"""Categorize the 45 uncategorized agents and improve their descriptions."""
import json

with open("store.json", "r") as f:
    data = json.load(f)

# Category assignments based on what these companies actually do
CATEGORIZATIONS = {
    # AI Research & Foundation Models -> Research & Knowledge
    "agent-0094": {"category": "Research & Knowledge", "name": "OpenAI", "description": "AI research lab and creator of GPT models, ChatGPT, and the Assistants API. Offers foundation models for building AI agents and applications."},
    "agent-0095": {"category": "Research & Knowledge", "name": "Google DeepMind", "description": "Google's AI research division. Develops Gemini foundation models and AI agent capabilities used across Google Cloud and Vertex AI."},
    "agent-0096": {"category": "Research & Knowledge", "name": "Meta AI", "description": "Meta's AI research lab. Develops open-source Llama models and AI research tools for building conversational AI agents."},
    "agent-0097": {"category": "Research & Knowledge", "name": "Mistral AI", "description": "European AI lab building open and commercial foundation models. Known for efficient, high-performance language models for agent applications."},
    "agent-0098": {"category": "Research & Knowledge", "name": "Cohere", "description": "Enterprise AI platform providing language models, embeddings, and retrieval-augmented generation for building business AI agents."},
    "agent-0099": {"category": "Research & Knowledge", "name": "AI21 Labs", "description": "AI research company building enterprise-grade language models (Jamba) for text generation, summarization, and agent workflows."},

    # Cloud & Infrastructure -> Developer Tools
    "agent-0071": {"category": "Developer Tools", "name": "Modal", "description": "Serverless cloud platform for running AI/ML workloads. Deploy AI agents, batch jobs, and model inference at scale without managing infrastructure."},
    "agent-0100": {"category": "Developer Tools", "name": "Google Cloud AI", "description": "Google Cloud's AI and ML platform. Offers Vertex AI, Gemini API, and agent builder tools for deploying enterprise AI agents."},
    "agent-0101": {"category": "Developer Tools", "name": "Microsoft Azure AI", "description": "Microsoft's cloud AI platform. Offers Azure AI services, Copilot Studio, and agent orchestration through AutoGen and Semantic Kernel."},
    "agent-0102": {"category": "Operations & Workflow", "name": "Oracle", "description": "Enterprise software and cloud platform. Offers AI-powered automation across ERP, HCM, and supply chain management."},
    "agent-0103": {"category": "Operations & Workflow", "name": "IBM", "description": "Enterprise technology company. Offers watsonx AI platform and IBM Consulting for deploying AI agents in business operations."},
    "agent-0104": {"category": "Operations & Workflow", "name": "SAP", "description": "Enterprise application software. Integrates AI agents across ERP, supply chain, and business process automation via Joule AI copilot."},
    "agent-0110": {"category": "Developer Tools", "name": "Vercel", "description": "Frontend cloud platform and creators of Next.js. Offers AI SDK for building AI-powered web applications and agent interfaces."},
    "agent-0111": {"category": "Software Development", "name": "Replit", "description": "Cloud-based IDE with built-in AI agent for code generation, debugging, and pair programming. Supports building and deploying AI applications."},
    "agent-0112": {"category": "Software Development", "name": "GitLab", "description": "DevSecOps platform with AI-powered code suggestions, vulnerability detection, and workflow automation through GitLab Duo."},
    "agent-0133": {"category": "Developer Tools", "name": "Cloudflare", "description": "Web infrastructure and security company. Offers Workers AI for deploying AI models at the edge and AI Gateway for managing AI agent traffic."},
    "agent-0134": {"category": "Developer Tools", "name": "Supabase", "description": "Open-source Firebase alternative. Provides database, auth, and vector embeddings for building AI agent backends and retrieval systems."},
    "agent-0135": {"category": "Developer Tools", "name": "Neon", "description": "Serverless Postgres platform. Offers vector storage and pgvector for AI agent memory, retrieval-augmented generation, and embeddings."},

    # Agent Frameworks -> Developer Tools
    "agent-0105": {"category": "Developer Tools", "name": "LangChain", "description": "Leading framework for building AI agent applications. Provides tools for chains, retrieval, memory, and multi-step agent workflows with LangGraph."},
    "agent-0106": {"category": "Developer Tools", "name": "CrewAI", "description": "Multi-agent orchestration framework. Build teams of AI agents that collaborate on complex tasks with role-based coordination."},
    "agent-0107": {"category": "Developer Tools", "name": "AutoGen", "description": "Microsoft's open-source framework for building multi-agent conversational AI systems. Supports agent collaboration and human-in-the-loop workflows."},
    "agent-0108": {"category": "Developer Tools", "name": "Fixie AI", "description": "Platform for building conversational AI agents with natural language interfaces. Focuses on making AI agents accessible to non-technical users."},
    "agent-0109": {"category": "Software Development", "name": "Adept AI", "description": "AI research lab building agents that can take actions in software. Developing foundation models for computer-use and workflow automation."},

    # Enterprise Platforms
    "agent-0113": {"category": "Operations & Workflow", "name": "Atlassian", "description": "Collaboration and project management platform (Jira, Confluence). Integrates AI agents for workflow automation and team productivity."},
    "agent-0114": {"category": "Operations & Workflow", "name": "Box", "description": "Enterprise content management platform with AI-powered document intelligence, classification, and workflow automation agents."},
    "agent-0115": {"category": "Finance & Accounting", "name": "Intuit", "description": "Financial software company (QuickBooks, TurboTax, Mailchimp). Offers AI-powered financial agents for bookkeeping, tax prep, and marketing."},
    "agent-0116": {"category": "Developer Tools", "name": "MongoDB", "description": "Document database platform. Offers Atlas Vector Search for AI agent memory, semantic search, and retrieval-augmented generation."},
    "agent-0117": {"category": "Finance & Accounting", "name": "PayPal", "description": "Digital payments platform. Developing AI agents for payment processing, fraud detection, and commerce automation."},
    "agent-0118": {"category": "Operations & Workflow", "name": "ServiceNow", "description": "Enterprise workflow automation platform. Offers AI agents for IT service management, HR operations, and customer service workflows."},
    "agent-0119": {"category": "HR & Recruiting", "name": "UKG", "description": "Human capital management platform. Offers AI-powered agents for workforce management, payroll, HR, and employee experience."},
    "agent-0120": {"category": "HR & Recruiting", "name": "Workday", "description": "Enterprise cloud platform for HR and finance. Integrates AI agents for talent management, financial planning, and workforce optimization."},

    # Conversational AI / Customer Service
    "agent-0122": {"category": "Developer Tools", "name": "Relevance AI", "description": "No-code AI agent platform. Build, deploy, and manage AI agents for sales, support, and operations without writing code."},
    "agent-0123": {"category": "Customer Service", "name": "Voiceflow", "description": "Conversational AI platform for building and deploying AI agents across chat, voice, and messaging channels."},
    "agent-0124": {"category": "Developer Tools", "name": "Botpress", "description": "Open-source platform for building AI-powered chatbots and agents. Supports natural language understanding and multi-channel deployment."},
    "agent-0125": {"category": "Customer Service", "name": "Rasa", "description": "Open-source conversational AI framework. Build contextual AI assistants and agents with advanced dialogue management."},
    "agent-0126": {"category": "Customer Service", "name": "Cognigy", "description": "Enterprise conversational AI platform. Deploys AI agents for customer service across voice and chat channels at scale."},
    "agent-0127": {"category": "Customer Service", "name": "Yellow.ai", "description": "Enterprise conversational AI platform. AI agents for customer support automation across 35+ channels in 135+ languages."},
    "agent-0128": {"category": "Customer Service", "name": "Kore.ai", "description": "Enterprise AI platform for building virtual assistants and AI agents across customer service, employee experience, and IT."},
    "agent-0129": {"category": "Operations & Workflow", "name": "Moveworks", "description": "AI copilot platform for enterprise IT, HR, and finance. Automates employee support with conversational AI agents."},
    "agent-0130": {"category": "Customer Service", "name": "Observe.AI", "description": "AI-powered conversation intelligence platform. Analyzes customer interactions and coaches agents with real-time AI assistance."},
    "agent-0131": {"category": "Customer Service", "name": "Assembled", "description": "Workforce management platform for support teams. Uses AI to forecast demand, schedule agents, and optimize customer service operations."},
    "agent-0132": {"category": "Customer Service", "name": "Haptik", "description": "Conversational AI platform for building AI agents. Automates customer engagement across WhatsApp, web, and messaging channels."},

    # Other
    "agent-0079": {"category": "Data & Analytics", "name": "Cerebrus Pulse", "description": "AI-powered analytics and monitoring agent. Provides real-time data insights and automated analysis through the A2A protocol."},
    "agent-0082": {"category": "Sales & Outreach", "name": "Gatana", "description": "AI-powered sales agent platform. Automates outreach, lead qualification, and sales engagement workflows."},
    "agent-0090": {"category": "Research & Knowledge", "name": "A2A Directory", "description": "Community resource for the Agent2Agent protocol ecosystem. Catalogs A2A-compatible agent cards, servers, clients, and documentation."},
}

# Apply categorizations
updated = 0
for agent in data["agents"]:
    aid = agent["id"]
    if aid in CATEGORIZATIONS:
        cat_data = CATEGORIZATIONS[aid]
        old_cat = agent.get("category", "?")
        agent["category"] = cat_data["category"]
        if "name" in cat_data:
            agent["name"] = cat_data["name"]
        if "description" in cat_data:
            agent["description"] = cat_data["description"]
        updated += 1
        print(f"  {cat_data.get('name', agent['name']):20s} -> {cat_data['category']}")

# Count remaining uncategorized
remaining = sum(1 for a in data["agents"] if a.get("category") == "Uncategorized")

print(f"\nUpdated: {updated} agents")
print(f"Remaining uncategorized: {remaining}")

# Show new category distribution
cats = {}
for a in data["agents"]:
    c = a.get("category", "Unknown")
    cats[c] = cats.get(c, 0) + 1
print("\nCategory distribution:")
for c, n in sorted(cats.items(), key=lambda x: -x[1]):
    print(f"  {c}: {n}")

with open("store.json", "w") as f:
    json.dump(data, f, indent=2)

print("\nstore.json saved")
