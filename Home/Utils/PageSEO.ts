/*
 * Page-specific SEO metadata configuration for OneUptime landing pages
 * This provides structured data for search engines and AI agents
 */

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageSEOData {
  title: string;
  description: string;
  canonicalPath: string; // e.g., "/product/monitoring" - will be combined with homeUrl
  ogImage?: string; // defaults to /img/og-image.png if not specified
  ogType?: string; // defaults to "website"
  twitterCard?: "summary" | "summary_large_image"; // defaults to "summary_large_image" for product pages
  breadcrumbs: BreadcrumbItem[];
  // For SoftwareApplication schema on product pages
  softwareApplication?: {
    name: string;
    applicationCategory: string;
    operatingSystem: string;
    description: string;
    features: string[];
  };
  // Page type for conditional schema rendering
  pageType:
    | "home"
    | "product"
    | "pricing"
    | "legal"
    | "blog"
    | "about"
    | "support"
    | "enterprise"
    | "compare"
    | "solutions"
    | "industry"
    | "other";
}

// Default SEO data factory
export const createDefaultSEO: (
  title: string,
  description: string,
  canonicalPath: string,
  pageType?: PageSEOData["pageType"],
) => PageSEOData = (
  title: string,
  description: string,
  canonicalPath: string,
  pageType: PageSEOData["pageType"] = "other",
): PageSEOData => {
  return {
    title,
    description,
    canonicalPath,
    pageType,
    breadcrumbs: [{ name: "Home", url: "/" }],
  };
};

