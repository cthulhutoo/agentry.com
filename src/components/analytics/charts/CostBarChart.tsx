import React from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface CostData {
  agent_id: string;
  cost_cents: number;
  percentage: number;
}

interface CostBarChartProps {
  data: CostData[];
  title?: string;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export const CostBarChart: React.FC<CostBarChartProps> = ({ data, title }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      <ResponsiveContainer width="100%" height={300}>
        <RechartsBarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="agent_id" 
            stroke="#9ca3af" 
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickFormatter={(value) => value.slice(0, 8)}
          />
          <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 12 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
            labelStyle={{ color: '#f3f4f6' }}
            formatter={(value: number) => [`$${(value / 100).toFixed(2)}`, 'Cost']}
          />
          <Bar dataKey="cost_cents" name="Cost ($)">
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CostBarChart;
