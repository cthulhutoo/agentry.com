import React, { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This month', special: 'month' },
  { label: 'Last month', special: 'lastMonth' },
];

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.startDate.toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(value.endDate.toISOString().slice(0, 10));

  const handlePreset = (preset: typeof PRESETS[0]) => {
    const end = new Date();
    let start = new Date();

    if (preset.special === 'month') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (preset.special === 'lastMonth') {
      start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      end.setDate(0); // Last day of previous month
    } else if (preset.days !== undefined) {
      start.setDate(start.getDate() - preset.days);
    }

    onChange({ startDate: start, endDate: end });
    setIsOpen(false);
  };

  const handleCustomApply = () => {
    onChange({
      startDate: new Date(customStart),
      endDate: new Date(customEnd),
    });
    setIsOpen(false);
  };

  const formatDateRange = () => {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${value.startDate.toLocaleDateString('en-US', options)} - ${value.endDate.toLocaleDateString('en-US', options)}`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <Calendar className="w-4 h-4 text-gray-500" />
        <span className="text-sm text-gray-700 dark:text-gray-300">{formatDateRange()}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 mb-2">Quick Select</div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePreset(preset)}
                  className="px-3 py-1.5 text-xs text-left rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-3">
            <div className="text-xs font-medium text-gray-500 mb-2">Custom Range</div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500">Start</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full px-2 py-1 text-sm border rounded"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">End</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full px-2 py-1 text-sm border rounded"
                />
              </div>
              <button
                onClick={handleCustomApply}
                className="w-full px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangeFilter;
