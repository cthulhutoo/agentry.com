/**
 * useAnalytics Hook
 * Custom hook for analytics data fetching
 */

import { useState, useEffect, useCallback } from 'react';
import { analyticsApi } from '../services/analyticsApi';

interface UseAnalyticsOptions {
  autoFetch?: boolean;
}

interface DateRange {
  start_date?: string;
  end_date?: string;
}

export function useAnalytics(options: UseAnalyticsOptions = {}) {
  const { autoFetch = true } = options;

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      start_date: start.toISOString(),
      end_date: end.toISOString(),
    };
  });

  const [overview, setOverview] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [costs, setCosts] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const data = await analyticsApi.getOverview(dateRange);
      setOverview(data);
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    }
  }, [dateRange]);

  const fetchUsage = useCallback(async (granularity = 'daily', agentId?: string) => {
    try {
      const data = await analyticsApi.getUsage(dateRange, { granularity, agent_id: agentId });
      setUsage(data);
    } catch (err) {
      console.error('Failed to fetch usage:', err);
    }
  }, [dateRange]);

  const fetchCosts = useCallback(async () => {
    try {
      const data = await analyticsApi.getCosts(dateRange);
      setCosts(data);
    } catch (err) {
      console.error('Failed to fetch costs:', err);
    }
  }, [dateRange]);

  const fetchPerformance = useCallback(async () => {
    try {
      const data = await analyticsApi.getPerformance(dateRange);
      setPerformance(data);
    } catch (err) {
      console.error('Failed to fetch performance:', err);
    }
  }, [dateRange]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchOverview(),
        fetchUsage(),
        fetchCosts(),
        fetchPerformance(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  }, [fetchOverview, fetchUsage, fetchCosts, fetchPerformance]);

  useEffect(() => {
    if (autoFetch) {
      fetchAll();
    }
  }, [autoFetch, fetchAll]);

  return {
    dateRange,
    setDateRange,
    overview,
    usage,
    costs,
    performance,
    loading,
    error,
    fetchAll,
    fetchOverview,
    fetchUsage,
    fetchCosts,
    fetchPerformance,
  };
}

export default useAnalytics;
