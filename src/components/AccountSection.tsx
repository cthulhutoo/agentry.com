import { Wallet, TrendingUp, Clock, Zap } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AuthModal } from './AuthModal';

interface UserAccount {
  id: string;
  credits: number;
  total_spent: number;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

interface Subscription {
  id: string;
  status: string;
  started_at: string;
  next_billing_date: string;
  pricing_plan: {
    name: string;
    credits: number;
  };
}

export function AccountSection() {
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    loadAccountData();
  }, []);

  const loadAccountData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const [accountRes, transactionsRes, subscriptionRes] = await Promise.all([
        supabase
          .from('user_accounts')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('credit_transactions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('subscriptions')
          .select(`
            *,
            pricing_plan:pricing_plans(name, credits)
          `)
          .eq('status', 'active')
          .maybeSingle()
      ]);

      if (accountRes.data) setAccount(accountRes.data);
      if (transactionsRes.data) setTransactions(transactionsRes.data);
      if (subscriptionRes.data) setSubscription(subscriptionRes.data as any);
    } catch (error) {
      console.error('Error loading account:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSuccess = async () => {
    await loadAccountData();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'purchase':
      case 'subscription':
      case 'bonus':
        return 'text-emerald-600';
      case 'usage':
        return 'text-red-600';
      default:
        return 'text-slate-600';
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-xl shadow-lg p-8 border-4 border-slate-900 text-center">
          <h3 className="text-2xl font-black text-slate-900 mb-4">No Account Found</h3>
          <p className="text-slate-600 mb-6">Create your account to start using Agentry and get 10 free credits to try it out!</p>
          <button
            onClick={() => setShowAuth(true)}
            className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-8 rounded-lg transition-all duration-200"
          >
            Create Account & Get 10 Free Credits
          </button>
        </div>

        <AuthModal
          isOpen={showAuth}
          onClose={() => setShowAuth(false)}
          onSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h2 className="text-4xl font-black text-slate-900 mb-8" style={{
        textShadow: '2px 2px 0px rgba(251,191,36,0.3)',
      }}>
        YOUR ACCOUNT
      </h2>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl shadow-lg p-6 text-slate-900">
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="w-8 h-8" />
            <h3 className="text-lg font-bold">Available Credits</h3>
          </div>
          <div className="text-5xl font-black">{account.credits.toFixed(0)}</div>
          <p className="text-sm mt-2 opacity-90">Ready to use</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-4 border-slate-900">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-8 h-8 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900">Total Spent</h3>
          </div>
          <div className="text-5xl font-black text-slate-900">${account.total_spent.toFixed(2)}</div>
          <p className="text-sm text-slate-600 mt-2">Lifetime investment</p>
        </div>

        {subscription && (
          <div className="bg-white rounded-xl shadow-lg p-6 border-4 border-cyan-400">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="w-8 h-8 text-cyan-600" />
              <h3 className="text-lg font-bold text-slate-900">Active Plan</h3>
            </div>
            <div className="text-3xl font-black text-slate-900">{subscription.pricing_plan.name}</div>
            <p className="text-sm text-slate-600 mt-2">
              Renews {formatDate(subscription.next_billing_date)}
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 border-4 border-slate-900">
        <div className="flex items-center gap-3 mb-6">
          <Clock className="w-6 h-6 text-slate-900" />
          <h3 className="text-2xl font-black text-slate-900">Recent Transactions</h3>
        </div>

        {transactions.length === 0 ? (
          <p className="text-slate-600 text-center py-8">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className="flex-1">
                  <div className="font-bold text-slate-900">{transaction.description || transaction.type}</div>
                  <div className="text-sm text-slate-600">{formatDate(transaction.created_at)}</div>
                </div>
                <div className={`text-xl font-black ${getTransactionColor(transaction.type)}`}>
                  {transaction.amount > 0 ? '+' : ''}{transaction.amount.toFixed(0)} credits
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 text-center">
        <button onClick={() => window.location.href = "#pricing"} className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-8 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl">
          Add More Credits
        </button>
      </div>
    </div>
  );
}
