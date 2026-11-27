// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SehatVault — integrity commitments + revocable share permissions.
/// Stores only opaque IDs and salted hashes. No medical data on-chain.
contract SehatVault {
    address public owner;
    mapping(address => bool) public relayers;

    struct Share {
        bytes32 patient;      // opaque patient id (keccak of salted user id)
        bytes32 scope;        // hash of the shared record-id list
        uint64  expiresAt;
        bool    revoked;
    }

    mapping(bytes32 => mapping(bytes32 => bool)) private records; // patient => commitment => registered
    mapping(bytes32 => Share) public shares;

    event RecordRegistered(bytes32 indexed patient, bytes32 commitment);
    event ShareCreated(bytes32 indexed shareId, bytes32 indexed patient, uint64 expiresAt);
    event ShareRevoked(bytes32 indexed shareId);
    event ShareAccessed(bytes32 indexed shareId, uint64 accessedAt);
    event RelayerSet(address relayer, bool allowed);

    modifier onlyOwner()   { require(msg.sender == owner, "not owner"); _; }
    modifier onlyRelayer() { require(relayers[msg.sender], "not relayer"); _; }

    constructor() {
        owner = msg.sender;
        relayers[msg.sender] = true;
        emit RelayerSet(msg.sender, true);
    }

    function setRelayer(address r, bool allowed) external onlyOwner {
        relayers[r] = allowed;
        emit RelayerSet(r, allowed);
    }

    function registerRecord(bytes32 patient, bytes32 commitment) external onlyRelayer {
        require(commitment != bytes32(0), "empty");
        require(!records[patient][commitment], "duplicate");
        records[patient][commitment] = true;
        emit RecordRegistered(patient, commitment);
    }

    function verifyRecord(bytes32 patient, bytes32 commitment) external view returns (bool) {
        return records[patient][commitment];
    }

    function createShare(bytes32 shareId, bytes32 patient, bytes32 scope, uint64 expiresAt)
        external onlyRelayer
    {
        require(shares[shareId].expiresAt == 0, "share exists");
        require(expiresAt > block.timestamp, "bad expiry");
        shares[shareId] = Share(patient, scope, expiresAt, false);
        emit ShareCreated(shareId, patient, expiresAt);
    }

    function revokeShare(bytes32 shareId, bytes32 patient) external onlyRelayer {
        Share storage s = shares[shareId];
        require(s.expiresAt != 0, "no share");
        require(s.patient == patient, "not patient share");
        require(!s.revoked, "already revoked");
        s.revoked = true;
        emit ShareRevoked(shareId);
    }

    function isShareActive(bytes32 shareId) public view returns (bool) {
        Share memory s = shares[shareId];
        return s.expiresAt != 0 && !s.revoked && block.timestamp <= s.expiresAt;
    }

    function logAccess(bytes32 shareId) external onlyRelayer {
        require(isShareActive(shareId), "inactive");
        emit ShareAccessed(shareId, uint64(block.timestamp));
    }
}
