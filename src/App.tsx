import { useState, useEffect } from 'react';
import { 
  Sparkles, Bot, Zap, Users, Star, Mail, ArrowRight, 
  CheckCircle2, Menu, X, Heart, Rocket, Brain, Code,
  MessageCircle, BarChart3, LogIn, UserPlus, LogOut,
  CreditCard, Settings, ChevronDown, Play, PartyPopper
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { withRetry } from './lib/retry';
import { AuthModal } from './components/AuthModal';
import { CreditDashboard } from './components/billing/CreditDashboard';
import { CreditPurchase } from './components/billing/CreditPurchase';
import { AgentTemplates } from './components/agents';
import { Header } from './components/Header';
import { DemoComparison } from './components/DemoComparison';
import { PricingSection } from './components/PricingSection';
import { FAQ } from './components/FAQ';

type View = 'landing' | 'dashboard' | 'agents';

function App() {
  const [view, setView] = useState<View>('landing');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Waitlist state
  const [email, setEmail] = useState('');
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [waitlistMessage, setWaitlistMessage] = useState('');

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setView('dashboard');
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setView('dashboard');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaitlistStatus('loading');
    setWaitlistMessage('');

    try {
      const { error } = await withRetry(() =>
        supabase.from('email_signups').insert([{ email }])
      );

      if (error) {
        if (error.code === '23505') {
          setWaitlistStatus('success');
          setWaitlistMessage('🎉 You\'re already on the list! We\'ll be in touch soon.');
        } else {
          throw error;
        }
      } else {
        setWaitlistStatus('success');
        setWaitlistMessage('🎉 Woohoo! You\'re on the waitlist! We\'ll notify you when it\'s your turn.');
      }
      setEmail('');
    } catch (err: any) {
      setWaitlistStatus('error');
      setWaitlistMessage(err.message || 'Something went wrong. Please try again!');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setView('landing');
  };

  const openAuth = (mode: 'signin' | 'signup') => {
    setAuthMode(mode);
    setShowAuthModal(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-bounce mb-4">
            <Bot className="w-16 h-16 text-white mx-auto" />
          </div>
          <p className="text-white text-xl font-bold">Loading magic... ✨</p>
        </div>
      </div>
    );
  }

  // Dashboard view for logged-in users
  if (view === 'dashboard' && user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {/* Dashboard Header */}
        <header className="bg-black/30 backdrop-blur-lg border-b border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-r from-violet-500 to-fuchsia-500 p-2 rounded-xl">
                  <Bot className="w-8 h-8 text-white" />
                </div>
                <h1 className="text-2xl font-black text-white">Agentry</h1>
              </div>
              
              <div className="flex items-center gap-4">
                <nav className="hidden md:flex gap-2">
                  <button
                    onClick={() => setView('agents')}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                      view === 'agents'
                        ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-purple-500/30'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    🤖 Agents
                  </button>
                  <button
                    onClick={() => setView('dashboard')}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                      view === 'dashboard'
                        ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-purple-500/30'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    📊 Dashboard
                  </button>
                </nav>
                
                <button
                  onClick={() => setShowPurchaseModal(true)}
                  className="bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-black font-bold py-2 px-4 rounded-xl transition-all duration-200 shadow-lg shadow-orange-500/30 flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Add Credits
                </button>
                
                <button
                  onClick={handleSignOut}
                  className="text-white/70 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-all"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {view === 'dashboard' ? (
            <CreditDashboard />
          ) : (
            <AgentTemplates credits={100} onTaskComplete={(result) => console.log('Task complete:', result)} />
          )}
        </main>

        {showPurchaseModal && (
          <CreditPurchase
            onSuccess={() => {
              setShowPurchaseModal(false);
            }}
            onClose={() => setShowPurchaseModal(false)}
          />
        )}
      </div>
    );
  }

  // Landing page for non-logged-in users
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500">
      {/* Floating decorations */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-32 h-32 bg-yellow-400/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-40 right-20 w-48 h-48 bg-pink-400/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute bottom-20 left-1/3 w-40 h-40 bg-blue-400/20 rounded-full blur-3xl animate-pulse delay-500" />
        <div className="absolute bottom-40 right-1/4 w-24 h-24 bg-green-400/20 rounded-full blur-3xl animate-pulse delay-700" />
      </div>

      {/* Header */}
      <header className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 backdrop-blur-lg p-2 rounded-xl border border-white/30">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <span className="text-2xl font-black text-white drop-shadow-lg">Agentry</span>
            </div>
            
            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-4">
              <button
                onClick={() => openAuth('signin')}
                className="text-white/90 hover:text-white font-medium px-4 py-2 rounded-xl hover:bg-white/10 transition-all flex items-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </button>
              <button
                onClick={() => openAuth('signup')}
                className="bg-white text-purple-600 font-bold px-6 py-2 rounded-xl hover:bg-white/90 transition-all shadow-lg shadow-black/20 flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Get Started Free
              </button>
            </nav>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-white p-2"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20">
              <div className="flex flex-col gap-3">
                <button
n                  onClick={() => { openAuth('signin'); setMobileMenuOpen(false); }}
                  className="text-white font-medium px-4 py-3 rounded-xl hover:bg-white/10 transition-all text-left"
                >
                  Sign In
                </button>
                <button
                  onClick={() => { openAuth('signup'); setMobileMenuOpen(false); }}
                  className="bg-white text-purple-600 font-bold px-4 py-3 rounded-xl text-center"
                >
                  Get Started Free
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-20">
        <div className="text-center">
          {/* Fun badge */}
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/30 mb-8">
            <PartyPopper className="w-4 h-4 text-yellow-300" />
            <span className="text-white font-medium text-sm">The Future of AI Agents is Here!</span>
            <Sparkles className="w-4 h-4 text-yellow-300" />
          </div>

          <h1 className="text-5xl md:text-7xl font-black text-white mb-6 leading-tight">
            <span className="drop-shadow-lg">Your Personal</span>
            <br />
            <span className="bg-gradient-to-r from-yellow-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
              AI Agent Army
            </span>
            <span className="drop-shadow-lg"> 🚀</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-white/90 max-w-3xl mx-auto mb-10 leading-relaxed">
            Deploy specialized AI agents that research, code, write, and analyze for you. 
            <span className="font-bold">Like having a team of experts on demand!</span> 🧠✨
          </p>

          {/* Waitlist Form */}
          <div className="max-w-md mx-auto mb-12">
            <form onSubmit={handleWaitlistSubmit} className="relative">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white/95 backdrop-blur-lg border-2 border-white/50 focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/20 outline-none text-gray-800 font-medium placeholder-gray-400 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={waitlistStatus === 'loading'}
                  className="bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-500 hover:from-yellow-500 hover:via-orange-500 hover:to-pink-600 text-white font-bold px-8 py-4 rounded-2xl transition-all duration-300 shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/40 hover:scale-105 disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {waitlistStatus === 'loading' ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Joining...
                    </>
                  ) : (
                    <>
                      <Rocket className="w-5 h-5" />
                      Join Waitlist
                    </>
                  )}
                </button>
              </div>
            </form>
            
            {waitlistMessage && (
              <div className={`mt-4 p-4 rounded-xl ${
                waitlistStatus === 'success' 
                  ? 'bg-green-500/20 border border-green-400/30 text-white' 
                  : 'bg-red-500/20 border border-red-400/30 text-white'
              }`}>
                {waitlistMessage}
              </div>
            )}
          </div>

          {/* Social proof */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-white/80">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <span className="font-medium">1,200+ on waitlist</span>
            </div>
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
              <span className="font-medium">4.9/5 early reviews</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-cyan-400" />
              <span className="font-medium">10 free credits to start</span>
            </div>
          </div>
        </div>

        {/* Fun feature cards */}
        <div className="grid md:grid-cols-3 gap-6 mt-16">
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/20 hover:bg-white/20 transition-all hover:scale-105 hover:shadow-2xl group">
            <div className="bg-gradient-to-br from-blue-400 to-cyan-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Research Agent 🔍</h3>
            <p className="text-white/70">Deep research on any topic. Get comprehensive reports with sources and insights.</p>
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/20 hover:bg-white/20 transition-all hover:scale-105 hover:shadow-2xl group">
            <div className="bg-gradient-to-br from-pink-400 to-rose-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Code className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Code Agent 💻</h3>
            <p className="text-white/70">Write, debug, and explain code in any language. Your pair programming buddy.</p>
          </div>
          
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/20 hover:bg-white/20 transition-all hover:scale-105 hover:shadow-2xl group">
            <div className="bg-gradient-to-br from-amber-400 to-orange-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <MessageCircle className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Content Agent ✍️</h3>
            <p className="text-white/70">Create amazing content for blogs, social media, and marketing campaigns.</p>
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section className="relative z-10 bg-white/5 backdrop-blur-lg border-y border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
              See the Magic in Action ✨
            </h2>
            <p className="text-white/70 text-lg">Watch how our AI agents collaborate to solve complex problems</p>
          </div>
          <DemoComparison />
        </div>
      </section>

      {/* Pricing Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <PricingSection />
      </section>

      {/* FAQ Section */}
      <section className="relative z-10 bg-white/5 backdrop-blur-lg border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <FAQ />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 bg-black/20 backdrop-blur-lg border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Bot className="w-6 h-6 text-white/70" />
              <span className="text-white/70 font-medium">Agentry © 2024</span>
            </div>
            <div className="flex items-center gap-6 text-white/60">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => {
          setShowAuthModal(false);
          setView('dashboard');
        }}
      />
    </div>
  );
}

export default App;
