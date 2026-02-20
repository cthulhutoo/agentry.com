import { useState } from 'react';
import { ChevronDown, Sparkles, Users, RefreshCw, Zap, Shield, TrendingUp } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
  icon: React.ReactNode;
}

const faqs: FAQItem[] = [
  {
    question: 'How does the consensus-building process work?',
    answer: 'When you submit a question, your agent council engages in a multi-round discussion (3 rounds by default). In Round 1, each agent provides their initial expert perspective. In Round 2, agents see what others said and refine their analysis, addressing gaps and building on insights. In Round 3, agents work toward a final consensus, synthesizing the collective intelligence into a comprehensive answer. This iterative approach ensures thorough analysis from multiple angles.',
    icon: <RefreshCw className="w-5 h-5" />,
  },
  {
    question: 'Why are multi-round discussions better than single responses?',
    answer: 'Multi-round discussions eliminate blind spots and surface insights that might be missed in a single pass. Each agent can challenge assumptions, fill knowledge gaps, and refine their thinking based on peer input. This mirrors how expert teams collaborate in the real world, where the best solutions emerge from iterative discussion rather than isolated opinions. The result is more nuanced, well-rounded, and actionable advice.',
    icon: <TrendingUp className="w-5 h-5" />,
  },
  {
    question: 'What are the benefits of using multiple AI models and vendors?',
    answer: 'Different AI models have unique strengths: Claude excels at nuanced reasoning and creative tasks, GPT-4 is strong at structured analysis and coding, and Gemini brings powerful multimodal capabilities. By combining models from Anthropic, OpenAI, and Google, you get diverse perspectives that reduce bias, catch errors, and provide more comprehensive coverage. One model might miss something another catches.',
    icon: <Users className="w-5 h-5" />,
  },
  {
    question: 'How does model diversity improve answer quality?',
    answer: 'Each AI model is trained differently, has different architectures, and excels in different domains. When multiple models analyze the same question, they approach it from different angles with different reasoning patterns. This diversity acts as a quality check - if all models agree, you can be more confident. If they disagree, you get to see multiple valid perspectives and make an informed choice. It\'s like getting second and third opinions from specialists.',
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    question: 'Why mix different LLM providers in one council?',
    answer: 'Mixing Anthropic, OpenAI, and Google models in your council creates a robust, vendor-agnostic analysis team. No single company has a monopoly on AI capabilities. Anthropic\'s models might excel at ethical reasoning, OpenAI\'s at technical accuracy, and Google\'s at real-world knowledge synthesis. By combining them, you avoid vendor lock-in and get the "best of all worlds" - each model contributing what it does best.',
    icon: <Zap className="w-5 h-5" />,
  },
  {
    question: 'How does agent specialization reduce hallucinations?',
    answer: 'When agents are specialized and prompted with domain expertise, they stay focused on their area of knowledge rather than making broad generalizations. The consensus process also helps catch hallucinations - if one agent makes an unsupported claim, others will either validate or challenge it in subsequent rounds. Multiple specialized perspectives create natural fact-checking and error correction.',
    icon: <Shield className="w-5 h-5" />,
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
      <div className="bg-gradient-to-r from-cyan-600 to-blue-600 p-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Sparkles className="w-6 h-6" />
          Frequently Asked Questions
        </h2>
        <p className="text-cyan-50 mt-2">
          Learn how multi-agent consensus and model diversity create better AI answers
        </p>
      </div>

      <div className="divide-y divide-slate-200">
        {faqs.map((faq, index) => (
          <div key={index} className="transition-colors hover:bg-slate-50">
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full px-6 py-4 flex items-start gap-4 text-left transition-all"
            >
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                openIndex === index
                  ? 'bg-cyan-100 text-cyan-600'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {faq.icon}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 mb-1">
                  {faq.question}
                </h3>
                {openIndex === index && (
                  <p className="text-slate-600 text-sm leading-relaxed mt-2 pr-8">
                    {faq.answer}
                  </p>
                )}
              </div>

              <ChevronDown
                className={`flex-shrink-0 w-5 h-5 text-slate-400 transition-transform ${
                  openIndex === index ? 'transform rotate-180' : ''
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="bg-slate-50 p-6 border-t border-slate-200">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-1">
              Ready to build your expert council?
            </h4>
            <p className="text-sm text-slate-600">
              Select multiple specialized agents from different domains to see the power of multi-model consensus in action.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
