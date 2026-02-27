import React from 'react';

interface HeatmapData {
  day: number;
  hour: number;
  value: number;
}

interface UsageHeatmapProps {
  data: HeatmapData[];
  title?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getColor(value: number, max: number): string {
  const intensity = value / max;
  if (intensity === 0) return 'bg-gray-100 dark:bg-gray-700';
  if (intensity < 0.25) return 'bg-blue-200';
  if (intensity < 0.5) return 'bg-blue-400';
  if (intensity < 0.75) return 'bg-blue-600';
  return 'bg-blue-800';
}

export const UsageHeatmap: React.FC<UsageHeatmapProps> = ({ data, title }) => {
  // Transform data into a 2D array
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const heatmapData: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
  
  data.forEach(d => {
    heatmapData[d.day][d.hour] = d.value;
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Hour labels */}
          <div className="flex ml-8 mb-1">
            {HOURS.filter((_, i) => i % 3 === 0).map(hour => (
              <div key={hour} className="w-6 text-xs text-gray-500" style={{ marginLeft: '18px' }}>
                {hour}:00
              </div>
            ))}
          </div>
          
          {/* Heatmap grid */}
          {DAYS.map((day, dayIndex) => (
            <div key={day} className="flex items-center mb-1">
              <div className="w-8 text-xs text-gray-500">{day}</div>
              <div className="flex gap-0.5">
                {HOURS.map(hour => (
                  <div
                    key={`${dayIndex}-${hour}`}
                    className={`w-6 h-6 rounded ${getColor(heatmapData[dayIndex][hour], maxValue)}`}
                    title={`${day} ${hour}:00 - ${heatmapData[dayIndex][hour]} events`}
                  />
                ))}
              </div>
            </div>
          ))}
          
          {/* Legend */}
          <div className="flex items-center justify-end mt-4 gap-2">
            <span className="text-xs text-gray-500">Less</span>
            {['bg-gray-100', 'bg-blue-200', 'bg-blue-400', 'bg-blue-600', 'bg-blue-800'].map(color => (
              <div key={color} className={`w-4 h-4 rounded ${color}`} />
            ))}
            <span className="text-xs text-gray-500">More</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UsageHeatmap;
