import { Component, ErrorInfo, ReactNode } from 'react';
import { Sentry } from '../lib/sentry';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
            <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
              Something went wrong
            </h1>
            <p className="text-gray-600 text-center mb-6">
              We've been notified and are working on a fix. Please try refreshing the page.
            </p>
            {this.state.error && (
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm font-mono text-gray-700 overflow-auto max-h-32">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
