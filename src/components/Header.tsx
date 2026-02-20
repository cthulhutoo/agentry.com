import { Brain, Network, Cpu, Sparkles, LogIn, LogOut, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AuthModal } from './AuthModal';

export function Header() {
  const [user, setUser] = useState<any>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };
  return (
    <header className="bg-slate-900 text-white border-b-4 border-amber-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-amber-400 rounded-lg transform rotate-3"></div>
              <div className="relative bg-slate-900 border-4 border-amber-400 p-2.5 rounded-lg">
                <div className="relative flex items-center justify-center w-10 h-10">
                  <Network className="w-7 h-7 text-amber-400 absolute" strokeWidth={2} />
                  <div className="w-3 h-3 bg-cyan-400 rounded-full absolute top-0 left-0 shadow-lg shadow-cyan-400/50"></div>
                  <div className="w-3 h-3 bg-emerald-400 rounded-full absolute top-0 right-0 shadow-lg shadow-emerald-400/50"></div>
                  <div className="w-3 h-3 bg-rose-400 rounded-full absolute bottom-0 left-1/2 -translate-x-1/2 shadow-lg shadow-rose-400/50"></div>
                </div>
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight" style={{
                textShadow: '3px 3px 0px rgba(0,0,0,0.3), -1px -1px 0px rgba(251,191,36,0.5)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                letterSpacing: '0.02em'
              }}>
                AGENTRY
              </h1>
              <p className="text-sm text-amber-400 font-bold tracking-wide">THE ULTIMATE AGENT ALLIANCE</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            {user ? (
              <>
                <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border-2 border-slate-700">
                  <User className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-white">{user.email}</span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-amber-400 px-4 py-2 rounded-lg font-bold text-sm text-white transition-all duration-200 flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="bg-amber-400 hover:bg-amber-500 border-2 border-amber-500 px-4 py-2 rounded-lg font-bold text-sm text-slate-900 transition-all duration-200 flex items-center gap-2 shadow-lg"
              >
                <LogIn className="w-4 h-4" />
                Sign In / Sign Up
              </button>
            )}
          </div>
        </div>

        <div className="sm:hidden mt-4">
          {user ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border-2 border-slate-700">
                <User className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-white">{user.email}</span>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-amber-400 px-4 py-2 rounded-lg font-bold text-sm text-white transition-all duration-200 flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="w-full bg-amber-400 hover:bg-amber-500 border-2 border-amber-500 px-4 py-2 rounded-lg font-bold text-sm text-slate-900 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
            >
              <LogIn className="w-4 h-4" />
              Sign In / Sign Up
            </button>
          )}
        </div>
      </div>

      <AuthModal
        isOpen={showAuth}
        onClose={() => setShowAuth(false)}
        onSuccess={() => setShowAuth(false)}
      />
    </header>
  );
}
