// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract DecentralisedPoker is ReentrancyGuard, EIP712 {

    constructor() EIP712("DecentralisedPoker", "1") {}

    enum Status { None, Open, Started, Cancelled, Finalized, Refunded }

    struct Table {
        address creator;
        uint256 buyIn;            // wei, divisible by 1000
        uint32 handCount;
        Status status;
        uint8 seatsFilled;        // 0..4
        uint256 totalDeposited;
        uint64 checkpointNumber;  // latest accepted checkpoint (0 = none)
        uint64 startedAt;
        uint64 challengeEnd;
        address[4] players;       // seat 0..3
        address[4] sessionKeys;   // seat 0..3
    }

    uint256 public nextTableId = 1;

    bytes32 public constant CHECKPOINT_TYPEHASH = keccak256(
        "Checkpoint(uint256 tableId,uint64 checkpointNumber,uint256[4] balances,bool[4] evicted)"
    );
    uint64 public constant CHALLENGE_WINDOW = 2 minutes;

    // balances from the latest accepted checkpoint, paid out on finalize
    mapping(uint256 => uint256[4]) private pendingBalances;

    event CheckpointSubmitted(uint256 indexed tableId, uint64 checkpointNumber, address indexed by, uint64 challengeEnd);
    event Finalized(uint256 indexed tableId, uint64 checkpointNumber);

    mapping(uint256 => Table) private tables;
    // tableId => seat => wei the seat can pull out
    mapping(uint256 => mapping(uint8 => uint256)) public withdrawable;

    event TableCreated(uint256 indexed tableId, address indexed creator, uint256 buyIn, uint32 handCount);
    event PlayerJoined(uint256 indexed tableId, uint8 seat, address indexed wallet, address sessionKey);
    event TableStarted(uint256 indexed tableId, uint64 startedAt);
    event TableCancelled(uint256 indexed tableId, address indexed by);
    event Withdrawn(uint256 indexed tableId, uint8 seat, address indexed wallet, uint256 amount);
    event EmergencyRefund(uint256 indexed tableId, address indexed by);

    function refundDeadline(uint256 tableId) public view returns (uint256) {
        Table storage t = tables[tableId];
        // 1 hour base + 5 minutes per hand, so long games aren't refunded mid-play
        return uint256(t.startedAt) + 1 hours + uint256(t.handCount) * 5 minutes;
    }

    function emergencyRefund(uint256 tableId) external {
        Table storage t = tables[tableId];
        require(t.status == Status.Started, "NOT_STARTED");
        require(t.checkpointNumber == 0, "CHECKPOINT_EXISTS");
        require(block.timestamp > refundDeadline(tableId), "TOO_EARLY");
        (bool found, ) = seatOf(tableId, msg.sender);
        require(found, "NOT_A_PLAYER");

        t.status = Status.Refunded;
        for (uint8 i = 0; i < 4; i++) {
            withdrawable[tableId][i] = t.buyIn;
        }
        emit EmergencyRefund(tableId, msg.sender);
    }
    function checkpointDigest(
        uint256 tableId,
        uint64 checkpointNumber,
        uint256[4] memory balances,
        bool[4] memory evicted
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CHECKPOINT_TYPEHASH,
                    tableId,
                    checkpointNumber,
                    keccak256(abi.encodePacked(balances)),
                    keccak256(abi.encodePacked(evicted))
                )
            )
        );
    }

    function submitCheckpoint(
        uint256 tableId,
        uint64 checkpointNumber,
        uint256[4] calldata balances,
        bool[4] calldata evicted,
        bytes[4] calldata signatures
    ) external {
        Table storage t = tables[tableId];
        require(t.status == Status.Started, "NOT_STARTED");
        (bool found, ) = seatOf(tableId, msg.sender);
        require(found, "NOT_A_PLAYER");
        require(checkpointNumber > t.checkpointNumber, "STALE_CHECKPOINT");
        require(t.challengeEnd == 0 || block.timestamp < t.challengeEnd, "WINDOW_CLOSED");

        uint256 weiPerChip = t.buyIn / 1000;
        uint256 sum;
        for (uint8 i = 0; i < 4; i++) {
            require(balances[i] % weiPerChip == 0, "BAD_CHIP_AMOUNT");
            sum += balances[i];
        }
        require(sum == t.totalDeposited, "BALANCE_MISMATCH");

        bytes32 digest = checkpointDigest(tableId, checkpointNumber, balances, evicted);
        uint8 signers;
        for (uint8 i = 0; i < 4; i++) {
            if (evicted[i]) continue; // evicted seats don't sign
            require(ECDSA.recover(digest, signatures[i]) == t.sessionKeys[i], "BAD_SIGNATURE");
            signers++;
        }
        require(signers >= 3, "TOO_FEW_SIGNERS");

        t.checkpointNumber = checkpointNumber;
        t.challengeEnd = uint64(block.timestamp) + CHALLENGE_WINDOW;
        pendingBalances[tableId] = balances;

        emit CheckpointSubmitted(tableId, checkpointNumber, msg.sender, t.challengeEnd);
    }

    function finalize(uint256 tableId) external {
        Table storage t = tables[tableId];
        require(t.status == Status.Started, "NOT_STARTED");
        require(t.challengeEnd != 0, "NO_CHECKPOINT");
        require(block.timestamp >= t.challengeEnd, "WINDOW_OPEN");

        t.status = Status.Finalized;
        for (uint8 i = 0; i < 4; i++) {
            withdrawable[tableId][i] = pendingBalances[tableId][i];
        }
        emit Finalized(tableId, t.checkpointNumber);
    }

    // ---------- views ----------

    function getTable(uint256 tableId) external view returns (Table memory) {
        return tables[tableId];
    }

    function seatOf(uint256 tableId, address wallet) public view returns (bool found, uint8 seat) {
        Table storage t = tables[tableId];
        for (uint8 i = 0; i < t.seatsFilled; i++) {
            if (t.players[i] == wallet) return (true, i);
        }
        return (false, 0);
    }

    // ---------- create / join / cancel ----------

    function createTable(uint256 buyIn, uint32 handCount, address sessionKey)
        external
        payable
        returns (uint256 tableId)
    {
        require(buyIn > 0 && buyIn % 1000 == 0, "BUYIN_NOT_DIVISIBLE_BY_1000");
        require(handCount > 0, "NO_HANDS");
        require(msg.value == buyIn, "WRONG_BUYIN");
        require(sessionKey != address(0), "BAD_SESSION_KEY");

        tableId = nextTableId++;
        Table storage t = tables[tableId];
        t.creator = msg.sender;
        t.buyIn = buyIn;
        t.handCount = handCount;
        t.status = Status.Open;
        t.seatsFilled = 1;
        t.totalDeposited = buyIn;
        t.players[0] = msg.sender;
        t.sessionKeys[0] = sessionKey;

        emit TableCreated(tableId, msg.sender, buyIn, handCount);
        emit PlayerJoined(tableId, 0, msg.sender, sessionKey);
    }

    function joinTable(uint256 tableId, address sessionKey) external payable {
        Table storage t = tables[tableId];
        require(t.status == Status.Open, "NOT_OPEN");
        require(msg.value == t.buyIn, "WRONG_BUYIN");
        require(sessionKey != address(0), "BAD_SESSION_KEY");

        for (uint8 i = 0; i < t.seatsFilled; i++) {
            require(t.players[i] != msg.sender, "ALREADY_SEATED");
            require(t.sessionKeys[i] != sessionKey, "SESSION_KEY_TAKEN");
        }

        uint8 seat = t.seatsFilled;
        t.players[seat] = msg.sender;
        t.sessionKeys[seat] = sessionKey;
        t.seatsFilled = seat + 1;
        t.totalDeposited += msg.value;

        emit PlayerJoined(tableId, seat, msg.sender, sessionKey);

        if (t.seatsFilled == 4) {
            t.status = Status.Started;
            t.startedAt = uint64(block.timestamp);
            emit TableStarted(tableId, t.startedAt);
        }
    }

    /// Any seated player can cancel while the table is not full.
    /// Everyone's deposit becomes withdrawable.
    function cancelTable(uint256 tableId) external {
        Table storage t = tables[tableId];
        require(t.status == Status.Open, "NOT_OPEN");
        (bool found, ) = seatOf(tableId, msg.sender);
        require(found, "NOT_A_PLAYER");

        t.status = Status.Cancelled;
        for (uint8 i = 0; i < t.seatsFilled; i++) {
            withdrawable[tableId][i] = t.buyIn;
        }
        emit TableCancelled(tableId, msg.sender);
    }

    // ---------- withdraw (pull payment) ----------

    function withdraw(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == Status.Cancelled || t.status == Status.Finalized || t.status == Status.Refunded, "NOT_WITHDRAWABLE");

        (bool found, uint8 seat) = seatOf(tableId, msg.sender);
        require(found, "NOT_A_PLAYER");

        uint256 amount = withdrawable[tableId][seat];
        require(amount > 0, "NOTHING_TO_WITHDRAW");

        withdrawable[tableId][seat] = 0;          // state first
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "TRANSFER_FAILED");

        emit Withdrawn(tableId, seat, msg.sender, amount);
    }
}