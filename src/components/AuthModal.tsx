import { X } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { PasswordReset } from './auth/PasswordReset';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        if (data.user) {
          const { error: accountError } = await supabase
            .from('user_accounts')
            .insert({
              user_id: data.user.id,
              credits: 10,
            });

          if (accountError && accountError.code !== '23505') {
            throw accountError;
          }

          onSuccess();
          onClose();
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.user) {
          const { data: existingAccount } = await supabase
            .from('user_accounts')
            .select('id')
            .eq('user_id', data.user.id)
            .maybeSingle();

          if (!existingAccount) {
            await supabase
              .from('user_accounts')
              .insert({
                user_id: data.user.id,
                credits: 10,
              });
          }
        }

        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {mode === 'reset' ? (
        <PasswordReset 
          isOpen={true} 
          onClose={() => onClose()} 
          onSwitchToSignin={() => setMode('signin')} 
        />
      ) : (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border-4 border-slate-900">
            <div className="p-6 border-b-4 border-slate-900 flex items-center justify-between">
              <h2 className="text-2xl font-black text-slate-900">
                {mode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}
              </h2>
              <button
                onClick={onClose}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {mode === 'signup' && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
                  <p className="text-sm font-bold text-slate-900">
                    Get 10 free credits when you sign up!
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border-2 border-red-400 rounded-lg p-4">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="your@email.com"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="••••••••"
                />
                {mode === 'signup' && (
                  <p className="text-xs text-slate-600 mt-1">
                    At least 6 characters
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
              >
                {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>

              <div className="text-center space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'signup' ? 'signin' : 'signup');
                    setError('');
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900 font-semibold"
                >
                  {mode === 'signup'
                    ? 'Already have an account? Sign in'
                    : "Don't have an account? Sign up"}
                </button>
                {mode === 'signin' && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setMode('reset')}
                      className="text-sm text-amber-600 hover:text-amber-800 font-semibold"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
