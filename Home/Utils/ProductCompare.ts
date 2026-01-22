import Dictionary from "Common/Types/Dictionary";

export interface FAQ {
  question: string;
  answer: string;
}

export enum ItemType {
  Item = "item",
  Category = "category",
}

export interface Item {
  title: string;
  description: string;
  productColumn: string;
  oneuptimeColumn: string;
}

export interface Category {
  name: string;
  data: Array<Item>;
}

export interface KeyDifference {
  title: string;
  description: string;
  icon: string;
}

export interface PricingTier {
  name: string;
  price: string;
  period: string;
  features: Array<string>;
  limitations: Array<string>;
}

export interface UseCaseComparison {
  scenario: string;
  competitorSolution: string;
  competitorCost: string;
  oneuptimeSolution: string;
  oneuptimeCost: string;
}

export interface Product {
  productName: string;
  iconUrl: string;
  price: string;
  oneuptimePrice: string;
  description: string;
  descriptionLine2: string;
  tagline: string;
  competitorFocus: string;
  oneuptimeFocus: string;
  annualSavings: string;
  faq: Array<FAQ>;
  items: Array<Category>;
  keyDifferences: Array<KeyDifference>;
  oneUptimeDescription: string;
  productDescription: string;
  competitorPricingTiers?: Array<PricingTier>;
  hiddenCosts?: Array<string>;
  migrationBenefits?: Array<string>;
  useCases?: Array<UseCaseComparison>;
  lastUpdated?: string;
}

