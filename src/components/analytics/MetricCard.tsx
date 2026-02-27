import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  format?: 'number' | 'currency' | 'percent' | 'time';
}

function formatValue(value: string | number, format: string): string {
  if (typeof value === 'string') return value;
  
  switch (format) {
    case 'currency':
      return `$${(value / 100).toFixed(2)}`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'time':
      if (value < 1000) return `${value}ms`;
      return `${(value / 1000).toFixed(1)}s`;
    default:
      return value.toLocaleString();
  }
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  changeLabel = 'vs last period',
  icon,
  format = 'number',
}) => {
  const getTrendIcon = () => {
    if (change === undefined || change === 0) {
      return <Minus className="w-4 h-4 text-gray-400" />;
    }
    return change > 0 ? (
      <ArrowUpRight className="w-4 h-4 text-green-500" />
    ) : (
      <ArrowDownRight className="w-4 h-4 text-red-500" />
    );
  };

  const getTrendClass = () => {
    if (change === undefined || change === 0) return 'text-gray-500';
    return change > 0 ? 'text-green-500' : 'text-red-500';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h3>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatValue(value, format)}
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-sm ${getTrendClass()}`}>
            {getTrendIcon()}
            <span>{Math.abs(change).toFixed(1)}%</span>
          </div>
        )}
      </div>
      {change !== undefined && (
        <div className="text-xs text-gray-400 mt-1">{changeLabel}</div>
      )}
    </div>
  );
};

export default MetricCard;