// Page-specific SEO configurations
export const PageSEOConfig: Record<string, PageSEOData> = {
  // Homepage
  "/": {
    title: "OneUptime | Complete Monitoring & Observability Platform",
    description:
      "OneUptime is an open-source complete observability platform. Monitor websites, APIs, and servers. Get alerts, manage incidents, and keep customers informed with status pages. Free tier available.",
    canonicalPath: "/",
    ogType: "website",
    twitterCard: "summary_large_image",
    pageType: "home",
    breadcrumbs: [{ name: "Home", url: "/" }],
  },

  // Product Pages
  "/product/status-page": {
    title: "Status Page | Free Public & Private Status Pages | OneUptime",
    description:
      "Create unlimited public and private status pages. Keep customers informed about incidents and scheduled maintenance. Custom branding, unlimited subscribers, SSL included. Open source.",
    canonicalPath: "/product/status-page",
    ogImage: "/img/status-pages.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Status Page", url: "/product/status-page" },
    ],
    softwareApplication: {
      name: "OneUptime Status Page",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Create public and private status pages to communicate service health to customers and stakeholders.",
      features: [
        "Unlimited public and private status pages",
        "Custom branding and domain",
        "Unlimited subscribers",
        "Email, SMS, and webhook notifications",
        "Scheduled maintenance announcements",
        "Incident timeline and postmortems",
        "SSL certificates included",
        "API access",
      ],
    },
  },

  "/product/monitoring": {
    title: "Uptime Monitoring | Website, API, Server Monitoring | OneUptime",
    description:
      "Monitor websites, APIs, servers, and any resource in real-time. Get instant alerts when things go wrong. Supports HTTP, TCP, UDP, DNS, SSL, ping monitoring. Open source.",
    canonicalPath: "/product/monitoring",
    ogImage: "/img/monitor.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Monitoring", url: "/product/monitoring" },
    ],
    softwareApplication: {
      name: "OneUptime Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Real-time uptime monitoring for websites, APIs, servers, and infrastructure.",
      features: [
        "Website and API monitoring",
        "Server and infrastructure monitoring",
        "Synthetic monitoring with Playwright",
        "Custom monitoring criteria",
        "Multi-location checks",
        "1-second monitoring intervals",
        "SSL certificate monitoring",
        "Response time tracking",
      ],
    },
  },

  "/product/incident-management": {
    title:
      "Incident Management Software | Resolve Incidents Faster | OneUptime",
    description:
      "Streamline incident response with OneUptime. Track incidents, collaborate in real-time, conduct postmortems, and improve MTTR. Integrates with Slack, PagerDuty, and more. Open source.",
    canonicalPath: "/product/incident-management",
    ogImage: "/img/incident-report.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Incident Management", url: "/product/incident-management" },
    ],
    softwareApplication: {
      name: "OneUptime Incident Management",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Complete incident management platform to detect, respond, and resolve incidents faster.",
      features: [
        "Incident tracking and timeline",
        "Real-time collaboration",
        "Postmortem reports",
        "Custom incident states and severity",
        "Slack and Teams integration",
        "Automated incident workflows",
        "MTTR and incident metrics",
        "Root cause analysis",
      ],
    },
  },

  "/product/on-call": {
    title:
      "On-Call Management & Alerting | Schedules & Escalations | OneUptime",
    description:
      "On-call scheduling, alerting, and escalation policies. Alert the right people at the right time via SMS, phone, email, Slack. Rotation schedules and override support. Open source.",
    canonicalPath: "/product/on-call",
    ogImage: "/img/on-call.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "On-Call & Alerts", url: "/product/on-call" },
    ],
    softwareApplication: {
      name: "OneUptime On-Call Management",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud, iOS, Android",
      description:
        "On-call scheduling, alerting, and escalation management for DevOps and SRE teams.",
      features: [
        "On-call schedules and rotations",
        "Escalation policies",
        "SMS, phone, and email alerts",
        "Slack and Teams notifications",
        "Override and swap shifts",
        "Mobile app notifications",
        "Alert deduplication",
        "On-call reports",
      ],
    },
  },

  "/product/logs-management": {
    title: "Log Management | Fast Log Search & Analysis | OneUptime",
    description:
      "Centralized log management with blazing fast search. Ingest logs from any source via OpenTelemetry, Fluentd, or API. Set up alerts on log patterns. Open source.",
    canonicalPath: "/product/logs-management",
    ogImage: "/img/logs.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Logs Management", url: "/product/logs-management" },
    ],
    softwareApplication: {
      name: "OneUptime Logs Management",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Centralized log management and analysis with fast search and alerting.",
      features: [
        "OpenTelemetry log ingestion",
        "Fluentd and Fluent Bit support",
        "Full-text log search",
        "Log pattern detection",
        "Log-based alerting",
        "Application and container logs",
        "Custom retention policies",
        "1000+ source integrations",
      ],
    },
  },

  "/product/workflows": {
    title: "Workflow Automation | No-Code Integrations | OneUptime",
    description:
      "Build automated workflows without code. Connect 5000+ services, automate incident response, and create custom integrations. Trigger on any event. Open source.",
    canonicalPath: "/product/workflows",
    ogImage: "/img/workflows.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Workflows", url: "/product/workflows" },
    ],
    softwareApplication: {
      name: "OneUptime Workflows",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "No-code workflow automation for incident response and integrations.",
      features: [
        "Visual workflow builder",
        "5000+ integrations",
        "Event-driven triggers",
        "Conditional logic",
        "Custom code blocks",
        "Webhook triggers",
        "Scheduled workflows",
        "Error handling and retries",
      ],
    },
  },

  "/product/ai-agent": {
    title: "AI Agent | Automatic Code Fixes & PRs | OneUptime",
    description:
      "AI Agent automatically fixes errors, performance issues, and database queries in your codebase. Creates ready-to-merge pull requests. Supports OpenAI, Anthropic, Ollama, and self-hosted LLMs. Privacy-first: no code stored or trained on.",
    canonicalPath: "/product/ai-agent",
    ogImage: "/img/ai-agent.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "AI Agent", url: "/product/ai-agent" },
    ],
    softwareApplication: {
      name: "OneUptime AI Agent",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "AI-powered agent that automatically detects and fixes code issues, creating ready-to-merge pull requests.",
      features: [
        "Automatic error fixes",
        "Performance issue resolution",
        "Database query optimization",
        "Frontend issue fixes",
        "GitHub and GitLab integration",
        "CI/CD pipeline integration",
        "Terraform support",
        "Issue tracker integration",
        "Multiple LLM provider support",
        "Self-hosted LLM option",
        "Privacy-first: no code storage",
      ],
    },
  },

  "/product/metrics": {
    title: "Metrics | Application & Infrastructure Metrics | OneUptime",
    description:
      "Collect and visualize metrics from applications and infrastructure. OpenTelemetry native. Custom dashboards, alerting, and anomaly detection. Open source.",
    canonicalPath: "/product/metrics",
    ogImage: "/img/metrics.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Metrics", url: "/product/metrics" },
    ],
    softwareApplication: {
      name: "OneUptime Metrics",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Collect, store, and visualize metrics from any source with powerful querying and alerting.",
      features: [
        "OpenTelemetry metrics ingestion",
        "Custom metric collection",
        "Real-time dashboards",
        "Metric-based alerting",
        "Anomaly detection",
        "Long-term retention",
        "PromQL compatible",
        "Infrastructure metrics",
      ],
    },
  },

  "/product/traces": {
    title: "Distributed Tracing | End-to-End Request Tracing | OneUptime",
    description:
      "Trace requests across microservices and distributed systems. OpenTelemetry native. Visualize latency, find bottlenecks, and debug performance issues. Open source.",
    canonicalPath: "/product/traces",
    ogImage: "/img/traces.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Traces", url: "/product/traces" },
    ],
    softwareApplication: {
      name: "OneUptime Traces",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Distributed tracing for microservices and complex architectures.",
      features: [
        "OpenTelemetry trace ingestion",
        "End-to-end request tracing",
        "Service dependency maps",
        "Latency analysis",
        "Span waterfall views",
        "Trace-based alerting",
        "Root cause analysis",
        "Performance bottleneck detection",
      ],
    },
  },

  "/product/exceptions": {
    title: "Error Tracking | Exception Monitoring & Alerts | OneUptime",
    description:
      "Track and monitor exceptions across your applications. Get instant alerts, stack traces, and context to fix bugs faster. OpenTelemetry native. Open source.",
    canonicalPath: "/product/exceptions",
    ogImage: "/img/exceptions.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Exceptions", url: "/product/exceptions" },
    ],
    softwareApplication: {
      name: "OneUptime Exceptions",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description: "Exception tracking and error monitoring for applications.",
      features: [
        "Real-time error tracking",
        "Stack trace capture",
        "Error grouping and deduplication",
        "Exception alerting",
        "Release tracking",
        "User impact analysis",
        "Integration with issue trackers",
        "OpenTelemetry native",
      ],
    },
  },

  "/product/dashboards": {
    title: "Dashboards | Custom Observability Dashboards | OneUptime",
    description:
      "Build custom dashboards to visualize all your observability data. Combine metrics, logs, traces, and status in one view. Share with your team. Open source.",
    canonicalPath: "/product/dashboards",
    ogImage: "/img/dashboards.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Dashboards", url: "/product/dashboards" },
    ],
    softwareApplication: {
      name: "OneUptime Dashboards",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Custom dashboards to visualize and monitor all your observability data.",
      features: [
        "Drag-and-drop dashboard builder",
        "Multiple visualization types",
        "Combine metrics, logs, and traces",
        "Real-time data updates",
        "Dashboard sharing and embedding",
        "Custom time ranges",
        "Dashboard templates",
        "Role-based access control",
      ],
    },
  },

  // Pricing
  "/pricing": {
    title: "Pricing | Free Tier & Paid Plans | OneUptime",
    description:
      "OneUptime pricing starts free. Get status pages, monitoring, incident management, and more. Transparent pricing with no hidden fees. Enterprise plans available.",
    canonicalPath: "/pricing",
    twitterCard: "summary_large_image",
    pageType: "pricing",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Pricing", url: "/pricing" },
    ],
  },

  // Enterprise
  "/enterprise/overview": {
    title: "Enterprise | Self-Hosted & Cloud | OneUptime",
    description:
      "OneUptime for enterprise. Self-hosted deployment, SSO/SAML, advanced security, SLA guarantees, dedicated support. SOC 2, HIPAA, GDPR compliant.",
    canonicalPath: "/enterprise/overview",
    twitterCard: "summary_large_image",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
    ],
  },

  "/enterprise/demo": {
    title: "Request Demo | See OneUptime in Action | OneUptime",
    description:
      "Schedule a personalized demo of OneUptime. See how our observability platform can help your team monitor, respond, and resolve issues faster.",
    canonicalPath: "/enterprise/demo",
    twitterCard: "summary",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
      { name: "Request Demo", url: "/enterprise/demo" },
    ],
  },

  // About & Support
  "/about": {
    title: "About Us | Open Source Observability | OneUptime",
    description:
      "Learn about OneUptime, the open-source observability platform. Built by engineers, for engineers. Meet our contributors and learn our mission.",
    canonicalPath: "/about",
    twitterCard: "summary",
    pageType: "about",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "About", url: "/about" },
    ],
  },

  "/support": {
    title: "Support | Help & Documentation | OneUptime",
    description:
      "Get help with OneUptime. Access documentation, community support, and contact our team. Enterprise customers get priority support.",
    canonicalPath: "/support",
    twitterCard: "summary",
    pageType: "support",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Support", url: "/support" },
    ],
  },

  "/oss-friends": {
    title: "OSS Friends | Open Source Partners | OneUptime",
    description:
      "Meet our open-source friends and partners. OneUptime is proud to be part of the open-source community.",
    canonicalPath: "/oss-friends",
    twitterCard: "summary",
    pageType: "other",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "OSS Friends", url: "/oss-friends" },
    ],
  },

  // Legal pages
  "/legal": {
    title: "Legal Center | Terms, Privacy, Compliance | OneUptime",
    description:
      "OneUptime legal documents including terms of service, privacy policy, GDPR, SOC 2, HIPAA compliance information.",
    canonicalPath: "/legal",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
    ],
  },

  "/legal/terms": {
    title: "Terms of Service | OneUptime",
    description: "OneUptime terms of service and conditions of use.",
    canonicalPath: "/legal/terms",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "Terms of Service", url: "/legal/terms" },
    ],
  },

  "/legal/privacy": {
    title: "Privacy Policy | OneUptime",
    description:
      "OneUptime privacy policy. Learn how we collect, use, and protect your data.",
    canonicalPath: "/legal/privacy",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "Privacy Policy", url: "/legal/privacy" },
    ],
  },

  "/legal/gdpr": {
    title: "GDPR Compliance | OneUptime",
    description:
      "OneUptime GDPR compliance information. We are committed to protecting EU citizen data rights.",
    canonicalPath: "/legal/gdpr",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "GDPR", url: "/legal/gdpr" },
    ],
  },

  "/legal/soc-2": {
    title: "SOC 2 Compliance | OneUptime",
    description:
      "OneUptime SOC 2 Type II compliance. Our security controls are audited annually.",
    canonicalPath: "/legal/soc-2",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "SOC 2", url: "/legal/soc-2" },
    ],
  },

  "/legal/hipaa": {
    title: "HIPAA Compliance | OneUptime",
    description:
      "OneUptime HIPAA compliance for healthcare organizations. We sign BAAs for enterprise customers.",
    canonicalPath: "/legal/hipaa",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "HIPAA", url: "/legal/hipaa" },
    ],
  },

  // Teams (Solutions)
  "/solutions/devops": {
    title: "DevOps Monitoring & Observability | OneUptime",
    description:
      "Observability platform built for DevOps teams. Monitor infrastructure, track deployments, automate incident response, and improve MTTR. Open source.",
    canonicalPath: "/solutions/devops",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "DevOps", url: "/solutions/devops" },
    ],
  },

  "/solutions/sre": {
    title: "SRE Tools & Platform | Site Reliability Engineering | OneUptime",
    description:
      "Complete SRE platform with SLOs, error budgets, incident management, and on-call scheduling. Track reliability metrics and reduce toil. Open source.",
    canonicalPath: "/solutions/sre",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "SRE", url: "/solutions/sre" },
    ],
  },

  "/solutions/platform": {
    title: "Platform Engineering Observability | OneUptime",
    description:
      "Observability for platform engineering teams. Provide self-service monitoring, standardized dashboards, and unified alerting for internal developer platforms. Open source.",
    canonicalPath: "/solutions/platform",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Platform", url: "/solutions/platform" },
    ],
  },

  "/solutions/developers": {
    title: "Developer Observability Tools | OneUptime",
    description:
      "Debugging and observability tools for developers. Trace requests, search logs, track errors, and understand application performance. Open source.",
    canonicalPath: "/solutions/developers",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Developers", url: "/solutions/developers" },
    ],
  },

  // Industries
  "/industries/fintech": {
    title: "FinTech Monitoring & Compliance | OneUptime",
    description:
      "Observability platform for FinTech companies. SOC 2 compliant, PCI-DSS ready. Monitor payment systems, track transactions, and ensure uptime for financial services.",
    canonicalPath: "/industries/fintech",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "FinTech", url: "/industries/fintech" },
    ],
  },

  "/industries/saas": {
    title: "SaaS Monitoring & Status Pages | OneUptime",
    description:
      "Complete observability for SaaS companies. Monitor your application, communicate status to customers, manage incidents, and improve reliability. Open source.",
    canonicalPath: "/industries/saas",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "SaaS", url: "/industries/saas" },
    ],
  },

  "/industries/healthcare": {
    title: "Healthcare IT Monitoring | HIPAA Compliant | OneUptime",
    description:
      "HIPAA-compliant observability platform for healthcare organizations. Monitor EHR systems, ensure uptime for critical health services, and maintain compliance.",
    canonicalPath: "/industries/healthcare",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "Healthcare", url: "/industries/healthcare" },
    ],
  },

  "/industries/ecommerce": {
    title: "E-Commerce Monitoring & Uptime | OneUptime",
    description:
      "Observability platform for e-commerce. Monitor checkout flows, track page performance, ensure uptime during peak traffic, and reduce cart abandonment.",
    canonicalPath: "/industries/ecommerce",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "E-Commerce", url: "/industries/ecommerce" },
    ],
  },

  "/industries/media": {
    title: "Media & Streaming Monitoring | OneUptime",
    description:
      "Observability for media and streaming platforms. Monitor video delivery, track playback quality, ensure global availability, and optimize viewer experience.",
    canonicalPath: "/industries/media",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "Media", url: "/industries/media" },
    ],
  },

  "/industries/government": {
    title: "Government IT Monitoring | FedRAMP Ready | OneUptime",
    description:
      "Secure observability platform for government agencies. Self-hosted deployment, data residency controls, and compliance-ready. Monitor critical public services.",
    canonicalPath: "/industries/government",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "Government", url: "/industries/government" },
    ],
  },
};