// Export products dictionary so we can build dynamic sitemap and other features.
const products: Dictionary<Product> = {
  pagerduty: {
    productName: "PagerDuty",
    iconUrl: "/img/pagerduty.jpeg",
    price: "",
    oneuptimePrice: "",
    tagline: "One complete platform vs multiple disconnected tools",
    competitorFocus:
      "Specialized in on-call alerting and incident response - requires integrating external monitoring and status page tools",
    oneuptimeFocus:
      "Complete observability platform with monitoring, status pages, on-call, and incident management unified in one solution",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "PagerDuty excels at on-call scheduling and alerting but operates as part of a larger toolchain. Teams typically integrate it with separate monitoring solutions and status page providers to build a complete incident response system.",
    oneUptimeDescription:
      "OneUptime brings together monitoring, status pages, on-call scheduling, incident management, logs, metrics, and traces in a single platform. Everything works together seamlessly, reducing context switching and tool fatigue.",
    description:
      "PagerDuty is the market leader in incident management and on-call scheduling, trusted by many enterprises. However, it's primarily an alerting tool that requires separate integrations for monitoring and additional tools for status pages. OneUptime provides a complete, unified observability platform where all components work together natively.",
    descriptionLine2:
      "Simplify your observability stack. Get monitoring, status pages, on-call, and incident management working together in one platform.",
    migrationBenefits: [
      "Import existing on-call schedules and escalation policies seamlessly",
      "Webhooks and API enable gradual migration without disruption",
      "Run both platforms in parallel while your team adapts",
      "Consolidate your monitoring, alerting, and status page tools into one",
      "Reduce context switching between multiple dashboards",
      "Gain unified visibility across your entire infrastructure",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "Up to 5 users",
          "100 SMS/phone notifications per month",
          "1 on-call schedule",
          "1 escalation policy",
          "700+ integrations",
        ],
        limitations: [
          "Very limited notifications",
          "Single schedule only",
          "No advanced features",
          "No status pages",
        ],
      },
      {
        name: "Professional",
        price: "$21",
        period: "/user/month (annual)",
        features: [
          "Unlimited notifications",
          "Multiple schedules",
          "Basic Slack/Teams integration",
          "Status page (250 subscribers)",
          "SSO included",
          "2 incident roles",
        ],
        limitations: [
          "Limited status page subscribers",
          "Basic chat features only",
          "Limited incident types",
          "2 teams maximum",
        ],
      },
      {
        name: "Business",
        price: "$41",
        period: "/user/month (annual)",
        features: [
          "Everything in Professional",
          "Custom fields",
          "Internal status pages",
          "Status page (500 subscribers)",
          "Advanced ITSM integrations",
          "Multi-year historical data",
        ],
        limitations: [
          "Still limited status page subscribers",
          "3 custom incident types max",
          "No advanced incident roles",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Full Slack integration",
          "Advanced workflows",
          "10 custom incident roles",
          "100 custom incident types",
          "Live call routing",
          "Premium status pages",
        ],
        limitations: [
          "Requires sales contact",
          "Minimum contract requirements",
          "Complex procurement process",
        ],
      },
    ],
    useCases: [
      {
        scenario: "10-person engineering team with basic on-call",
        competitorSolution: "PagerDuty Professional + External monitoring",
        competitorCost: "$210/month + $100/month monitoring = $310/month",
        oneuptimeSolution: "OneUptime with built-in monitoring and on-call",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario: "25-person team with status pages and incident management",
        competitorSolution:
          "PagerDuty Business + Status Pages add-on + Monitoring",
        competitorCost: "$1,025/month + $89/month + $200/month = $1,314/month",
        oneuptimeSolution:
          "OneUptime with unlimited status pages and subscribers",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Enterprise with 100 engineers and stakeholder access",
        competitorSolution:
          "PagerDuty Enterprise + Stakeholder licenses + Add-ons",
        competitorCost: "$5,000+/month + add-ons",
        oneuptimeSolution: "OneUptime Enterprise with unlimited users",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to PagerDuty?",
        answer:
          "PagerDuty excels at on-call scheduling and incident response, but it's primarily an alerting hub that requires external tools for monitoring and status pages. OneUptime is a complete observability platform with native monitoring, status pages, on-call scheduling, incident management, logs, metrics, and traces - all working together in one unified interface. This means less context switching, simpler workflows, and a single source of truth for your team.",
      },
      {
        question: "What about PagerDuty's 700+ integrations?",
        answer:
          "PagerDuty's integrations primarily connect external monitoring tools to their alerting system. OneUptime has built-in monitoring for websites, APIs, servers, and containers, which means many integrations become unnecessary. We still offer extensive integrations via native Slack/Teams support, webhooks, REST API, and 2000+ connections through Zapier. The key difference is our integrations enhance workflows rather than fill functionality gaps.",
      },
      {
        question: "What are the benefits of a unified platform?",
        answer:
          "With a unified platform like OneUptime, your team gets a single dashboard for all observability needs. Alerts automatically link to relevant logs and metrics. Status pages update based on real incident data. On-call engineers have full context without jumping between tools. This reduces mean time to resolution (MTTR) and eliminates the complexity of maintaining multiple tool integrations.",
      },
      {
        question: "Does OneUptime match PagerDuty's on-call features?",
        answer:
          "Yes. OneUptime provides comprehensive on-call capabilities: multiple rotation schedules (daily, weekly, custom), multi-level escalation policies, vacation and override management, follow-the-sun scheduling for global teams, and alerts via SMS, phone, email, push notifications, Slack, and Microsoft Teams. Plus, you get native monitoring and status pages that work seamlessly with your on-call workflows.",
      },
      {
        question: "How does OneUptime handle alert noise reduction?",
        answer:
          "OneUptime includes intelligent alert deduplication and grouping to reduce noise. Similar alerts are automatically grouped, and you can configure thresholds and conditions to prevent alert fatigue. Our approach focuses on practical, effective noise reduction that works out of the box without requiring complex configuration or separate modules.",
      },
      {
        question: "Can I migrate from PagerDuty to OneUptime?",
        answer:
          "Yes. You can import existing on-call schedules and escalation policies. OneUptime receives webhooks from any system, enabling gradual migration. Many teams run both platforms in parallel during transition, moving monitors and integrations to OneUptime incrementally. Our support team provides migration assistance for complex setups.",
      },
      {
        question: "Is OneUptime enterprise-ready?",
        answer:
          "Absolutely. OneUptime is built on distributed, high-availability infrastructure across multiple cloud regions. We're SOC 2 Type II certified, ISO 27001 compliant, and GDPR compliant. Enterprise features include SSO/SAML, role-based access control, audit logs, and data residency options. Self-hosting is available for organizations requiring complete infrastructure control.",
      },
    ],
    keyDifferences: [
      {
        title: "Native Monitoring",
        description:
          "Monitor websites, APIs, servers, and containers directly - no need to integrate external monitoring tools",
        icon: "monitoring",
      },
      {
        title: "Integrated Status Pages",
        description:
          "Public and private status pages that automatically update based on your monitors and incidents",
        icon: "status-page",
      },
      {
        title: "Scale Your Team Freely",
        description:
          "Add team members as your organization grows without worrying about per-seat limitations",
        icon: "subscribers",
      },
      {
        title: "Unified Platform",
        description:
          "One dashboard for monitoring, alerting, incidents, and communication - no more tool sprawl",
        icon: "unified",
      },
      {
        title: "Open Source & Self-Hostable",
        description:
          "Apache 2.0 licensed - full transparency, self-host on your infrastructure, zero vendor lock-in",
        icon: "open-source",
      },
      {
        title: "Complete Out of the Box",
        description:
          "Every feature included in the platform - no add-ons or modules to purchase separately",
        icon: "transparent",
      },
    ],
    items: [
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Multi-channel Alerts",
            description:
              "SMS, phone call, email, push notifications, Slack, Microsoft Teams",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-Call Rotations",
            description: "Daily, weekly, monthly, or custom rotation schedules",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation with customizable timeouts",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Vacation/Override Schedules",
            description: "Temporary schedule overrides for time off",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-Sun Scheduling",
            description: "Global team scheduling across timezones",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS/Phone Notifications",
            description: "Voice and text message alerts",
            productColumn: "100/mo free, unlimited paid",
            oneuptimeColumn: "Included in all plans",
          },
          {
            title: "Alert Deduplication",
            description: "Intelligent grouping to reduce noise",
            productColumn: "AIOps add-on ($699/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Live Call Routing",
            description: "Route customer calls to on-call responders",
            productColumn: "Enterprise only",
            oneuptimeColumn: "Coming soon",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website & URL Monitoring",
            description: "HTTP/HTTPS uptime and response time monitoring",
            productColumn: "Requires 3rd party integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "REST API monitoring with custom headers/payloads",
            productColumn: "Requires 3rd party integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server & Infrastructure",
            description: "CPU, memory, disk, network metrics",
            productColumn: "Requires 3rd party integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container Monitoring",
            description: "Docker and Kubernetes monitoring",
            productColumn: "Requires 3rd party integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic Monitoring",
            description: "Multi-step transaction monitoring",
            productColumn: "Requires 3rd party integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Certificate Monitoring",
            description: "Certificate expiration alerts",
            productColumn: "Requires 3rd party integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global Probe Locations",
            description: "Monitor from multiple geographic locations",
            productColumn: "",
            oneuptimeColumn: "7+ locations worldwide",
          },
          {
            title: "Custom Check Intervals",
            description: "Configurable monitoring frequency",
            productColumn: "",
            oneuptimeColumn: "1 second to 24 hours",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Pages",
            description: "Customer-facing status communication",
            productColumn: "Add-on ($89/mo per 1K subs)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Pages",
            description: "Internal team status dashboards",
            productColumn: "Business+ plans only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Limits",
            description: "Number of status page subscribers",
            productColumn: "250-500 based on plan",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Email/SMS Notifications",
            description: "Subscriber notification channels",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned maintenance windows",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Branding",
            description: "Logo, colors, custom domain",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML/CSS/JS",
            description: "Advanced page customization",
            productColumn: "Premium plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic Status Updates",
            description: "Update status based on monitors",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Timeline",
            description: "Automatic event timeline tracking",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Severity Levels",
            description: "Categorize incidents by impact",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack/Teams Integration",
            description: "Manage incidents from chat",
            productColumn: "Basic (full in Enterprise)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Incident Types",
            description: "Define incident categories",
            productColumn: "3 types (100 in Enterprise)",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Postmortem Templates",
            description: "Structured post-incident reviews",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Item Tracking",
            description: "Follow-up task management",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbook Integration",
            description: "Link response procedures",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Analytics",
            description: "MTTR, frequency metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Enterprise",
        data: [
          {
            title: "SSO/SAML",
            description: "Enterprise single sign-on",
            productColumn: "Professional+",
            oneuptimeColumn: "tick",
          },
          {
            title: "Role-Based Access Control",
            description: "Granular permissions",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Access",
            description: "Full REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Webhooks",
            description: "Event-driven integrations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-Hosting Option",
            description: "Deploy on your infrastructure",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent, auditable code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0 License",
          },
          {
            title: "SOC 2 Compliance",
            description: "Enterprise security standards",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit Logs",
            description: "Activity tracking",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  "statuspage.io": {
    productName: "Atlassian Statuspage",
    iconUrl: "/img/statuspagelogo.png",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete reliability platform vs dedicated status page tool",
    competitorFocus:
      "Specialized status page solution - requires separate monitoring, alerting, and incident management tools",
    oneuptimeFocus:
      "Unified platform where status pages automatically reflect your actual system health from integrated monitoring",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "Statuspage provides beautiful, customizable status pages for communicating with customers during incidents. It excels at status communication but relies on external tools to detect issues and manage incident response.",
    oneUptimeDescription:
      "OneUptime combines status pages with monitoring, on-call scheduling, and incident management. Your status pages automatically update based on real system health, and incidents flow seamlessly from detection to resolution to communication.",
    description:
      "Atlassian Statuspage is a dedicated status page product that excels at customer communication during incidents. However, it operates in isolation - you need separate monitoring tools to detect issues, separate alerting to notify your team, and separate incident management for coordination. OneUptime provides a unified platform where everything works together natively.",
    descriptionLine2:
      "Get status pages that automatically reflect your actual system health, connected to monitoring, alerting, and incident management in one platform.",
    migrationBenefits: [
      "Automatic status updates from integrated monitoring - no manual updates needed",
      "On-call scheduling ensures the right person responds to incidents",
      "Complete incident workflow from detection to postmortem",
      "Import existing components and subscriber lists easily",
      "Same notification channels: email, SMS, webhook, RSS, Slack, Teams",
      "Scale your subscriber base without artificial limits",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "1 public status page",
          "100 subscribers",
          "2 team members",
          "25 components",
          "Email/Slack notifications",
        ],
        limitations: [
          "Very limited subscribers",
          "Only 2 team members",
          "No custom domain",
          "No SMS notifications",
        ],
      },
      {
        name: "Hobby",
        price: "$29",
        period: "/month",
        features: [
          "250 subscribers",
          "5 team members",
          "Custom domain",
          "5 metrics",
          "Basic customization",
        ],
        limitations: [
          "Still limited to 250 subscribers",
          "No SMS notifications",
          "Basic customization only",
        ],
      },
      {
        name: "Startup",
        price: "$99",
        period: "/month",
        features: [
          "1,000 subscribers",
          "10 team members",
          "SMS notifications",
          "10 metrics",
          "Team member SSO",
        ],
        limitations: [
          "1,000 subscriber cap",
          "No custom CSS/HTML",
          "Limited metrics",
        ],
      },
      {
        name: "Business",
        price: "$399",
        period: "/month",
        features: [
          "5,000 subscribers",
          "25 team members",
          "Custom CSS/HTML/JS",
          "Component subscriptions",
          "Role-based access",
          "25 metrics",
        ],
        limitations: [
          "5,000 subscriber cap",
          "Expensive for the features",
          "Still no monitoring/on-call",
        ],
      },
      {
        name: "Enterprise",
        price: "$1,499",
        period: "/month",
        features: [
          "25,000 subscribers",
          "50 team members",
          "All Business features",
          "50 metrics",
          "Yearly invoicing",
        ],
        limitations: [
          "25,000 subscriber cap",
          "$17,988/year for status pages only",
          "Still requires other tools",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup with 500 customers needing status updates",
        competitorSolution: "Statuspage Startup + Pingdom + OpsGenie",
        competitorCost: "$99 + $50 + $100 = $249/month",
        oneuptimeSolution: "OneUptime with unlimited subscribers",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "Growing company with 10,000 status page subscribers",
        competitorSolution:
          "Statuspage Enterprise (still under cap) + monitoring + on-call",
        competitorCost: "$1,499 + $150 + $300 = $1,949/month",
        oneuptimeSolution: "OneUptime with unlimited everything",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario:
          "SaaS company needing private status pages for enterprise clients",
        competitorSolution:
          "Statuspage Corporate Private ($599) + monitoring + on-call",
        competitorCost: "$599 + $150 + $300 = $1,049/month",
        oneuptimeSolution: "OneUptime with unlimited private status pages",
        oneuptimeCost: "$0-299/month",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Atlassian Statuspage?",
        answer:
          "Statuspage excels at creating beautiful status pages for customer communication. However, it operates in isolation - you need separate monitoring to detect issues, separate alerting to notify your team, and separate tools for incident management. OneUptime provides status pages as part of a complete platform where monitoring, alerting, incident management, and status communication work together seamlessly.",
      },
      {
        question: "Can OneUptime automatically update status pages?",
        answer:
          "Yes, this is a key advantage. OneUptime's integrated monitoring continuously checks your services. When issues are detected, status pages can automatically update to reflect degraded or down status. When issues resolve, the status page updates automatically. This ensures your customers always see accurate information without manual intervention during stressful incident situations.",
      },
      {
        question: "How does automatic status page updating work?",
        answer:
          "OneUptime connects your monitors directly to status page components. When a monitor detects an issue, it automatically updates the corresponding component status. You can configure automatic updates for different severity levels, or require manual approval for public status changes. This eliminates the delay between detecting an issue and communicating it to customers.",
      },
      {
        question: "Can I customize my OneUptime status page like Statuspage?",
        answer:
          "Yes. OneUptime status pages support custom domains with automatic SSL, custom branding (logos, colors, favicon), and custom HTML/CSS/JavaScript. You can create component groups, show historical uptime percentages, display real-time metrics, and configure exactly how much detail to share with your audience.",
      },
      {
        question: "Does OneUptime support private status pages?",
        answer:
          "Yes. OneUptime supports password-protected private status pages for internal teams and enterprise customers. You can create multiple status pages with different access levels - public pages for customers and private pages for internal teams or specific enterprise clients.",
      },
      {
        question: "What notification channels does OneUptime support?",
        answer:
          "OneUptime supports comprehensive notification channels: email, SMS, webhooks, RSS feeds, Slack, Microsoft Teams, and push notifications. Subscribers can choose their preferred channels, and you can configure different notification types for different incident severities.",
      },
      {
        question: "What's the benefit of a unified platform for status pages?",
        answer:
          "With a unified platform, everything works together. Incidents detected by monitoring automatically trigger alerts to on-call engineers and can update status pages. Engineers can collaborate on incident response while keeping customers informed. Postmortems include complete timelines from detection through resolution. This reduces mean time to resolution and improves customer communication during incidents.",
      },
    ],
    keyDifferences: [
      {
        title: "Unlimited Subscribers",
        description:
          "Scale your status page audience freely without subscriber caps or tiers",
        icon: "subscribers",
      },
      {
        title: "Automatic Status Updates",
        description:
          "Integrated monitoring automatically reflects system health on your status page",
        icon: "monitoring",
      },
      {
        title: "On-Call Scheduling",
        description:
          "Alert the right team members when incidents occur - built into the same platform",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Full incident workflow with timelines, collaboration, and postmortems",
        icon: "incident",
      },
      {
        title: "Unified Platform",
        description:
          "One platform for monitoring, status pages, alerting, and incident response",
        icon: "unified",
      },
      {
        title: "All Notification Channels",
        description:
          "Email, SMS, Slack, Teams, webhooks, and push notifications included on all plans",
        icon: "sms",
      },
    ],
    items: [
      {
        name: "Status Page Features",
        data: [
          {
            title: "Public Status Pages",
            description: "Customer-facing status communication",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Pages",
            description: "Password-protected internal pages",
            productColumn: "Separate product ($79-1,499/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Limits",
            description: "Maximum status page subscribers",
            productColumn: "100-25,000 based on plan",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Multiple Status Pages",
            description: "Create different pages for different audiences",
            productColumn: "Additional cost",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Component Groups",
            description: "Organize services into logical groups",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned maintenance windows",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident History",
            description: "Show past incidents and resolutions",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Uptime Percentage",
            description: "Display historical uptime metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Customization",
        data: [
          {
            title: "Custom Domain",
            description: "Use your own domain (status.yourcompany.com)",
            productColumn: "Hobby+ ($29+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Free SSL Certificate",
            description: "Automatic HTTPS for custom domains",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Branding",
            description: "Logo, colors, favicon customization",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom CSS",
            description: "Style with custom CSS",
            productColumn: "Business+ ($399+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML",
            description: "Custom page structure",
            productColumn: "Business+ ($399+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "JavaScript Injection",
            description: "Add custom scripts for analytics",
            productColumn: "Business+ ($399+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "White Label",
            description: "Remove vendor branding",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Metrics Display",
            description: "Show real-time performance data",
            productColumn: "2-50 based on plan",
            oneuptimeColumn: "Unlimited",
          },
        ],
      },
      {
        name: "Notifications",
        data: [
          {
            title: "Email Notifications",
            description: "Send status updates via email",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS Notifications",
            description: "Send status updates via text",
            productColumn: "Startup+ ($99+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Webhook Notifications",
            description: "Push to custom endpoints",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "RSS Feeds",
            description: "Subscribe via RSS readers",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack Integration",
            description: "Post to Slack channels",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Microsoft Teams",
            description: "Post to Teams channels",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Component-level Subscriptions",
            description: "Subscribe to specific services only",
            productColumn: "Business+ ($399+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push Notifications",
            description: "Mobile push alerts",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring & Automation",
        data: [
          {
            title: "Built-in Uptime Monitoring",
            description: "Monitor service availability",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "Monitor API endpoints",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic Status Updates",
            description: "Update page based on monitor status",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-Call Scheduling",
            description: "Route alerts to on-call responders",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Management",
            description: "Full incident workflow",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Automatic alert escalation",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Access",
            description: "Programmatic status updates",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Third-party Integrations",
            description: "Connect with other tools",
            productColumn: "Limited",
            oneuptimeColumn: "2000+ via Zapier + native",
          },
        ],
      },
      {
        name: "Team & Enterprise",
        data: [
          {
            title: "Team Member Limits",
            description: "Number of users who can manage pages",
            productColumn: "2-50 based on plan",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Team Member SSO",
            description: "Single sign-on for team members",
            productColumn: "Startup+ ($99+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Role-Based Access",
            description: "Granular permissions",
            productColumn: "Business+ ($399+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-Hosting Option",
            description: "Run on your own infrastructure",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent, auditable code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0 License",
          },
          {
            title: "Uptime SLA",
            description: "Guaranteed availability",
            productColumn: "99.9%",
            oneuptimeColumn: "99.9%",
          },
        ],
      },
    ],
  },
  pingdom: {
    productName: "SolarWinds Pingdom",
    iconUrl: "/img/pingdom.svg",
    price: "",
    productDescription:
      "Pingdom is a veteran in the monitoring space with reliable uptime monitoring and 100+ probe locations worldwide. It focuses on synthetic monitoring and real user monitoring but requires additional tools for incident response and status communication.",
    oneUptimeDescription:
      "OneUptime provides unlimited monitoring from global locations, plus integrated status pages, on-call scheduling, and incident management. Monitor everything your infrastructure needs without worrying about check limits.",
    oneuptimePrice: "",
    tagline: "Complete observability platform vs monitoring-only tool",
    competitorFocus:
      "Specialized in uptime and performance monitoring - requires separate tools for alerting, status pages, and incident management",
    oneuptimeFocus:
      "Unified platform where monitoring connects directly to alerting, status pages, and incident workflows",
    annualSavings: "",
    lastUpdated: "January 2025",
    description:
      "Pingdom (now owned by SolarWinds) is one of the oldest and most reliable monitoring tools, offering uptime monitoring from 100+ probe locations. It excels at detecting outages but operates in isolation - you need additional tools for on-call scheduling, incident management, and customer-facing status pages.",
    descriptionLine2:
      "Get unlimited monitoring plus status pages, on-call scheduling, and incident management working together in one platform.",
    migrationBenefits: [
      "Monitor unlimited endpoints without per-check limitations",
      "Global probe network for comprehensive coverage",
      "Add on-call scheduling you didn't have before",
      "Get status pages that auto-update from monitoring",
      "Complete incident workflow from detection to postmortem",
      "API-compatible for easy migration of existing monitors",
    ],
    competitorPricingTiers: [
      {
        name: "Synthetic Monitoring",
        price: "$10",
        period: "/month starting",
        features: [
          "Uptime monitoring",
          "Page speed testing",
          "Transaction monitoring",
          "100+ probe locations",
          "Alerting via email/SMS",
        ],
        limitations: [
          "Priced per number of checks",
          "No on-call scheduling",
          "No incident management",
          "Basic alerting only",
        ],
      },
      {
        name: "Real User Monitoring",
        price: "$10",
        period: "/month starting",
        features: [
          "Real user experience metrics",
          "Page load performance",
          "Geographic performance data",
          "Browser breakdown",
        ],
        limitations: [
          "Priced per page views",
          "Separate from synthetic",
          "No alerting included",
          "No incident workflow",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "High-volume monitoring",
          "Custom SLAs",
          "Dedicated support",
          "Advanced features",
        ],
        limitations: [
          "Requires sales contact",
          "Still no incident management",
          "Still no on-call",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup monitoring 20 endpoints with on-call needs",
        competitorSolution: "Pingdom Synthetic + PagerDuty + StatusPage",
        competitorCost: "$50 + $210 + $99 = $359/month",
        oneuptimeSolution: "OneUptime with unlimited monitors",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "Growing company with 100 monitors and RUM",
        competitorSolution: "Pingdom Synthetic + RUM + PagerDuty + StatusPage",
        competitorCost: "$100+ + $50 + $400 + $99 = $649+/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "E-commerce site with synthetic transactions",
        competitorSolution:
          "Pingdom Transaction monitoring + on-call + status page",
        competitorCost: "$200+ + $400 + $99 = $699+/month",
        oneuptimeSolution: "OneUptime with synthetic monitoring included",
        oneuptimeCost: "$0-299/month",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Pingdom?",
        answer:
          "Pingdom is a focused uptime monitoring tool with 100+ probe locations and per-check pricing. It does basic monitoring well but lacks incident management, on-call scheduling, and robust status pages. OneUptime provides unlimited monitors (no per-monitor fees), plus status pages with unlimited subscribers, on-call scheduling with escalation policies, and full incident management. You replace Pingdom plus 2-3 other tools with one platform.",
      },
      {
        question: "What types of monitoring does OneUptime support vs Pingdom?",
        answer:
          "Both support HTTP/HTTPS monitoring, SSL certificate checks, and transaction/synthetic monitoring. OneUptime additionally provides server monitoring (CPU, memory, disk), container monitoring (Docker/Kubernetes), and custom metrics without needing the separate RUM product. All OneUptime monitoring is included at no extra per-check cost.",
      },
      {
        question: "How do probe locations compare?",
        answer:
          "Pingdom offers 100+ probe locations worldwide but charges based on usage. OneUptime provides 7+ strategically placed global locations and allows checking from all locations on every monitor without additional cost. For most use cases, our locations provide excellent coverage. We also support private probes inside your network for internal monitoring.",
      },
      {
        question: "What about Pingdom's Real User Monitoring (RUM)?",
        answer:
          "Pingdom's RUM is a separate product with per-pageview pricing starting at $10/month. OneUptime includes real user monitoring capabilities in our platform to track actual user experience metrics like page load time, time to first byte, and core web vitals - without separate per-pageview charges.",
      },
      {
        question: "Does OneUptime have transaction monitoring like Pingdom?",
        answer:
          "Yes. OneUptime supports multi-step synthetic monitoring to test user flows like login, checkout, or form submissions. Pingdom charges extra for transaction monitoring based on the number and frequency of checks. OneUptime includes this in all plans.",
      },
      {
        question: "What about Pingdom's status pages?",
        answer:
          "Pingdom offers basic public status pages as a feature with limited customization. OneUptime provides full-featured public and private status pages with unlimited subscribers, custom branding, custom domains, and automatic updates based on monitor status. This alone can save $100+/month compared to buying a separate status page product.",
      },
      {
        question: "Why is per-monitor pricing problematic?",
        answer:
          "Per-monitor pricing creates perverse incentives to monitor less. With Pingdom, adding a new service or endpoint means calculating if it's worth the extra cost. With OneUptime's unlimited monitoring, you can monitor everything - every endpoint, every region, every environment - without worrying about the bill. This leads to better coverage and faster issue detection.",
      },
    ],
    keyDifferences: [
      {
        title: "Unlimited Monitoring",
        description:
          "Monitor every endpoint, service, and region without artificial limits",
        icon: "unlimited",
      },
      {
        title: "Integrated Status Pages",
        description:
          "Status pages that automatically update based on your actual system health",
        icon: "status-page",
      },
      {
        title: "On-Call Scheduling",
        description:
          "Complete on-call management with rotations, escalations, and overrides",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description: "Full incident workflow from detection through postmortem",
        icon: "incident",
      },
      {
        title: "Infrastructure Monitoring",
        description:
          "CPU, memory, disk, and custom metrics all in the same platform",
        icon: "monitoring",
      },
      {
        title: "Unified Platform",
        description: "One dashboard for monitoring, alerting, status, and incidents",
        icon: "unified",
      },
    ],
    items: [
      {
        name: "Uptime Monitoring",
        data: [
          {
            title: "HTTP/HTTPS Monitoring",
            description: "Monitor websites and web applications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "Monitor REST APIs with custom requests",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Transaction Monitoring",
            description: "Multi-step synthetic user flows",
            productColumn: "Additional cost",
            oneuptimeColumn: "tick",
          },
          {
            title: "Number of Monitors",
            description: "How many endpoints you can monitor",
            productColumn: "Pay per check",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Check Frequency",
            description: "How often monitors run",
            productColumn: "1-60 minutes",
            oneuptimeColumn: "1 second - 24 hours",
          },
          {
            title: "Global Probe Locations",
            description: "Monitoring locations worldwide",
            productColumn: "100+ (usage-based)",
            oneuptimeColumn: "7+ (all included)",
          },
          {
            title: "Private Probes",
            description: "Monitor internal resources",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Certificate Monitoring",
            description: "Certificate expiration alerts",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Server & Infrastructure",
        data: [
          {
            title: "Server Monitoring",
            description: "CPU, memory, disk metrics",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container Monitoring",
            description: "Docker and Kubernetes",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Metrics",
            description: "Send custom application metrics",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Log Monitoring",
            description: "Monitor log patterns and errors",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Real User Monitoring",
            description: "Actual user experience metrics",
            productColumn: "Separate product ($10+/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Core Web Vitals",
            description: "LCP, FID, CLS metrics",
            productColumn: "In RUM product",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Alerting & Notifications",
        data: [
          {
            title: "Email Alerts",
            description: "Receive alerts via email",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS Alerts",
            description: "Receive alerts via text message",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone Call Alerts",
            description: "Receive voice call alerts",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack/Teams Alerts",
            description: "Alert in chat tools",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push Notifications",
            description: "Mobile app push alerts",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Automatic escalation",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert Deduplication",
            description: "Reduce alert noise",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Pages",
            description: "Customer-facing status",
            productColumn: "Basic feature",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Pages",
            description: "Internal status dashboards",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS status updates",
            productColumn: "Limited",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Use your own domain",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Branding",
            description: "Logo, colors, styling",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic Status Updates",
            description: "Update based on monitors",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned work",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident History",
            description: "Show past incidents",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Creation",
            description: "Create and track incidents",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Timeline",
            description: "Automatic event tracking",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Collaboration",
            description: "Team coordination",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident reviews",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Item Tracking",
            description: "Follow-up tasks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack/Teams Integration",
            description: "Manage from chat",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "API Access",
            description: "Full REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Webhooks",
            description: "Event notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Reports & Analytics",
            description: "Uptime reports, SLA tracking",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-Hosting",
            description: "Run on your infrastructure",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0 License",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise authentication",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  datadog: {
    productName: "Datadog",
    iconUrl: "/img/datadog.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability platform vs monitoring-focused tool",
    competitorFocus:
      "Comprehensive cloud monitoring and APM with 600+ integrations - status pages, on-call, and incident management require separate tools",
    oneuptimeFocus:
      "Unified platform with monitoring, logs, metrics, traces, status pages, on-call, and incident management all working together",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "Datadog is the industry leader in cloud monitoring and APM, offering comprehensive observability with 600+ integrations. It excels at infrastructure monitoring, APM, and log management but focuses purely on monitoring - status pages, on-call scheduling, and incident management require separate tools.",
    oneUptimeDescription:
      "OneUptime provides complete observability with predictable pricing. Get monitoring, logs, metrics, traces, status pages, on-call scheduling, and incident management in one unified platform.",
    description:
      "Datadog is the industry leader in cloud monitoring and APM, offering comprehensive observability with 600+ integrations. It excels at deep infrastructure insights but requires separate tools for status pages, on-call scheduling, and incident management - meaning you need to integrate multiple platforms for a complete solution.",
    descriptionLine2:
      "Get monitoring, status pages, on-call scheduling, and incident management in one unified platform with predictable pricing.",
    migrationBenefits: [
      "Predictable pricing without complex usage calculations",
      "Status pages included with automatic updates from monitoring",
      "On-call scheduling with escalations built in",
      "Complete incident management workflow",
      "Self-hosting option for complete control",
      "OpenTelemetry-compatible for easy data migration",
    ],
    competitorPricingTiers: [
      {
        name: "Infrastructure Pro",
        price: "$15",
        period: "/host/month",
        features: [
          "750+ integrations",
          "15-month data retention",
          "Alerting and dashboards",
          "Host maps and inventory",
        ],
        limitations: [
          "Per-host pricing adds up quickly",
          "No APM included",
          "No logs included",
          "No status pages or on-call",
        ],
      },
      {
        name: "APM Pro",
        price: "$31",
        period: "/host/month (additional)",
        features: [
          "Distributed tracing",
          "Error tracking",
          "15-month trace retention",
          "Service maps",
        ],
        limitations: [
          "On TOP of infrastructure cost",
          "Ingestion limits apply",
          "No incident management",
          "Complex pricing tiers",
        ],
      },
      {
        name: "Log Management",
        price: "$0.10/GB + $1.70/M",
        period: "ingested + indexed",
        features: [
          "Log collection and search",
          "Log patterns and analytics",
          "Flexible retention",
        ],
        limitations: [
          "Costs scale with volume",
          "Can become very expensive",
          "Complex pricing model",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Volume discounts",
          "Custom contracts",
          "Dedicated support",
          "Advanced security",
        ],
        limitations: [
          "Requires sales engagement",
          "Long contract terms",
          "Still complex pricing",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup with 10 servers needing monitoring and APM",
        competitorSolution:
          "Datadog Infrastructure + APM + StatusPage + PagerDuty",
        competitorCost: "$150 + $310 + $99 + $210 = $769/month",
        oneuptimeSolution: "OneUptime with unlimited monitoring",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario: "Growing company with 50 servers and log management",
        competitorSolution:
          "Datadog full stack + status page + on-call + incidents",
        competitorCost:
          "$2,000-4,000+/month + $399 + $500 + $340 = $3,239-5,239/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Enterprise with containers and microservices",
        competitorSolution: "Datadog Enterprise + supporting tools",
        competitorCost: "$10,000-50,000+/month",
        oneuptimeSolution: "OneUptime Enterprise or self-hosted",
        oneuptimeCost: "Contact for pricing (fraction of Datadog)",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Datadog?",
        answer:
          "Datadog is a comprehensive observability platform with deep APM, log management, and infrastructure monitoring. It's excellent for large enterprises with complex requirements. However, its per-host, per-container, per-GB pricing model makes costs unpredictable and often surprisingly high. A typical startup can spend $500-2,000/month on Datadog alone, plus additional tools for status pages ($100-400/mo), on-call ($200-500/mo), and incident management ($150-450/mo). OneUptime provides core monitoring, status pages, on-call, and incident management in one platform with straightforward pricing.",
      },
      {
        question: "Can OneUptime replace Datadog for monitoring?",
        answer:
          "For most teams, yes. OneUptime covers uptime monitoring, API monitoring, server metrics, SSL monitoring, and synthetic transactions. If you need deep APM with distributed tracing across hundreds of microservices, Datadog may be necessary. But many teams use Datadog for features they could get elsewhere at a fraction of the cost. We recommend evaluating your actual needs - often core monitoring plus status pages and on-call (all in OneUptime) is sufficient.",
      },
      {
        question: "What about Datadog's 750+ integrations?",
        answer:
          "Datadog has an impressive integration library. OneUptime takes a different approach: we provide core monitoring capabilities built-in, plus 2000+ integrations via Zapier and native webhooks. Our monitoring is designed to work out of the box without extensive configuration. For many teams, fewer but well-designed integrations is actually preferable to integration overload.",
      },
      {
        question: "How much can I save switching from Datadog?",
        answer:
          "Savings vary widely based on your Datadog usage. A typical team with 10-20 servers using Infrastructure + APM + Logs can spend $500-2,000/month on Datadog. Add StatusPage ($99-399/mo), PagerDuty ($210-490/mo), and Incident.io ($250-450/mo) and you're at $1,059-3,339/month. OneUptime provides monitoring, status pages, on-call, and incident management starting from $0. Even at enterprise scale, savings are typically 70-90%.",
      },
      {
        question: "Is OneUptime's monitoring as comprehensive as Datadog?",
        answer:
          "Datadog offers deeper APM capabilities, especially for distributed tracing in complex microservice architectures. OneUptime focuses on what most teams actually need: uptime monitoring, API health checks, server metrics, and synthetic transactions. If you're running hundreds of microservices and need sub-millisecond trace analysis, Datadog may be necessary. For monitoring websites, APIs, servers, and keeping customers informed during incidents, OneUptime is fully capable.",
      },
      {
        question: "Does OneUptime support logs like Datadog?",
        answer:
          "OneUptime includes log monitoring for error detection and alerting. For full-text log search and analysis at scale, you might pair OneUptime with a dedicated log solution. The difference is you're not paying per-GB for log ingestion - our approach keeps costs predictable while providing the alerting and monitoring capabilities most teams need.",
      },
      {
        question: "Can I self-host OneUptime to control costs?",
        answer:
          "Yes! OneUptime is open source (Apache 2.0) and can be self-hosted on your own infrastructure. This gives you complete control over costs - pay only for your infrastructure, not per-host or per-GB fees. This is impossible with Datadog, which is SaaS-only. Self-hosting is ideal for teams with strict data requirements or those wanting to eliminate variable cloud costs entirely.",
      },
    ],
    keyDifferences: [
      {
        title: "Predictable Costs",
        description:
          "Straightforward pricing you can plan around without complex usage calculations",
        icon: "pricing",
      },
      {
        title: "Integrated Status Pages",
        description:
          "Customer communication tools built into the same platform as your monitoring",
        icon: "status-page",
      },
      {
        title: "On-Call Management",
        description:
          "Complete on-call scheduling with rotations and escalations in the same platform",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Full incident workflow from detection through postmortem, all connected",
        icon: "incident",
      },
      {
        title: "Self-Hosting Available",
        description:
          "Deploy on your infrastructure for complete control and data sovereignty",
        icon: "open-source",
      },
      {
        title: "Unified Platform",
        description:
          "One integrated platform for monitoring, alerting, status, and incident response",
        icon: "unified",
      },
    ],
    items: [
      {
        name: "Monitoring Capabilities",
        data: [
          {
            title: "Infrastructure Monitoring",
            description: "Server metrics, CPU, memory, disk",
            productColumn: "$15-23/host/month",
            oneuptimeColumn: "tick",
          },
          {
            title: "APM / Tracing",
            description: "Application performance monitoring",
            productColumn: "+$31-40/host/month",
            oneuptimeColumn: "Basic APM included",
          },
          {
            title: "Log Management",
            description: "Log collection and search",
            productColumn: "$0.10/GB + $1.70/M events",
            oneuptimeColumn: "Log monitoring included",
          },
          {
            title: "Uptime Monitoring",
            description: "Website and API availability",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic Monitoring",
            description: "Multi-step transaction tests",
            productColumn: "$5/1000 tests",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container Monitoring",
            description: "Docker and Kubernetes",
            productColumn: "$2/container/hour (>5)",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Certificate Monitoring",
            description: "Certificate expiration alerts",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Metrics",
            description: "Send custom application metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Alerting",
        data: [
          {
            title: "Threshold Alerts",
            description: "Alert on metric thresholds",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Anomaly Detection",
            description: "ML-based anomaly alerts",
            productColumn: "tick",
            oneuptimeColumn: "Pattern detection",
          },
          {
            title: "Email Alerts",
            description: "Receive alerts via email",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS Alerts",
            description: "Text message notifications",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone Call Alerts",
            description: "Voice call notifications",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Page",
            description: "Internal dashboards",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "Not included",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned work",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Tracking",
            description: "Create and manage incidents",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Timeline",
            description: "Automatic event history",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident reviews",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack Integration",
            description: "Incident management from Slack",
            productColumn: "Alerts only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Item Tracking",
            description: "Follow-up tasks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "API Access",
            description: "REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Integrations",
            description: "Third-party connections",
            productColumn: "750+",
            oneuptimeColumn: "2000+ via Zapier + native",
          },
          {
            title: "Self-Hosting",
            description: "On-premises deployment",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise authentication",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit Logs",
            description: "Activity tracking",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  newrelic: {
    productName: "New Relic",
    iconUrl: "/img/newrelic.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability platform vs APM-focused monitoring",
    competitorFocus:
      "Powerful full-stack observability with comprehensive APM, logs, and infrastructure monitoring - status pages and on-call require separate tools",
    oneuptimeFocus:
      "Unified platform with monitoring, logs, metrics, traces, status pages, on-call, and incident management all working together",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "New Relic is a powerful full-stack observability platform with comprehensive APM, logs, and infrastructure monitoring. It offers deep insights into application performance but requires separate tools for status pages, on-call scheduling, and incident management.",
    oneUptimeDescription:
      "OneUptime provides complete observability with monitoring, status pages, on-call scheduling, and incident management in one unified platform. Everything works together without requiring additional tools.",
    description:
      "New Relic is a powerful full-stack observability platform with comprehensive APM, logs, and infrastructure monitoring. It excels at deep application insights but focuses purely on monitoring - status pages and on-call scheduling require additional tools.",
    descriptionLine2:
      "Get monitoring, status pages, on-call scheduling, and incident management all working together in one platform.",
    migrationBenefits: [
      "Add team members as you grow without limitations",
      "Predictable costs you can plan around",
      "Status pages included with automatic updates",
      "On-call scheduling with escalations built in",
      "Complete incident management workflow",
      "OpenTelemetry-compatible for easy data migration",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "100GB data ingest",
          "1 full platform user",
          "Unlimited basic users",
          "Core observability features",
        ],
        limitations: [
          "Single full platform user only",
          "Limited data retention",
          "Community support only",
        ],
      },
      {
        name: "Standard",
        price: "$99",
        period: "/user/month",
        features: [
          "100GB data included",
          "Up to 5 full platform users",
          "All observability features",
          "Email support",
        ],
        limitations: [
          "Maximum 5 full platform users",
          "Data overage charges apply",
          "No advanced compute",
        ],
      },
      {
        name: "Pro",
        price: "$349",
        period: "/user/month",
        features: [
          "Everything in Standard",
          "Unlimited users",
          "Advanced compute",
          "Extended retention",
          "Priority support",
        ],
        limitations: [
          "Expensive per-user pricing",
          "Data overage still applies",
          "No status pages or on-call",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Custom data retention",
          "HIPAA/FedRAMP eligibility",
          "Dedicated support",
        ],
        limitations: ["Requires sales engagement", "Still usage-based pricing"],
      },
    ],
    useCases: [
      {
        scenario: "5-person team needing full observability",
        competitorSolution: "New Relic Standard + StatusPage + OpsGenie",
        competitorCost: "$495 + $99 + $100 = $694/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "10-person engineering team with 500GB data/month",
        competitorSolution:
          "New Relic Pro + data overages + StatusPage + PagerDuty",
        competitorCost: "$3,490 + $200 + $99 + $210 = $3,999/month",
        oneuptimeSolution: "OneUptime with unlimited features",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Growing company with 25 engineers",
        competitorSolution: "New Relic Pro + supporting tools",
        competitorCost: "$8,725+/month + data + tools",
        oneuptimeSolution: "OneUptime Enterprise",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to New Relic?",
        answer:
          "New Relic is a comprehensive observability platform with excellent APM, logs, and infrastructure monitoring. However, its per-user pricing ($99-349/user) and per-GB data charges can make costs unpredictable. A 10-person team on Pro is $3,490/month before data charges. Plus you need StatusPage ($99-399/mo) and PagerDuty ($210-490/mo) for complete coverage. OneUptime provides monitoring, status pages, on-call, and incident management with straightforward pricing.",
      },
      {
        question: "Can OneUptime match New Relic's observability features?",
        answer:
          "New Relic offers deeper APM capabilities, especially for distributed tracing in complex applications. OneUptime covers what most teams actually use: uptime monitoring, API health, server metrics, and synthetic tests. If you need deep APM with code-level tracing across hundreds of services, New Relic may be necessary. For monitoring reliability and communicating with customers during incidents, OneUptime is fully capable.",
      },
      {
        question: "What about New Relic's free tier?",
        answer:
          "New Relic's free tier is generous: 100GB data and one full platform user. However, once you need more than one power user or exceed 100GB, costs jump significantly. OneUptime's free tier includes unlimited basic users and doesn't charge per-GB, making it more scalable for growing teams.",
      },
      {
        question: "How does data pricing compare?",
        answer:
          "New Relic charges $0.30-0.50/GB after 100GB free. A team generating 500GB/month pays $120-200 in overages alone. OneUptime doesn't charge per-GB for monitoring data. Our pricing is based on features and usage tiers, not data volume, making costs predictable as your infrastructure grows.",
      },
      {
        question: "Does OneUptime have APM like New Relic?",
        answer:
          "OneUptime includes application monitoring capabilities for tracking response times, errors, and throughput. For full distributed tracing with code-level performance analysis, New Relic has deeper features. Many teams find they don't need that depth - they need to know when services are down and be able to respond quickly, which OneUptime handles completely.",
      },
    ],
    keyDifferences: [
      {
        title: "No Per-User Pricing",
        description:
          "Add team members without cost scaling - New Relic charges $99-349/user",
        icon: "savings",
      },
      {
        title: "No Data Charges",
        description: "No per-GB fees - New Relic charges $0.30-0.50/GB overage",
        icon: "unlimited",
      },
      {
        title: "Status Pages Included",
        description:
          "Unlimited status pages and subscribers - New Relic has none",
        icon: "status-page",
      },
      {
        title: "On-Call Included",
        description:
          "Full on-call scheduling built-in - requires PagerDuty with New Relic",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Complete incident workflow included - basic only in New Relic",
        icon: "incident",
      },
      {
        title: "Self-Hosting Option",
        description: "Run on your infrastructure - New Relic is SaaS-only",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "Monitoring",
        data: [
          {
            title: "Infrastructure Monitoring",
            description: "Server and cloud metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "APM",
            description: "Application performance monitoring",
            productColumn: "tick",
            oneuptimeColumn: "Basic APM included",
          },
          {
            title: "Log Management",
            description: "Centralized logging",
            productColumn: "$0.30-0.50/GB overage",
            oneuptimeColumn: "Log monitoring included",
          },
          {
            title: "Uptime Monitoring",
            description: "Website and API availability",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic Monitoring",
            description: "Multi-step transactions",
            productColumn: "$0.005/check overage",
            oneuptimeColumn: "tick",
          },
          {
            title: "Browser Monitoring",
            description: "Real user monitoring",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Alerting & On-Call",
        data: [
          {
            title: "Alert Conditions",
            description: "Threshold and anomaly alerts",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Email Alerts",
            description: "Email notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS/Phone Alerts",
            description: "SMS and voice alerts",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages & Incidents",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "Not included",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Incident Management",
            description: "Full incident workflow",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident reviews",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "API Access",
            description: "REST and GraphQL APIs",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-Hosting",
            description: "On-premises option",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise SSO",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  "better-uptime": {
    productName: "Better Stack (Better Uptime)",
    iconUrl: "/img/betterstack.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability platform with unlimited scale",
    competitorFocus:
      "Unified monitoring platform with uptime monitoring, status pages, and on-call features in one place",
    oneuptimeFocus:
      "Open-source observability with unlimited monitoring, status pages, on-call, and incident management",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "Better Stack (formerly Better Uptime) offers monitoring, status pages, and on-call features in one modern platform. It provides a similar unified approach with a focus on developer experience and modern design.",
    oneUptimeDescription:
      "OneUptime provides unlimited monitoring, status pages with unlimited subscribers, and full on-call scheduling. Open source and self-hostable for complete control.",
    description:
      "Better Stack (formerly Better Uptime) offers monitoring, status pages, and on-call in one platform - a similar unified approach to OneUptime. Both platforms aim to consolidate observability tools, with OneUptime offering open-source transparency and self-hosting options.",
    descriptionLine2:
      "Both platforms share the vision of unified observability. OneUptime adds open-source transparency and self-hosting flexibility.",
    migrationBenefits: [
      "Scale monitoring without worrying about limits",
      "Self-hosting option for complete infrastructure control",
      "Open source codebase you can audit and extend",
      "Faster check frequency options available",
      "Similar features with full transparency",
      "Apache 2.0 license with no vendor lock-in",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "10 monitors",
          "1 status page",
          "100,000 exceptions",
          "Slack/email alerts",
        ],
        limitations: [
          "Only 10 monitors",
          "Limited features",
          "No on-call scheduling",
        ],
      },
      {
        name: "Additional Monitors",
        price: "$21-25",
        period: "/month per 50",
        features: [
          "Add more monitoring capacity",
          "Same monitoring features",
          "30-second check frequency",
        ],
        limitations: [
          "Costs add up with scale",
          "Per-50-monitor bundles",
          "Responder license separate",
        ],
      },
      {
        name: "Responder License",
        price: "$29-34",
        period: "/month",
        features: [
          "Unlimited phone/SMS alerts",
          "On-call scheduling",
          "Incident management",
        ],
        limitations: [
          "Required for on-call",
          "Per-responder pricing",
          "Additional to monitoring",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup with 50 monitors and on-call needs",
        competitorSolution: "Better Stack (Free + 40 monitors + Responder)",
        competitorCost: "$0 + $21 + $29 = $50/month",
        oneuptimeSolution: "OneUptime with unlimited monitors",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "Growing company with 200 monitors and 3 responders",
        competitorSolution:
          "Better Stack (200 monitors + 3 responders + telemetry)",
        competitorCost: "$84 + $87 + $50 = $221/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0-99/month",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Better Stack?",
        answer:
          "Better Stack and OneUptime have similar visions - providing monitoring, status pages, and incident management in one platform. The key difference is pricing: Better Stack charges per 50 monitors ($21/month) and per responder ($29/month), while OneUptime offers unlimited monitors and users. For teams with growing monitoring needs, OneUptime's flat pricing is more predictable.",
      },
      {
        question: "What about Better Stack's incident management?",
        answer:
          "Both platforms offer incident management with timelines, Slack integration, and status page updates. Better Stack requires a Responder license ($29/month) for full on-call and incident features. OneUptime includes all incident management features in every plan.",
      },
      {
        question: "How do monitoring capabilities compare?",
        answer:
          "Both offer HTTP monitoring, API checks, SSL monitoring, and status pages. OneUptime offers faster check frequencies (1 second minimum vs 30 seconds) and includes server monitoring. Better Stack has a strong focus on logs and observability data, while OneUptime focuses on the complete incident lifecycle.",
      },
      {
        question: "Is Better Stack or OneUptime better for startups?",
        answer:
          "Both have free tiers. Better Stack's free tier includes 10 monitors while OneUptime's includes more generous limits. As you grow, OneUptime's unlimited monitoring becomes more cost-effective. If you need extensive log management, Better Stack's telemetry features may be valuable. For pure reliability monitoring with status pages and on-call, OneUptime offers better value.",
      },
    ],
    keyDifferences: [
      {
        title: "Unlimited Monitors",
        description:
          "No per-monitor fees - Better Stack charges $21/50 monitors",
        icon: "unlimited",
      },
      {
        title: "No Responder Licenses",
        description:
          "On-call included - Better Stack charges $29/month per responder",
        icon: "on-call",
      },
      {
        title: "Faster Check Frequency",
        description: "1-second minimum vs 30-second minimum on Better Stack",
        icon: "speed",
      },
      {
        title: "Self-Hosting Option",
        description: "Run on your infrastructure - complete control",
        icon: "open-source",
      },
      {
        title: "Open Source",
        description: "Apache 2.0 licensed - transparent and auditable",
        icon: "open-source",
      },
      {
        title: "Simpler Pricing",
        description: "No calculating monitor bundles and responder counts",
        icon: "savings",
      },
    ],
    items: [
      {
        name: "Monitoring",
        data: [
          {
            title: "Number of Monitors",
            description: "How many checks included",
            productColumn: "10 free, +$21/50 extra",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Check Frequency",
            description: "How often monitors run",
            productColumn: "30 seconds minimum",
            oneuptimeColumn: "1 second minimum",
          },
          {
            title: "HTTP Monitoring",
            description: "Website availability",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "API health checks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Monitoring",
            description: "Certificate expiration",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server Monitoring",
            description: "CPU, memory, disk",
            productColumn: "Via telemetry add-on",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "Responder license ($29/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone/SMS Alerts",
            description: "Voice and text alerts",
            productColumn: "Responder license ($29/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "Responder license",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack Integration",
            description: "Alert in Slack",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "tick",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned work",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "Self-Hosting",
            description: "On-premises option",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Audit the code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "API Access",
            description: "REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  "uptime-robot": {
    productName: "Uptime Robot",
    iconUrl: "/img/uptimerobot.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability platform vs simple monitoring tool",
    competitorFocus:
      "Simple, popular uptime monitoring tool - excels at basic monitoring but requires additional tools for incident response",
    oneuptimeFocus:
      "Complete platform with monitoring, status pages, on-call scheduling, and incident management all integrated",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "Uptime Robot is one of the most popular simple monitoring tools with an excellent free tier. It excels at straightforward uptime monitoring with a clean interface but focuses solely on monitoring without on-call or incident management features.",
    oneUptimeDescription:
      "OneUptime provides unlimited monitoring plus complete incident lifecycle management - status pages, on-call scheduling, and incident management all working together.",
    description:
      "Uptime Robot is one of the most popular simple monitoring tools with an excellent free tier. It's great for straightforward uptime monitoring but lacks on-call scheduling, advanced incident management, and has basic status pages. As needs grow beyond simple monitoring, teams often need additional tools.",
    descriptionLine2:
      "Great for simple monitoring. When you need on-call scheduling and incident management, OneUptime provides a complete platform.",
    migrationBenefits: [
      "Keep simple monitoring, add on-call scheduling",
      "Complete incident management workflow",
      "Status pages with unlimited subscribers",
      "Faster check intervals available (1 second)",
      "Unlimited monitors without caps",
      "All integrations included: Slack, Teams, webhooks, and more",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "50 monitors",
          "5-minute intervals",
          "HTTP/port/ping monitoring",
          "5 integrations",
        ],
        limitations: [
          "5-minute intervals only",
          "50 monitor limit",
          "Basic status pages",
          "No on-call",
        ],
      },
      {
        name: "Solo",
        price: "$7",
        period: "/month",
        features: [
          "10-50 monitors",
          "1-minute intervals",
          "9 integrations",
          "Basic status pages",
        ],
        limitations: [
          "Limited monitors",
          "No on-call scheduling",
          "No incident management",
          "Basic alerting",
        ],
      },
      {
        name: "Team",
        price: "$29",
        period: "/month",
        features: [
          "100 monitors",
          "1-minute intervals",
          "All 12 integrations",
          "Full status pages",
          "3 notify/login seats",
        ],
        limitations: [
          "100 monitor limit",
          "Still no on-call",
          "Basic incident tracking",
        ],
      },
      {
        name: "Enterprise",
        price: "$54",
        period: "/month",
        features: [
          "200 monitors",
          "30-second intervals",
          "All integrations",
          "5 notify/login seats",
        ],
        limitations: [
          "200 monitor limit",
          "No on-call scheduling",
          "No incident management",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Small team needing monitoring plus on-call",
        competitorSolution: "Uptime Robot Team + PagerDuty",
        competitorCost: "$29 + $210 = $239/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "Growing company needing complete observability",
        competitorSolution: "Uptime Robot Enterprise + PagerDuty + StatusPage",
        competitorCost: "$54 + $400 + $99 = $553/month",
        oneuptimeSolution: "OneUptime with unlimited monitors",
        oneuptimeCost: "$0-99/month",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Uptime Robot?",
        answer:
          "Uptime Robot is excellent for simple, affordable uptime monitoring. OneUptime provides that same monitoring capability plus on-call scheduling, incident management, and better status pages. If you just need basic monitoring, Uptime Robot's free tier is hard to beat. But if you need to manage incidents and alert on-call teams, you'd need to add PagerDuty ($210+/month) and possibly StatusPage ($99+/month), making OneUptime more cost-effective.",
      },
      {
        question: "What about Uptime Robot's free tier?",
        answer:
          "Uptime Robot's free tier (50 monitors, 5-minute intervals) is generous for basic needs. OneUptime also has a free tier with more features - on-call scheduling, incident management, and better status pages included. If monitoring alone is enough, Uptime Robot Free works well. If you need the complete incident lifecycle, OneUptime Free provides more value.",
      },
      {
        question: "Does OneUptime have the same monitoring types?",
        answer:
          "Yes. Both support HTTP/HTTPS, TCP port, ping, and keyword monitoring. OneUptime adds API monitoring with custom headers/payloads, server monitoring (CPU, memory, disk), container monitoring, and multi-step synthetic transactions. Plus OneUptime offers faster check frequencies (1 second vs 30 seconds minimum).",
      },
      {
        question: "Why switch from Uptime Robot?",
        answer:
          "Consider switching when you need: on-call scheduling (Uptime Robot has none), incident management workflows (basic in Uptime Robot), advanced status pages with unlimited subscribers, or more than 200 monitors. Rather than adding PagerDuty and StatusPage to Uptime Robot, OneUptime provides everything in one platform.",
      },
    ],
    keyDifferences: [
      {
        title: "On-Call Scheduling",
        description:
          "Full rotation and escalation support - Uptime Robot has none",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Complete workflow with timelines - basic tracking in Uptime Robot",
        icon: "incident",
      },
      {
        title: "Unlimited Monitors",
        description:
          "No monitor caps - Uptime Robot limits 50-200 based on plan",
        icon: "unlimited",
      },
      {
        title: "Faster Monitoring",
        description: "1-second intervals vs 30-second minimum (Enterprise)",
        icon: "speed",
      },
      {
        title: "Better Status Pages",
        description: "Unlimited subscribers, custom domains, automatic updates",
        icon: "status-page",
      },
      {
        title: "Self-Hosting Option",
        description: "Run on your infrastructure - Uptime Robot is SaaS-only",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "Monitoring",
        data: [
          {
            title: "Monitor Limits",
            description: "Number of monitors included",
            productColumn: "50-200 based on plan",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Check Frequency",
            description: "Minimum check interval",
            productColumn: "5min (Free), 30sec (Enterprise)",
            oneuptimeColumn: "1 second",
          },
          {
            title: "HTTP Monitoring",
            description: "Website availability",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Port Monitoring",
            description: "TCP port checks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Keyword Monitoring",
            description: "Content verification",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "Custom API tests",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server Monitoring",
            description: "CPU, memory, disk",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Monitoring",
            description: "Certificate checks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Alerting",
        data: [
          {
            title: "Email Alerts",
            description: "Email notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS Alerts",
            description: "Text notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone Calls",
            description: "Voice alerts",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack/Teams",
            description: "Chat integrations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Integrations",
            description: "Third-party alerts",
            productColumn: "5-12 based on plan",
            oneuptimeColumn: "2000+ via Zapier + native",
          },
        ],
      },
      {
        name: "On-Call & Incidents",
        data: [
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Management",
            description: "Full workflow",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Timeline",
            description: "Event history",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident reviews",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email updates",
            productColumn: "Basic",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Automatic Updates",
            description: "Update from monitors",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "Self-Hosting",
            description: "On-premises option",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "API Access",
            description: "REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise SSO",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  checkly: {
    productName: "Checkly",
    iconUrl: "/img/checkly.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability vs developer-focused synthetic monitoring",
    competitorFocus:
      "Developer-focused synthetic monitoring with excellent Playwright and Terraform integration - designed for CI/CD pipelines",
    oneuptimeFocus:
      "Complete platform with monitoring, status pages, on-call, and incident management all working together",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "Checkly is a developer-focused synthetic monitoring tool with excellent Playwright and Terraform integration. It excels at API and browser testing in CI/CD pipelines with a modern developer experience.",
    oneUptimeDescription:
      "OneUptime provides unlimited synthetic monitoring plus complete incident lifecycle management. Status pages, on-call scheduling, and incident management all integrated.",
    description:
      "Checkly is a developer-focused synthetic monitoring tool with excellent Playwright and Terraform integration. It's designed for API and browser testing in CI/CD pipelines. However, it focuses on monitoring - on-call scheduling, incident management, and status pages require separate tools.",
    descriptionLine2:
      "Excellent for synthetic testing. For a complete reliability platform, OneUptime adds on-call, incidents, and status pages.",
    migrationBenefits: [
      "Unlimited synthetic tests without run limits",
      "On-call scheduling with rotations and escalations",
      "Complete incident management workflow",
      "Status pages with unlimited subscribers",
      "Faster check frequencies (1 second minimum)",
      "Self-hosting option available",
    ],
    competitorPricingTiers: [
      {
        name: "Hobby",
        price: "$0",
        period: "/month",
        features: [
          "10 uptime monitors",
          "1K browser checks/month",
          "10K API checks/month",
          "4 global locations",
        ],
        limitations: [
          "Very limited checks",
          "2-minute minimum frequency",
          "No on-call",
          "No incident management",
        ],
      },
      {
        name: "Starter",
        price: "$24",
        period: "/month",
        features: [
          "50 monitors",
          "3K browser checks/month",
          "25K API checks/month",
          "4 locations",
          "1-minute frequency",
        ],
        limitations: [
          "Limited check runs",
          "No visual testing",
          "Still no on-call",
          "Basic alerting only",
        ],
      },
      {
        name: "Team",
        price: "$64",
        period: "/month",
        features: [
          "75 monitors",
          "12K browser checks/month",
          "100K API checks/month",
          "22 locations",
          "Visual regression testing",
        ],
        limitations: [
          "Check run limits still apply",
          "No on-call scheduling",
          "No incident management",
          "Per-run overages",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Custom limits",
          "1-second frequency",
          "Private locations",
          "Advanced features",
        ],
        limitations: [
          "Requires sales contact",
          "Still no on-call",
          "Still no incidents",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Dev team needing synthetic monitoring plus on-call",
        competitorSolution: "Checkly Team + PagerDuty + StatusPage",
        competitorCost: "$64 + $210 + $99 = $373/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "E-commerce site with critical user flows",
        competitorSolution: "Checkly Enterprise + on-call + incidents",
        competitorCost: "$200+ + $400 + $300 = $900+/month",
        oneuptimeSolution: "OneUptime with synthetic monitoring",
        oneuptimeCost: "$0-299/month",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Checkly?",
        answer:
          "Checkly excels at developer-focused synthetic monitoring with great Playwright integration and CI/CD support. It's a specialized testing tool. OneUptime provides synthetic monitoring plus the complete incident lifecycle: on-call scheduling, incident management, and status pages. If you only need synthetic tests for your CI pipeline, Checkly is excellent. If you need to actually respond to incidents and communicate with customers, OneUptime provides the complete solution.",
      },
      {
        question: "Does OneUptime have Playwright support like Checkly?",
        answer:
          "OneUptime supports synthetic browser tests for monitoring user flows. Checkly has deeper Playwright integration specifically designed for test-as-code workflows. If Playwright scripting in your IDE is essential, Checkly has an edge there. OneUptime focuses on reliable monitoring with easier configuration for common use cases.",
      },
      {
        question: "What about Checkly's Terraform provider?",
        answer:
          "Checkly has strong infrastructure-as-code support. OneUptime provides API and webhook-based automation. For teams deeply invested in Terraform-managed monitoring, Checkly integrates well. OneUptime's approach works well with any automation tool via our REST API.",
      },
      {
        question: "How do check limits compare?",
        answer:
          "Checkly limits browser checks (1K-12K/month) and API checks (10K-100K/month) based on plan. OneUptime doesn't limit check runs - monitor as frequently as needed without counting. This makes OneUptime more predictable for high-frequency monitoring needs.",
      },
    ],
    keyDifferences: [
      {
        title: "On-Call Scheduling",
        description: "Full rotation and escalation support - Checkly has none",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Complete workflow with timelines - not available in Checkly",
        icon: "incident",
      },
      {
        title: "Status Pages",
        description:
          "Unlimited subscriber status pages - basic only in Checkly",
        icon: "status-page",
      },
      {
        title: "No Check Limits",
        description: "Unlimited check runs vs Checkly's monthly quotas",
        icon: "unlimited",
      },
      {
        title: "Complete Platform",
        description: "Detection + Response + Communication in one tool",
        icon: "unified",
      },
      {
        title: "Self-Hosting Option",
        description: "Run on your infrastructure - Checkly is SaaS-only",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "Synthetic Monitoring",
        data: [
          {
            title: "Browser Checks",
            description: "Headless browser tests",
            productColumn: "1K-12K/month limited",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "API Checks",
            description: "HTTP API monitoring",
            productColumn: "10K-100K/month limited",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Multi-Step Tests",
            description: "Transaction monitoring",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Check Frequency",
            description: "Minimum interval",
            productColumn: "1min (Starter), 30sec (Team)",
            oneuptimeColumn: "1 second",
          },
          {
            title: "Global Locations",
            description: "Probe locations",
            productColumn: "4-22 based on plan",
            oneuptimeColumn: "7+ included",
          },
        ],
      },
      {
        name: "Developer Features",
        data: [
          {
            title: "Playwright Integration",
            description: "Native Playwright support",
            productColumn: "tick",
            oneuptimeColumn: "Browser testing supported",
          },
          {
            title: "Terraform Provider",
            description: "Infrastructure as code",
            productColumn: "tick",
            oneuptimeColumn: "API-based automation",
          },
          {
            title: "CI/CD Integration",
            description: "Pipeline integration",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Incidents",
        data: [
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Management",
            description: "Full workflow",
            productColumn: "Not included",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS/Phone Alerts",
            description: "Voice and text alerts",
            productColumn: "Via integrations",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "Basic via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "Via integration",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "Self-Hosting",
            description: "On-premises option",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "API Access",
            description: "REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  "incident.io": {
    productName: "Incident.io",
    iconUrl: "/img/incident-io.svg",
    price: "",
    productDescription:
      "Incident.io is a modern, beautifully designed incident management tool that excels at Slack-native incident response. It provides excellent coordination features for teams during incidents with a polished user experience.",
    oneUptimeDescription:
      "OneUptime provides complete incident management plus integrated monitoring, status pages, and on-call scheduling. The full incident lifecycle from detection to resolution in one platform.",
    oneuptimePrice: "",
    tagline:
      "Complete incident lifecycle platform vs incident response specialist",
    competitorFocus:
      "Modern, beautifully designed incident response with excellent Slack integration - monitoring and status pages require separate tools",
    oneuptimeFocus:
      "Full incident lifecycle: Detection (Monitoring) + Response (On-Call + Incidents) + Communication (Status Pages)",
    annualSavings: "",
    lastUpdated: "January 2025",
    description:
      "Incident.io is a modern, beautifully designed incident management tool that excels at Slack-native incident response. It's excellent for coordinating teams during incidents. However, it focuses on incident response - monitoring (to detect incidents) and status pages (to communicate with customers) require separate tools.",
    descriptionLine2:
      "Excellent incident response is part of the equation. Complete reliability also needs detection (monitoring) and customer communication (status pages).",
    migrationBenefits: [
      "Add integrated monitoring for incident detection",
      "Add status pages for customer communication",
      "On-call scheduling built into the same platform",
      "Scale your team without per-user concerns",
      "Slack and Microsoft Teams included on all plans",
      "Complete incident lifecycle in one unified platform",
    ],
    competitorPricingTiers: [
      {
        name: "Basic",
        price: "$0",
        period: "/forever",
        features: [
          "Slack-native incidents",
          "Single team on-call (limited)",
          "Basic status page",
          "Essential automation",
        ],
        limitations: [
          "Slack only",
          "Very limited on-call",
          "Basic features only",
          "No custom workflows",
        ],
      },
      {
        name: "Team",
        price: "$15-19",
        period: "/user/month",
        features: [
          "All Basic features",
          "3 workflows",
          "3 custom fields",
          "AI and automation",
          "On-call add-on available (+$10/user)",
        ],
        limitations: [
          "Slack only",
          "Limited workflows",
          "On-call costs extra",
          "No private incidents",
        ],
      },
      {
        name: "Pro",
        price: "$25",
        period: "/user/month",
        features: [
          "All Team features",
          "Unlimited workflows",
          "Unlimited custom fields",
          "Microsoft Teams support",
          "Private incidents",
          "On-call add-on available (+$20/user)",
        ],
        limitations: [
          "On-call still costs extra",
          "No monitoring",
          "No status pages (beyond basic)",
          "Per-user pricing",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "All Pro features",
          "Customer success manager",
          "Advanced access control",
          "Multiple environments",
          "Phone support",
        ],
        limitations: [
          "Requires sales contact",
          "Still no monitoring",
          "Still no status pages",
        ],
      },
    ],
    useCases: [
      {
        scenario: "10-person engineering team with on-call",
        competitorSolution:
          "Incident.io Pro + On-call add-on + Monitoring + Status Page",
        competitorCost: "$250 + $200 + $150 + $99 = $699/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario: "25-person team with multiple environments",
        competitorSolution:
          "Incident.io Enterprise + on-call + monitoring + status pages",
        competitorCost: "$1,000+ + $500 + $200 + $99 = $1,799+/month",
        oneuptimeSolution: "OneUptime with unlimited users",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Startup needing Slack-based incident response",
        competitorSolution: "Incident.io Team + on-call + basic monitoring",
        competitorCost: "$150 + $100 + $50 = $300/month",
        oneuptimeSolution: "OneUptime with Slack integration",
        oneuptimeCost: "$0/month (Free tier)",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Incident.io?",
        answer:
          "Incident.io excels at Slack-native incident management - it's beautifully designed for coordinating incident response. However, it's only one piece of the puzzle. You still need monitoring tools to detect incidents (Incident.io doesn't monitor anything), status pages to communicate with customers, and on-call is a paid add-on ($10-20/user/month extra). OneUptime provides complete incident lifecycle management: monitoring detects issues, on-call alerts the right people, incident management coordinates response, and status pages keep customers informed - all in one platform.",
      },
      {
        question: "Does OneUptime work with Slack like Incident.io?",
        answer:
          "Yes! OneUptime has native Slack integration for incident management. You can create, acknowledge, update, and resolve incidents directly from Slack. We also support Microsoft Teams on all plans - Incident.io requires the $25/user Pro plan for Teams. The difference is OneUptime's Slack integration is part of a complete platform, not the entire product.",
      },
      {
        question: "What about Incident.io's AI features?",
        answer:
          "Incident.io has invested heavily in AI-powered features for incident response. OneUptime focuses on practical automation and intelligent alerting rather than AI marketing. We provide automatic incident creation from monitors, smart alert deduplication, and workflow automation. For most teams, this covers the key use cases without the premium pricing.",
      },
      {
        question: "How do postmortems compare?",
        answer:
          "Both platforms support structured post-incident reviews with timelines and action items. Incident.io has a polished postmortem experience. OneUptime provides comparable functionality plus the ability to publish postmortems directly to your status page for customer transparency - something Incident.io can't do since it doesn't have status pages.",
      },
      {
        question: "Is on-call included in OneUptime?",
        answer:
          "Yes, full on-call scheduling with rotation schedules, escalation policies, and multi-channel alerts is included in OneUptime on all plans. Incident.io charges on-call as an add-on: +$10/user/month on Team, +$20/user/month on Pro. For a 10-person team, that's an extra $100-200/month just for on-call.",
      },
      {
        question: "What about private incidents?",
        answer:
          "OneUptime supports private incidents on all plans. Incident.io restricts private incidents to the Pro plan ($25/user/month). This is important for security incidents or HR-related issues that shouldn't be visible to everyone.",
      },
      {
        question: "Why choose OneUptime over Incident.io?",
        answer:
          "Choose OneUptime if you want a complete solution without assembling 4 different tools. With Incident.io, you still need: monitoring ($50-200/mo), status pages ($29-399/mo), and on-call is an add-on ($100-200/mo for 10 users). That's $179-799/month in additional tools on top of Incident.io's per-user pricing. OneUptime includes everything - monitoring, status pages, on-call, AND incident management - without per-user pricing.",
      },
    ],
    keyDifferences: [
      {
        title: "Built-in Monitoring",
        description:
          "Detect incidents automatically - Incident.io has zero monitoring capabilities",
        icon: "monitoring",
      },
      {
        title: "Included Status Pages",
        description:
          "Communicate with customers during incidents - not available in Incident.io",
        icon: "status-page",
      },
      {
        title: "On-Call Included",
        description:
          "Full on-call scheduling included - Incident.io charges +$10-20/user extra",
        icon: "on-call",
      },
      {
        title: "No Per-User Pricing",
        description:
          "Add team members without cost scaling - Incident.io charges per user",
        icon: "savings",
      },
      {
        title: "Complete Lifecycle",
        description:
          "Detection, Response, Communication, Learning - all in one platform",
        icon: "unified",
      },
      {
        title: "Teams on All Plans",
        description:
          "Microsoft Teams included free - Incident.io requires $25/user Pro plan",
        icon: "teams",
      },
    ],
    items: [
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Creation",
            description: "Create incidents manually or automatically",
            productColumn: "Manual + limited triggers",
            oneuptimeColumn: "Manual + automatic from monitors",
          },
          {
            title: "Slack Integration",
            description: "Manage incidents from Slack",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Microsoft Teams",
            description: "Manage incidents from Teams",
            productColumn: "Pro plan ($25/user)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Severity",
            description: "Categorize by impact level",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Timeline",
            description: "Automatic event history",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Roles",
            description: "Commander, communications, etc.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Incidents",
            description: "Restricted visibility incidents",
            productColumn: "Pro plan only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Fields",
            description: "Add custom incident data",
            productColumn: "3 (Team), unlimited (Pro)",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Workflows/Automation",
            description: "Automated incident actions",
            productColumn: "3 (Team), unlimited (Pro)",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Post-Incident",
        data: [
          {
            title: "Postmortem Templates",
            description: "Structured review documents",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Item Tracking",
            description: "Follow-up task management",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Analytics",
            description: "MTTR, frequency metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Learning Reviews",
            description: "Blameless retrospectives",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Public Postmortem",
            description: "Publish to status page",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Trend Analysis",
            description: "Incident patterns over time",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "+$10-20/user add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "+$10-20/user add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS Alerts",
            description: "Text message notifications",
            productColumn: "Add-on required",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone Call Alerts",
            description: "Voice call notifications",
            productColumn: "Add-on required",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push Notifications",
            description: "Mobile app alerts",
            productColumn: "Add-on required",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert Deduplication",
            description: "Reduce noise",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert Routing",
            description: "Route to right team",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring & Detection",
        data: [
          {
            title: "Uptime Monitoring",
            description: "Website/API availability",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "Endpoint health checks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server Monitoring",
            description: "Infrastructure metrics",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Monitoring",
            description: "Certificate expiration",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic Monitoring",
            description: "Transaction testing",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Auto-Incident Creation",
            description: "Create incidents from monitors",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "Basic only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Page",
            description: "Internal dashboards",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned work",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic Updates",
            description: "Update from monitors",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform",
        data: [
          {
            title: "API Access",
            description: "REST API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Webhooks",
            description: "Event integrations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-Hosting",
            description: "On-premises deployment",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise SSO",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit Logs",
            description: "Activity tracking",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
  signoz: {
    productName: "SigNoz",
    iconUrl: "/img/signoz.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability vs open-source APM platform",
    competitorFocus:
      "Excellent open-source APM platform with logs, metrics, and traces built on ClickHouse - focuses on observability data",
    oneuptimeFocus:
      "Complete platform with monitoring, status pages, on-call, incident management, plus logs, metrics, and traces",
    annualSavings: "",
    lastUpdated: "January 2025",
    productDescription:
      "SigNoz is an excellent open-source observability platform focused on logs, metrics, and traces. Built on ClickHouse for high performance with a self-hosted community edition available. It's a strong alternative to proprietary APM tools with transparent, open-source development.",
    oneUptimeDescription:
      "OneUptime provides complete observability with monitoring, on-call scheduling, incident management, and unlimited status pages, plus logs, metrics, and traces. Both self-hosting and cloud options available.",
    description:
      "SigNoz is an excellent open-source observability platform focused on logs, metrics, and traces. Built on ClickHouse for high performance, it's a great alternative to proprietary APM tools. However, SigNoz focuses on observability data - on-call scheduling, incident management, and customer-facing status pages require additional tools.",
    descriptionLine2:
      "Excellent for APM and observability data. OneUptime adds on-call, incidents, and status pages for complete incident lifecycle management.",
    migrationBenefits: [
      "Add on-call scheduling with rotations and escalations",
      "Add incident management workflow",
      "Add customer-facing status pages",
      "Predictable pricing you can plan around",
      "Both platforms offer self-hosting options",
      "Both platforms are open source with transparent development",
    ],
    competitorPricingTiers: [
      {
        name: "Community",
        price: "$0",
        period: "/self-hosted",
        features: [
          "Full feature set",
          "Self-managed deployment",
          "Unlimited data (your storage)",
          "Community support",
        ],
        limitations: [
          "Self-hosting required",
          "No managed support",
          "You manage infrastructure",
          "No on-call or incidents",
        ],
      },
      {
        name: "Teams",
        price: "$49",
        period: "/month + usage",
        features: [
          "163GB logs/traces included",
          "490M metric samples included",
          "Unlimited teammates",
          "SOC2 Type II compliant",
          "Multi-region (US, EU, India)",
          "Chat and email support",
        ],
        limitations: [
          "Usage-based after included quota",
          "$0.30/GB logs and traces",
          "$0.10/million metrics",
          "No on-call scheduling",
        ],
      },
      {
        name: "Enterprise",
        price: "$4,000+",
        period: "/month custom",
        features: [
          "Custom data volumes",
          "SSO/SAML",
          "Dedicated support",
          "Custom retention",
          "SLA guarantees",
        ],
        limitations: [
          "Minimum $4,000/month",
          "Sales contact required",
          "Still no on-call",
          "Still no incident management",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Dev team needing APM plus on-call and status pages",
        competitorSolution: "SigNoz Teams + PagerDuty + StatusPage",
        competitorCost: "$49 + $210 + $99 = $358/month + usage",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "Growing startup with 500GB/month logs",
        competitorSolution: "SigNoz Teams with usage overage",
        competitorCost: "$49 + (337GB × $0.30) = $150/month for logs alone",
        oneuptimeSolution: "OneUptime with log management",
        oneuptimeCost: "$0-99/month",
      },
      {
        scenario: "Enterprise with full observability stack",
        competitorSolution: "SigNoz Enterprise + on-call + status pages",
        competitorCost: "$4,000+ + $500 + $400 = $4,900+/month",
        oneuptimeSolution: "OneUptime Enterprise with everything",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to SigNoz?",
        answer:
          "SigNoz excels at APM with logs, metrics, and traces in a unified platform. It's an excellent open-source Datadog alternative with transparent usage-based pricing. OneUptime focuses on the complete incident lifecycle: monitoring to detect issues, on-call to notify the right people, incident management to coordinate response, and status pages to communicate with customers. If you need deep APM with traces and custom metrics, SigNoz is excellent. If you need the complete reliability stack, OneUptime provides monitoring plus on-call, incidents, and status pages.",
      },
      {
        question: "Is SigNoz really open source like OneUptime?",
        answer:
          "Yes, both are genuinely open source. SigNoz uses AGPL-3.0 license and focuses on observability data (logs, metrics, traces). OneUptime uses Apache 2.0 license and focuses on the incident lifecycle (monitoring, on-call, incidents, status pages). Both can be self-hosted. They solve different but complementary problems.",
      },
      {
        question: "What about SigNoz's usage-based pricing?",
        answer:
          "SigNoz charges $0.30/GB for logs and traces, $0.10/million metric samples after the included quota. This is transparent but can be unpredictable for high-volume use cases. OneUptime uses predictable tier-based pricing without per-GB or per-sample charges. For teams with variable or high log volumes, OneUptime's pricing is more predictable.",
      },
      {
        question: "Can I use SigNoz and OneUptime together?",
        answer:
          "Yes! They're complementary. Use SigNoz for deep APM, distributed tracing, and log analysis. Use OneUptime for uptime monitoring, on-call scheduling, incident management, and customer-facing status pages. SigNoz can alert to OneUptime via webhooks for a complete solution.",
      },
    ],
    keyDifferences: [
      {
        title: "On-Call Scheduling",
        description: "Full rotation and escalation support - not in SigNoz",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Complete workflow with timelines - not available in SigNoz",
        icon: "incident",
      },
      {
        title: "Status Pages",
        description: "Unlimited subscriber status pages - not in SigNoz",
        icon: "status-page",
      },
      {
        title: "Predictable Pricing",
        description: "No usage-based surprises vs SigNoz per-GB/sample costs",
        icon: "pricing",
      },
      {
        title: "Uptime Monitoring",
        description: "HTTP, TCP, UDP monitoring - SigNoz focuses on APM",
        icon: "monitoring",
      },
      {
        title: "Apache 2.0 License",
        description: "More permissive than SigNoz's AGPL-3.0",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "Observability Data",
        data: [
          {
            title: "Logs Management",
            description: "Centralized logging",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Time-series metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed Traces",
            description: "Request tracing",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "APM",
            description: "Application performance",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Dashboards",
            description: "Build your own views",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Uptime Monitoring",
        data: [
          {
            title: "HTTP Monitoring",
            description: "Website and API checks",
            productColumn: "Via synthetic tests",
            oneuptimeColumn: "tick",
          },
          {
            title: "TCP/UDP Monitoring",
            description: "Port and protocol checks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global Probes",
            description: "Multi-region monitoring",
            productColumn: "Limited",
            oneuptimeColumn: "7+ locations",
          },
          {
            title: "SSL Monitoring",
            description: "Certificate expiry alerts",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Incidents",
        data: [
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Management",
            description: "Full workflow",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS/Phone Alerts",
            description: "Voice and text alerts",
            productColumn: "Via integrations",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert Rules",
            description: "Condition-based alerting",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public Status Page",
            description: "Customer-facing status",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Planned downtime notices",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Self-Hosting",
            description: "On-premises option",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Open Source",
            description: "Transparent code",
            productColumn: "AGPL-3.0",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "Pricing Model",
            description: "How you pay",
            productColumn: "Usage-based (per GB/sample)",
            oneuptimeColumn: "Predictable tiers",
          },
          {
            title: "SOC 2 Compliant",
            description: "Security compliance",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
  },
};

export const getProductCompareSlugs: () => Array<string> =
  (): Array<string> => {
    return Object.keys(products);
  };

const ProductCompare: (product: string) => Product = (
  product: string,
): Product => {
  return products[product] as Product;
};

export default ProductCompare;
