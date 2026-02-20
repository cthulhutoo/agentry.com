import { useState } from 'react';
import { Header } from './components/Header';
import { AgentCard } from './components/AgentCard';
import { CouncilSidebar } from './components/CouncilSidebar';
import { TaskModal } from './components/TaskModal';
import { TaskResults } from './components/TaskResults';
import { TaskProgress } from './components/TaskProgress';
import { CouncilDiscussion } from './components/CouncilDiscussion';
import { FAQ } from './components/FAQ';
import { PricingSection } from './components/PricingSection';
import { AccountSection } from './components/AccountSection';
import { DemoComparison } from './components/DemoComparison';
import { useAgents } from './hooks/useAgents';
import { useCouncil } from './hooks/useCouncil';
import { supabase, Task } from './lib/supabase';
import { Loader, Sparkles, Filter, Zap, Star, TrendingUp, Mail, Bell, ChevronRight, HelpCircle } from 'lucide-react';

function App() {
  const { agents, loading } = useAgents();
  const {
    selectedAgents,
    toggleAgent,
    calculateTotalPrice,
    getDiscount,
    saveCouncil,
    clearCouncil,
    saving,
  } = useCouncil();

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showTaskProgress, setShowTaskProgress] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [currentTaskPrompt, setCurrentTaskPrompt] = useState('');
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [filterSpecialty, setFilterSpecialty] = useState<string>('all');
  const [email, setEmail] = useState('');
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [currentView, setCurrentView] = useState<'marketplace' | 'demo' | 'pricing' | 'account'>('marketplace');

  const specialties = Array.from(new Set(agents.map(a => a.specialty)));
  const filteredAgents = filterSpecialty === 'all'
    ? agents
    : agents.filter(a => a.specialty === filterSpecialty);

  const handleSaveCouncil = async (name: string, description: string) => {
    try {
      const council = await saveCouncil(name, description);
      alert(`Council "${council.name}" saved successfully!`);
    } catch (error) {
      alert('Failed to save council');
    }
  };

  const handleSubmitTask = async (prompt: string) => {
    try {
      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        alert('Please sign in to submit tasks');
        return;
      }

      // Check user has enough credits
      const { data: account } = await supabase
        .from('user_accounts')
        .select('credits')
        .eq('user_id', user.id)
        .single();

      const creditsNeeded = selectedAgents.length;
      if (!account || account.credits < creditsNeeded) {
        alert(`Insufficient credits. You need ${creditsNeeded} credits but have ${account?.credits || 0}. Please purchase more credits.`);
        return;
      }

      const { data: council } = await supabase
        .from('councils')
        .insert({
          name: 'Temporary Council',
          description: 'Ad-hoc council for task',
          agent_ids: selectedAgents.map(a => a.id),
          total_price: calculateTotalPrice(),
        })
        .select()
        .single();

      if (!council) throw new Error('Failed to create council');

      const { data: task } = await supabase
        .from('tasks')
        .insert({
          council_id: council.id,
          prompt,
          status: 'processing',
          user_id: user.id,
        })
        .select()
        .single();

      if (task) {
        setCurrentTask(task as Task);
        setCurrentTaskPrompt(prompt);
        setShowTaskProgress(true);
      }
    } catch (error) {
      console.error('Error submitting task:', error);
      alert('Failed to submit task');
    }
  };

  const handleTaskComplete = async (results: any[]) => {
    if (!currentTask) return;

    const { data } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        results,
        completed_at: new Date().toISOString(),
      })
      .eq('id', currentTask.id)
      .select()
      .single();

    if (data) {
      setCurrentTask(data as Task);
    }
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');

    if (!email || !email.includes('@')) {
      setEmailError('Please enter a valid email address');
      return;
    }

    try {
      const { error } = await supabase
        .from('email_signups')
        .insert({ email });

      if (error) {
        if (error.code === '23505') {
          setEmailError('This email is already subscribed');
        } else {
          setEmailError('Failed to subscribe. Please try again.');
        }
        return;
      }

      setEmailSubmitted(true);
      setEmail('');
    } catch (error) {
      console.error('Email signup error:', error);
      setEmailError('Failed to subscribe. Please try again.');
    }
  };

  const scrollToFAQ = () => {
    const faqElement = document.getElementById('faq-section');
    if (faqElement) {
      faqElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <Header />

      <nav className="bg-white border-b-2 border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto">
            <button
              onClick={() => setCurrentView('marketplace')}
              className={`px-6 py-4 font-bold text-sm transition-all border-b-4 whitespace-nowrap ${
                currentView === 'marketplace'
                  ? 'border-amber-400 text-slate-900 bg-slate-50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              AGENT MARKETPLACE
            </button>
            <button
              onClick={() => setCurrentView('demo')}
              className={`px-6 py-4 font-bold text-sm transition-all border-b-4 whitespace-nowrap ${
                currentView === 'demo'
                  ? 'border-amber-400 text-slate-900 bg-slate-50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              DEMO VIDEO
            </button>
            <button
              onClick={() => setCurrentView('pricing')}
              className={`px-6 py-4 font-bold text-sm transition-all border-b-4 whitespace-nowrap ${
                currentView === 'pricing'
                  ? 'border-amber-400 text-slate-900 bg-slate-50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              PRICING & CREDITS
            </button>
            <button
              onClick={() => setCurrentView('account')}
              className={`px-6 py-4 font-bold text-sm transition-all border-b-4 whitespace-nowrap ${
                currentView === 'account'
                  ? 'border-amber-400 text-slate-900 bg-slate-50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              MY ACCOUNT
            </button>
          </div>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {currentView === 'marketplace' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-4 sm:mb-6 bg-gradient-to-r from-slate-900 to-slate-700 rounded-lg sm:rounded-xl shadow-2xl overflow-hidden border-2 sm:border-4 border-amber-400">
              <div className="p-4 sm:p-6">
                <div className="flex flex-col items-start gap-4 sm:gap-6">
                  <div className="w-full text-white">
                    <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                      <div className="bg-amber-400 text-slate-900 px-2 sm:px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase animate-pulse">
                        Soft Launch Beta
                      </div>
                      <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
                    </div>
                    <h3 className="text-xl sm:text-2xl lg:text-3xl font-black mb-2 text-white leading-tight">
                      Limited Access Available
                    </h3>
                    <p className="text-sm sm:text-base text-slate-200 mb-3 sm:mb-4">
                      Agentry is currently in soft launch beta with limited user access. Sign up below to be notified when the next batch of users will be added to the platform.
                    </p>

                    {!emailSubmitted ? (
                      <form onSubmit={handleEmailSignup} className="flex flex-col gap-2 w-full sm:max-w-md">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email for early access"
                          className="w-full px-4 py-3 rounded-lg border-2 border-amber-400/30 bg-slate-800/50 backdrop-blur-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm sm:text-base"
                        />
                        <button
                          type="submit"
                          className="w-full sm:w-auto px-6 py-3 bg-amber-400 text-slate-900 rounded-lg font-bold hover:bg-amber-500 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                        >
                          <Bell className="w-4 h-4" />
                          <span className="text-sm sm:text-base">Join Waitlist</span>
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-900 bg-amber-400 px-4 sm:px-6 py-2 sm:py-3 rounded-lg w-full sm:w-fit font-bold text-sm sm:text-base">
                        <Star className="w-4 h-4 sm:w-5 sm:h-5 fill-slate-900 flex-shrink-0" />
                        <span>You're on the list! We'll notify you soon.</span>
                      </div>
                    )}

                    {emailError && (
                      <p className="text-xs sm:text-sm text-red-300 mt-2 bg-red-500/20 px-3 py-2 rounded-lg">
                        {emailError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="mb-6 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 rounded-xl shadow-lg overflow-hidden">
              <div className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
                  <div className="flex-1 text-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Bell className="w-5 h-5 animate-pulse" />
                      <span className="text-xs font-bold tracking-wider uppercase bg-white/20 px-2 py-1 rounded-full">
                        Weekly Updates
                      </span>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold mb-1">
                      New Agents & LLMs Added Weekly
                    </h3>
                    <p className="text-sm text-white/90 mb-3">
                      We're constantly expanding our agent roster with new specialists and cutting-edge AI models
                    </p>

                    {!emailSubmitted ? (
                      <form onSubmit={handleEmailSignup} className="flex flex-col sm:flex-row gap-2 max-w-md">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email"
                          className="flex-1 px-4 py-2 rounded-lg border-2 border-white/30 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/50"
                        />
                        <button
                          type="submit"
                          className="px-6 py-2 bg-white text-fuchsia-600 rounded-lg font-semibold hover:bg-white/90 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          <Mail className="w-4 h-4" />
                          Get Updates
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2 text-white bg-white/20 backdrop-blur-sm px-4 py-2 rounded-lg w-fit">
                        <Star className="w-5 h-5 fill-white" />
                        <span className="font-semibold">Thanks for subscribing!</span>
                      </div>
                    )}

                    {emailError && (
                      <p className="text-sm text-white/90 mt-2 bg-red-500/20 px-3 py-1 rounded-lg w-fit">
                        {emailError}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={scrollToFAQ}
                    className="group bg-white/10 backdrop-blur-sm hover:bg-white/20 border-2 border-white/30 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    <HelpCircle className="w-5 h-5" />
                    <span>How It Works</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-8 space-y-4">
              <div className="relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-xl shadow-xl border-4 border-amber-300">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-10 rounded-full -mr-32 -mt-32 animate-pulse"></div>
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-white opacity-10 rounded-full -ml-24 -mb-24 animate-pulse" style={{ animationDelay: '1s' }}></div>

                <div className="relative p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="bg-white rounded-full p-2 animate-bounce">
                      <Star className="w-6 h-6 text-amber-500 fill-amber-500" />
                    </div>
                    <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-1.5 rounded-full border-2 border-white/40">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-sm font-black tracking-wide">JUST LAUNCHED</span>
                    </div>
                  </div>

                  <h2 className="text-4xl font-black mb-2 text-white" style={{
                    textShadow: '4px 4px 0px rgba(0,0,0,0.3), -2px -2px 0px rgba(255,255,255,0.2)',
                    letterSpacing: '0.02em'
                  }}>
                    20 NEW AGENTS UNLEASHED!
                  </h2>

                  <p className="text-white text-lg font-bold mb-4 max-w-3xl">
                    From Video Production to Agriculture, Real Estate to Game Design - we've massively expanded our agent roster!
                    <span className="inline-block ml-2 px-3 py-1 bg-white text-orange-600 rounded-full text-sm font-black">
                      44 TOTAL AGENTS
                    </span>
                  </p>

                  <div className="flex flex-wrap gap-3 text-sm">
                    <div className="flex items-center gap-2 bg-white/90 text-orange-600 px-4 py-2 rounded-lg font-bold">
                      <Zap className="w-4 h-4 fill-orange-600" />
                      <span>3 LLM Providers</span>
                    </div>
                    <div className="flex items-center gap-2 bg-white/90 text-orange-600 px-4 py-2 rounded-lg font-bold">
                      <Sparkles className="w-4 h-4" />
                      <span>44 Specialized Agents</span>
                    </div>
                    <div className="flex items-center gap-2 bg-white/90 text-orange-600 px-4 py-2 rounded-lg font-bold">
                      <Star className="w-4 h-4 fill-orange-600" />
                      <span>10-15% Bundle Discounts</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl p-6 text-white shadow-lg">
                <h3 className="text-2xl font-bold mb-2">Build Your AI Agent Council</h3>
                <p className="text-cyan-50">
                  Select specialized AI agents to create a multi-perspective analysis team. Mix and match expertise across dozens of industries to tackle complex questions.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-slate-900">Agent Marketplace</h3>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                <select
                  value={filterSpecialty}
                  onChange={(e) => setFilterSpecialty(e.target.value)}
                  className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white"
                >
                  <option value="all">All Specialties</option>
                  {specialties.map(specialty => (
                    <option key={specialty} value={specialty}>{specialty}</option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader className="w-8 h-8 text-cyan-600 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
                {filteredAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isSelected={selectedAgents.some((a) => a.id === agent.id)}
                    onToggle={() => toggleAgent(agent)}
                  />
                ))}
              </div>
            )}

            <div id="faq-section" className="mb-8">
              <FAQ />
            </div>

            {currentTask && (
              <div className="mt-8">
                <TaskResults task={currentTask} />
              </div>
            )}
          </div>
          )}

          {currentView === 'demo' && <DemoComparison />}
          {currentView === 'pricing' && <PricingSection />}
          {currentView === 'account' && <AccountSection />}
        </main>

        <CouncilSidebar
          selectedAgents={selectedAgents}
          totalPrice={calculateTotalPrice()}
          discount={getDiscount()}
          onRemove={toggleAgent}
          onSave={handleSaveCouncil}
          onSubmitTask={() => setShowTaskModal(true)}
          onStartDiscussion={() => setShowDiscussion(true)}
          saving={saving}
        />
      </div>

      <TaskModal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        selectedAgents={selectedAgents}
        onSubmit={handleSubmitTask}
      />

      <TaskProgress
        isOpen={showTaskProgress}
        onClose={() => setShowTaskProgress(false)}
        selectedAgents={selectedAgents}
        taskPrompt={currentTaskPrompt}
        onComplete={handleTaskComplete}
      />

      <CouncilDiscussion
        isOpen={showDiscussion}
        onClose={() => setShowDiscussion(false)}
        selectedAgents={selectedAgents}
      />
    </div>
  );
}

export default App;
