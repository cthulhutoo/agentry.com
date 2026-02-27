import React, { useState, useEffect, useCallback } from 'react';
import { Download, RefreshCw, Users, MessageSquare, Zap, DollarSign, Clock, AlertCircle } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { DateRangeFilter } from './DateRangeFilter';
import { UsageLineChart, CostBarChart, UsagePieChart, UsageHeatmap } from './charts';
import { analyticsApi } from '../../services/analyticsApi';

interface DashboardData {
  overview: any;
  usage: any;
  costs: any;
  performance: any;
  users: any;
}

export const AnalyticsDashboard: React.FC = () => {
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
  });
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dateRangeParams = {
        start_date: dateRange.startDate.toISOString(),
        end_date: dateRange.endDate.toISOString(),
      };

      const [overview, usage, costs, performance, users] = await Promise.all([
        analyticsApi.getOverview(dateRangeParams),
        analyticsApi.getUsage(dateRangeParams, { granularity: 'daily' }),
        analyticsApi.getCosts(dateRangeParams),
        analyticsApi.getPerformance(dateRangeParams),
        analyticsApi.getUsers(dateRangeParams),
      ]);

      setData({ overview, usage, costs, performance, users });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics data');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async (format: 'csv' | 'json') => {
    const params = {
      start_date: dateRange.startDate.toISOString(),
      end_date: dateRange.endDate.toISOString(),
    };

    const blob = await analyticsApi.exportData('usage', params, format);
    const url = URL.createObjectURL(blob as any);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-export.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchData}
          className="mt-2 text-sm text-red-500 hover:text-red-600"
        >
          Try again
        </button>
      </div>
    );
  }

  const metrics = data?.overview?.metrics || {};
  const prevMetrics = data?.overview?.previous_period || {};

  // Calculate changes
  const calcChange = (current: number, previous: number) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Monitor your AI agent usage, costs, and performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter
            value={dateRange}
            onChange={setDateRange}
          />
          <button
            onClick={fetchData}
            className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            title="Refresh data"
          >
            <RefreshCw className={`w-5 h-5 text-gray-600 dark:text-gray-300 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="relative group">
            <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Download className="w-4 h-4" />
              Export
            </button>
            <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg hidden group-hover:block z-10">
              <button
                onClick={() => handleExport('json')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Export as JSON
              </button>
              <button
                onClick={() => handleExport('csv')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Export as CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Users"
          value={metrics.total_users || 0}
          change={calcChange(metrics.total_users, prevMetrics.total_conversations)}
          icon={<Users className="w-5 h-5" />}
        />
        <MetricCard
          title="Conversations"
          value={metrics.total_conversations || 0}
          change={calcChange(metrics.total_conversations, prevMetrics.total_conversations)}
          icon={<MessageSquare className="w-5 h-5" />}
        />
        <MetricCard
          title="Total Cost"
          value={metrics.total_cost_cents || 0}
          change={calcChange(metrics.total_cost_cents, prevMetrics.total_cost_cents)}
          format="currency"
          icon={<DollarSign className="w-5 h-5" />}
        />
        <MetricCard
          title="Avg Response Time"
          value={metrics.avg_response_time_ms || 0}
          format="time"
          icon={<Clock className="w-5 h-5" />}
        />
      </div>

      {/* Usage Trend Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UsageLineChart
          data={data?.usage?.data || []}
          dataKeys={['tokens_used', 'event_count']}
          title="Usage Over Time"
        />
        <CostBarChart
          data={data?.costs?.cost_by_agent || []}
          title="Cost by Agent"
        />
      </div>

      {/* Additional Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UsagePieChart
          data={(data?.costs?.cost_by_agent || []).slice(0, 5).map((c: any) => ({
            name: c.agent_id?.slice(0, 8) || 'Unknown',
            value: c.cost_cents || 0,
          }))}
          title="Cost Distribution"
        />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">User Segments</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Power Users</span>
              <span className="font-medium">{data?.users?.user_segments?.power || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Regular Users</span>
              <span className="font-medium">{data?.users?.user_segments?.regular || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Casual Users</span>
              <span className="font-medium">{data?.users?.user_segments?.casual || 0}</span>
            </div>
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">DAU/MAU Ratio</span>
                <span className="font-medium">{data?.users?.dau_mau_ratio || 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-gray-500">Success Rate</div>
            <div className="text-xl font-bold text-green-600">
              {data?.performance?.success_rate?.toFixed(1) || 0}%
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">P50 Response</div>
            <div className="text-xl font-bold">
              {data?.performance?.p50_response_time_ms || 0}ms
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">P95 Response</div>
            <div className="text-xl font-bold">
              {data?.performance?.p95_response_time_ms || 0}ms
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Error Rate</div>
            <div className="text-xl font-bold text-red-600">
              {data?.performance?.error_rate?.toFixed(1) || 0}%
            </div>
          </div>
        </div>
        
        {/* Error Breakdown */}
        {data?.performance?.error_breakdown?.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-medium text-gray-500 mb-3">Top Errors</h4>
            <div className="space-y-2">
              {data.performance.error_breakdown.slice(0, 5).map((err: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300 truncate max-w-md">{err.error_type}</span>
                  <span className="text-gray-500">{err.count} ({err.percentage.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