// Helper to get SEO data for a path, with fallback
export const getPageSEO: (path: string) => PageSEOData = (
  path: string,
): PageSEOData => {
  // Exact match first
  if (PageSEOConfig[path]) {
    return PageSEOConfig[path];
  }

  // For compare pages, create dynamic SEO
  if (path.startsWith("/compare/")) {
    const product: string = path.replace("/compare/", "");
    const productName: string = product
      .split("-")
      .map((word: string) => {
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
    return {
      title: `OneUptime vs ${productName} | Comparison | OneUptime`,
      description: `Compare OneUptime with ${productName}. See features, pricing, and why teams choose OneUptime as their observability platform.`,
      canonicalPath: path,
      twitterCard: "summary_large_image",
      pageType: "compare",
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: "Compare", url: "/#compare" },
        { name: `vs ${productName}`, url: path },
      ],
    };
  }

  // For legal subpages not explicitly defined
  if (path.startsWith("/legal/")) {
    const section: string = path.replace("/legal/", "");
    const sectionName: string = section
      .split("-")
      .map((word: string) => {
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
    return {
      title: `${sectionName} | Legal | OneUptime`,
      description: `OneUptime ${sectionName.toLowerCase()} legal information and compliance documentation.`,
      canonicalPath: path,
      twitterCard: "summary",
      pageType: "legal",
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: "Legal", url: "/legal" },
        { name: sectionName, url: path },
      ],
    };
  }

  // Default fallback
  return createDefaultSEO(
    "OneUptime | Complete Observability Platform",
    "OneUptime monitors websites, APIs, and servers and alerts your team if something goes wrong. It also keeps your customers updated about any downtime.",
    path,
    "other",
  );
};

export default PageSEOConfig;
