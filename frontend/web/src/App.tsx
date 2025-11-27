import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VotingData {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  publicVoteCount: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedTotal: number;
  category: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votings, setVotings] = useState<VotingData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVoting, setCreatingVoting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVotingData, setNewVotingData] = useState({ 
    title: "", 
    description: "", 
    initialVotes: "",
    category: "general" 
  });
  const [selectedVoting, setSelectedVoting] = useState<VotingData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [stats, setStats] = useState({
    totalVotings: 0,
    verifiedVotings: 0,
    totalVotes: 0,
    activeVotings: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votingsList: VotingData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votingsList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedVotes: businessId,
            publicVoteCount: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedTotal: Number(businessData.decryptedValue) || 0,
            category: "voting"
          });
        } catch (e) {
          console.error('Error loading voting data:', e);
        }
      }
      
      setVotings(votingsList);
      updateStats(votingsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (votingsList: VotingData[]) => {
    const totalVotings = votingsList.length;
    const verifiedVotings = votingsList.filter(v => v.isVerified).length;
    const totalVotes = votingsList.reduce((sum, v) => sum + v.publicVoteCount, 0);
    const activeVotings = votingsList.filter(v => 
      Date.now()/1000 - v.timestamp < 60 * 60 * 24 * 7
    ).length;

    setStats({ totalVotings, verifiedVotings, totalVotes, activeVotings });
  };

  const createVoting = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVoting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating secure voting with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const initialVotes = parseInt(newVotingData.initialVotes) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, initialVotes);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVotingData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        initialVotes,
        0,
        newVotingData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Secure voting created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVotingData({ title: "", description: "", initialVotes: "", category: "general" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVoting(false); 
    }
  };

  const decryptVotes = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Votes decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE voting system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotings = votings.filter(voting => {
    const matchesSearch = voting.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         voting.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || voting.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const paginatedVotings = filteredVotings.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredVotings.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Secure Voting 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🗳️</div>
            <h2>Connect Wallet to Access Secure Voting</h2>
            <p>Private, encrypted voting powered by Zama FHE technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Voting System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure voting platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Secure Voting 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Voting
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <div className="stat-value">{stats.totalVotings}</div>
              <div className="stat-label">Total Votes</div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <div className="stat-value">{stats.verifiedVotings}</div>
              <div className="stat-label">Verified</div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">🔢</div>
            <div className="stat-content">
              <div className="stat-value">{stats.totalVotes}</div>
              <div className="stat-label">Total Count</div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">⚡</div>
            <div className="stat-content">
              <div className="stat-value">{stats.activeVotings}</div>
              <div className="stat-label">Active</div>
            </div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search votes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="filter-controls">
            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              <option value="voting">Voting</option>
            </select>
            
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="votings-list">
          {paginatedVotings.length === 0 ? (
            <div className="no-votings">
              <p>No secure votes found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Vote
              </button>
            </div>
          ) : (
            paginatedVotings.map((voting, index) => (
              <div 
                className={`voting-item ${voting.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedVoting(voting)}
              >
                <div className="voting-header">
                  <h3>{voting.title}</h3>
                  <span className={`status-badge ${voting.isVerified ? "verified" : "pending"}`}>
                    {voting.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <p className="voting-desc">{voting.description}</p>
                <div className="voting-meta">
                  <span>Votes: {voting.publicVoteCount}</span>
                  <span>Created: {new Date(voting.timestamp * 1000).toLocaleDateString()}</span>
                  {voting.isVerified && (
                    <span>Total: {voting.decryptedTotal}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            
            <span>Page {currentPage} of {totalPages}</span>
            
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateVoting 
          onSubmit={createVoting} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingVoting} 
          votingData={newVotingData} 
          setVotingData={setNewVotingData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVoting && (
        <VotingDetailModal 
          voting={selectedVoting} 
          onClose={() => setSelectedVoting(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptVotes={() => decryptVotes(selectedVoting.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateVoting: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  votingData: any;
  setVotingData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, votingData, setVotingData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'initialVotes') {
      const intValue = value.replace(/[^\d]/g, '');
      setVotingData({ ...votingData, [name]: intValue });
    } else {
      setVotingData({ ...votingData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-voting-modal">
        <div className="modal-header">
          <h2>Create Secure Voting</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encrypted Voting</strong>
            <p>Vote counts encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Voting Title *</label>
            <input 
              type="text" 
              name="title" 
              value={votingData.title} 
              onChange={handleChange} 
              placeholder="Enter voting title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={votingData.description} 
              onChange={handleChange} 
              placeholder="Describe this voting..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Initial Votes (Integer) *</label>
            <input 
              type="number" 
              name="initialVotes" 
              value={votingData.initialVotes} 
              onChange={handleChange} 
              placeholder="Enter initial vote count..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !votingData.title || !votingData.initialVotes} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Voting"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VotingDetailModal: React.FC<{
  voting: VotingData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptVotes: () => Promise<number | null>;
}> = ({ voting, onClose, isDecrypting, decryptVotes }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await decryptVotes();
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="voting-detail-modal">
        <div className="modal-header">
          <h2>Voting Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="voting-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{voting.title}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <strong>{voting.description}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{voting.creator.substring(0, 6)}...{voting.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(voting.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Vote Count</h3>
            
            <div className="vote-display">
              <div className="vote-count">
                {voting.isVerified ? 
                  `${voting.decryptedTotal} (Verified)` : 
                  localDecrypted !== null ? 
                  `${localDecrypted} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              
              <button 
                className={`decrypt-btn ${(voting.isVerified || localDecrypted !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 voting.isVerified ? "✅ Verified" : 
                 localDecrypted !== null ? "🔄 Re-verify" : 
                 "🔓 Decrypt Votes"}
              </button>
            </div>
            
            <div className="fhe-process">
              <div className="process-step">
                <span>1</span>
                <p>Votes encrypted with FHE</p>
              </div>
              <div className="process-step">
                <span>2</span>
                <p>Stored on-chain securely</p>
              </div>
              <div className="process-step">
                <span>3</span>
                <p>Offline decryption with proof</p>
              </div>
              <div className="process-step">
                <span>4</span>
                <p>On-chain verification</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!voting.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;