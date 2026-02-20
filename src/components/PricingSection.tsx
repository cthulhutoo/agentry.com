import { Check, Zap, Crown, Rocket } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AuthModal } from './AuthModal';

interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  credits: number;
  features: string[];
  sort_order: number;
}

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  bonus_credits: number;
  sort_order: number;
}

export function PricingSection() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    try {
      const [plansRes, packagesRes] = await Promise.all([
        supabase
          .from('pricing_plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('credit_packages')
          .select('*')
          .eq('is_active', true)
          .order('sort_order')
      ]);

      if (plansRes.data) setPlans(plansRes.data);
      if (packagesRes.data) setPackages(packagesRes.data);
    } catch (error) {
      console.error('Error loading pricing:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPlanIcon = (name: string) => {
    if (name.toLowerCase().includes('starter')) return Zap;
    if (name.toLowerCase().includes('pro')) return Crown;
    return Rocket;
  };

  const handlePlanClick = async (planId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSelectedPlanId(planId);
      setShowAuth(true);
    } else {
      alert('Subscription feature coming soon!');
    }
  };

  const handlePackageClick = async (packageId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSelectedPackageId(packageId);
      setShowAuth(true);
    } else {
      alert('Credit purchase feature coming soon!');
    }
  };

  const handleAuthSuccess = async () => {
    if (selectedPlanId) {
      alert('Account created! Subscription feature coming soon.');
    } else if (selectedPackageId) {
      alert('Account created! Credit purchase feature coming soon.');
    }
    setSelectedPlanId(null);
    setSelectedPackageId(null);
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h2 className="text-4xl font-black text-slate-900 mb-4" style={{
          textShadow: '2px 2px 0px rgba(251,191,36,0.3)',
        }}>
          POWER UP YOUR AGENTS
        </h2>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Choose a monthly plan or top up with credit packages. All plans include access to our elite agent council.
        </p>
      </div>

      <div className="mb-16">
        <h3 className="text-2xl font-bold text-slate-900 mb-6 text-center">Monthly Plans</h3>
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const Icon = getPlanIcon(plan.name);
            const isPopular = plan.name.toLowerCase().includes('pro');

            return (
              <div
                key={plan.id}
                className={`relative bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:scale-105 ${
                  isPopular ? 'ring-4 ring-amber-400' : ''
                }`}
              >
                {isPopular && (
                  <div className="absolute top-0 right-0 bg-amber-400 text-slate-900 text-xs font-black px-4 py-1 rounded-bl-lg">
                    POPULAR
                  </div>
                )}

                <div className="p-6 border-b-4 border-slate-900">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-amber-400 rounded-lg">
                      <Icon className="w-6 h-6 text-slate-900" />
                    </div>
                    <h4 className="text-2xl font-black text-slate-900">{plan.name}</h4>
                  </div>
                  <p className="text-slate-600 text-sm mb-4">{plan.description}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-black text-slate-900">${plan.price}</span>
                    <span className="text-slate-600">/month</span>
                  </div>
                  <div className="mt-2 inline-block bg-cyan-400 text-slate-900 px-3 py-1 rounded-full text-sm font-bold">
                    {plan.credits} credits/month
                  </div>
                </div>

                <div className="p-6">
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span className="text-slate-700 text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handlePlanClick(plan.id)}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                  >
                    Get Started
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-2xl font-bold text-slate-900 mb-6 text-center">Top-Up Credit Packages</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {packages.map((pkg) => {
            const totalCredits = pkg.credits + pkg.bonus_credits;
            const hasBonus = pkg.bonus_credits > 0;

            return (
              <div
                key={pkg.id}
                className="bg-white rounded-xl shadow-lg p-6 border-4 border-slate-900 hover:border-amber-400 transition-all duration-300 hover:scale-105"
              >
                <div className="text-center mb-4">
                  <h4 className="text-xl font-black text-slate-900 mb-1">{pkg.name}</h4>
                  <div className="text-3xl font-black text-amber-500">
                    {totalCredits}
                  </div>
                  <div className="text-sm text-slate-600">
                    {hasBonus ? (
                      <>
                        <span>{pkg.credits} credits</span>
                        <span className="text-emerald-600 font-bold"> +{pkg.bonus_credits} bonus</span>
                      </>
                    ) : (
                      <span>credits</span>
                    )}
                  </div>
                </div>

                <div className="text-center mb-4">
                  <div className="text-2xl font-black text-slate-900">${pkg.price}</div>
                  <div className="text-xs text-slate-600">one-time payment</div>
                </div>

                <button
                  onClick={() => handlePackageClick(pkg.id)}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
                >
                  Buy Now
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-12 text-center text-sm text-slate-600">
        <p>All purchases are processed securely. Credits never expire. Need help? Contact our support team.</p>
      </div>

      <AuthModal
        isOpen={showAuth}
        onClose={() => {
          setShowAuth(false);
          setSelectedPlanId(null);
          setSelectedPackageId(null);
        }}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
