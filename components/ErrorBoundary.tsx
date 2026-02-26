
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4 dashboard-card">
          <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center">
            <AlertTriangle size={22} className="text-red-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white mb-1">Something went wrong</p>
            <p className="text-xs text-muted">Refresh the page to continue.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white transition-all"
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
