import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

interface CreditTransaction {
  id: string;
  amount: number;
  transaction_type: string;
  tier: string | null;
  stripe_session_id: string | null;
  task_id: string | null;
  description: string | null;
  created_at: string;
}

interface UserCredits {
  credits: number;
  created_at: string;
  updated_at: string;
}

export function CreditDashboard() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<UserCredits | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  useEffect(() => {
    if (user) {
      loadCreditData();
    }
  }, [user]);

  const loadCreditData = async () => {
    try {
      setLoading(true);
      setError('');

      // Load current credit balance
      const { data: creditsData, error: creditsError } = await supabase
        .from('user_credits')
        .select('credits, created_at, updated_at')
        .eq('user_id', user?.id)
        .single();

      if (creditsError && creditsError.code !== 'PGRST116') {
        throw creditsError;
      }

      if (creditsData) {
        setCredits(creditsData);
      } else {
        // User has no credit record, initialize with 0
        setCredits({ credits: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }

      // Load transaction history
      const { data: transactionsData, error: transactionsError } = await supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (transactionsError) {
        throw transactionsError;
      }

      setTransactions(transactionsData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load credit data');
    } finally {
      setLoading(false);
    }
  };

  const formatTransactionType = (type: string) => {
    switch (type) {
      case 'purchase': return 'Purchase';
      case 'usage': return 'Usage';
      case 'refund': return 'Refund';
      case 'bonus': return 'Bonus';
      default: return type;
    }
  };

  const formatAmount = (amount: number) => {
    return amount > 0 ? `+${amount}` : amount.toString();
  };

  const getTransactionDescription = (transaction: CreditTransaction) => {
    switch (transaction.transaction_type) {
      case 'purchase':
        return transaction.tier ? `Purchased ${transaction.amount} credits (${transaction.tier.replace('_', ' ')})` : `Purchased ${transaction.amount} credits`;
      case 'usage':
        return transaction.description || `Used ${Math.abs(transaction.amount)} credits for task`;
      case 'refund':
        return transaction.description || `Refunded ${transaction.amount} credits`;
      case 'bonus':
        return transaction.description || `Received ${transaction.amount} bonus credits`;
      default:
        return transaction.description || `${formatTransactionType(transaction.transaction_type)} ${transaction.amount} credits`;
    }
  };

  if (!user) {
    return (
      <div className="bg-slate-50 border-2 border-slate-300 rounded-lg p-6">
        <p className="text-slate-600">Please sign in to view your credit balance and transaction history.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-slate-50 border-2 border-slate-300 rounded-lg p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
          <span className="ml-3 text-slate-600">Loading credit data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border-2 border-red-400 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Credit Balance Card */}
      <div className="bg-white border-4 border-slate-900 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black text-slate-900">Credit Balance</h2>
          <button
            onClick={() => setShowPurchaseModal(true)}
            className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-lg"
          >
            Add Credits
          </button>
        </div>

        <div className="bg-slate-900 text-amber-400 rounded-lg p-6 text-center">
          <div className="text-4xl font-black mb-2">{credits?.credits || 0}</div>
          <div className="text-sm uppercase tracking-wider">Available Credits</div>
        </div>

        <div className="mt-4 text-sm text-slate-600">
          <p>Last updated: {new Date(credits?.updated_at || '').toLocaleString()}</p>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white border-4 border-slate-900 rounded-xl p-6">
        <h2 className="text-xl font-black text-slate-900 mb-4">Transaction History</h2>
        
        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-slate-600">No transactions yet. Purchase credits or complete tasks to see your history.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-300">
                  <th className="text-left py-3 px-4 font-black text-slate-900">Date</th>
                  <th className="text-left py-3 px-4 font-black text-slate-900">Type</th>
                  <th className="text-left py-3 px-4 font-black text-slate-900">Description</th>
                  <th className="text-right py-3 px-4 font-black text-slate-900">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {transactions.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(transaction.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        transaction.transaction_type === 'purchase' ? 'bg-green-100 text-green-800' :
                        transaction.transaction_type === 'usage' ? 'bg-red-100 text-red-800' :
                        transaction.transaction_type === 'refund' ? 'bg-blue-100 text-blue-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {formatTransactionType(transaction.transaction_type)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {getTransactionDescription(transaction)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right font-mono font-bold ${
                      transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                    }">
                      {formatAmount(transaction.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Purchase Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full border-4 border-slate-900 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b-4 border-slate-900 flex items-center justify-between">
              <h2 className="text-2xl font-black text-slate-900">
                Purchase Credits
              </h2>
              <button
                onClick={() => setShowPurchaseModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-slate-600 mb-6">
                Select a credit package to purchase. All purchases are one-time and credits never expire.
              </p>
              {/* Credit packages will be rendered here */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
