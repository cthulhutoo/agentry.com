import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

const creditPackages = [
  {
    id: 'pkg_starter',
    name: 'Starter Pack',
    credits: 50,
    price: 5,
    bonusCredits: 0,
    description: 'Perfect for getting started',
    features: ['50 credits', 'One-time purchase']
  },
  {
    id: 'pkg_standard',
    name: 'Standard Pack',
    credits: 150,
    price: 15,
    bonusCredits: 30,
    description: 'Best value for regular users',
    features: ['150 credits', '+30 bonus credits', 'Great value']
  },
  {
    id: 'pkg_pro',
    name: 'Pro Pack',
    credits: 300,
    price: 30,
    bonusCredits: 100,
    description: 'For power users and small teams',
    features: ['300 credits', '+100 bonus credits', 'Premium value']
  },
  {
    id: 'pkg_enterprise',
    name: 'Enterprise Pack',
    credits: 750,
    price: 75,
    bonusCredits: 450,
    description: 'For organizations with advanced needs',
    features: ['750 credits', '+450 bonus credits', 'Maximum value']
  }
];

interface CreditPurchaseProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function CreditPurchase({ onSuccess, onClose }: CreditPurchaseProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPackage, setSelectedPackage] = useState(creditPackages[0]);
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const { user } = useAuth();

  const handlePurchase = async () => {
    if (!user) {
      setError('You must be signed in to purchase credits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call the stripe-checkout function
      const { data, error: fetchError } = await fetch('/functions/v1/stripe-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await supabase.auth.getSession().then(r => r.data.session?.access_token)}`
        },
        body: JSON.stringify({
          tier: selectedPackage.id.replace('pkg_', '')
        })
      }).then(r => r.json());

      if (fetchError || !data) {
        throw new Error('Failed to create checkout session');
      }

      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || 'An error occurred during purchase');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full border-4 border-slate-900 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b-4 border-slate-900 flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-900">
            Purchase Credits
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
            disabled={loading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {purchaseComplete ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Purchase Successful!</h3>
            <p className="text-slate-600 mb-6">
              Your credits have been added to your account. You can now use them to run AI agent councils.
            </p>
            <button
              onClick={onSuccess}
              className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg"
            >
              Start Using Credits
            </button>
          </div>
        ) : (
          <div className="p-6">
            {error && (
              <div className="bg-red-50 border-2 border-red-400 rounded-lg p-4 mb-6">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="grid md:grid-cols-4 gap-4 mb-8">
              {creditPackages.map((pkg) => (
                <div
                  key={pkg.id}
                  className={`border-4 rounded-xl p-6 cursor-pointer transition-all duration-200 text-center ${
                    selectedPackage.id === pkg.id
                      ? 'border-amber-400 bg-amber-50 shadow-lg'
                      : 'border-slate-300 hover:border-slate-400'
                  }`}
                  onClick={() => setSelectedPackage(pkg)}
                >
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-black text-slate-900 mb-1">{pkg.name}</h3>
                      <p className="text-sm text-slate-600">{pkg.description}</p>
                    </div>

                    <div className="bg-slate-900 text-amber-400 rounded-lg p-4 font-mono">
                      <div className="text-2xl font-black">${pkg.price}</div>
                      <div className="text-sm">one-time purchase</div>
                    </div>

                    <div className="space-y-2">
                      <div className="bg-slate-100 rounded-lg p-3">
                        <div className="text-sm font-bold text-slate-900">{pkg.credits} Credits</div>
                      </div>
                      {pkg.bonusCredits > 0 && (
                        <div className="bg-green-100 border-2 border-green-400 rounded-lg p-3">
                          <div className="text-sm font-bold text-green-800">+{pkg.bonusCredits} Bonus</div>
                        </div>
                      )}
                    </div>

                    <ul className="text-left text-sm text-slate-600 space-y-1 mt-4">
                      {pkg.features.map((feature, index) => (
                        <li key={index} className="flex items-center">
                          <svg className="w-4 h-4 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-6">
              <p className="text-sm text-slate-800">
                <strong>Pro Tip:</strong> The <strong>Standard Pack</strong> offers the best value with 30% bonus credits. 
                Power users should consider the <strong>Pro</strong> or <strong>Enterprise</strong> packs for maximum savings.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handlePurchase}
                disabled={loading}
                className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-8 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex-1 sm:flex-none"
              >
                {loading ? 'Processing...' : `Purchase ${selectedPackage.name}`}
              </button>
              
              <button
                onClick={onClose}
                disabled={loading}
                className="border-2 border-slate-900 text-slate-900 hover:bg-slate-100 font-bold py-3 px-8 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-none"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
