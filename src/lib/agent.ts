import type { Content, Part } from "@google/genai";
import { ai, MODEL } from "./gemini";
import { TOOLS, runTool } from "./tools";
import { loadRecords } from "./records";
import { errorMessage, type Ctx } from "./server";

const AGENT_SYSTEM = `You are Sehat AI, a medical RECORDS assistant for one patient.
- Answer ONLY from tool results about this patient's own records. Mention dates and doctors from the records.
- If information is not in the records, say: "I couldn't find that in your uploaded records."
- Never diagnose, never recommend medicines or dose changes. You may say "please discuss this with your doctor."
- For visit preparation: search relevant records (use several keywords), compare labs if useful, call generate_visit_brief,
  then call request_approval with the chosen record ids, the requested duration (default 24 hours) and the brief text.
  Never claim something was shared before approval.
- Keep answers short and clear. If the user writes Urdu or Roman Urdu, reply in the same language.`;

export type Step = { name: string; ok: boolean; summary: string };
export type Approval = {
  record_ids: string[];
  duration_hours: number;
  brief: string;
  records: { id: string; date: string | null; type: string | null; doctor: string | null; summary: string | null }[];
};
export type AgentResult = { steps: Step[]; answer: string; approval?: Approval };
export type ChatTurn = { role: "user" | "model"; text: string };

function summarize(name: string, result: unknown): string {
  const obj = (result ?? {}) as Record<string, unknown>;
  if (name === "search_records") {
    const n = (obj.records as unknown[] | undefined)?.length ?? 0;
    return obj.note ? `No direct match, reviewed all ${n} records` : `Found ${n} relevant records`;
  }
  if (name === "list_medications") return `Found ${Array.isArray(result) ? result.length : 0} medication entries`;
  if (name === "compare_lab_results") return `Found ${(obj.values as unknown[] | undefined)?.length ?? 0} results`;
  if (name === "generate_visit_brief") return "Consultation brief ready";
  if (name === "verify_document") return obj.intact ? "Document intact" : "Document modified";
  return "Done";
}

async function buildApproval(ctx: Ctx, args: Record<string, unknown>): Promise<Approval> {
  const ids = Array.isArray(args.record_ids) ? args.record_ids.filter((x): x is string => typeof x === "string") : [];
  const recs = await loadRecords(ctx, ids);
  const hours = Number(args.duration_hours) || 24;
  return {
    record_ids: recs.map((r) => r.id),
    duration_hours: Math.min(168, Math.max(1, Math.round(hours))),
    brief: typeof args.brief === "string" ? args.brief : "",
    records: recs.map((r) => ({ id: r.id, date: r.doc_date, type: r.doc_type, doctor: r.doctor, summary: r.summary })),
  };
}

export async function runAgent(ctx: Ctx, message: string, history: ChatTurn[]): Promise<AgentResult> {
  const contents: Content[] = [
    ...history.slice(-10).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  const steps: Step[] = [];

  for (let i = 0; i < 8; i++) {
    const res = await ai().models.generateContent({
      model: MODEL(),
      contents,
      config: { systemInstruction: AGENT_SYSTEM, tools: [{ functionDeclarations: TOOLS }], temperature: 0.2 },
    });
    const calls = res.functionCalls ?? [];
    if (!calls.length) return { steps, answer: res.text ?? "" };

    const modelTurn = res.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    const responses: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      if (name === "request_approval") {
        steps.push({ name, ok: true, summary: "Waiting for your approval" });
        return {
          steps,
          answer: "Your consultation brief is ready. Review the records below and approve to create a secure QR link.",
          approval: await buildApproval(ctx, args),
        };
      }
      try {
        const result = await runTool(name, args, ctx);
        steps.push({ name, ok: true, summary: summarize(name, result) });
        responses.push({ functionResponse: { name, response: { result } } });
      } catch (e) {
        steps.push({ name, ok: false, summary: errorMessage(e) });
        responses.push({ functionResponse: { name, response: { error: errorMessage(e) } } });
      }
    }
    contents.push({ role: "user", parts: responses });
  }
  return { steps, answer: "I stopped after several steps. Please try a more specific request." };
}
