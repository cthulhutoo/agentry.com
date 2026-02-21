import { AuthProvider } from './hooks/useAuth';
import { CreditDashboard } from './components/billing/CreditDashboard';
import { CreditPurchase } from './components/billing/CreditPurchase';
import { useState } from 'react';

function App() {
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <header className="bg-white shadow-sm border-b-4 border-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-black text-slate-900">Agentry</h1>
              <button
                onClick={() => setShowPurchaseModal(true)}
                className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-lg"
              >
                Add Credits
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <CreditDashboard />
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
