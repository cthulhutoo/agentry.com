import { useState, useEffect } from 'react';
import { Play, Users, Bot, CheckCircle2, ArrowRight, Sparkles, Mail, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Scenario {
  id: string;
  title: string;
  prompt: string;
  singleAIResponse: string;
  councilDiscussion: {
    round: number;
    responses: {
      agent: string;
      specialty: string;
      response: string;
      color: string;
    }[];
  }[];
  finalAnswer: string;
  improvement: string;
}

const scenarios: Scenario[] = [
  {
    id: 'product-launch',
    title: 'Product Launch Strategy',
    prompt: 'I want to launch a new AI-powered fitness app. What should my go-to-market strategy be?',
    singleAIResponse: 'To launch your AI fitness app, focus on: 1) Building a strong social media presence, 2) Partnering with fitness influencers, 3) Offering a free trial period, 4) Creating engaging content, 5) Running targeted ads on Instagram and Facebook. Consider app store optimization and getting featured in health & fitness categories.',
    councilDiscussion: [
      {
        round: 1,
        responses: [
          {
            agent: 'Marketing Strategist',
            specialty: 'Go-to-Market',
            response: 'Start with a niche positioning strategy. Target a specific user segment first - perhaps busy professionals aged 25-40. Use a tiered launch: beta with 100 users for feedback, then limited release to 1,000 users, then full launch. This creates exclusivity and allows iteration.',
            color: 'bg-blue-100 border-blue-300'
          },
          {
            agent: 'Data Scientist',
            specialty: 'Analytics & AI',
            response: 'The AI differentiation is crucial. Implement proper instrumentation from day one to track: workout completion rates, AI recommendation accuracy, and user engagement patterns. Use this data to demonstrate ROI in your pitch - most fitness apps show 80% churn in 90 days, aim to prove your AI reduces this by 50%.',
            color: 'bg-green-100 border-green-300'
          },
          {
            agent: 'Business Analyst',
            specialty: 'Market Research',
            response: 'The fitness app market is crowded with 71,000+ apps. Your TAM is $14B but competition is fierce. Focus on a specific pain point competitors miss - perhaps form correction or injury prevention using AI computer vision. Price at $12.99/month (20% below Peloton app) with annual option at $99 (30% discount).',
            color: 'bg-purple-100 border-purple-300'
          }
        ]
      },
      {
        round: 2,
        responses: [
          {
            agent: 'Marketing Strategist',
            specialty: 'Go-to-Market',
            response: 'Building on the data point about reducing churn - that\'s our key message. Campaign theme: "The fitness app that actually sticks." Partner with 3-5 micro-influencers (50k-200k followers) rather than one macro-influencer - better ROI and authenticity. Budget $15k for 3-month influencer program.',
            color: 'bg-blue-100 border-blue-300'
          },
          {
            agent: 'Data Scientist',
            specialty: 'Analytics & AI',
            response: 'Agree on injury prevention focus - this is measurable and valuable. Create a demo showing the AI in action: side-by-side video of incorrect vs correct form with real-time AI feedback. This becomes your primary marketing asset. Also implement A/B testing framework for onboarding flow from launch day.',
            color: 'bg-green-100 border-green-300'
          },
          {
            agent: 'Business Analyst',
            specialty: 'Market Research',
            response: 'The pricing strategy should include a loss-leader approach: free first month with AI form analysis (normally $49 value). This demonstrates immediate value. Target 1,000 signups month one, 5,000 by month three. At 25% conversion to paid, that\'s $16k MRR by month four. Pitch this projection to investors for pre-launch funding.',
            color: 'bg-purple-100 border-purple-300'
          }
        ]
      }
    ],
    finalAnswer: 'Launch Strategy: Position as "The AI fitness app that prevents injury and increases consistency" targeting busy professionals 25-40. Execute a tiered launch (100 beta → 1,000 limited → full release) with injury prevention/form correction as the core differentiator. Pricing: $12.99/month with free first month including $49 AI form analysis. Partner with 3-5 micro-influencers ($15k/3 months) with messaging focused on reducing the 80% churn rate. Implement full analytics from day one to prove 50% churn reduction. Target: 1,000 signups month 1, growing to 5,000 by month 3, achieving $16k MRR by month 4. Create side-by-side demo video showing AI form correction as primary marketing asset.',
    improvement: 'The Council provides specific metrics, pricing strategy backed by market data, actionable budget allocations, and a phased launch plan with measurable milestones - far more comprehensive than generic advice.'
  },
  {
    id: 'technical-architecture',
    title: 'Technical Architecture Decision',
    prompt: 'Should I use microservices or a monolith for my startup\'s backend?',
    singleAIResponse: 'For a startup, I\'d generally recommend starting with a monolith. It\'s simpler to develop, deploy, and debug. Microservices add complexity with distributed systems challenges like service discovery, network latency, and data consistency. You can always migrate to microservices later as you scale. Focus on writing modular code within your monolith so the transition is easier when needed.',
    councilDiscussion: [
      {
        round: 1,
        responses: [
          {
            agent: 'Software Architect',
            specialty: 'System Design',
            response: 'Start with a modular monolith - single deployment but clear bounded contexts. Use a pattern like Clean Architecture or Hexagonal. This gives you monolith benefits (easier debugging, deployment) while preparing for potential microservices split. Critical: separate your data access layer and use anti-corruption layers between domains.',
            color: 'bg-blue-100 border-blue-300'
          },
          {
            agent: 'DevOps Engineer',
            specialty: 'Infrastructure',
            response: 'From ops perspective: monolith wins for teams under 15 engineers. You need to consider: CI/CD pipeline complexity (1 pipeline vs 20+), monitoring overhead, and on-call burden. That said, containerize your monolith from day one with Docker - this makes eventual migration easier and keeps deployment consistent.',
            color: 'bg-orange-100 border-orange-300'
          },
          {
            agent: 'CTO Advisor',
            specialty: 'Technical Strategy',
            response: 'The real question is team size and business domains. If you have distinct business units (e.g., payments, notifications, core product) that might scale independently, consider service-oriented monolith with separate modules. Amazon strangler pattern: build new features as services while keeping core as monolith. Costs: microservices infrastructure runs $2k-5k/month minimum vs $200-500 for monolith.',
            color: 'bg-green-100 border-green-300'
          }
        ]
      },
      {
        round: 2,
        responses: [
          {
            agent: 'Software Architect',
            specialty: 'System Design',
            response: 'The strangler pattern is excellent advice. Specific implementation: use feature flags to route traffic between monolith and new services. For your startup, identify one service that\'s truly independent (like notifications or file processing) and extract only that. Keep user auth, core business logic in monolith for now.',
            color: 'bg-blue-100 border-blue-300'
          },
          {
            agent: 'DevOps Engineer',
            specialty: 'Infrastructure',
            response: 'On the cost point - let me be specific. Monolith: 1 app server ($50), 1 DB ($100), monitoring ($50) = $200/month. Microservices: API gateway ($50), 5 services ($250), message queue ($75), service mesh ($100), distributed tracing ($150), 1 DB per service ($500) = $1,125 minimum. Plus 3x more development time for deployment automation.',
            color: 'bg-orange-100 border-orange-300'
          },
          {
            agent: 'CTO Advisor',
            specialty: 'Technical Strategy',
            response: 'Decision framework: Choose monolith if team < 20 engineers, < 100k users, single domain. Choose hybrid (service-oriented monolith) if 20-50 engineers, need independent scaling for specific features. Only go full microservices if > 50 engineers, > 500k users, or true multi-tenant requirements. For startups, technical perfection < speed to market. You can refactor at scale.',
            color: 'bg-green-100 border-green-300'
          }
        ]
      }
    ],
    finalAnswer: 'Recommendation: Start with a Modular Monolith using Clean/Hexagonal Architecture with clear bounded contexts. Containerize with Docker from day one. Estimated costs: $200-500/month (vs $1,125+ for microservices). Use the strangler pattern: keep core business logic in monolith but extract truly independent services (like notifications, file processing) as separate services with feature flags. Decision framework: Monolith for < 20 engineers and < 100k users. Only consider full microservices when you have > 50 engineers or > 500k users. Prioritize speed to market over architectural perfection - you can refactor at scale. Expected timeline: this approach gives you 3x faster initial development while maintaining clean migration path for future.',
    improvement: 'The Council provides specific cost breakdowns ($200 vs $1,125/month), concrete team size thresholds, named architectural patterns, and a hybrid approach (strangler pattern) that the single AI didn\'t consider. Actionable decision framework included.'
  }
];

export function DemoComparison() {
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [currentAgent, setCurrentAgent] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (!isPlaying) return;

    if (showFinal) {
      setTimeout(() => {
        setIsPlaying(false);
        setShowFinal(false);
        setCurrentRound(0);
        setCurrentAgent(0);
      }, 5000);
      return;
    }

    if (currentRound >= selectedScenario.councilDiscussion.length) {
      setShowFinal(true);
      return;
    }

    const round = selectedScenario.councilDiscussion[currentRound];
    if (currentAgent >= round.responses.length) {
      setTimeout(() => {
        setCurrentRound(prev => prev + 1);
        setCurrentAgent(0);
      }, 1500);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentAgent(prev => prev + 1);
    }, 2000);

    return () => clearTimeout(timer);
  }, [isPlaying, currentRound, currentAgent, showFinal, selectedScenario]);

  const handlePlay = () => {
    setIsPlaying(true);
    setCurrentRound(0);
    setCurrentAgent(0);
    setShowFinal(false);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentRound(0);
    setCurrentAgent(0);
    setShowFinal(false);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            Interactive Demo
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            See The Difference
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Watch how multiple AI specialists collaborating produces dramatically better results than a single AI chatbot
          </p>
        </div>

        <div className="mb-8 flex gap-4 justify-center flex-wrap">
          {scenarios.map(scenario => (
            <button
              key={scenario.id}
              onClick={() => {
                setSelectedScenario(scenario);
                handleReset();
              }}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                selectedScenario.id === scenario.id
                  ? 'bg-blue-600 text-white shadow-lg scale-105'
                  : 'bg-white text-gray-700 hover:bg-gray-50 shadow'
              }`}
            >
              {scenario.title}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-start gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">💭</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Your Question:</h3>
              <p className="text-gray-700 text-lg">{selectedScenario.prompt}</p>
            </div>
          </div>

          <div className="flex justify-center mb-6">
            {!isPlaying ? (
              <button
                onClick={handlePlay}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-all shadow-lg hover:shadow-xl"
              >
                <Play className="w-6 h-6" />
                Play Demo
              </button>
            ) : (
              <button
                onClick={handleReset}
                className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-all shadow-lg"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gray-600 text-white px-6 py-4 flex items-center gap-3">
              <Bot className="w-6 h-6" />
              <div>
                <h3 className="font-bold text-lg">Single AI Chatbot</h3>
                <p className="text-sm text-gray-300">Like ChatGPT, Claude, or Gemini</p>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
                <p className="text-gray-700 leading-relaxed">{selectedScenario.singleAIResponse}</p>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                <CheckCircle2 className="w-4 h-4" />
                Response completed in 3 seconds
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4 flex items-center gap-3">
              <Users className="w-6 h-6" />
              <div>
                <h3 className="font-bold text-lg">Agent Council</h3>
                <p className="text-sm text-blue-100">Multiple AI Specialists Collaborating</p>
              </div>
            </div>
            <div className="p-6 min-h-[400px]">
              {!isPlaying && !showFinal && (
                <div className="text-center py-12 text-gray-400">
                  Click "Play Demo" to see the agents discuss
                </div>
              )}

              {isPlaying && !showFinal && (
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-gray-900 mb-4">
                    Round {currentRound + 1} of {selectedScenario.councilDiscussion.length}
                  </div>
                  {selectedScenario.councilDiscussion.slice(0, currentRound + 1).map((round, roundIdx) => (
                    <div key={roundIdx} className="space-y-3">
                      {round.responses.slice(0, roundIdx === currentRound ? currentAgent : undefined).map((response, idx) => (
                        <div
                          key={idx}
                          className={`border-2 rounded-lg p-4 ${response.color} animate-fadeIn`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm font-bold">
                              {response.agent.split(' ').map(w => w[0]).join('')}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900 text-sm">{response.agent}</div>
                              <div className="text-xs text-gray-600">{response.specialty}</div>
                            </div>
                          </div>
                          <p className="text-gray-700 text-sm leading-relaxed">{response.response}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {showFinal && (
                <div className="animate-fadeIn">
                  <div className="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-300 rounded-lg p-6 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                      <h4 className="font-bold text-gray-900">Final Consensus Answer</h4>
                    </div>
                    <p className="text-gray-800 leading-relaxed whitespace-pre-line">{selectedScenario.finalAnswer}</p>
                  </div>
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-yellow-600" />
                      Why This Is Better
                    </h4>
                    <p className="text-gray-700 text-sm leading-relaxed">{selectedScenario.improvement}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-xl p-8 text-white text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get better answers?</h2>
          <p className="text-xl text-blue-100 mb-6 max-w-2xl mx-auto">
            Stop settling for generic AI responses. Get comprehensive, expert-level insights from multiple specialized AI agents working together.
          </p>

          {!emailSubmitted ? (
            <form onSubmit={handleEmailSignup} className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email to sign up"
                className="flex-1 px-6 py-4 rounded-lg border-2 border-white/30 bg-white/10 backdrop-blur-sm text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-white/50 text-lg"
              />
              <button
                type="submit"
                className="bg-white text-blue-600 px-8 py-4 rounded-lg font-bold text-lg hover:bg-blue-50 transition-all shadow-lg inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Mail className="w-5 h-5" />
                Sign Up
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center gap-3 text-white bg-white/20 backdrop-blur-sm px-6 py-4 rounded-lg w-fit mx-auto font-bold text-lg">
              <Star className="w-6 h-6 fill-white" />
              <span>Thanks for signing up! We'll be in touch soon.</span>
            </div>
          )}

          {emailError && (
            <p className="text-sm text-white/90 mt-3 bg-red-500/30 backdrop-blur-sm px-4 py-2 rounded-lg w-fit mx-auto">
              {emailError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
