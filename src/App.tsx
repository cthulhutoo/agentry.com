import { AuthProvider } from './hooks/useAuth';
import { CreditDashboard } from './components/billing/CreditDashboard';
import { CreditPurchase } from './components/billing/CreditPurchase';
import { AgentTemplates } from './components/agents';
import { useState } from 'react';

type Tab = 'dashboard' | 'agents';

function App() {
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('agents');

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <header className="bg-white shadow-sm border-b-4 border-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-black text-slate-900">Agentry</h1>
              <div className="flex items-center gap-4">
                <nav className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('agents')}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      activeTab === 'agents'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    🤖 Agents
                  </button>
                  <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      activeTab === 'dashboard'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    💳 Dashboard
                  </button>
                </nav>
                <button
                  onClick={() => setShowPurchaseModal(true)}
                  className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-lg"
                >
                  Add Credits
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === 'dashboard' ? (
            <CreditDashboard />
          ) : (
            <AgentTemplates credits={100} onTaskComplete={(result) => console.log('Task complete:', result)} />
          )}
        </main>

        {showPurchaseModal && (
          <CreditPurchase
            onSuccess={() => {
              setShowPurchaseModal(false);
              // Refresh credit data
            }}
            onClose={() => setShowPurchaseModal(false)}
          />
        )}
      </div>
    </AuthProvider>
  );
}

export default App;
