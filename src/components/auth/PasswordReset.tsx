import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { X } from 'lucide-react';

interface PasswordResetProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToSignin: () => void;
}

export function PasswordReset({ isOpen, onClose, onSwitchToSignin }: PasswordResetProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [step, setStep] = useState<'request' | 'confirm'>('request');

  if (!isOpen) return null;

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://agentry.com/auth/callback',
      });

      if (error) throw error;

      setSuccess('Password reset email sent! Check your inbox for instructions.');
      setStep('confirm');
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const form = e.target as HTMLFormElement;
    const password = (form.password as HTMLInputElement).value;
    const confirmPassword = (form.confirmPassword as HTMLInputElement).value;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      setSuccess('Password updated successfully! You can now sign in with your new password.');
      // Close the modal after a short delay
      setTimeout(() => {
        onClose();
        onSwitchToSignin();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border-4 border-slate-900">
        <div className="p-6 border-b-4 border-slate-900 flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-900">
            {step === 'request' ? 'RESET PASSWORD' : 'SET NEW PASSWORD'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {step === 'request' ? (
          <form onSubmit={handleRequestReset} className="p-6 space-y-4">
            {success ? (
              <div className="bg-green-50 border-2 border-green-400 rounded-lg p-4">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            ) : (
              <>
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

                <p className="text-sm text-slate-600">
                  Enter your email address and we'll send you a link to reset your password.
                </p>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                >
                  {loading ? 'Sending...' : 'Send Reset Email'}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={onSwitchToSignin}
                    className="text-sm text-slate-600 hover:text-slate-900 font-semibold"
                  >
                    Remember your password? Sign in
                  </button>
                </div>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={handleConfirmReset} className="p-6 space-y-4">
            {success ? (
              <div className="bg-green-50 border-2 border-green-400 rounded-lg p-4">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            ) : (
              <>
                {error && (
                  <div className="bg-red-50 border-2 border-red-400 rounded-lg p-4">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={6}
                    className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                    placeholder="••••••••"
                  />
                  <p className="text-xs text-slate-600 mt-1">
                    At least 6 characters
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    required
                    minLength={6}
                    className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>

                <p className="text-sm text-slate-600">
                  Check your email for the password reset link. This form is for demonstration purposes.
                </p>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                >
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
