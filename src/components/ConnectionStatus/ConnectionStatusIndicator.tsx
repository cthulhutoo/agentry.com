/**
 * ConnectionStatusIndicator Component
 * Visual indicator for streaming connection status
 * 
 * Features:
 * - Visual status indicator with color-coded dot
 * - Animated states for connecting/reconnecting
 * - Optional label and reconnect button
 * - Framer Motion animations
 */

import React from 'react';
import { motion } from 'framer-motion';
import { ConnectionStatus } from '../../hooks/useStreamingResponse';

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  showLabel?: boolean;
  showIcon?: boolean;
  onReconnect?: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Status configuration mapping
const statusConfig: Record<ConnectionStatus, { 
  color: string; 
  colorBg: string;
  label: string; 
  icon: React.ReactNode;
  description: string;
}> = {
  idle: { 
    color: 'bg-gray-400', 
    colorBg: 'bg-gray-400/20',
    label: 'Ready', 
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    description: 'Ready to start streaming'
  },
  connecting: { 
    color: 'bg-yellow-400', 
    colorBg: 'bg-yellow-400/20',
    label: 'Connecting...', 
    icon: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    description: 'Establishing connection to AI provider'
  },
  connected: { 
    color: 'bg-green-400', 
    colorBg: 'bg-green-400/20',
    label: 'Connected', 
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    description: 'Streaming response in progress'
  },
  reconnecting: { 
    color: 'bg-orange-400', 
    colorBg: 'bg-orange-400/20',
    label: 'Reconnecting...', 
    icon: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    description: 'Attempting to reconnect'
  },
  disconnected: { 
    color: 'bg-gray-400', 
    colorBg: 'bg-gray-400/20',
    label: 'Disconnected', 
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" opacity="0.3" />
      </svg>
    ),
    description: 'Connection closed'
  },
  error: { 
    color: 'bg-red-400', 
    colorBg: 'bg-red-400/20',
    label: 'Error', 
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-7v2h2v-2h-2zm0-8v6h2V7h-2z" />
      </svg>
    ),
    description: 'Connection error occurred'
  },
};

// Size configurations
const sizeConfig = {
  sm: {
    dot: 'w-2 h-2',
    icon: 'w-3 h-3',
    text: 'text-xs',
    padding: 'px-2 py-1',
    gap: 'gap-1.5',
  },
  md: {
    dot: 'w-2.5 h-2.5',
    icon: 'w-3.5 h-3.5',
    text: 'text-sm',
    padding: 'px-2.5 py-1.5',
    gap: 'gap-2',
  },
  lg: {
    dot: 'w-3 h-3',
    icon: 'w-4 h-4',
    text: 'text-base',
    padding: 'px-3 py-2',
    gap: 'gap-2.5',
  },
};

export const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({
  status,
  showLabel = true,
  showIcon = true,
  onReconnect,
  size = 'md',
  className = '',
}) => {
  const config = statusConfig[status];
  const sizes = sizeConfig[size];

  // Determine if we should show the reconnect button
  const showReconnect = (status === 'disconnected' || status === 'error') && onReconnect;

  // Animation variants
  const pulseVariants = {
    connecting: {
      scale: [1, 1.2, 1],
      opacity: [1, 0.7, 1],
    },
    reconnecting: {
      scale: [1, 1.15, 1],
      opacity: [1, 0.8, 1],
    },
    connected: {
      scale: [1, 1.05, 1],
      opacity: [1, 0.9, 1],
    },
  };

  return (
    <div 
      className={`inline-flex items-center ${sizes.gap} ${className}`}
      title={config.description}
    >
      {/* Status indicator dot */}
      <motion.div
        className={`relative flex items-center justify-center rounded-full ${sizes.dot} ${config.color}`}
        animate={status === 'connecting' || status === 'reconnecting' ? pulseVariants[status] : {}}
        transition={{ 
          repeat: Infinity, 
          duration: status === 'connecting' ? 1 : 1.5,
          ease: 'easeInOut',
        }}
      >
        {/* Glow effect for connected state */}
        {status === 'connected' && (
          <motion.div
            className={`absolute inset-0 rounded-full ${config.color}`}
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: 'easeInOut',
            }}
          />
        )}
      </motion.div>

      {/* Icon (optional) */}
      {showIcon && (
        <span className={`${sizes.icon} ${config.color} flex-shrink-0`}>
          {config.icon}
        </span>
      )}

      {/* Label */}
      {showLabel && (
        <span className={`${sizes.text} text-gray-400 font-medium`}>
          {config.label}
        </span>
      )}

      {/* Reconnect button */}
      {showReconnect && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          onClick={onReconnect}
          className={`${sizes.text} text-blue-400 hover:text-blue-300 
                     transition-colors duration-200 font-medium
                     hover:underline decoration-blue-400/30 underline-offset-2`}
        >
          Reconnect
        </motion.button>
      )}

      {/* Status badge background for error states */}
      {status === 'error' && (
        <span className={`absolute inset-0 rounded-full ${config.colorBg} -z-10`} />
      )}
    </div>
  );
};

// Export as default
export default ConnectionStatusIndicator;
