import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteData {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", description: "", voteCount: "" });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, active: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        console.error('FHEVM init failed:', error);
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadVotes();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Load failed:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const loadVotes = async () => {
    if (!isConnected) return;
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedVotes: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading vote:', e);
        }
      }
      
      setVotes(votesList);
      updateStats(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Load failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (votesList: VoteData[]) => {
    const total = votesList.length;
    const verified = votesList.filter(v => v.isVerified).length;
    const active = votesList.filter(v => Date.now()/1000 - v.timestamp < 86400).length;
    setStats({ total, verified, active });
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating vote with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      
      const voteValue = parseInt(newVoteData.voteCount) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadVotes();
      setShowCreateModal(false);
      setNewVoteData({ title: "", description: "", voteCount: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptVotes = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadVotes();
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadVotes();
        return null;
      }
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "Service is available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotes = votes.filter(vote => {
    const matchesSearch = vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vote.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || vote.isVerified;
    return matchesSearch && matchesFilter;
  });

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Votes</div>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon">✅</div>
        <div className="stat-content">
          <div className="stat-value">{stats.verified}</div>
          <div className="stat-label">Verified</div>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon">🔥</div>
        <div className="stat-content">
          <div className="stat-value">{stats.active}</div>
          <div className="stat-label">Active Today</div>
        </div>
      </div>
    </div>
  );

  const renderFHEProcess = () => (
    <div className="fhe-process">
      <div className="process-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <h4>Encrypt Votes</h4>
          <p>Vote counts encrypted with FHE before submission</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <h4>Store on Chain</h4>
          <p>Encrypted data stored securely on blockchain</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <h4>Homomorphic Tally</h4>
          <p>Perform calculations on encrypted data</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">4</div>
        <div className="step-content">
          <h4>Secure Decryption</h4>
          <p>Authorized parties can decrypt final results</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>FHE Secure Voting 🔐</h1>
            <p>Fully Homomorphic Encrypted Voting Platform</p>
          </div>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🗳️</div>
            <h2>Connect Your Wallet to Start Voting</h2>
            <p>Experience secure, private voting powered by Fully Homomorphic Encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="encryption-animation"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="encryption-animation"></div>
      <p>Loading Secure Voting Platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-main">
          <div className="logo-section">
            <h1>FHE Vote 🔐</h1>
            <span>Secure Encrypted Voting</span>
          </div>
          <div className="header-actions">
            <button className="availability-btn" onClick={checkAvailability}>
              Check Availability
            </button>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Fully Homomorphic Encrypted Voting</h2>
            <p>Vote with complete privacy. Your votes are encrypted end-to-end using advanced FHE technology.</p>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="stats-section">
          <h3>Voting Statistics</h3>
          {renderStats()}
        </section>

        <section className="votes-section">
          <div className="section-header">
            <h3>Active Voting Sessions</h3>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search votes..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <label className="filter-toggle">
                <input 
                  type="checkbox" 
                  checked={filterVerified}
                  onChange={(e) => setFilterVerified(e.target.checked)}
                />
                Verified Only
              </label>
              <button className="create-vote-btn" onClick={() => setShowCreateModal(true)}>
                + New Vote
              </button>
              <button className="refresh-btn" onClick={loadVotes} disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "↻"}
              </button>
            </div>
          </div>

          <div className="votes-list">
            {filteredVotes.length === 0 ? (
              <div className="empty-state">
                <p>No voting sessions found</p>
                <button onClick={() => setShowCreateModal(true)}>Create First Vote</button>
              </div>
            ) : (
              filteredVotes.map((vote) => (
                <div 
                  key={vote.id} 
                  className={`vote-card ${vote.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedVote(vote)}
                >
                  <div className="vote-header">
                    <h4>{vote.title}</h4>
                    <span className={`status ${vote.isVerified ? 'verified' : 'pending'}`}>
                      {vote.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  <p className="vote-desc">{vote.description}</p>
                  <div className="vote-meta">
                    <span>By: {vote.creator.substring(0, 8)}...</span>
                    <span>{new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  {vote.isVerified && vote.decryptedValue !== undefined && (
                    <div className="vote-result">
                      Final Count: <strong>{vote.decryptedValue}</strong>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreateVoteModal
          onSubmit={createVote}
          onClose={() => setShowCreateModal(false)}
          creating={creatingVote}
          voteData={newVoteData}
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedVote && (
        <VoteDetailModal
          vote={selectedVote}
          onClose={() => setSelectedVote(null)}
          isDecrypting={isDecrypting || fheIsDecrypting}
          onDecrypt={() => decryptVotes(selectedVote.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>FHE Secure Voting Platform - Powered by Zama FHE Technology</p>
      </footer>
    </div>
  );
};

const CreateVoteModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'voteCount') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Create New Encrypted Vote</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Voting</strong>
              <p>Vote counts will be encrypted using Fully Homomorphic Encryption</p>
            </div>
          </div>

          <div className="form-group">
            <label>Vote Title *</label>
            <input
              type="text"
              name="title"
              value={voteData.title}
              onChange={handleChange}
              placeholder="Enter vote title..."
            />
          </div>

          <div className="form-group">
            <label>Description *</label>
            <textarea
              name="description"
              value={voteData.description}
              onChange={handleChange}
              placeholder="Describe this voting session..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Initial Vote Count (Integer) *</label>
            <input
              type="number"
              name="voteCount"
              value={voteData.voteCount}
              onChange={handleChange}
              placeholder="Enter initial count..."
              min="0"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.description || !voteData.voteCount}
            className="primary-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  isDecrypting: boolean;
  onDecrypt: () => Promise<number | null>;
}> = ({ vote, onClose, isDecrypting, onDecrypt }) => {
  const handleDecrypt = async () => {
    await onDecrypt();
  };

  return (
    <div className="modal-overlay">
      <div className="modal large">
        <div className="modal-header">
          <h3>Vote Details</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-grid">
              <div className="info-item">
                <label>Title:</label>
                <span>{vote.title}</span>
              </div>
              <div className="info-item">
                <label>Creator:</label>
                <span>{vote.creator.substring(0, 10)}...{vote.creator.substring(38)}</span>
              </div>
              <div className="info-item">
                <label>Created:</label>
                <span>{new Date(vote.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="info-item">
                <label>Status:</label>
                <span className={`status ${vote.isVerified ? 'verified' : 'encrypted'}`}>
                  {vote.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                </span>
              </div>
            </div>

            <div className="description">
              <label>Description:</label>
              <p>{vote.description}</p>
            </div>
          </div>

          <div className="vote-data">
            <h4>Vote Count Data</h4>
            <div className="data-section">
              <div className="data-item">
                <label>Current Status:</label>
                <div className="data-value">
                  {vote.isVerified ? (
                    <span className="decrypted-value">Decrypted: {vote.decryptedValue} votes</span>
                  ) : (
                    <span className="encrypted-value">🔐 FHE Encrypted</span>
                  )}
                </div>
              </div>

              <div className="decrypt-action">
                <button 
                  onClick={handleDecrypt}
                  disabled={isDecrypting || vote.isVerified}
                  className={`decrypt-btn ${vote.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? "Decrypting..." : 
                   vote.isVerified ? "✅ Verified" : "🔓 Decrypt Votes"}
                </button>
                {!vote.isVerified && (
                  <p className="decrypt-hint">
                    Decrypt the vote count using FHE verification
                  </p>
                )}
              </div>
            </div>
          </div>

          {vote.isVerified && vote.decryptedValue !== undefined && (
            <div className="results-section">
              <h4>Final Results</h4>
              <div className="result-display">
                <div className="result-value">{vote.decryptedValue}</div>
                <div className="result-label">Total Votes</div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

