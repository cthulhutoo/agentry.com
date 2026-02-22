import React, { useState } from 'react';
import ResearchAgent from './ResearchAgent';
import ContentAgent from './ContentAgent';
import CodeAgent from './CodeAgent';
import DataAgent from './DataAgent';
import CommunicationAgent from './CommunicationAgent';

interface AgentTemplatesProps {
  credits?: number;
  onTaskComplete?: (result: string) => void;
}

type AgentType = 'research' | 'content' | 'code' | 'data' | 'communication';

const AgentTemplates: React.FC<AgentTemplatesProps> = ({ credits = 0, onTaskComplete }) => {
  const [activeAgent, setActiveAgent] = useState<AgentType>('research');

  const agents = [
    { 
      id: 'research' as const, 
      name: 'Research', 
      icon: '🔍', 
      color: 'blue',
      description: 'Web search & summarization'
    },
    { 
      id: 'content' as const, 
      name: 'Content', 
      icon: '📝', 
      color: 'purple',
      description: 'Writing & editing'
    },
    { 
      id: 'code' as const, 
      name: 'Code', 
      icon: '💻', 
      color: 'green',
      description: 'Generation & review'
    },
    { 
      id: 'data' as const, 
      name: 'Data', 
      icon: '📊', 
      color: 'orange',
      description: 'Analysis & visualization'
    },
    { 
      id: 'communication' as const, 
      name: 'Communication', 
      icon: '💬', 
      color: 'pink',
      description: 'Email & social'
    },
  ];

  const colorClasses = {
    blue: 'bg-blue-100 border-blue-500 text-blue-700',
    purple: 'bg-purple-100 border-purple-500 text-purple-700',
    green: 'bg-green-100 border-green-500 text-green-700',
    orange: 'bg-orange-100 border-orange-500 text-orange-700',
    pink: 'bg-pink-100 border-pink-500 text-pink-700',
  };

  const renderAgent = () => {
    switch (activeAgent) {
      case 'research':
        return <ResearchAgent credits={credits} onTaskComplete={onTaskComplete} />;
      case 'content':
        return <ContentAgent credits={credits} onTaskComplete={onTaskComplete} />;
      case 'code':
        return <CodeAgent credits={credits} onTaskComplete={onTaskComplete} />;
      case 'data':
        return <DataAgent credits={credits} onTaskComplete={onTaskComplete} />;
      case 'communication':
        return <CommunicationAgent credits={credits} onTaskComplete={onTaskComplete} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Agent Templates</h2>
        <p className="text-gray-600">Select an agent type to get started with specialized AI assistance</p>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setActiveAgent(agent.id)}
            className={`p-4 rounded-lg border-2 transition-all ${
              activeAgent === agent.id
                ? `${colorClasses[agent.color]} border-2 shadow-md`
                : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-3xl mb-2">{agent.icon}</div>
            <div className="font-semibold text-sm">{agent.name}</div>
            <div className="text-xs text-gray-500 mt-1">{agent.description}</div>
          </button>
        ))}
      </div>

      <div className="border-t border-gray-200 pt-6">
        {renderAgent()}
      </div>
    </div>
  );
};

export default AgentTemplates;
