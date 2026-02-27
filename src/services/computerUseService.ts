import { supabase } from '@/lib/supabase';

export interface ComputerUseTask {
  id: string;
  user_id: string;
  org_id: string;
  agent_id?: string;
  name: string;
  description?: string;
  target_url: string;
  instructions: string;
  max_steps: number;
  timeout_minutes: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  credits_used: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface ComputerUseSession {
  id: string;
  task_id: string;
  user_id: string;
  status: 'active' | 'expired' | 'terminated';
  browser_type: string;
  viewport?: string;
  started_at: string;
  ended_at?: string;
}

export interface ComputerUseAction {
  id: string;
  session_id: string;
  action_type: string;
  action_data: Record<string, any>;
  result: Record<string, any>;
  screenshot_url?: string;
  status: 'pending' | 'success' | 'failed';
  error_message?: string;
  created_at: string;
}

export interface ActionTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  actions: Record<string, any>[];
  is_public: boolean;
  user_id?: string;
  org_id?: string;
  usage_count: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  org_id: string;
  resource_type: string;
  resource_id: string;
  action: string;
  details: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface TaskListOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogOptions {
  resource_type?: string;
  resource_id?: string;
  action?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

class ComputerUseService {
  // ============ TASKS ============

  static async createTask(taskData: {
    name: string;
    target_url: string;
    instructions: string;
    max_steps: number;
    timeout_minutes: number;
    agent_id?: string;
    description?: string;
  }): Promise<ComputerUseTask> {
    const { data, error } = await supabase.functions.invoke('computer-use-task', {
      method: 'POST',
      body: { action: 'create', ...taskData },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data.task;
  }

  static async getTasks(options: TaskListOptions = {}): Promise<ComputerUseTask[]> {
    const { data, error } = await supabase.functions.invoke('computer-use-task', {
      method: 'GET',
      body: { action: 'list', ...options },
    });

    if (error) throw new Error(error.message);
    return data.tasks || [];
  }

  static async getTask(taskId: string): Promise<ComputerUseTask> {
    const { data, error } = await supabase.functions.invoke('computer-use-task', {
      method: 'GET',
      body: { action: 'get', task_id: taskId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data.task;
  }

  static async cancelTask(taskId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('computer-use-task', {
      method: 'DELETE',
      body: { action: 'cancel', task_id: taskId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
  }

  // ============ SESSIONS ============

  static async createSession(sessionData: {
    task_id: string;
    browser_type: string;
    viewport?: string;
  }): Promise<ComputerUseSession> {
    const { data, error } = await supabase.functions.invoke('computer-use-session', {
      method: 'POST',
      body: { action: 'create', ...sessionData },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data.session;
  }

  static async getSessions(taskId?: string): Promise<ComputerUseSession[]> {
    const { data, error } = await supabase.functions.invoke('computer-use-session', {
      method: 'GET',
      body: { action: 'list', task_id: taskId },
    });

    if (error) throw new Error(error.message);
    return data.sessions || [];
  }

  static async getSession(sessionId: string): Promise<ComputerUseSession> {
    const { data, error } = await supabase.functions.invoke('computer-use-session', {
      method: 'GET',
      body: { action: 'get', session_id: sessionId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data.session;
  }

  static async terminateSession(sessionId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('computer-use-session', {
      method: 'DELETE',
      body: { action: 'terminate', session_id: sessionId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
  }

  // ============ ACTIONS ============

  static async getSessionActions(sessionId: string): Promise<ComputerUseAction[]> {
    const { data, error } = await supabase
      .from('computer_use_actions')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ============ TEMPLATES ============

  static async getTemplates(category?: string): Promise<ActionTemplate[]> {
    let query = supabase
      .from('computer_use_action_templates')
      .select('*')
      .eq('is_public', true)
      .order('usage_count', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data || [];
  }

  static async getTemplate(templateId: string): Promise<ActionTemplate> {
    const { data, error } = await supabase.functions.invoke('computer-use-templates', {
      method: 'GET',
      body: { action: 'get', template_id: templateId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data.template;
  }

  static async createTemplate(templateData: {
    name: string;
    description: string;
    category: string;
    actions: Record<string, any>[];
    is_public?: boolean;
  }): Promise<ActionTemplate> {
    const { data, error } = await supabase.functions.invoke('computer-use-templates', {
      method: 'POST',
      body: { action: 'create', ...templateData },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data.template;
  }

  static async deleteTemplate(templateId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('computer-use-templates', {
      method: 'DELETE',
      body: { action: 'delete', template_id: templateId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
  }

  // ============ AUDIT LOGS ============

  static async getAuditLogs(options: AuditLogOptions = {}): Promise<AuditLog[]> {
    const { data, error } = await supabase.functions.invoke('computer-use-audit', {
      method: 'GET',
      body: { action: 'list', ...options },
    });

    if (error) throw new Error(error.message);
    return data.audit_logs || [];
  }

  // ============ CREDITS ============

  static calculateCredits(steps: number, timeoutMinutes: number, screenshots: number): number {
    return 1 + steps + Math.min(timeoutMinutes, 5) + screenshots;
  }

  static async getCreditBalance(): Promise<number> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('user_credits')
      .select('credits')
      .eq('user_id', user.id)
      .single();

    if (error) return 0; // Default to 0 if no credits record
    return data?.credits || 0;
  }

  // ============ REAL-TIME SUBSCRIPTIONS ============

  static subscribeToTask(taskId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`task:${taskId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'computer_use_tasks',
        filter: `id=eq.${taskId}`,
      }, callback)
      .subscribe();
  }

  static subscribeToSessionActions(sessionId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`session:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'computer_use_actions',
        filter: `session_id=eq.${sessionId}`,
      }, callback)
      .subscribe();
  }
}

export default ComputerUseService;
