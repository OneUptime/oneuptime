import URL from "Common/Types/API/URL";

export type OSSCategory =
  | "Data & Analytics"
  | "Developer Tools"
  | "Productivity & Collaboration"
  | "Infrastructure & DevOps"
  | "Security"
  | "AI & Machine Learning";

export interface OSSFriend {
  name: string;
  description: string;
  repositoryUrl: URL;
  websiteUrl: URL;
  category: OSSCategory;
}

const OSSFriends: OSSFriend[] = [
  // Data & Analytics
  {
    name: "Airbyte",
    description:
      "Open-source EL(T) platform that helps you replicate your data in your warehouses, lakes, and databases.",
    repositoryUrl: URL.fromString("https://github.com/airbytehq/airbyte"),
    websiteUrl: URL.fromString("https://airbyte.com"),
    category: "Data & Analytics",
  },
  {
    name: "Metabase",
    description:
      "The easy, open-source way for everyone in your company to ask questions and learn from data.",
    repositoryUrl: URL.fromString("https://github.com/metabase/metabase"),
    websiteUrl: URL.fromString("https://metabase.com"),
    category: "Data & Analytics",
  },
  {
    name: "PostHog",
    description:
      "Open-source product analytics, session recording, feature flags, and A/B testing - all in one platform.",
    repositoryUrl: URL.fromString("https://github.com/PostHog/posthog"),
    websiteUrl: URL.fromString("https://posthog.com"),
    category: "Data & Analytics",
  },
  {
    name: "Apache Superset",
    description:
      "A modern, enterprise-ready business intelligence web application for data exploration and visualization.",
    repositoryUrl: URL.fromString("https://github.com/apache/superset"),
    websiteUrl: URL.fromString("https://superset.apache.org"),
    category: "Data & Analytics",
  },
  {
    name: "ClickHouse",
    description:
      "An open-source column-oriented database management system for real-time analytics using SQL.",
    repositoryUrl: URL.fromString("https://github.com/ClickHouse/ClickHouse"),
    websiteUrl: URL.fromString("https://clickhouse.com"),
    category: "Data & Analytics",
  },
  {
    name: "Plausible",
    description:
      "Simple, open-source, lightweight and privacy-friendly web analytics alternative to Google Analytics.",
    repositoryUrl: URL.fromString("https://github.com/plausible/analytics"),
    websiteUrl: URL.fromString("https://plausible.io"),
    category: "Data & Analytics",
  },

  // Developer Tools
  {
    name: "GitLab",
    description:
      "The complete DevOps platform. From project planning and source code management to CI/CD and monitoring.",
    repositoryUrl: URL.fromString("https://github.com/gitlabhq/gitlabhq"),
    websiteUrl: URL.fromString("https://gitlab.com"),
    category: "Developer Tools",
  },
  {
    name: "Gitea",
    description:
      "A painless self-hosted Git service. Lightweight, fast, and easy to set up.",
    repositoryUrl: URL.fromString("https://github.com/go-gitea/gitea"),
    websiteUrl: URL.fromString("https://gitea.io"),
    category: "Developer Tools",
  },
  {
    name: "n8n",
    description:
      "Free and open fair-code licensed workflow automation tool. Easily automate tasks across different services.",
    repositoryUrl: URL.fromString("https://github.com/n8n-io/n8n"),
    websiteUrl: URL.fromString("https://n8n.io"),
    category: "Developer Tools",
  },
  {
    name: "Backstage",
    description:
      "An open platform for building developer portals. Powered by a centralized software catalog.",
    repositoryUrl: URL.fromString("https://github.com/backstage/backstage"),
    websiteUrl: URL.fromString("https://backstage.io"),
    category: "Developer Tools",
  },
  {
    name: "Hoppscotch",
    description:
      "Open-source API development ecosystem. A free, fast, and beautiful alternative to Postman.",
    repositoryUrl: URL.fromString("https://github.com/hoppscotch/hoppscotch"),
    websiteUrl: URL.fromString("https://hoppscotch.io"),
    category: "Developer Tools",
  },
  {
    name: "Insomnia",
    description:
      "The open-source, cross-platform API client for GraphQL, REST, WebSockets and gRPC.",
    repositoryUrl: URL.fromString("https://github.com/Kong/insomnia"),
    websiteUrl: URL.fromString("https://insomnia.rest"),
    category: "Developer Tools",
  },

  // Productivity & Collaboration
  {
    name: "Cal.com",
    description:
      "Open Source Scheduling: Send a link and meet or build an entire marketplace for humans to connect.",
    repositoryUrl: URL.fromString("https://github.com/calcom/cal.com"),
    websiteUrl: URL.fromString("https://cal.com"),
    category: "Productivity & Collaboration",
  },
  {
    name: "Twenty",
    description:
      "Building an open-source modern CRM. A powerful alternative to Salesforce and HubSpot.",
    repositoryUrl: URL.fromString("https://github.com/twentyhq/twenty"),
    websiteUrl: URL.fromString("https://twenty.com"),
    category: "Productivity & Collaboration",
  },
  {
    name: "AppFlowy",
    description:
      "Open-source alternative to Notion. A privacy-first, customizable workspace for notes and tasks.",
    repositoryUrl: URL.fromString("https://github.com/AppFlowy-IO/AppFlowy"),
    websiteUrl: URL.fromString("https://appflowy.io"),
    category: "Productivity & Collaboration",
  },
  {
    name: "Mattermost",
    description:
      "Open-source platform for secure collaboration across the entire software development lifecycle.",
    repositoryUrl: URL.fromString("https://github.com/mattermost/mattermost"),
    websiteUrl: URL.fromString("https://mattermost.com"),
    category: "Productivity & Collaboration",
  },
  {
    name: "Chatwoot",
    description:
      "Open-source customer engagement suite. An alternative to Intercom, Zendesk, and Salesforce Service Cloud.",
    repositoryUrl: URL.fromString("https://github.com/chatwoot/chatwoot"),
    websiteUrl: URL.fromString("https://chatwoot.com"),
    category: "Productivity & Collaboration",
  },
  {
    name: "Documenso",
    description:
      "The open-source DocuSign alternative. Sign documents digitally with ease and security.",
    repositoryUrl: URL.fromString("https://github.com/documenso/documenso"),
    websiteUrl: URL.fromString("https://documenso.com"),
    category: "Productivity & Collaboration",
  },

  // Infrastructure & DevOps
  {
    name: "Docker",
    description:
      "The platform for building, sharing, and running containerized applications anywhere.",
    repositoryUrl: URL.fromString("https://github.com/moby/moby"),
    websiteUrl: URL.fromString("https://docker.com"),
    category: "Infrastructure & DevOps",
  },
  {
    name: "Kubernetes",
    description:
      "Production-grade container orchestration. Automate deployment, scaling, and management of containerized applications.",
    repositoryUrl: URL.fromString("https://github.com/kubernetes/kubernetes"),
    websiteUrl: URL.fromString("https://kubernetes.io"),
    category: "Infrastructure & DevOps",
  },
  {
    name: "Terraform",
    description:
      "Infrastructure as code tool that lets you build, change, and version cloud and on-prem resources safely.",
    repositoryUrl: URL.fromString("https://github.com/hashicorp/terraform"),
    websiteUrl: URL.fromString("https://terraform.io"),
    category: "Infrastructure & DevOps",
  },
  {
    name: "Ansible",
    description:
      "Radically simple IT automation platform that makes your applications and systems easier to deploy and maintain.",
    repositoryUrl: URL.fromString("https://github.com/ansible/ansible"),
    websiteUrl: URL.fromString("https://ansible.com"),
    category: "Infrastructure & DevOps",
  },
  {
    name: "Coolify",
    description:
      "An open-source and self-hostable Heroku/Netlify alternative. Deploy anything with ease.",
    repositoryUrl: URL.fromString("https://github.com/coollabsio/coolify"),
    websiteUrl: URL.fromString("https://coolify.io"),
    category: "Infrastructure & DevOps",
  },
  {
    name: "Traefik",
    description:
      "A modern HTTP reverse proxy and load balancer that makes deploying microservices easy.",
    repositoryUrl: URL.fromString("https://github.com/traefik/traefik"),
    websiteUrl: URL.fromString("https://traefik.io"),
    category: "Infrastructure & DevOps",
  },

  // Security
  {
    name: "Infisical",
    description:
      "Open-source end-to-end platform to manage secrets and configuration across your team and infrastructure.",
    repositoryUrl: URL.fromString("https://github.com/Infisical/infisical"),
    websiteUrl: URL.fromString("https://infisical.com"),
    category: "Security",
  },
  {
    name: "Vault",
    description:
      "A tool for secrets management, encryption as a service, and privileged access management.",
    repositoryUrl: URL.fromString("https://github.com/hashicorp/vault"),
    websiteUrl: URL.fromString("https://vaultproject.io"),
    category: "Security",
  },
  {
    name: "Keycloak",
    description:
      "Open-source identity and access management for modern applications and services.",
    repositoryUrl: URL.fromString("https://github.com/keycloak/keycloak"),
    websiteUrl: URL.fromString("https://keycloak.org"),
    category: "Security",
  },
  {
    name: "Trivy",
    description:
      "Find vulnerabilities, misconfigurations, secrets, and SBOM in containers, Kubernetes, and code repositories.",
    repositoryUrl: URL.fromString("https://github.com/aquasecurity/trivy"),
    websiteUrl: URL.fromString("https://trivy.dev"),
    category: "Security",
  },
  {
    name: "Authentik",
    description:
      "Open-source Identity Provider focused on flexibility and versatility. SSO, MFA, and more.",
    repositoryUrl: URL.fromString("https://github.com/goauthentik/authentik"),
    websiteUrl: URL.fromString("https://goauthentik.io"),
    category: "Security",
  },

  // AI & Machine Learning
  {
    name: "Langfuse",
    description:
      "Open-source LLM engineering platform. Debug, analyze, and iterate on your LLM applications.",
    repositoryUrl: URL.fromString("https://github.com/langfuse/langfuse"),
    websiteUrl: URL.fromString("https://langfuse.com"),
    category: "AI & Machine Learning",
  },
  {
    name: "Flowise",
    description:
      "Build LLM apps easily with a drag-and-drop UI. Open-source low-code tool for developers.",
    repositoryUrl: URL.fromString("https://github.com/FlowiseAI/Flowise"),
    websiteUrl: URL.fromString("https://flowiseai.com"),
    category: "AI & Machine Learning",
  },
  {
    name: "Ollama",
    description:
      "Get up and running with large language models locally. Run Llama, Mistral, and other models.",
    repositoryUrl: URL.fromString("https://github.com/ollama/ollama"),
    websiteUrl: URL.fromString("https://ollama.com"),
    category: "AI & Machine Learning",
  },
  {
    name: "LocalAI",
    description:
      "Free, open-source alternative to OpenAI. Self-hosted, community-driven, local-first AI inference.",
    repositoryUrl: URL.fromString("https://github.com/mudler/LocalAI"),
    websiteUrl: URL.fromString("https://localai.io"),
    category: "AI & Machine Learning",
  },
  {
    name: "Dify",
    description:
      "Open-source LLM app development platform. Build AI workflows, RAG pipelines, and agent capabilities.",
    repositoryUrl: URL.fromString("https://github.com/langgenius/dify"),
    websiteUrl: URL.fromString("https://dify.ai"),
    category: "AI & Machine Learning",
  },
];

export default OSSFriends;
