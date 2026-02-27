/**
 * Analytics API Service
 * Client-side API for interacting with analytics edge functions
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create client for browser-side requests
const createBrowserClient = () => {
  return createClient(supabaseUrl, supabaseAnonKey);
};

interface DateRange {
  start_date?: string;
  end_date?: string;
  preset?: string;
}

// Build query string from date range
function buildDateRangeParams(dateRange: DateRange): string {
  const params = new URLSearchParams();
  
  if (dateRange.start_date) params.set('start_date', dateRange.start_date);
  if (dateRange.end_date) params.set('end_date', dateRange.end_date);
  if (dateRange.preset) params.set('preset', dateRange.preset);
  
  return params.toString();
}

// Get edge function URL
function getFunctionUrl(name: string): string {
  return `${supabaseUrl}/functions/v1/${name}`;
}

// Get auth token
async function getAuthToken(): Promise<string> {
  const client = createBrowserClient();
  const { data: { session } } = await client.auth.getSession();
  return session?.access_token || '';
}

// Make authenticated request
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<any> {
  const token = await getAuthToken();
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': supabaseAnonKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
}

export const analyticsApi = {
  // Event collection
  async trackEvent(event: any) {
    const response = await fetch(getFunctionUrl('analytics-events'), {
      method: 'POST',
      body: JSON.stringify(event),
    });
    return response.json();
  },

  async trackEvents(events: any[]) {
    const response = await fetch(getFunctionUrl('analytics-events'), {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
    return response.json();
  },

  // Overview metrics
  async getOverview(dateRange: DateRange = {}) {
    const params = buildDateRangeParams(dateRange);
    return fetchWithAuth(`${getFunctionUrl('analytics-overview')}?${params}`);
  },

  // Usage analytics
  async getUsage(dateRange: DateRange = {}, options: { granularity?: string; agent_id?: string } = {}) {
    const params = new URLSearchParams(buildDateRangeParams(dateRange));
    if (options.granularity) params.set('granularity', options.granularity);
    if (options.agent_id) params.set('agent_id', options.agent_id);
    return fetchWithAuth(`${getFunctionUrl('analytics-usage')}?${params}`);
  },

  // Cost analytics
  async getCosts(dateRange: DateRange = {}) {
    const params = buildDateRangeParams(dateRange);
    return fetchWithAuth(`${getFunctionUrl('analytics-costs')}?${params}`);
  },

  // Performance metrics
  async getPerformance(dateRange: DateRange = {}) {
    const params = buildDateRangeParams(dateRange);
    return fetchWithAuth(`${getFunctionUrl('analytics-performance')}?${params}`);
  },

  // User analytics
  async getUsers(dateRange: DateRange = {}) {
    const params = buildDateRangeParams(dateRange);
    return fetchWithAuth(`${getFunctionUrl('analytics-users')}?${params}`);
  },

  // Agent analytics
  async getAgents(dateRange: DateRange = {}, limit = 50) {
    const params = new URLSearchParams(buildDateRangeParams(dateRange));
    params.set('limit', String(limit));
    return fetchWithAuth(`${getFunctionUrl('analytics-agents')}?${params}`);
  },

  // Export
  async exportData(type: 'usage' | 'costs' | 'performance', dateRange: DateRange = {}, format: 'json' | 'csv' = 'json') {
    const params = new URLSearchParams(buildDateRangeParams(dateRange));
    params.set('type', type);
    params.set('format', format);
    
    const response = await fetchWithAuth(`${getFunctionUrl('analytics-export')}?${params}`);
    return response;
  },
};

export default analyticsApi;
