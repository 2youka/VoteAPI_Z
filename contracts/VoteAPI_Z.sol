pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VoteAPI_Z is ZamaEthereumConfig {
    struct EncryptedVote {
        euint32 encryptedVoteValue;
        uint256 publicVoterId;
        uint256 timestamp;
        bool isDecrypted;
        uint32 decryptedVoteValue;
    }

    mapping(uint256 => EncryptedVote) public encryptedVotes;
    uint256[] public voteIds;

    event VoteCast(uint256 indexed voteId, address indexed voter);
    event VoteDecrypted(uint256 indexed voteId, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {
        // Initialize contract with Zama configuration
    }

    function castVote(
        uint256 publicVoterId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted vote");

        uint256 voteId = voteIds.length;
        encryptedVotes[voteId] = EncryptedVote({
            encryptedVoteValue: FHE.fromExternal(encryptedVote, inputProof),
            publicVoterId: publicVoterId,
            timestamp: block.timestamp,
            isDecrypted: false,
            decryptedVoteValue: 0
        });

        FHE.allowThis(encryptedVotes[voteId].encryptedVoteValue);
        FHE.makePubliclyDecryptable(encryptedVotes[voteId].encryptedVoteValue);

        voteIds.push(voteId);
        emit VoteCast(voteId, msg.sender);
    }

    function decryptVote(
        uint256 voteId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(voteId < voteIds.length, "Vote does not exist");
        require(!encryptedVotes[voteId].isDecrypted, "Vote already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedVotes[voteId].encryptedVoteValue);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        encryptedVotes[voteId].decryptedVoteValue = decodedValue;
        encryptedVotes[voteId].isDecrypted = true;

        emit VoteDecrypted(voteId, decodedValue);
    }

    function getEncryptedVote(uint256 voteId) external view returns (euint32) {
        require(voteId < voteIds.length, "Vote does not exist");
        return encryptedVotes[voteId].encryptedVoteValue;
    }

    function getVoteDetails(uint256 voteId) external view returns (
        uint256 publicVoterId,
        uint256 timestamp,
        bool isDecrypted,
        uint32 decryptedVoteValue
    ) {
        require(voteId < voteIds.length, "Vote does not exist");
        EncryptedVote storage vote = encryptedVotes[voteId];

        return (
            vote.publicVoterId,
            vote.timestamp,
            vote.isDecrypted,
            vote.decryptedVoteValue
        );
    }

    function getAllVoteIds() external view returns (uint256[] memory) {
        return voteIds;
    }

    function tallyVotes() external view returns (uint32 totalVotes) {
        for (uint256 i = 0; i < voteIds.length; i++) {
            require(encryptedVotes[i].isDecrypted, "Some votes not decrypted");
            totalVotes += encryptedVotes[i].decryptedVoteValue;
        }
        return totalVotes;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

