import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  Save,
  FolderOpen,
  Share2,
  Trash2,
  Plus,
  Edit2,
  Copy,
  Check,
  X,
  Users,
  Calendar,
  Star
} from 'lucide-react';

interface SavedCouncil {
  id: string;
  user_id: string;
  name: string;
  agent_ids: string[];
  description?: string;
  is_default?: boolean;
  created_at: string;
  updated_at: string;
}

interface CouncilManagerProps {
  currentAgentIds: string[];
  onLoadCouncil?: (agentIds: string[]) => void;
  allAgents?: Array<{ id: string; name: string; category: string }>;
}

const CouncilManager: React.FC<CouncilManagerProps> = ({
  currentAgentIds = [],
  onLoadCouncil,
  allAgents = []
}) => {
  const [savedCouncils, setSavedCouncils] = useState<SavedCouncil[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedCouncil, setSelectedCouncil] = useState<SavedCouncil | null>(null);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  
  // Save form state
  const [saveForm, setSaveForm] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    fetchSavedCouncils();
  }, []);

  const fetchSavedCouncils = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSavedCouncils([]);
        return;
      }

      const { data, error } = await supabase
        .from('saved_councils')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSavedCouncils(data || []);
    } catch (err: any) {
      console.error('Failed to fetch saved councils:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveCouncil = async () => {
    if (!saveForm.name.trim()) {
      alert('Please enter a council name');
      return;
    }

    if (currentAgentIds.length === 0) {
      alert('Please select at least one agent');
      return;
    }

    try {
      setIsSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please login to save councils');
        return;
      }

      const { data, error } = await supabase
        .from('saved_councils')
        .insert({
          user_id: user.id,
          name: saveForm.name,
          agent_ids: currentAgentIds,
          description: saveForm.description || null
        })
        .select()
        .single();

      if (error) throw error;

      setSavedCouncils(prev => [data, ...prev]);
      setShowSaveModal(false);
      setSaveForm({ name: '', description: '' });
      alert('Council saved successfully!');
    } catch (err: any) {
      console.error('Failed to save council:', err);
      alert('Failed to save council. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCouncil = async (councilId: string) => {
    if (!confirm('Are you sure you want to delete this council?')) return;

    try {
      setIsDeleting(councilId);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('saved_councils')
        .delete()
        .eq('id', councilId)
        .eq('user_id', user.id);

      if (error) throw error;
      setSavedCouncils(prev => prev.filter(c => c.id !== councilId));
    } catch (err: any) {
      console.error('Failed to delete council:', err);
      alert('Failed to delete council. Please try again.');
    } finally {
      setIsDeleting(null);
    }
  };

  const loadCouncil = async (council: SavedCouncil) => {
    if (onLoadCouncil) {
      onLoadCouncil(council.agent_ids);
      alert(`Loaded council: ${council.name}`);
    }
  };

  const shareCouncil = (council: SavedCouncil) => {
    // Encode council data for URL sharing
    const councilData = {
      name: council.name,
      agent_ids: council.agent_ids,
      description: council.description
    };
    
    const encoded = btoa(JSON.stringify(councilData));
    const url = `${window.location.origin}?council=${encodeURIComponent(encoded)}`;
    
    setShareUrl(url);
    setSelectedCouncil(council);
    setShowShareModal(true);
    setCopied(false);
  };

  const copyShareUrl = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
      alert('Failed to copy URL. Please try again.');
    });
  };

  const getAgentCountText = (agentIds: string[]): string => {
    const count = agentIds.length;
    return `${count} ${count === 1 ? 'agent' : 'agents'}`;
  };

  const getAgentNames = (agentIds: string[]): string => {
    return agentIds
      .map(id => {
        const agent = allAgents.find(a => a.id === id);
        return agent ? agent.name : id;
      })
      .slice(0, 3)
      .join(', ') + (agentIds.length > 3 ? '...' : '');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Council Manager
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Save, load, and share agent councils
            </p>
          </div>
          <button
            onClick={() => setShowSaveModal(true)}
            disabled={currentAgentIds.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            <Save className="w-4 h-4" />
            Save Current Council
          </button>
        </div>
      </div>

      {/* Saved Councils List */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
          </div>
        ) : savedCouncils.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 font-medium">No saved councils yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Select agents and save your first council to get started
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {savedCouncils.map(council => (
              <div
                key={council.id}
                className="border border-slate-200 rounded-lg p-4 hover:border-slate-300 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {council.is_default && (
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      )}
                      <h3 className="font-semibold text-slate-900">{council.name}</h3>
                    </div>
                    
                    {council.description && (
                      <p className="text-sm text-slate-600 mb-2">{council.description}</p>
                    )}
                    
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {getAgentCountText(council.agent_ids)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(council.created_at)}
                      </span>
                      <span className="text-slate-400 truncate max-w-xs">
                        {getAgentNames(council.agent_ids)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ml-4">
                    <button
                      onClick={() => loadCouncil(council)}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Load council"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => shareCouncil(council)}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Share council"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteCouncil(council.id)}
                      disabled={isDeleting === council.id}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Delete council"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Save Council</h3>
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Council Name *
                </label>
                <input
                  type="text"
                  value={saveForm.name}
                  onChange={(e) => setSaveForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Research & Analysis Team"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={saveForm.description}
                  onChange={(e) => setSaveForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe what this council specializes in..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none"
                />
              </div>

              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm text-slate-600">
                  <span className="font-medium">{currentAgentIds.length}</span> agents will be saved in this council
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveCouncil}
                disabled={isSaving || !saveForm.name.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Council
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Share Council</h3>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-900 mb-1">
                  {selectedCouncil?.name}
                </p>
                <p className="text-xs text-slate-500">
                  {selectedCouncil?.agent_ids.length} agents • Shareable link
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Share URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm font-mono"
                  />
                  <button
                    onClick={copyShareUrl}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Anyone with this link can view and load this council configuration.
              </p>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CouncilManager;
