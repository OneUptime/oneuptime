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
    tagline:
      "One complete platform vs a single-purpose alerting tool with add-ons",
    competitorFocus:
      "Specialized in on-call alerting and incident response, requiring separate monitoring, status page, and AIOps tools bought as add-ons or integrations.",
    oneuptimeFocus:
      "A complete observability platform with monitoring, status pages, on-call, incident management, and telemetry unified in one solution.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "PagerDuty is the market-leading on-call scheduling and incident response platform, trusted by many enterprises for reliable alerting. It operates as an alerting hub, so teams typically integrate separate monitoring solutions and buy add-ons like status pages, AIOps, and live call routing to build a complete incident response system.",
    oneUptimeDescription:
      "OneUptime brings together monitoring, status pages, on-call scheduling, incident management, logs, metrics, and traces in a single open-source platform. Everything works together natively, reducing context switching, tool sprawl, and unpredictable add-on costs.",
    description:
      "PagerDuty is the market leader in incident management and on-call scheduling, trusted by many enterprises. However, it is primarily an alerting tool priced per user, and a complete setup requires separate monitoring integrations plus paid add-ons for status pages, AIOps, and live call routing. OneUptime provides a complete, unified observability platform where monitoring, status pages, on-call, and incidents all work together natively at flat, predictable pricing.",
    descriptionLine2:
      "Simplify your reliability stack. Get monitoring, status pages, on-call, and incident management working together in one platform, without per-seat pricing or surprise add-ons.",
    migrationBenefits: [
      "Import existing on-call schedules and escalation policies seamlessly",
      "Webhooks and REST API enable gradual migration without disruption",
      "Run both platforms in parallel while your team adapts",
      "Consolidate monitoring, alerting, status pages, and AIOps into one tool",
      "Escape per-user pricing and stacked add-on fees with flat, predictable costs",
      "Gain unified visibility across your entire infrastructure in one dashboard",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "Up to 5 users",
          "100 international SMS/phone notifications per month",
          "1 on-call schedule",
          "1 escalation policy",
          "750+ monitoring and chat integrations",
        ],
        limitations: [
          "Very limited notifications",
          "Single schedule only",
          "No status pages or add-ons",
          "No advanced features",
        ],
      },
      {
        name: "Professional",
        price: "$21",
        period: "/user/month (annual)",
        features: [
          "Unlimited notifications",
          "Multiple on-call schedules",
          "750+ integrations",
          "Status pages add-on (250 subscribers)",
          "SSO included",
          "1,000 AI Actions (PagerDuty Advance)",
        ],
        limitations: [
          "Status pages, AIOps, and call routing are paid add-ons",
          "Limited status page subscribers",
          "Basic chat features only",
          "Per-user pricing scales with headcount",
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
          "Status pages add-on (500 subscribers)",
          "Advanced ITSM integrations",
          "5,000 AI Actions (PagerDuty Advance)",
        ],
        limitations: [
          "Still limited status page subscribers",
          "AIOps add-on adds $799/mo",
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
          "Premium status pages included",
          "Live call routing included",
          "Unlimited schedules and escalations",
          "20,000 AI Actions (PagerDuty Advance)",
        ],
        limitations: [
          "Requires sales contact",
          "Minimum contract requirements",
          "AIOps still a paid add-on",
          "Complex procurement process",
        ],
      },
    ],
    useCases: [
      {
        scenario: "10-person engineering team with basic on-call",
        competitorSolution: "PagerDuty Professional + external monitoring",
        competitorCost: "$210/month + ~$100/month monitoring = ~$310/month",
        oneuptimeSolution: "OneUptime with built-in monitoring and on-call",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario: "25-person team with status pages and incident management",
        competitorSolution:
          "PagerDuty Business + status pages add-on + monitoring",
        competitorCost:
          "$1,025/month + $89/month + ~$200/month = ~$1,314/month",
        oneuptimeSolution:
          "OneUptime with unlimited status pages and subscribers",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Enterprise with 100 engineers, AIOps and stakeholder access",
        competitorSolution:
          "PagerDuty Enterprise + AIOps + stakeholder licenses",
        competitorCost: "$5,000+/month + $799/month AIOps + add-ons",
        oneuptimeSolution: "OneUptime Enterprise with unlimited users",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    keyDifferences: [
      {
        title: "Native Monitoring",
        description:
          "Monitor websites, APIs, servers, and containers directly, with no need to integrate external monitoring tools.",
        icon: "monitoring",
      },
      {
        title: "Integrated Status Pages",
        description:
          "Public and private status pages that automatically update from your monitors and incidents, with no per-subscriber add-on fee.",
        icon: "status-page",
      },
      {
        title: "Scale Your Team Freely",
        description:
          "Add team members as your organization grows without per-seat pricing that climbs with every hire.",
        icon: "subscribers",
      },
      {
        title: "Unified Platform",
        description:
          "One dashboard for monitoring, alerting, incidents, and communication, with no more tool sprawl.",
        icon: "unified",
      },
      {
        title: "Open Source & Self-Hostable",
        description:
          "Apache 2.0 licensed, with full transparency, self-hosting on your infrastructure, and zero vendor lock-in.",
        icon: "open-source",
      },
      {
        title: "Complete Out of the Box",
        description:
          "Every feature is included in the platform, with no AIOps, status page, or call-routing add-ons to purchase separately.",
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
            productColumn: "AIOps add-on ($799/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Live Call Routing",
            description: "Route customer calls to on-call responders",
            productColumn: "Add-on / Enterprise",
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
            productColumn: "Add-on ($89/mo)",
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
    faq: [
      {
        question: "How does OneUptime compare to PagerDuty?",
        answer:
          "PagerDuty excels at on-call scheduling and incident response, but it is primarily an alerting hub that requires external tools for monitoring and paid add-ons for status pages, AIOps, and live call routing. OneUptime is a complete observability platform with native monitoring, status pages, on-call scheduling, incident management, logs, metrics, and traces, all working together in one unified interface. This means less context switching, simpler workflows, and a single source of truth for your team.",
      },
      {
        question: "What about PagerDuty's 750+ integrations?",
        answer:
          "PagerDuty's integrations primarily connect external monitoring tools to their alerting system. OneUptime has built-in monitoring for websites, APIs, servers, and containers, which means many of those integrations become unnecessary. We still offer extensive connectivity via native Slack and Teams support, webhooks, a full REST API, and 2000+ connections through Zapier. The key difference is our integrations enhance workflows rather than fill functionality gaps.",
      },
      {
        question: "What are the benefits of a unified platform?",
        answer:
          "With a unified platform like OneUptime, your team gets a single dashboard for all observability needs. Alerts automatically link to relevant logs and metrics. Status pages update based on real incident data. On-call engineers have full context without jumping between tools. This reduces mean time to resolution and eliminates the complexity and cost of maintaining multiple tool integrations and add-ons.",
      },
      {
        question: "Does OneUptime match PagerDuty's on-call features?",
        answer:
          "Yes. OneUptime provides comprehensive on-call capabilities: multiple rotation schedules (daily, weekly, custom), multi-level escalation policies, vacation and override management, and follow-the-sun scheduling for global teams, with alerts via SMS, phone call, email, push notifications, Slack, and Microsoft Teams. Plus, you get native monitoring and status pages that work seamlessly with your on-call workflows, with SMS and phone included rather than metered.",
      },
      {
        question: "How does OneUptime handle alert noise reduction?",
        answer:
          "OneUptime includes alert deduplication and grouping to reduce noise out of the box. Similar alerts are automatically grouped, and you can configure thresholds and conditions to prevent alert fatigue. PagerDuty charges for advanced noise reduction through its AIOps add-on, which starts around $799/month on top of per-user fees. Our approach delivers practical noise reduction without a separate paid module.",
      },
      {
        question: "Can I migrate from PagerDuty to OneUptime?",
        answer:
          "Yes. You can import existing on-call schedules and escalation policies, and OneUptime receives webhooks from any system, enabling gradual migration. Many teams run both platforms in parallel during the transition, moving monitors and integrations to OneUptime incrementally. Our support team provides migration assistance for complex setups.",
      },
      {
        question: "Is OneUptime enterprise-ready?",
        answer:
          "Absolutely. OneUptime is built on distributed, high-availability infrastructure across multiple cloud regions. We are SOC 2 Type II certified, ISO 27001 compliant, and GDPR compliant. Enterprise features include SSO/SAML, role-based access control, audit logs, and data residency options. Self-hosting is available under the Apache 2.0 license for organizations requiring complete infrastructure control.",
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
      "Specialized status page product - requires separate monitoring, alerting, and incident management tools to actually detect and respond to issues.",
    oneuptimeFocus:
      "Unified platform where status pages automatically reflect real system health from built-in monitoring, on-call, and incident management.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Statuspage provides beautiful, customizable status pages for communicating with customers during incidents. It excels at status communication but relies entirely on external tools to detect issues and manage incident response, and its pricing is tiered around subscriber count with public, private, and audience-specific pages billed separately.",
    oneUptimeDescription:
      "OneUptime combines status pages with monitoring, on-call scheduling, and incident management in a single open-source platform. Your status pages automatically update based on real system health, and incidents flow seamlessly from detection to on-call alerting to resolution to public communication.",
    description:
      "Atlassian Statuspage is a dedicated status page product that excels at customer communication during incidents. However, it operates in isolation - you need separate monitoring tools to detect issues, separate alerting to notify your team, and separate incident management for coordination. Costs also scale with subscriber count, and private and audience-specific pages are billed as additional products on top of your public page. OneUptime provides a unified platform where everything works together natively.",
    descriptionLine2:
      "Get status pages that automatically reflect your actual system health, connected to monitoring, alerting, and incident management in one platform, with unlimited subscribers.",
    migrationBenefits: [
      "Automatic status updates from integrated monitoring - no manual updates needed during an incident",
      "On-call scheduling and escalation ensure the right person responds to every incident",
      "Complete incident workflow from detection through postmortem and action items",
      "Import existing components and subscriber lists so migration is fast and low-risk",
      "Same notification channels your customers expect: email, SMS, webhook, RSS, Slack, Teams",
      "Grow your subscriber base to any size without subscriber caps or tier upgrades",
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
          "Email/Slack/Teams notifications",
        ],
        limitations: [
          "Only 100 subscribers",
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
          "Capped at 250 subscribers",
          "No SMS notifications",
          "No custom CSS/HTML",
        ],
      },
      {
        name: "Startup",
        price: "$99",
        period: "/month",
        features: [
          "1,000 subscribers",
          "10 team members",
          "SMS and webhook notifications",
          "Custom CSS",
          "10 metrics",
          "Team member SSO (Atlassian Guard)",
        ],
        limitations: [
          "Capped at 1,000 subscribers",
          "No custom HTML/JavaScript",
          "No role-based access control",
        ],
      },
      {
        name: "Business",
        price: "$399",
        period: "/month",
        features: [
          "5,000 subscribers",
          "25 team members",
          "Custom CSS/HTML/JavaScript",
          "Component subscriptions",
          "Role-based access control",
          "25 metrics",
        ],
        limitations: [
          "Capped at 5,000 subscribers",
          "Expensive for status pages alone",
          "Still no monitoring or on-call",
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
          "Capped at 25,000 subscribers",
          "$17,988/year for status pages only",
          "Still requires separate monitoring and on-call tools",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup with 500 customers needing status updates",
        competitorSolution: "Statuspage Startup + Pingdom + Opsgenie",
        competitorCost: "$99 + $50 + $100 = $249/month",
        oneuptimeSolution:
          "OneUptime with unlimited subscribers, monitoring, and on-call",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "Growing company with 10,000 status page subscribers",
        competitorSolution:
          "Statuspage Enterprise (subscriber tier) + monitoring + on-call",
        competitorCost: "$1,499 + $150 + $300 = $1,949/month",
        oneuptimeSolution:
          "OneUptime with unlimited subscribers and integrated tooling",
        oneuptimeCost: "$0-99/month + $1 per active monitor",
      },
      {
        scenario:
          "SaaS company needing audience-specific pages for enterprise clients",
        competitorSolution:
          "Statuspage audience-specific pages ($300/mo add-on) + monitoring + on-call",
        competitorCost: "$300 + $150 + $300 = $750/month",
        oneuptimeSolution:
          "OneUptime with unlimited public and private status pages",
        oneuptimeCost: "$0-99/month + $1 per active monitor",
      },
    ],
    keyDifferences: [
      {
        title: "Unlimited Subscribers",
        description:
          "Scale your status page audience freely without subscriber caps or tier upgrades",
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
          "Full incident workflow with timelines, collaboration, postmortems, and MTTR analytics",
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
            productColumn: "Add-on ($79-300+/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Limits",
            description: "Maximum status page subscribers",
            productColumn: "100-25,000 by plan",
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
            productColumn: "Startup+ ($99+)",
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
            productColumn: "Business+ ($399+)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Metrics Display",
            description: "Show real-time performance data",
            productColumn: "2-50 by plan",
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
            productColumn: "Startup+ ($99+)",
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
            productColumn: "2-50 by plan",
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
            title: "Compliance",
            description: "SOC 2 Type II, ISO 27001, GDPR",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Atlassian Statuspage?",
        answer:
          "Statuspage excels at creating beautiful status pages for customer communication. However, it operates in isolation - you need separate monitoring to detect issues, separate alerting to notify your team, and separate tools for incident management. OneUptime provides status pages as part of a complete platform where monitoring, alerting, incident management, and status communication work together seamlessly, with no subscriber caps.",
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
          "Yes, and without gating customization behind higher tiers. OneUptime status pages support custom domains with automatic SSL, custom branding (logos, colors, favicon), and custom HTML/CSS/JavaScript on every plan. You can create component groups, show historical uptime percentages, display real-time metrics, and configure exactly how much detail to share with your audience.",
      },
      {
        question: "Does OneUptime support private status pages?",
        answer:
          "Yes. OneUptime supports password-protected private status pages for internal teams and enterprise customers at no extra charge. You can create multiple status pages with different access levels - public pages for customers and private pages for internal teams or specific enterprise clients - without paying a separate per-page fee like Statuspage's private and audience-specific plans.",
      },
      {
        question: "What notification channels does OneUptime support?",
        answer:
          "OneUptime supports comprehensive notification channels: email, SMS, webhooks, RSS feeds, Slack, Microsoft Teams, and push notifications. Subscribers can choose their preferred channels, and you can configure different notification types for different incident severities. SMS is included rather than reserved for a higher-priced tier.",
      },
      {
        question: "Is OneUptime cheaper than Statuspage as I grow?",
        answer:
          "Almost always. Statuspage pricing climbs with subscriber count, from $29/mo up to $1,499/mo, and private and audience-specific pages are billed as separate add-ons. OneUptime gives you unlimited subscribers and unlimited status pages, charges a flat $1/month per active monitor with no per-check tiers, and is completely free to self-host - so your status page costs stay predictable no matter how large your audience gets.",
      },
    ],
  },
  pingdom: {
    productName: "SolarWinds Pingdom",
    iconUrl: "/img/pingdom.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete observability platform vs monitoring-only tool",
    competitorFocus:
      "Specialized in uptime and performance monitoring - requires separate tools for alerting, status pages, and incident management",
    oneuptimeFocus:
      "Unified platform where monitoring connects directly to alerting, status pages, and incident workflows",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Pingdom (owned by SolarWinds) is a veteran in the monitoring space with reliable uptime monitoring and 100+ probe locations worldwide. It focuses on synthetic monitoring and real user monitoring, but its plans are tiered by the number of uptime and advanced monitors, and it requires additional tools for incident response, on-call, and status communication.",
    oneUptimeDescription:
      "OneUptime provides monitoring from global locations at a flat $1/month per active monitor (no per-check tiers and no caps), plus unlimited free manual monitors, integrated status pages, on-call scheduling, and incident management. Monitor everything your infrastructure needs without worrying about check limits or upgrading tiers.",
    description:
      "Pingdom (now owned by SolarWinds) is one of the oldest and most reliable monitoring tools, offering uptime monitoring from 100+ probe locations. It excels at detecting outages but operates in isolation - you need additional tools for on-call scheduling, incident management, and customer-facing status pages. Its synthetic plans are gated by monitor counts, so growing coverage means jumping to a higher tier.",
    descriptionLine2:
      "Get monitoring at a flat $1/month per active monitor plus status pages, on-call scheduling, and incident management working together in one platform.",
    migrationBenefits: [
      "Monitor any number of endpoints at $1/month each with no per-check tiers",
      "Global probe network plus private probes for internal and external coverage",
      "Add on-call scheduling with rotations and escalations you didn't have before",
      "Get status pages that auto-update from monitoring with unlimited subscribers",
      "Complete incident workflow from detection to postmortem in one place",
      "Open-source and self-hostable - no vendor lock-in and free to run yourself",
    ],
    competitorPricingTiers: [
      {
        name: "Synthetic - Starter",
        price: "$15",
        period: "/month ($10 annual)",
        features: [
          "10 uptime monitors",
          "1 advanced (transaction) monitor",
          "50 SMS alerts",
          "1-minute check intervals",
          "100+ global probe locations",
        ],
        limitations: [
          "Priced per number of monitors",
          "No on-call scheduling",
          "No incident management",
          "Basic alerting only",
        ],
      },
      {
        name: "Synthetic - Standard",
        price: "$50",
        period: "/month ($40 annual)",
        features: [
          "50 uptime monitors",
          "10 advanced monitors",
          "200 SMS alerts",
          "1-minute check intervals",
          "Public status page",
        ],
        limitations: [
          "Advanced monitors capped by tier",
          "No on-call or escalation policies",
          "No incident workflow",
          "Add more monitors by upgrading",
        ],
      },
      {
        name: "Synthetic - Advanced",
        price: "$95",
        period: "/month ($76 annual)",
        features: [
          "100 uptime monitors",
          "20 advanced monitors",
          "350 SMS alerts",
          "API access",
          "Advanced alerting rules",
        ],
        limitations: [
          "Still monitoring-only",
          "No incident management",
          "No postmortems or runbooks",
          "Status page is basic",
        ],
      },
      {
        name: "Synthetic - Professional",
        price: "$249",
        period: "/month ($199 annual)",
        features: [
          "250+ uptime monitors",
          "50+ advanced monitors",
          "1,000+ SMS alerts",
          "Priority support",
          "Custom dashboards",
        ],
        limitations: [
          "Highest published tier",
          "$500+/month routes to sales",
          "Still no on-call or incidents",
          "No self-hosting option",
        ],
      },
      {
        name: "Real User Monitoring",
        price: "$10",
        period: "/month ($8 annual)",
        features: [
          "100,000 pageviews included",
          "Core Web Vitals tracking",
          "Geographic performance data",
          "Browser breakdown",
        ],
        limitations: [
          "Separate product from synthetic",
          "Priced per pageview tier",
          "No alerting included",
          "No incident workflow",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup monitoring 20 endpoints with on-call needs",
        competitorSolution:
          "Pingdom Standard + PagerDuty + Atlassian Statuspage",
        competitorCost: "$50 + $210 + $99 = $359/month",
        oneuptimeSolution:
          "OneUptime at $1/active monitor, on-call and status included",
        oneuptimeCost: "~$20/month (all included)",
      },
      {
        scenario: "Growing company with 100 monitors and RUM",
        competitorSolution: "Pingdom Advanced + RUM + PagerDuty + Statuspage",
        competitorCost: "$95 + $10 + $400 + $99 = $604+/month",
        oneuptimeSolution:
          "OneUptime with monitoring, RUM, on-call, and status included",
        oneuptimeCost: "~$100/month (all included)",
      },
      {
        scenario: "E-commerce site with synthetic transactions",
        competitorSolution:
          "Pingdom Professional (transactions) + on-call + status page",
        competitorCost: "$249 + $400 + $99 = $748+/month",
        oneuptimeSolution:
          "OneUptime with synthetic transaction monitoring included",
        oneuptimeCost: "$99-299/month (Growth tier)",
      },
    ],
    keyDifferences: [
      {
        title: "$1 Per Active Monitor",
        description:
          "Monitor every endpoint, service, and region at a flat $1/month each - no per-check tiers and no caps",
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
        title: "Open Source and Unified",
        description:
          "One Apache 2.0 platform for monitoring, alerting, status, and incidents - self-host for free",
        icon: "open-source",
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
            productColumn: "Advanced monitor add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Number of Monitors",
            description: "How many endpoints you can monitor",
            productColumn: "10-250 by tier",
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
            productColumn: "100+ (tier-based)",
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
            productColumn: "Capped by tier",
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
            productColumn: "Higher tiers",
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
    faq: [
      {
        question: "How does OneUptime compare to Pingdom?",
        answer:
          "Pingdom is a focused uptime monitoring tool with 100+ probe locations and plans tiered by monitor count ($15-$249/month for synthetic). It does basic monitoring well but lacks incident management, on-call scheduling, and robust status pages. OneUptime provides active monitors at a flat $1/month - no per-check tiers and no caps - plus unlimited free manual monitors, status pages with unlimited subscribers, on-call scheduling with escalation policies, and full incident management. You replace Pingdom plus 2-3 other tools with one platform.",
      },
      {
        question: "What types of monitoring does OneUptime support vs Pingdom?",
        answer:
          "Both support HTTP/HTTPS monitoring, SSL certificate checks, and transaction/synthetic monitoring. OneUptime additionally provides server monitoring (CPU, memory, disk), container monitoring (Docker/Kubernetes), and custom metrics without needing the separate RUM product. All OneUptime monitoring is included at no extra per-check cost, while Pingdom gates advanced monitors and pageviews behind higher tiers.",
      },
      {
        question: "How do probe locations compare?",
        answer:
          "Pingdom offers 100+ probe locations worldwide but charges based on plan tier. OneUptime provides 7+ strategically placed global locations and allows checking from all locations on every monitor without additional cost. For most use cases, our locations provide excellent coverage. We also support private probes inside your network for internal monitoring.",
      },
      {
        question: "What about Pingdom's Real User Monitoring (RUM)?",
        answer:
          "Pingdom's RUM is a separate product with per-pageview pricing starting at $10/month for 100,000 pageviews. OneUptime includes real user monitoring capabilities in our platform to track actual user experience metrics like page load time, time to first byte, and core web vitals - without separate per-pageview charges.",
      },
      {
        question: "Does OneUptime have transaction monitoring like Pingdom?",
        answer:
          "Yes. OneUptime supports multi-step synthetic monitoring to test user flows like login, checkout, or form submissions. Pingdom charges extra for these as advanced monitors, and each tier caps how many you get (1 on Starter, up to 50+ on Professional). OneUptime includes synthetic transaction monitoring without a separate add-on.",
      },
      {
        question: "What about Pingdom's status pages?",
        answer:
          "Pingdom offers a basic public status page as a feature with limited customization. OneUptime provides full-featured public and private status pages with unlimited subscribers, custom branding, custom domains, and automatic updates based on monitor status. This alone can save $100+/month compared to buying a separate status page product like Atlassian Statuspage.",
      },
      {
        question: "Why is tiered per-monitor pricing problematic?",
        answer:
          "Tier-based pricing creates perverse incentives to monitor less. With Pingdom, adding services or advanced checks can push you into the next plan tier. With OneUptime's flat $1/month per active monitor - no per-check tiers and no caps - you can monitor everything across every endpoint, region, and environment with simple, predictable costs. This leads to better coverage and faster issue detection.",
      },
    ],
  },
  datadog: {
    productName: "Datadog",
    iconUrl: "/img/datadog.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One flat-priced unified platform vs metered per-host, per-seat SKUs",
    competitorFocus:
      "Datadog is the market leader in cloud monitoring, APM, and logs, but its status pages, on-call, and incident management are separate seat-based products layered on top of per-host and per-GB metering.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, logs, metrics, traces, status pages, on-call, and incident management in one platform at a flat, predictable price.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Datadog is the industry leader in cloud monitoring, APM, and log management, with a deep observability suite and 800+ integrations. In 2025 it added native On-Call, Incident Management, and Status Pages, but each is a separate seat-based SKU stacked on top of per-host and per-GB metering, so a full deployment means juggling many priced modules.",
    oneUptimeDescription:
      "OneUptime delivers monitoring, logs, metrics, traces, status pages, on-call, and incident management in one open-source platform with flat pricing. Active monitors are a flat $1/month each, telemetry ingestion is about $0.10/GB, and every reliability feature is included instead of sold as a separate seat.",
    description:
      "Datadog is the industry leader in cloud monitoring, APM, and log management, offering deep observability with 800+ integrations. It now bundles native On-Call, Incident Management, and Status Pages, but each is metered separately - per host, per GB, and per seat - so bills grow with usage and headcount and are hard to forecast. Standing up a complete reliability stack still means stitching together and paying for several priced modules.",
    descriptionLine2:
      "OneUptime gives you monitoring, status pages, on-call, and incident management in one open-source platform at a flat, predictable price - no per-host, per-seat, or surprise per-GB bills.",
    migrationBenefits: [
      "Flat $1 per active monitor - no per-host, per-seat, or per-GB surprises",
      "Status pages with unlimited subscribers included, not a seat-based add-on",
      "Built-in on-call rotations and escalations at no extra per-seat charge",
      "Full incident management with postmortems and action items included",
      "Self-host for free under Apache 2.0 for complete data control",
      "OpenTelemetry-native ingestion for a drop-in migration path",
    ],
    competitorPricingTiers: [
      {
        name: "Infrastructure Pro",
        price: "$15",
        period: "/host/month (annual)",
        features: [
          "800+ integrations",
          "15-month metric retention",
          "Alerting and dashboards",
          "Host maps and inventory",
        ],
        limitations: [
          "Per-host pricing scales fast",
          "Billed at 99th-percentile host count",
          "No APM, logs, or status pages",
          "Enterprise tier runs $23-27/host",
        ],
      },
      {
        name: "APM Pro",
        price: "$35",
        period: "/host/month (annual, additional)",
        features: [
          "Distributed tracing",
          "Error tracking",
          "Service maps",
          "150 GB spans per host included",
        ],
        limitations: [
          "Stacks on top of Infrastructure",
          "Span overages at $1.70/M events",
          "Cannot be bought standalone",
          "On-demand runs $42/host",
        ],
      },
      {
        name: "Log Management",
        price: "$0.10/GB + $1.70/M",
        period: "ingested + indexed",
        features: [
          "Log collection and search",
          "Log patterns and analytics",
          "Flexible retention tiers",
        ],
        limitations: [
          "Costs scale with volume",
          "Indexing up to $3.75/M on-demand",
          "Bills often 2-3x initial estimates",
        ],
      },
      {
        name: "Incident Response",
        price: "$40",
        period: "/user/month (annual)",
        features: [
          "On-Call schedules and escalations",
          "Incident management and postmortems",
          "Datadog Status Pages",
          "Included SMS and phone telephony",
        ],
        limitations: [
          "Per-seat, on top of observability",
          "On-Call alone is $20/seat, Incident $30",
          "Requires paid Datadog observability",
          "Seat sprawl as teams grow",
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
          "Advanced security and compliance",
        ],
        limitations: [
          "Requires sales engagement",
          "Long annual commitments",
          "Still metered and multi-SKU",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup with 10 servers needing monitoring, APM, and on-call",
        competitorSolution:
          "Datadog Infrastructure + APM + logs + 5 Incident Response seats",
        competitorCost: "$150 + $350 + ~$150 logs + $200 = ~$850/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario:
          "Growing company with 50 servers, logs, on-call, and a status page",
        competitorSolution: "Datadog full stack + 15 Incident Response seats",
        competitorCost:
          "$750 infra + $1,750 APM + $500-1,500 logs + $600 seats = ~$3,600-4,600/month",
        oneuptimeSolution:
          "OneUptime with monitoring, status, on-call, and incidents included",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Enterprise with containers and microservices",
        competitorSolution:
          "Datadog Enterprise + on-call and incident seats across teams",
        competitorCost: "$10,000-50,000+/month",
        oneuptimeSolution: "OneUptime Enterprise or self-hosted",
        oneuptimeCost:
          "Contact for pricing (fraction of Datadog) or free self-hosted",
      },
    ],
    keyDifferences: [
      {
        title: "Predictable Flat Pricing",
        description:
          "Active monitors at a flat $1/month each - no per-host, per-seat, or 99th-percentile billing to forecast",
        icon: "pricing",
      },
      {
        title: "Everything Included",
        description:
          "Status pages, on-call, and incident management built in, not sold as separate seat-based SKUs",
        icon: "unified",
      },
      {
        title: "Unlimited Status Page Subscribers",
        description:
          "Public and private status pages with unlimited subscribers, custom domain, and free SSL included",
        icon: "subscribers",
      },
      {
        title: "On-Call Without Per-Seat Fees",
        description:
          "Rotations, escalations, and SMS/voice alerting included rather than a $20+/seat add-on",
        icon: "on-call",
      },
      {
        title: "Open Source and Self-Hostable",
        description:
          "Apache 2.0 licensed - deploy on your own infrastructure for full control and data sovereignty",
        icon: "open-source",
      },
      {
        title: "No Metering Surprises",
        description:
          "Transparent, published pricing instead of stacked per-host, per-GB, and per-seat meters",
        icon: "transparent",
      },
    ],
    items: [
      {
        name: "Monitoring Capabilities",
        data: [
          {
            title: "Infrastructure Monitoring",
            description: "Server metrics, CPU, memory, disk",
            productColumn: "$15-27/host/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "APM / Tracing",
            description: "Application performance monitoring",
            productColumn: "+$35/host/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "Log Management",
            description: "Log collection and search",
            productColumn: "$0.10/GB + indexing",
            oneuptimeColumn: "~$0.10/GB, no indexing fee",
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
            productColumn: "$5/10K API, $12/1K browser",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container Monitoring",
            description: "Docker and Kubernetes",
            productColumn: "Billed above host limit",
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
            productColumn: "Usage-based",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
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
            oneuptimeColumn: "tick",
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
            productColumn: "On-Call seat ($20/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone Call Alerts",
            description: "Voice call notifications",
            productColumn: "On-Call seat ($20/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-Call Scheduling",
            description: "Rotation schedules",
            productColumn: "$20/seat/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Escalation Policies",
            description: "Multi-level escalation",
            productColumn: "$20/seat/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push Notifications",
            description: "Mobile push alerts",
            productColumn: "On-Call seat",
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
            productColumn: "Incident Response seat",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Page",
            description: "Internal dashboards",
            productColumn: "Incident Response seat",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited Subscribers",
            description: "Email/SMS status updates",
            productColumn: "Limited",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain + Free SSL",
            description: "Your own domain and certificate",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML/CSS/JS",
            description: "Full branding control",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned work",
            productColumn: "Incident Response seat",
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
            productColumn: "$30/seat/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident Timeline",
            description: "Automatic event history",
            productColumn: "$30/seat/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident reviews",
            productColumn: "$30/seat/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack / Teams Collaboration",
            description: "Manage incidents from chat",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Item Tracking",
            description: "Follow-up tasks",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR Analytics",
            description: "Incident response metrics",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
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
            productColumn: "800+",
            oneuptimeColumn: "2000+ via Zapier + native",
          },
          {
            title: "Predictable Flat Pricing",
            description: "No per-host or per-GB metering",
            productColumn: "",
            oneuptimeColumn: "$1/active monitor",
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
            title: "SSO / SAML & RBAC",
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
          {
            title: "SOC 2 / ISO 27001 / GDPR",
            description: "Compliance certifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Datadog?",
        answer:
          "Datadog is a comprehensive observability platform with deep APM, log management, and infrastructure monitoring, and it now offers native On-Call, Incident Management, and Status Pages. The catch is that everything is metered separately: Infrastructure starts at $15/host/month, APM adds about $35/host/month, logs run $0.10/GB plus indexing, and each on-call, incident, or status-page user is a $20-40/seat/month add-on on top. A typical startup can spend $700-2,000/month once those modules stack up. OneUptime provides monitoring, status pages, on-call, and incident management in one platform with flat, predictable pricing.",
      },
      {
        question: "Can OneUptime replace Datadog for monitoring?",
        answer:
          "For most teams, yes. OneUptime covers website and API monitoring, server and container metrics, SSL and port checks, synthetic transactions, and OpenTelemetry logs, metrics, and traces. If you need Datadog's deepest APM across hundreds of microservices, Datadog may still fit. But many teams pay for Datadog features they could get elsewhere at a fraction of the cost, so we recommend evaluating your actual needs - often core monitoring plus status pages, on-call, and incidents (all in OneUptime) is more than enough.",
      },
      {
        question: "What about Datadog's 800+ integrations?",
        answer:
          "Datadog has an impressive integration library. OneUptime takes a different approach: core monitoring and telemetry are built in and OpenTelemetry-native, plus 2000+ integrations via Zapier and native webhooks. Our monitoring is designed to work out of the box without extensive configuration, and for many teams a smaller set of well-designed integrations beats integration overload and the per-integration data volume that inflates Datadog bills.",
      },
      {
        question: "How much can I save switching from Datadog?",
        answer:
          "Savings vary with usage, but they are usually large. A team with 10-20 servers on Infrastructure + APM + logs can spend $500-2,000/month, and adding Datadog On-Call ($20/seat), Incident Management ($30/seat), or the Incident Response bundle ($40/seat) pushes it higher as headcount grows. OneUptime provides monitoring, status pages, on-call, and incident management starting from $0, with active monitors at a flat $1/month each. Even at enterprise scale, teams commonly cut spend by 70-90%.",
      },
      {
        question: "Is OneUptime's monitoring as comprehensive as Datadog?",
        answer:
          "Datadog offers deeper APM, especially for high-cardinality distributed tracing across large microservice fleets. OneUptime focuses on what most teams actually need: uptime and API monitoring, server and container metrics, synthetic transactions, and OpenTelemetry logs, metrics, and traces with dashboards and error tracking. If you run hundreds of microservices and need sub-millisecond trace analysis, Datadog may be necessary. For monitoring websites, APIs, servers, and keeping customers informed during incidents, OneUptime is fully capable.",
      },
      {
        question: "Does OneUptime support logs like Datadog?",
        answer:
          "Yes. OneUptime ingests logs, metrics, and traces natively via OpenTelemetry, with search, dashboards, and exception tracking. The difference is price predictability: OneUptime telemetry ingestion is about $0.10/GB, whereas Datadog layers indexing charges (up to $3.75/million events on-demand) and 99th-percentile host billing on top, which is where bills routinely land 2-3x over estimate.",
      },
      {
        question: "Can I self-host OneUptime to control costs?",
        answer:
          "Yes. OneUptime is open source (Apache 2.0) and can be self-hosted on your own infrastructure at no license cost - you pay only for the compute you run, not per-host, per-seat, or per-GB fees. This is impossible with Datadog, which is SaaS-only. Self-hosting is ideal for teams with strict data-residency requirements or those wanting to eliminate variable cloud observability costs entirely.",
      },
    ],
  },
  newrelic: {
    productName: "New Relic",
    iconUrl: "/img/newrelic.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs an APM-focused observability tool",
    competitorFocus:
      "New Relic delivers powerful full-stack observability with deep APM, logs, and infrastructure monitoring, but leaves status pages, on-call scheduling, and incident response to separate tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, logs, metrics, traces, status pages, on-call, and incident management in a single open-source platform that works together out of the box.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "New Relic is a powerful full-stack observability platform with comprehensive APM, distributed tracing, logs, and infrastructure monitoring. It offers deep insight into application performance, but you still need separate products for status pages, on-call scheduling, and end-to-end incident management. Pricing is usage-based, combining per-full-platform-user fees with per-GB data ingestion charges.",
    oneUptimeDescription:
      "OneUptime provides complete observability and reliability with monitoring, logs, metrics, traces, status pages, on-call scheduling, and incident management in one unified platform. Everything works together without stitching multiple vendors, and it is open source (Apache 2.0) with a free self-hosted option and predictable pricing.",
    description:
      "New Relic is a powerful full-stack observability platform with comprehensive APM, distributed tracing, logs, and infrastructure monitoring. It excels at deep application insight, but it focuses purely on observability, so status pages, on-call scheduling, and full incident workflows require additional paid tools. Its usage-based pricing combines per-user fees ($99-349/full platform user) with per-GB data charges that can grow unpredictably. OneUptime brings all of these capabilities together in one platform with flat, predictable pricing.",
    descriptionLine2:
      "Get monitoring, telemetry, status pages, on-call scheduling, and incident management all working together in one open-source platform with predictable, flat pricing.",
    migrationBenefits: [
      "Add unlimited team members with no per-user fees (New Relic charges $99-349/full platform user)",
      "Predictable flat pricing you can plan around: $1 per active monitor and $0.10/GB telemetry",
      "Public and private status pages included with unlimited subscribers and automatic updates",
      "On-call rotations and multi-level escalation policies built in (no separate PagerDuty needed)",
      "Complete incident management workflow with timelines, postmortems, and MTTR analytics",
      "OpenTelemetry-native ingestion for logs, metrics, and traces makes migrating your data straightforward",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "100GB data ingest per month",
          "1 full platform user",
          "Unlimited basic users",
          "Core observability features",
        ],
        limitations: [
          "Single full platform user only",
          "8-day default data retention",
          "Community support only",
        ],
      },
      {
        name: "Standard",
        price: "$99",
        period: "/user/month",
        features: [
          "100GB data ingest included",
          "Up to 5 full platform users ($10 first user)",
          "Core users at $49/user",
          "All observability features",
          "Ticketed support",
        ],
        limitations: [
          "Capped at 5 full platform users",
          "Data overage $0.40-0.60/GB",
          "No status pages or on-call",
        ],
      },
      {
        name: "Pro",
        price: "$349",
        period: "/user/month",
        features: [
          "Everything in Standard",
          "Unlimited full platform users",
          "Priority support (2-hour critical SLA)",
          "Vulnerability management",
          "Data Plus eligibility (90-day retention)",
        ],
        limitations: [
          "Expensive per-user pricing at scale",
          "Data overage still applies ($0.40-0.60/GB)",
          "No status pages or on-call",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Custom data retention and compute",
          "HIPAA/FedRAMP eligibility",
          "1-hour critical response SLA",
          "Dedicated support",
        ],
        limitations: [
          "Requires sales engagement",
          "Annual or multi-year contracts",
          "Still usage-based pricing",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "5-person team needing full observability plus customer comms",
        competitorSolution:
          "New Relic Standard (5 users) + Atlassian Statuspage + PagerDuty",
        competitorCost: "$406 + $99 + $105 = ~$610/month",
        oneuptimeSolution:
          "OneUptime with monitoring, status pages, on-call, and incidents included",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario: "10-person engineering team sending 500GB data/month",
        competitorSolution:
          "New Relic Pro + data overages + Statuspage + PagerDuty",
        competitorCost: "$3,490 + $240 + $99 + $290 = ~$4,119/month",
        oneuptimeSolution:
          "OneUptime with unlimited users and telemetry at $0.10/GB",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Growing company with 25 engineers",
        competitorSolution: "New Relic Pro ($349/user) + supporting tools",
        competitorCost: "$8,725+/month plus data and add-on tools",
        oneuptimeSolution: "OneUptime Enterprise with everything unified",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    keyDifferences: [
      {
        title: "No Per-User Pricing",
        description:
          "Add team members without cost scaling - New Relic charges $99-349 per full platform user",
        icon: "pricing",
      },
      {
        title: "Lower Data Costs",
        description:
          "Telemetry at $0.10/GB - New Relic charges $0.40-0.60/GB in data overages",
        icon: "transparent",
      },
      {
        title: "Status Pages Included",
        description:
          "Public and private status pages with unlimited subscribers - New Relic has none",
        icon: "status-page",
      },
      {
        title: "On-Call Included",
        description:
          "Full on-call scheduling and escalations built in - requires PagerDuty alongside New Relic",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Complete incident workflow with postmortems and MTTR analytics - basic only in New Relic",
        icon: "incident",
      },
      {
        title: "Open Source & Self-Hosting",
        description:
          "Apache 2.0 licensed, run it on your own infrastructure - New Relic is SaaS-only",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "Observability & APM",
        data: [
          {
            title: "Application Performance Monitoring",
            description: "Response times, throughput, and errors",
            productColumn: "tick",
            oneuptimeColumn: "Basic APM included",
          },
          {
            title: "Distributed Tracing",
            description: "Trace requests across services",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Error & Exception Tracking",
            description: "Capture and group exceptions",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Real User Monitoring",
            description: "Browser-side real user data",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Metrics",
            description: "Custom and infra metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Log Management",
            description: "Centralized log ingestion",
            productColumn: "$0.40-0.60/GB overage",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Custom telemetry dashboards",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
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
            title: "Website & Uptime Monitoring",
            description: "Website and page availability",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API Monitoring",
            description: "REST/API endpoint checks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic Monitoring",
            description: "Multi-step transactions",
            productColumn: "Usage-based add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL Certificate Monitoring",
            description: "Certificate expiry checks",
            productColumn: "Via synthetics",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron & Heartbeat Monitoring",
            description: "Scheduled job monitoring",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container & Kubernetes",
            description: "Docker and K8s monitoring",
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
            title: "SMS & Phone Alerts",
            description: "SMS and voice call alerts",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push, Slack & Teams Alerts",
            description: "Push and chat notifications",
            productColumn: "tick",
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
          {
            title: "Overrides & Follow-the-Sun",
            description: "Vacation and global rotations",
            productColumn: "",
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
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Page",
            description: "Internal/authenticated status",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS/webhook updates",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain + SSL",
            description: "Branded status page domain",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Planned maintenance events",
            productColumn: "",
            oneuptimeColumn: "tick",
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
          {
            title: "Runbooks",
            description: "Response runbooks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "API Access",
            description: "REST and GraphQL APIs",
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
            description: "Transparent, auditable code",
            productColumn: "",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise single sign-on",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "RBAC & Audit Logs",
            description: "Access control and audit trail",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Per-User Pricing",
            description: "Fees per platform user",
            productColumn: "$99-349/user",
            oneuptimeColumn: "No per-user fees",
          },
          {
            title: "Predictable Flat Pricing",
            description: "Cost you can plan around",
            productColumn: "Usage-based",
            oneuptimeColumn: "$1/monitor/mo",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to New Relic?",
        answer:
          "New Relic is a comprehensive observability platform with excellent APM, distributed tracing, logs, and infrastructure monitoring. However, its usage-based pricing (per-user fees of $99-349/full platform user plus per-GB data charges) can make costs unpredictable. A 10-person team on Pro is $3,490/month before data charges. On top of that you need Atlassian Statuspage and PagerDuty for status pages and on-call. OneUptime provides monitoring, telemetry, status pages, on-call, and incident management together with flat, predictable pricing.",
      },
      {
        question: "Can OneUptime match New Relic's observability features?",
        answer:
          "New Relic offers deeper APM capabilities, especially code-level distributed tracing across complex, high-service-count applications and real user monitoring. OneUptime covers what most teams actually use day to day: uptime and API monitoring, server and container metrics, synthetic tests, and OpenTelemetry logs, metrics, and traces. If you need deep code-level APM across hundreds of services, New Relic may be necessary. For monitoring reliability and coordinating incident response, OneUptime is fully capable.",
      },
      {
        question: "What about New Relic's free tier?",
        answer:
          "New Relic's free tier is generous: 100GB of data ingest and one full platform user. But once you need more than one power user or exceed 100GB, costs climb quickly through per-user fees and data overages. OneUptime's free tier includes unlimited team members and unlimited free manual monitors, with telemetry at a low $0.10/GB ingested, so it scales more affordably as your team grows.",
      },
      {
        question: "How does data pricing compare?",
        answer:
          "New Relic charges $0.40/GB (Original Data) to $0.60/GB (Data Plus) after the 100GB free allotment. A team generating 500GB/month pays roughly $160-240 in overages alone, on top of user fees. OneUptime's telemetry is just $0.10/GB ingested, well below New Relic's overage rates, so the same 500GB/month costs a fraction as much and stays predictable as your infrastructure grows.",
      },
      {
        question: "Does OneUptime have APM like New Relic?",
        answer:
          "OneUptime includes application monitoring for response times, errors, exceptions, and throughput, plus OpenTelemetry-native traces. For full code-level distributed tracing and real user monitoring across very large service graphs, New Relic has deeper features. Many teams find they do not need that depth. They need to know when services degrade and be able to respond quickly, which OneUptime handles end to end.",
      },
      {
        question: "Is OneUptime open source and self-hostable?",
        answer:
          "Yes. OneUptime is fully open source under the Apache 2.0 license and can be self-hosted on your own infrastructure at no license cost, giving you complete control over your data. New Relic is SaaS-only and closed source. You can also use OneUptime's managed cloud if you prefer not to run it yourself.",
      },
      {
        question: "Can I migrate my New Relic telemetry to OneUptime?",
        answer:
          "Yes. OneUptime is OpenTelemetry-native for logs, metrics, and traces, so if you already instrument with OpenTelemetry you can point your collectors at OneUptime with minimal changes. That makes moving off New Relic straightforward without re-instrumenting your applications from scratch.",
      },
    ],
  },
  "better-uptime": {
    productName: "Better Stack (Better Uptime)",
    iconUrl: "/img/betterstack.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "Open source and unified vs a modular platform with per-responder add-on pricing",
    competitorFocus:
      "A modern monitoring, status page, incident, and telemetry platform whose bill is built from a per-responder license plus separate monitor, status page, and telemetry add-ons.",
    oneuptimeFocus:
      "One open-source, self-hostable platform that includes monitoring at a flat $1/active monitor, on-call, incidents, status pages, and telemetry with no per-responder or per-subscriber fees.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Better Stack (formerly Better Uptime) offers uptime monitoring, status pages, on-call, incident management, and log and metric telemetry in one modern, developer-friendly product. Its pricing is modular: you start free, then pay a per-responder license and layer on packs for extra monitors, status page features, and telemetry volume. The polished UX is a real strength, but costs compound as your on-call team, monitor count, and subscriber list grow.",
    oneUptimeDescription:
      "OneUptime provides monitoring at a flat $1/month per active monitor, status pages with unlimited subscribers, and full on-call scheduling and incident management included for the whole team at no extra per-person cost. It is OpenTelemetry-native for logs, metrics, and traces, and is fully open source under Apache 2.0 so you can self-host it on your own infrastructure. You get the same unified vision with transparent pricing and no vendor lock-in.",
    description:
      "Better Stack (formerly Better Uptime) and OneUptime share the same unified vision: monitoring, status pages, on-call, incidents, and telemetry in one place instead of a stack of point tools. The difference is how you pay and how much control you keep. Better Stack layers a $29-34/month per-responder license on top of add-on packs for monitors, status pages, and telemetry, so the bill scales with every engineer, subscriber, and gigabyte. OneUptime charges a flat $1/month per active monitor with on-call, incidents, and unlimited status page subscribers included, and is fully open source and self-hostable.",
    descriptionLine2:
      "Both consolidate your observability tooling into one product. OneUptime adds predictable per-monitor pricing, no per-responder or per-subscriber fees, open-source transparency, and the option to self-host.",
    migrationBenefits: [
      "Eliminate per-responder licenses - on-call and incident management for your whole team are included",
      "Predictable $1/month per active monitor with no $21-25 per-50-monitor bundles to stack",
      "Unlimited status page subscribers with no $40 per additional 1,000 metering",
      "White-label, custom-domain status pages included rather than a $208-250 per-page add-on",
      "Self-host on your own Docker or Kubernetes infrastructure for complete data control and compliance",
      "Open-source Apache 2.0 codebase you can audit, extend, and never get locked into",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "10 monitors and 10 heartbeats",
          "1 status page",
          "Slack and email alerts",
          "100,000 exceptions per month",
        ],
        limitations: [
          "Only 10 monitors and 1 status page",
          "No on-call scheduling or escalation",
          "30-second minimum check frequency",
        ],
      },
      {
        name: "Responder License",
        price: "$29-34",
        period: "/responder/month",
        features: [
          "On-call scheduling and rotations",
          "Incident management and timelines",
          "Unlimited phone and SMS alerts",
        ],
        limitations: [
          "Charged per on-call responder",
          "Required for any on-call or paging",
          "Separate from monitor and telemetry costs",
        ],
      },
      {
        name: "Additional Monitors",
        price: "$21-25",
        period: "/month per 50",
        features: [
          "Adds 50 uptime monitors per pack",
          "Same monitoring feature set",
          "30-second check frequency",
        ],
        limitations: [
          "Sold in per-50-monitor bundles",
          "Heartbeats billed separately ($17-20/10)",
          "Costs compound as you scale",
        ],
      },
      {
        name: "Status Page Add-ons",
        price: "$12-250",
        period: "/page/month",
        features: [
          "Extra public pages from $12/page",
          "Custom CSS and JavaScript from $12/page",
          "White-label, password, SSO at $208-250/page",
        ],
        limitations: [
          "Branding removal is a premium add-on",
          "Priced per status page",
          "Extra 1,000 subscribers cost $40/month",
        ],
      },
      {
        name: "Telemetry Bundles",
        price: "$25-1,750",
        period: "/month",
        features: [
          "Logs, metrics, and traces",
          "Nano to Tera volume bundles",
          "30-day default retention",
        ],
        limitations: [
          "Priced by region and data volume",
          "Separate from uptime and on-call",
          "Bundle jumps can overshoot your usage",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Small team with 30 monitors and on-call for 4 engineers",
        competitorSolution:
          "Better Stack (Free 10 + 20 extra monitors + 4 responders)",
        competitorCost: "$0 + $21 + $116 = ~$137/month",
        oneuptimeSolution:
          "OneUptime at $1/active monitor with on-call included for all 4 engineers",
        oneuptimeCost: "~$30/month",
      },
      {
        scenario:
          "SaaS company with 150 monitors, 5 responders, and a white-label status page",
        competitorSolution:
          "Better Stack (140 extra monitors + 5 responders + white-label page)",
        competitorCost: "$63 + $145 + $208 = ~$416/month",
        oneuptimeSolution:
          "OneUptime monitors + custom-domain branded status page + on-call, all included",
        oneuptimeCost: "~$150/month",
      },
      {
        scenario:
          "Scale-up with 500 monitors, 10 responders, and 10,000 status page subscribers",
        competitorSolution:
          "Better Stack (490 extra monitors + 10 responders + 10k subscribers)",
        competitorCost: "$210 + $290 + $400 = ~$900/month",
        oneuptimeSolution:
          "OneUptime with unlimited subscribers and unlimited responders included",
        oneuptimeCost: "~$500/month",
      },
    ],
    keyDifferences: [
      {
        title: "$1 Per Active Monitor",
        description:
          "Flat $1/month per active monitor - Better Stack sells monitors in $21-25 per-50 packs",
        icon: "unlimited",
      },
      {
        title: "No Responder Licenses",
        description:
          "On-call and incidents included - Better Stack charges $29-34/month per responder",
        icon: "on-call",
      },
      {
        title: "Unlimited Subscribers",
        description:
          "Unlimited status page subscribers - Better Stack meters $40 per additional 1,000",
        icon: "subscribers",
      },
      {
        title: "Self-Hosting Option",
        description:
          "Run on your own Docker or Kubernetes infrastructure for complete control",
        icon: "open-source",
      },
      {
        title: "Open Source",
        description:
          "Apache 2.0 licensed and fully auditable - Better Stack is closed-source SaaS",
        icon: "transparent",
      },
      {
        title: "Simpler Pricing",
        description:
          "No stacking monitor packs, responder seats, and telemetry bundles to model your bill",
        icon: "pricing",
      },
    ],
    items: [
      {
        name: "Monitoring",
        data: [
          {
            title: "Number of Monitors",
            description: "How many checks included",
            productColumn: "10 free, +$21-25/50",
            oneuptimeColumn: "$1/active monitor",
          },
          {
            title: "Check Frequency",
            description: "How often monitors run",
            productColumn: "30 seconds minimum",
            oneuptimeColumn: "1 second minimum",
          },
          {
            title: "HTTP and Website Monitoring",
            description: "Website and URL availability",
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
            title: "SSL Certificate Monitoring",
            description: "Certificate expiration",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and Infra Monitoring",
            description: "CPU, memory, disk",
            productColumn: "Via telemetry add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and Transaction",
            description: "Multi-step browser flows",
            productColumn: "$1/100 Playwright min",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and Heartbeat Monitoring",
            description: "Background job checks",
            productColumn: "10 free, +$17-20/10",
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
            productColumn: "Responder ($29-34/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone and SMS Alerts",
            description: "Voice and text alerts",
            productColumn: "Responder ($29-34/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-Level Escalation",
            description: "Escalation policies",
            productColumn: "Responder license",
            oneuptimeColumn: "tick",
          },
          {
            title: "Rotations and Overrides",
            description: "Vacation and follow-the-sun",
            productColumn: "Responder license",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack Integration",
            description: "Alert and act in Slack",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Microsoft Teams",
            description: "Alert and act in Teams",
            productColumn: "$9/responder/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push Notifications",
            description: "Mobile push alerts",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Timelines",
            description: "Chronological event log",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities",
            description: "Classify incident impact",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident reviews",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Item Tracking",
            description: "Follow-up task tracking",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Documented response steps",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams Collaboration",
            description: "Coordinate response in chat",
            productColumn: "$9/responder/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR Analytics",
            description: "Response time reporting",
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
            title: "Private Status Page",
            description: "Internal or gated status",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Domain and SSL",
            description: "Your own domain",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom CSS and JavaScript",
            description: "Full styling control",
            productColumn: "$12-15/page/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "White-Label Branding",
            description: "Remove vendor branding",
            productColumn: "$208-250/page/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email, SMS, webhook, RSS updates",
            productColumn: "$40/1,000 subs",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Scheduled Maintenance",
            description: "Announce planned work",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multiple Status Pages",
            description: "Add more pages",
            productColumn: "$12-15/page/mo",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry & Observability",
        data: [
          {
            title: "Log Management",
            description: "Centralized logs",
            productColumn: "Telemetry bundle",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Time-series metrics",
            productColumn: "Telemetry bundle",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed Traces",
            description: "Request tracing",
            productColumn: "Telemetry bundle",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry Native",
            description: "Standard OTel ingestion",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Dashboards",
            description: "Build your own views",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and Error Tracking",
            description: "Capture app errors",
            productColumn: "100k free, then paid",
            oneuptimeColumn: "tick",
          },
          {
            title: "Telemetry Pricing",
            description: "How ingestion is billed",
            productColumn: "$25-1,750/mo bundles",
            oneuptimeColumn: "~$0.10/GB",
          },
        ],
      },
      {
        name: "Platform & Pricing",
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
            title: "REST API",
            description: "Programmatic access",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Native Webhooks",
            description: "Event callbacks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO and SAML",
            description: "Enterprise sign-on",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit Logs",
            description: "Track account activity",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "Pricing Model",
            description: "How the bill is built",
            productColumn: "Per-responder + packs",
            oneuptimeColumn: "$1/active monitor",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Better Stack (Better Uptime)?",
        answer:
          "Better Stack (formerly Better Uptime) and OneUptime share a similar vision of unified observability. Both provide monitoring, status pages, incident management, and telemetry in one platform. The key differences are pricing and openness: Better Stack charges a $29-34/month per-responder license plus add-on packs for monitors ($21-25 per 50), status page features, and telemetry, while OneUptime offers simple usage-based pricing at $1/month per active monitor with on-call, incidents, and unlimited status page subscribers included. OneUptime is also fully open source under Apache 2.0 with self-hosting options, giving you complete control over your data and infrastructure.",
      },
      {
        question: "What is Better Uptime and why did it become Better Stack?",
        answer:
          "Better Uptime was a popular monitoring and status page tool that rebranded to Better Stack in 2023 to reflect an expanded suite that now includes logs, metrics, traces, and incident management. The core uptime monitoring product remains strong, but the pricing model is modular: you pay a per-responder license and add packs for monitors, status pages, and telemetry volume. OneUptime offers a simpler, more predictable model of a flat $1/month per active monitor with on-call and incidents included.",
      },
      {
        question:
          "How does Better Stack's per-responder pricing compare to OneUptime?",
        answer:
          "Better Stack requires a Responder license, roughly $29/month per person on annual billing or $34/month monthly, for anyone who runs on-call rotations, acknowledges incidents, or receives phone and SMS alerts. That fee multiplies with every engineer you add to the pager. OneUptime includes on-call scheduling, escalation policies, and incident management for your entire team at no per-responder cost, so growing your on-call rotation does not grow your bill.",
      },
      {
        question:
          "How do monitoring capabilities compare between Better Stack and OneUptime?",
        answer:
          "Both offer HTTP and API checks, SSL certificate monitoring, heartbeats, and status pages. OneUptime provides faster minimum check frequencies (1 second versus 30 seconds on Better Stack) and includes native server and infrastructure monitoring for CPU, memory, and disk. Better Stack meters extra monitors in per-50 bundles and charges separately for heartbeats and Playwright transaction minutes, while OneUptime bills a flat $1/month per active monitor with unlimited free manual and static monitors.",
      },
      {
        question: "What do status pages cost on Better Stack versus OneUptime?",
        answer:
          "Better Stack includes one status page, then charges for extras: about $12 per page per month for additional pages or custom CSS and JavaScript, $208-250 per page per month for white-label branding, password protection, and SSO, and $40/month for each additional 1,000 subscribers. OneUptime includes public and private status pages, custom domains with free SSL, custom branding and HTML/CSS/JS, and unlimited subscribers at no extra cost.",
      },
      {
        question: "Can I self-host OneUptime like Better Stack?",
        answer:
          "Yes, and this is a major differentiator. OneUptime is fully open source under the Apache 2.0 license and can be self-hosted on your own infrastructure using Docker or Kubernetes. Better Stack is a closed-source SaaS product with no self-hosting option. Self-hosting gives you complete control over your data, helps meet compliance requirements, and eliminates vendor lock-in.",
      },
      {
        question:
          "What features does OneUptime have that Better Stack charges extra for?",
        answer:
          "OneUptime includes several things Better Stack meters or gates behind add-ons: on-call and incident management for the whole team (no per-responder license), unlimited status page subscribers (no $40 per 1,000), white-label custom-domain status pages (no $208-250 per-page fee), and native server and infrastructure monitoring. On top of that, OneUptime offers 1-second minimum check intervals, an open-source Apache 2.0 codebase you can audit and extend, and self-hosting on your own infrastructure.",
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
      "Simple, popular uptime monitoring tool that excels at basic checks and status pages but has no on-call scheduling or real incident response.",
    oneuptimeFocus:
      "One unified platform where monitoring, status pages, on-call scheduling, and incident management work together out of the box.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Uptime Robot is one of the most popular simple monitoring tools, with a genuinely generous free tier and a clean, easy interface. It covers uptime checks, SSL and domain expiry, keyword and DNS monitoring, and status pages, but it stops there - there is no on-call scheduling and only lightweight incident tracking.",
    oneUptimeDescription:
      "OneUptime delivers the same core monitoring at a flat $1/month per active monitor, then adds the full incident lifecycle - status pages, on-call rotations and escalations, incident management, postmortems, and OpenTelemetry logs, metrics, and traces - in a single open-source platform.",
    description:
      "Uptime Robot is one of the most popular simple monitoring tools, with an excellent free tier of 50 monitors. It is great for straightforward uptime checks and basic status pages, but it lacks on-call scheduling, has only lightweight incident tracking, and caps monitors by plan (50 to 1,000+). As needs grow beyond simple monitoring, teams end up bolting on separate tools like PagerDuty and Statuspage.",
    descriptionLine2:
      "Uptime Robot is great for simple monitoring. When you need on-call scheduling and real incident management, OneUptime gives you the whole platform without stitching tools together.",
    migrationBenefits: [
      "Keep simple uptime monitoring and add real on-call rotations and escalations",
      "Complete incident management workflow with timelines and postmortems",
      "Status pages with unlimited subscribers and free custom-domain SSL",
      "Faster checks: intervals down to 1 second vs a 30-second minimum",
      "Active monitors at a flat $1/month each with no per-plan caps",
      "All alerting included: SMS, phone calls, Slack, Teams, webhooks, and push",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "/month",
        features: [
          "50 monitors",
          "5-minute intervals",
          "HTTP/port/ping/keyword monitoring",
          "SSL & domain expiry monitoring",
          "1 status page",
          "5 integrations",
        ],
        limitations: [
          "5-minute intervals only",
          "50 monitor limit",
          "No on-call scheduling",
          "3-month data retention",
        ],
      },
      {
        name: "Solo",
        price: "$10",
        period: "/month",
        features: [
          "10-50 monitors",
          "60-second intervals",
          "API & multi-location monitoring",
          "3 status pages",
          "Up to 12 integrations",
        ],
        limitations: [
          "No login seats included",
          "No on-call scheduling",
          "No incident management",
          "12-month data retention",
        ],
      },
      {
        name: "Team",
        price: "$38",
        period: "/month",
        features: [
          "100 monitors",
          "60-second intervals",
          "Full-featured status pages (100)",
          "3 login + 3 notify seats",
          "Custom domain & whitelabel",
        ],
        limitations: [
          "100 monitor limit",
          "Still no on-call scheduling",
          "Only basic incident tracking",
        ],
      },
      {
        name: "Enterprise",
        price: "$82",
        period: "/month",
        features: [
          "200-1,000+ monitors",
          "30-second intervals",
          "Unlimited status pages",
          "5 login + 5 notify seats",
          "SOC 2 & GDPR compliant",
        ],
        limitations: [
          "No on-call scheduling",
          "No incident management",
          "Extra login seats billed per-seat",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Small team needing monitoring plus on-call",
        competitorSolution: "Uptime Robot Team + PagerDuty",
        competitorCost: "$38 + $210 = $248/month",
        oneuptimeSolution:
          "OneUptime with monitoring, on-call, and incidents included",
        oneuptimeCost: "$0/month (Free tier)",
      },
      {
        scenario:
          "Startup monitoring 40 endpoints with a status page and on-call",
        competitorSolution: "Uptime Robot Solo + a separate on-call tool",
        competitorCost: "$10 + on-call tooling",
        oneuptimeSolution:
          "OneUptime: 40 active monitors, status page, and on-call together",
        oneuptimeCost: "~$40/month ($1 per active monitor)",
      },
      {
        scenario: "Growing company needing complete observability",
        competitorSolution: "Uptime Robot Enterprise + PagerDuty + Statuspage",
        competitorCost: "$82 + $400 + $99 = $581/month",
        oneuptimeSolution: "OneUptime at a flat $1 per active monitor",
        oneuptimeCost: "$0-99/month",
      },
    ],
    keyDifferences: [
      {
        title: "On-Call Scheduling",
        description:
          "Full rotation and multi-level escalation support - Uptime Robot has none",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Complete workflow with timelines and postmortems - only basic tracking in Uptime Robot",
        icon: "incident",
      },
      {
        title: "$1 Per Active Monitor",
        description:
          "Flat $1/month per active monitor with no caps - Uptime Robot limits 50 to 1,000+ by plan",
        icon: "unlimited",
      },
      {
        title: "Faster Monitoring",
        description:
          "Intervals down to 1 second vs a 30-second minimum on Uptime Robot Enterprise",
        icon: "monitoring",
      },
      {
        title: "Better Status Pages",
        description:
          "Unlimited subscribers, custom domains with free SSL, and automatic updates from monitors",
        icon: "status-page",
      },
      {
        title: "Self-Hosting Option",
        description:
          "Open-source under Apache 2.0 - run on your own infrastructure; Uptime Robot is SaaS-only",
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
            productColumn: "50-1,000+ based on plan",
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
            productColumn: "Paid plans",
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
            title: "Mobile Push",
            description: "Mobile app push",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack/Teams",
            description: "Chat integrations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Webhooks",
            description: "Custom webhook alerts",
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
          {
            title: "Runbooks",
            description: "Response runbooks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR Analytics",
            description: "Resolution metrics",
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
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Branding",
            description: "Logo, colors, CSS/JS",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS/webhook updates",
            productColumn: "Basic",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Scheduled Maintenance",
            description: "Maintenance windows",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Pages",
            description: "Password protected",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
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
        name: "Platform & Pricing",
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
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Telemetry (Logs/Metrics/Traces)",
            description: "OpenTelemetry-native",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit Logs",
            description: "Activity tracking",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable Pricing",
            description: "Flat, capped costs",
            productColumn: "Tiered by monitor count",
            oneuptimeColumn: "$1/active monitor",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Uptime Robot?",
        answer:
          "Uptime Robot is excellent for simple, affordable uptime monitoring and basic status pages. OneUptime provides that same monitoring plus on-call scheduling, full incident management, and richer status pages in one platform. If you only need basic monitoring, Uptime Robot's free tier is hard to beat. But once you need to manage incidents and alert an on-call team, you would add PagerDuty ($210+/month) and possibly Statuspage ($99+/month), which is where OneUptime becomes far more cost-effective.",
      },
      {
        question: "What about Uptime Robot's free tier?",
        answer:
          "Uptime Robot's free tier (50 monitors, 5-minute intervals, 1 status page) is genuinely generous for basic needs. OneUptime also has a free tier, and it includes on-call scheduling, incident management, and better status pages. If monitoring alone is enough, Uptime Robot Free works well; if you need the complete incident lifecycle, OneUptime Free delivers far more.",
      },
      {
        question: "Does OneUptime have the same monitoring types?",
        answer:
          "Yes. Both support HTTP/HTTPS, TCP port, ping, keyword, SSL, and DNS monitoring. OneUptime adds API monitoring with custom headers and payloads, server monitoring (CPU, memory, disk), container monitoring, and multi-step synthetic transactions - plus faster check frequencies (down to 1 second vs a 30-second minimum on Uptime Robot Enterprise).",
      },
      {
        question: "Why switch from Uptime Robot?",
        answer:
          "Consider switching when you need on-call scheduling (Uptime Robot has none), real incident management workflows (only basic tracking in Uptime Robot), advanced status pages with unlimited subscribers, or you are hitting monitor caps. Rather than bolting PagerDuty and Statuspage onto Uptime Robot, OneUptime gives you everything in one platform at a flat $1 per active monitor.",
      },
      {
        question: "How does the pricing compare in 2026?",
        answer:
          "Uptime Robot's paid plans in 2026 run from Solo at $10/month to Team at $38/month and Enterprise starting at $82/month, with monitors capped per tier (50 to 1,000+). OneUptime charges a flat $1/month per active monitor with no caps, keeps manual and static monitors free, and includes on-call and incident management - so as you scale, costs stay predictable instead of jumping between tiers.",
      },
      {
        question: "Can I self-host OneUptime?",
        answer:
          "Yes. OneUptime is fully open source under Apache 2.0, so you can self-host it on your own infrastructure for free. Uptime Robot is SaaS-only with no self-hosting option, which matters for teams with data-residency, compliance, or air-gapped requirements.",
      },
      {
        question:
          "Does OneUptime replace both Uptime Robot and a separate status page tool?",
        answer:
          "Yes. OneUptime includes public and private status pages with unlimited subscribers, custom domains with free SSL, custom branding, scheduled maintenance, and automatic updates from your monitors - so you do not need a separate tool like Statuspage or Instatus on top of your monitoring.",
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
      "Developer-focused synthetic monitoring with best-in-class Playwright and Terraform support for CI/CD; on-call rotations and deep incident response still lean on separate tools.",
    oneuptimeFocus:
      "One unified platform where monitoring, status pages, on-call, and full incident management work together out of the box.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Checkly is a developer-focused reliability platform centered on synthetic monitoring, with excellent Playwright and Terraform integration for API and browser testing in CI/CD pipelines. It has expanded into status pages and basic incident communication through its Communicate module and uses Rocky AI for root-cause analysis. Its core strength and pricing model remain monitoring-as-code for engineering teams.",
    oneUptimeDescription:
      "OneUptime provides unlimited synthetic monitoring plus the complete incident lifecycle in one platform. On-call scheduling, escalation policies, incident management with postmortems, and unlimited-subscriber status pages are all included, with predictable flat per-monitor pricing.",
    description:
      "Checkly is a developer-focused synthetic monitoring tool with excellent Playwright and Terraform integration, built for API and browser testing inside CI/CD pipelines. It has recently added status pages and basic status-page incidents through a paid Communicate module, but on-call rotations and a full incident lifecycle still rely on integrations like PagerDuty or Opsgenie. Its check-run quotas and per-run overages also make high-frequency monitoring costs hard to predict. OneUptime folds monitoring, status pages, on-call, and incident management into a single platform with unlimited check runs and flat per-monitor pricing.",
    descriptionLine2:
      "Checkly is excellent for synthetic testing as code. For a complete reliability platform with real on-call, full incident management, and unlimited-subscriber status pages, OneUptime does it all in one place.",
    migrationBenefits: [
      "Unlimited synthetic check runs with no monthly quotas or per-run overages",
      "Native on-call scheduling with rotations, multi-level escalations, and overrides",
      "Full incident lifecycle: timelines, postmortems, action items, runbooks, and MTTR analytics",
      "Status pages with unlimited subscribers plus free custom domain and SSL",
      "Faster check frequencies down to a 1-second interval",
      "Open-source and self-hostable, or predictable $1 per active monitor in the cloud",
    ],
    competitorPricingTiers: [
      {
        name: "Hobby",
        price: "$0",
        period: "/month",
        features: [
          "10 uptime monitors",
          "1K browser check runs/month",
          "10K API check runs/month",
          "1 user included",
        ],
        limitations: [
          "Very limited check runs",
          "No native on-call rotations",
          "Basic status page only",
          "Community support",
        ],
      },
      {
        name: "Starter (Detect)",
        price: "$24",
        period: "/month (billed annually)",
        features: [
          "50 uptime monitors",
          "3K browser runs/month",
          "25K API runs/month",
          "4 public locations",
          "100 SMS alerts/month",
          "3 users",
        ],
        limitations: [
          "Browser overages ~$6.50/1K runs",
          "API overages ~$2.60/10K runs",
          "No native on-call scheduling",
          "Status pages are a separate Communicate plan",
        ],
      },
      {
        name: "Team (Detect)",
        price: "$64",
        period: "/month (billed annually)",
        features: [
          "75 monitors",
          "12K browser runs/month",
          "100K API runs/month",
          "All 22 locations + private locations",
          "200 phone alerts/month",
          "10 users",
        ],
        limitations: [
          "Check-run overages still apply",
          "Branding/custom CSS is a ~$30/mo Communicate add-on",
          "On-call rotations require PagerDuty/Opsgenie",
          "Incident management is status-page basic",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Custom check-run limits",
          "Private locations",
          "SSO/SAML and SAML",
          "White-labeled status pages",
        ],
        limitations: [
          "Requires sales contact",
          "No native on-call rotation engine",
          "Full incident response via integrations",
          "Usage-based costs remain",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Dev team needing synthetic monitoring plus on-call and a branded status page",
        competitorSolution:
          "Checkly Team (Detect) + Communicate add-on + PagerDuty for on-call",
        competitorCost: "$64 + ~$30 + ~$21/user = $115+/month",
        oneuptimeSolution:
          "OneUptime unified: synthetic monitoring, status page, and on-call included",
        oneuptimeCost: "$0/month (Free tier) or a few $/monitor",
      },
      {
        scenario:
          "E-commerce site with critical user flows needing full incident response",
        competitorSolution:
          "Checkly Enterprise + Communicate + dedicated incident tool",
        competitorCost: "$300+ plus add-ons = $500+/month",
        oneuptimeSolution:
          "OneUptime with synthetic monitoring, incidents, postmortems, and status page",
        oneuptimeCost: "$1/active monitor + ~$0.10/GB telemetry",
      },
      {
        scenario:
          "50 API checks running every 30 seconds (about 4M+ runs/month)",
        competitorSolution:
          "Checkly with API check-run overages past the included quota",
        competitorCost: "Base plan + $2.50/10K overages = $1,000+/month",
        oneuptimeSolution:
          "OneUptime flat per-monitor pricing, no run counting",
        oneuptimeCost: "$50/month flat (50 x $1), unlimited runs",
      },
    ],
    keyDifferences: [
      {
        title: "Native On-Call Scheduling",
        description:
          "Rotations, multi-level escalation, and overrides built in - Checkly relies on PagerDuty or Opsgenie",
        icon: "on-call",
      },
      {
        title: "Full Incident Management",
        description:
          "Timelines, postmortems, action items, runbooks, and MTTR - Checkly incidents are status-page basic",
        icon: "incident",
      },
      {
        title: "Unlimited-Subscriber Status Pages",
        description:
          "Unlimited subscribers, free custom domain, and custom HTML/CSS - Checkly gates branding behind a paid add-on",
        icon: "status-page",
      },
      {
        title: "No Check-Run Limits",
        description:
          "Unlimited check runs vs Checkly's monthly quotas and per-run overages",
        icon: "unlimited",
      },
      {
        title: "One Unified Platform",
        description:
          "Detection, response, and communication in a single tool instead of stitched-together modules",
        icon: "unified",
      },
      {
        title: "Open Source and Self-Hostable",
        description:
          "Apache 2.0, run it on your own infrastructure - Checkly is SaaS-only",
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
            productColumn: "1K-12K/mo, then overages",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "API Checks",
            description: "HTTP API monitoring",
            productColumn: "10K-100K/mo, then overages",
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
            productColumn: "Down to 10 sec",
            oneuptimeColumn: "1 second",
          },
          {
            title: "Global Locations",
            description: "Probe locations",
            productColumn: "4-22 by plan",
            oneuptimeColumn: "7+ included",
          },
          {
            title: "Private Locations",
            description: "Probes inside your network",
            productColumn: "Team+ plans",
            oneuptimeColumn: "tick",
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
          {
            title: "AI Root-Cause Help",
            description: "AI failure analysis",
            productColumn: "Rocky AI",
            oneuptimeColumn: "Sentinel AI",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-Call Rotations",
            description: "Daily/weekly/custom schedules",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-Level Escalation",
            description: "Escalate to next responder",
            productColumn: "Alert-based only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides & Vacation",
            description: "Cover schedule gaps",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS & Phone Alerts",
            description: "Voice and text alerts",
            productColumn: "100-200/mo by plan",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack & Teams Alerts",
            description: "Chat notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Mobile Push",
            description: "Push notifications",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Timelines",
            description: "Chronological updates",
            productColumn: "Basic (status page)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic Incident Creation",
            description: "Open incidents from failures",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities",
            description: "Built-in severity levels",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured retrospectives",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action Items & Runbooks",
            description: "Follow-ups and playbooks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR Analytics",
            description: "Response metrics",
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
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private/Internal Status Page",
            description: "Internal audiences",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited Subscribers",
            description: "Notify stakeholders",
            productColumn: "Email/RSS only",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "Starter+ plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML/CSS/Branding",
            description: "Full white labeling",
            productColumn: "Add-on (~$30/mo)",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS/Slack/Teams Updates",
            description: "Multi-channel subscriber alerts",
            productColumn: "Email/RSS only",
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
            title: "REST API",
            description: "Full API access",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable Flat Pricing",
            description: "No per-run overages",
            productColumn: "Per-run overages",
            oneuptimeColumn: "$1/monitor flat",
          },
          {
            title: "SSO / SAML",
            description: "Enterprise auth",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unified Platform",
            description: "Detect, respond, communicate",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Checkly?",
        answer:
          "Checkly excels at developer-focused synthetic monitoring with great Playwright integration and monitoring-as-code via Terraform. It has added status pages and basic status-page incidents, but on-call rotations and a full incident lifecycle still rely on tools like PagerDuty or Opsgenie. OneUptime provides synthetic monitoring plus native on-call scheduling, complete incident management with postmortems, and unlimited-subscriber status pages in one platform. If you only need synthetic tests in a CI pipeline, Checkly is excellent; if you need to detect, respond, and communicate all in one place, OneUptime is the complete solution.",
      },
      {
        question:
          "Doesn't Checkly now have status pages and incident management?",
        answer:
          "Yes. Checkly launched a Communicate module with public and internal status pages and the ability to open, update, and resolve incidents from a failing check. However, branding, custom CSS, and white labeling sit behind a paid add-on, subscribers are email/RSS only, and incidents are essentially status-page updates without postmortems, action items, runbooks, or MTTR analytics. OneUptime includes unlimited subscribers, free custom domain and SSL, and a full incident lifecycle at no extra tier.",
      },
      {
        question: "Does Checkly have real on-call scheduling like OneUptime?",
        answer:
          "Not natively. Checkly offers alert escalation policies that control when and how often alerts fire, but managing human on-call rotations, overrides, and follow-the-sun coverage means integrating PagerDuty, Opsgenie, Incident.io, or Rootly as a separate tool. OneUptime includes on-call rotations, multi-level escalation policies, and overrides built in, with alerts via SMS, phone call, email, push, Slack, and Microsoft Teams.",
      },
      {
        question: "Does OneUptime have Playwright support like Checkly?",
        answer:
          "OneUptime supports synthetic browser tests for monitoring user flows. Checkly has deeper Playwright integration specifically designed for test-as-code workflows in your IDE and CI. If Playwright scripting is essential to your team, Checkly has an edge there. OneUptime focuses on reliable monitoring with easier configuration for common use cases and pairs it with the full response and communication stack.",
      },
      {
        question: "What about Checkly's Terraform provider?",
        answer:
          "Checkly has strong infrastructure-as-code support and a mature Terraform provider covering checks and status pages. OneUptime provides a full REST API and native webhooks for automation, plus 2000+ integrations via Zapier. For teams deeply invested in Terraform-managed monitoring, Checkly integrates well; OneUptime's API-first approach works with any automation toolchain.",
      },
      {
        question: "How do check-run limits and pricing compare?",
        answer:
          "Checkly bills by check runs, limiting browser checks (1K-12K/month) and API checks (10K-100K/month), then charging per-run overages of roughly $2.50-$6.50 per batch. High-frequency monitoring gets expensive and hard to predict. OneUptime does not count check runs at all: active monitors are a flat $1/month each with no per-check tiers or caps, so a 30-second monitor costs the same as an hourly one.",
      },
      {
        question: "Can I self-host or audit the code?",
        answer:
          "Checkly is a SaaS-only product with no open-source or self-host option. OneUptime is Apache 2.0 licensed and fully self-hostable for free, so you can run it on your own infrastructure, audit every line, and keep telemetry data in your environment, or use the managed cloud with predictable pricing.",
      },
    ],
  },
  "incident.io": {
    productName: "Incident.io",
    iconUrl: "/img/incident-io.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "Complete incident lifecycle platform vs incident response specialist",
    competitorFocus:
      "Modern, beautifully designed incident response with excellent Slack and Microsoft Teams integration, but it has no monitoring to detect incidents, on-call is a paid per-user add-on, and status pages are basic.",
    oneuptimeFocus:
      "Full incident lifecycle: Detection (Monitoring) + Response (On-Call + Incidents) + Communication (Status Pages), unified in one open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Incident.io is a modern, beautifully designed incident management tool that excels at Slack- and Teams-native incident response. It provides polished coordination features for teams during incidents, plus built-in on-call (as a paid add-on) and basic status pages. It does not monitor anything, so incidents must be detected by separate tools.",
    oneUptimeDescription:
      "OneUptime provides complete incident management plus integrated monitoring, full-featured status pages, and on-call scheduling in one platform. It covers the entire incident lifecycle from automatic detection to customer communication and post-incident learning, with predictable flat pricing instead of per-user seats.",
    description:
      "Incident.io is a modern, beautifully designed incident management tool that excels at Slack- and Teams-native incident response, and it's excellent for coordinating teams during a live incident. It includes on-call (as a paid per-user add-on) and basic status pages. However, it has no monitoring to detect incidents in the first place, and its pricing scales per user with every hire. Complete reliability needs detection, response, and customer communication working together.",
    descriptionLine2:
      "Great incident response is one piece of the equation. Complete reliability also needs detection (monitoring) and customer communication (status pages), without the per-user add-on math.",
    migrationBenefits: [
      "Add integrated monitoring to detect incidents automatically - incident.io monitors nothing",
      "Get full-featured status pages with unlimited subscribers and custom domains",
      "On-call scheduling and escalations included, not a per-user paid add-on",
      "Flat pricing instead of per-user seats that grow with every hire",
      "Slack and Microsoft Teams incident collaboration included on all plans",
      "Complete incident lifecycle in one unified, open-source platform",
    ],
    competitorPricingTiers: [
      {
        name: "Basic",
        price: "$0",
        period: "/forever",
        features: [
          "Up to 5 users",
          "Slack or Microsoft Teams incidents",
          "Single-team on-call",
          "Basic status page",
          "Essential incident automation",
        ],
        limitations: [
          "Capped at 5 users",
          "Single-team on-call only",
          "Basic status page only",
          "No advanced automation",
        ],
      },
      {
        name: "Team",
        price: "$15",
        period: "/user/mo (annual)",
        features: [
          "$19/user/mo billed monthly",
          "Slack and Microsoft Teams incidents",
          "Multi-team incident response",
          "Status page included",
          "AI-powered incident automation",
          "On-call add-on +$10/user (annual)",
        ],
        limitations: [
          "On-call costs extra",
          "No private incidents",
          "No advanced insights",
          "Per-user pricing",
        ],
      },
      {
        name: "Pro",
        price: "$25",
        period: "/user/month",
        features: [
          "Everything in Team",
          "Advanced insights and analytics",
          "Private incidents and policies",
          "AI Assistant",
          "Customizable post-incident process",
          "On-call add-on +$20/user",
        ],
        limitations: [
          "On-call still costs extra",
          "No monitoring",
          "Multiple status pages need Enterprise",
          "Per-user pricing",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Everything in Pro",
          "Customer success manager",
          "SAML/SCIM and advanced access control",
          "Multiple environments and status pages",
          "Live phone support and SLAs",
        ],
        limitations: [
          "Requires sales contact",
          "Still no monitoring",
          "On-call still a paid add-on",
          "Per-user pricing",
        ],
      },
    ],
    useCases: [
      {
        scenario: "10-person engineering team with monitoring and on-call",
        competitorSolution:
          "Incident.io Team + On-call add-on + a separate monitoring tool",
        competitorCost:
          "$250/mo (Team + on-call) + ~$150 monitoring = ~$400/month",
        oneuptimeSolution:
          "OneUptime with monitoring, on-call, incidents, and status pages included",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario: "25-person team on Pro with private incidents and monitoring",
        competitorSolution:
          "Incident.io Pro + On-call add-on + separate monitoring",
        competitorCost:
          "$1,125/mo (Pro + on-call) + ~$200 monitoring = ~$1,325+/month",
        oneuptimeSolution:
          "OneUptime with unlimited users and monitoring included",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Startup needing Slack-based incident response and on-call",
        competitorSolution:
          "Incident.io Team + On-call add-on (6 users) + basic monitoring",
        competitorCost: "$150/mo (Team + on-call) + monitoring",
        oneuptimeSolution:
          "OneUptime Free tier with Slack and Teams integration",
        oneuptimeCost: "$0/month (Free tier)",
      },
    ],
    keyDifferences: [
      {
        title: "Built-in Monitoring",
        description:
          "Detect incidents automatically - incident.io has zero monitoring capabilities",
        icon: "monitoring",
      },
      {
        title: "Complete Status Pages",
        description:
          "Unlimited subscribers, custom domains, and monitor-driven updates - incident.io's are basic and multiple pages need Enterprise",
        icon: "status-page",
      },
      {
        title: "On-Call Included",
        description:
          "Full on-call scheduling and escalations included - incident.io charges +$10-20/user as an add-on",
        icon: "on-call",
      },
      {
        title: "No Per-User Pricing",
        description:
          "Add team members without cost scaling - incident.io bills per user, so cost grows with every hire",
        icon: "pricing",
      },
      {
        title: "Complete Lifecycle",
        description:
          "Detection, Response, Communication, and Learning - all in one platform",
        icon: "unified",
      },
      {
        title: "Open Source & Self-Hostable",
        description:
          "Apache 2.0 licensed, self-host for free and own your data - incident.io is closed-source SaaS only",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident Creation",
            description: "Create incidents manually or automatically",
            productColumn: "Manual + alert triggers",
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
            productColumn: "tick",
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
            productColumn: "Advanced on Pro",
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
            productColumn: "On-call add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert Routing",
            description: "Route to right team",
            productColumn: "On-call add-on",
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
            productColumn: "Included",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Page",
            description: "Internal dashboards",
            productColumn: "Pro plan",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multiple Status Pages",
            description: "No page count limits",
            productColumn: "Enterprise only",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Subscriber Notifications",
            description: "Email/SMS updates",
            productColumn: "Email only",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom Domain",
            description: "Your own domain",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic Updates from Monitors",
            description: "Update status from monitor health",
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
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit Logs",
            description: "Activity tracking",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Incident.io?",
        answer:
          "Incident.io excels at Slack- and Teams-native incident management - it's beautifully designed for coordinating a live incident. However, it's only one piece of the puzzle. It has no monitoring to detect incidents (incident.io monitors nothing), on-call is a paid per-user add-on (+$10-20/user/month), and its status pages are basic, with multiple pages reserved for Enterprise. OneUptime provides the complete incident lifecycle: monitoring detects issues, on-call alerts the right people, incident management coordinates response, and full-featured status pages keep customers informed - all in one platform.",
      },
      {
        question: "Does OneUptime work with Slack and Teams like Incident.io?",
        answer:
          "Yes. OneUptime has native Slack and Microsoft Teams integration for incident management. You can create, acknowledge, update, and resolve incidents directly from either tool. Incident.io also supports both, but the difference is OneUptime's chat integration is part of a complete platform that monitors your systems, runs your on-call, and powers your status page - not the entire product.",
      },
      {
        question: "What about Incident.io's AI features?",
        answer:
          "Incident.io has invested heavily in AI for incident response, with an AI Assistant and automation now included on its paid plans. OneUptime focuses on practical automation and intelligent alerting: automatic incident creation from monitors, alert deduplication, and workflow automation. The key difference is that OneUptime's automation spans the entire lifecycle - including detection - because it actually monitors your systems.",
      },
      {
        question: "How do postmortems compare?",
        answer:
          "Both platforms support structured post-incident reviews with timelines and action items, and incident.io has a polished postmortem experience. OneUptime provides comparable functionality plus the ability to publish postmortems directly to your status page for customer transparency - something incident.io can't do the same way since its status pages are more basic and monitor-driven detection isn't part of the product.",
      },
      {
        question: "Is on-call included in OneUptime?",
        answer:
          "Yes. Full on-call scheduling with rotations, multi-level escalation policies, and multi-channel alerts (SMS, phone call, push, email, Slack, Teams) is included in OneUptime on all plans. Incident.io charges on-call as a per-user add-on: +$10/user/month on Team (annual) and +$20/user/month on Pro. For a 10-person team, that's an extra $100-200/month just for on-call, on top of the base per-user seat cost.",
      },
      {
        question: "What about private incidents?",
        answer:
          "OneUptime supports private incidents on all plans. Incident.io restricts private incidents to the Pro plan ($25/user/month). This matters for security incidents or HR-related issues that shouldn't be visible to everyone in the workspace.",
      },
      {
        question: "Why choose OneUptime over Incident.io?",
        answer:
          "Choose OneUptime if you want a complete reliability platform without assembling and paying for separate tools. With incident.io you still need a dedicated monitoring tool to detect incidents (incident.io monitors nothing), on-call is a paid add-on (+$10-20/user/month), and pricing scales per user with every hire. OneUptime includes monitoring, full-featured status pages, on-call, AND incident management - with predictable flat pricing and no per-seat costs, plus the option to self-host for free.",
      },
    ],
  },
  signoz: {
    productName: "SigNoz",
    iconUrl: "/img/signoz.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "Complete reliability platform vs open-source APM",
    competitorFocus:
      "An excellent open-source, OpenTelemetry-native APM built on ClickHouse for logs, metrics, traces, and exceptions - but it stops at observability data.",
    oneuptimeFocus:
      "A unified platform that pairs logs, metrics, and traces with uptime monitoring, on-call, incident management, and status pages in one tool.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "SigNoz is a strong open-source observability platform focused on logs, metrics, traces, and exceptions, native to OpenTelemetry and built on ClickHouse for high-performance querying. It offers a free self-hosted Community edition and a managed Teams cloud, making it a credible open-source alternative to Datadog and New Relic. Its scope is observability data - on-call, incident response, and customer-facing status pages need separate tools.",
    oneUptimeDescription:
      "OneUptime is a unified, Apache 2.0 reliability platform that combines OpenTelemetry logs, metrics, and traces with uptime monitoring, on-call scheduling, incident management, and unlimited status pages. It is available as a free self-hosted stack or a managed cloud with predictable, flat pricing. One platform covers detection, response, and customer communication.",
    description:
      "SigNoz is an excellent open-source observability platform focused on logs, metrics, traces, and exceptions. Built on ClickHouse and native to OpenTelemetry, it is a genuine alternative to proprietary APM tools with a transparent, usage-based cloud. However, SigNoz covers only observability data - synthetic and uptime monitoring, on-call scheduling, incident management, and customer-facing status pages all require additional products. That means stitching together and paying for several tools to cover the full incident lifecycle.",
    descriptionLine2:
      "SigNoz is great for APM and telemetry. OneUptime adds monitoring, on-call, incidents, and status pages so one platform handles the entire path from signal to customer update.",
    migrationBenefits: [
      "Add on-call scheduling with rotations, escalations, and follow-the-sun",
      "Add end-to-end incident management with timelines, postmortems, and MTTR analytics",
      "Add unlimited-subscriber, custom-domain status pages your customers can trust",
      "Add synthetic, SSL, port, and heartbeat monitoring alongside your telemetry",
      "Predictable pricing - flat $1/active monitor and ~$0.10/GB telemetry, no per-sample surprises",
      "Stay fully open source and self-hostable under a permissive Apache 2.0 license",
    ],
    competitorPricingTiers: [
      {
        name: "Community",
        price: "$0",
        period: "/self-hosted",
        features: [
          "Full observability feature set",
          "Self-managed Docker or Kubernetes deploy",
          "No data caps or license fees",
          "Community support",
        ],
        limitations: [
          "You run and scale the infrastructure",
          "No managed support or SLA",
          "No on-call or incident management",
          "No uptime or status pages",
        ],
      },
      {
        name: "Teams",
        price: "$49",
        period: "/month + usage",
        features: [
          "About 163GB logs/traces included in base",
          "About 490M metric samples included",
          "Unlimited teammates, no per-host fees",
          "SOC 2 Type II, multi-region (US, EU, India)",
          "Chat and email support",
          "30-day free trial; 50% startup discount",
        ],
        limitations: [
          "Usage-based after included quota",
          "$0.30/GB for logs and traces",
          "$0.10 per million metric samples",
          "No on-call, incidents, or status pages",
        ],
      },
      {
        name: "Enterprise",
        price: "$4,000+",
        period: "/month custom",
        features: [
          "Dedicated cloud, BYOC, or self-hosted",
          "SSO/SAML and custom retention",
          "Volume-discounted custom pricing",
          "Dedicated support and SLA",
        ],
        limitations: [
          "Starts around $4,000/month",
          "Sales contact required",
          "Still no on-call scheduling",
          "Still no incident or status pages",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Dev team needing APM plus on-call and a status page",
        competitorSolution: "SigNoz Teams + PagerDuty + Statuspage",
        competitorCost: "$49 + ~$210 + ~$99 = ~$358/month + usage",
        oneuptimeSolution:
          "OneUptime with telemetry, on-call, and status pages included",
        oneuptimeCost: "$0/month on the Free tier",
      },
      {
        scenario: "Growing startup ingesting 500GB/month of logs",
        competitorSolution: "SigNoz Teams with usage overage",
        competitorCost: "$49 + (~337GB x $0.30) = ~$150/month for logs alone",
        oneuptimeSolution: "OneUptime telemetry at ~$0.10/GB",
        oneuptimeCost: "~$50/month for the same volume",
      },
      {
        scenario:
          "Enterprise wanting a full observability plus reliability stack",
        competitorSolution:
          "SigNoz Enterprise + separate on-call + status page tools",
        competitorCost: "$4,000+ + ~$500 + ~$400 = $4,900+/month",
        oneuptimeSolution: "OneUptime Enterprise with everything unified",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    keyDifferences: [
      {
        title: "On-Call Scheduling",
        description:
          "Rotations and multi-level escalations built in - not available in SigNoz",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description:
          "Full workflow with timelines, postmortems, and MTTR - not in SigNoz",
        icon: "incident",
      },
      {
        title: "Status Pages",
        description:
          "Unlimited-subscriber, custom-domain status pages - not in SigNoz",
        icon: "status-page",
      },
      {
        title: "Predictable Pricing",
        description:
          "Flat $1/monitor and ~$0.10/GB vs SigNoz per-GB and per-sample usage",
        icon: "pricing",
      },
      {
        title: "Uptime Monitoring",
        description:
          "Synthetic, HTTP, TCP, SSL, and heartbeat checks - SigNoz focuses on APM",
        icon: "monitoring",
      },
      {
        title: "Fully Apache 2.0",
        description:
          "Permissive single license vs SigNoz's open-core enterprise module",
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
            title: "OpenTelemetry Native",
            description: "OTel-first ingestion",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exceptions Tracking",
            description: "Error and exception views",
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
          {
            title: "Cron/Heartbeat",
            description: "Job and heartbeat checks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server/Infra Monitors",
            description: "CPU, memory, disk",
            productColumn: "Via metrics",
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
            title: "Postmortems",
            description: "Retros and action items",
            productColumn: "",
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
            description: "Your own domain + SSL",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled Maintenance",
            description: "Planned downtime notices",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom Branding",
            description: "HTML/CSS/JS control",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private Status Pages",
            description: "Internal audiences",
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
            title: "Open Source License",
            description: "How the code is licensed",
            productColumn: "Open-core (ee module)",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "Pricing Model",
            description: "How you pay",
            productColumn: "Usage-based per GB/sample",
            oneuptimeColumn: "Flat $1/monitor + tiers",
          },
          {
            title: "SOC 2 Type II",
            description: "Security compliance",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML",
            description: "Enterprise identity",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Full Reliability Stack",
            description: "Monitoring to status pages",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to SigNoz?",
        answer:
          "SigNoz excels at APM with logs, metrics, traces, and exceptions in one OpenTelemetry-native tool, and it is an excellent open-source Datadog alternative with transparent usage-based pricing. OneUptime covers the complete incident lifecycle: monitoring to detect issues, on-call to notify the right people, incident management to coordinate response, and status pages to communicate with customers - plus its own logs, metrics, and traces. If you only need deep APM, SigNoz is a great choice. If you need the full reliability stack in one place, OneUptime unifies telemetry with monitoring, on-call, incidents, and status pages.",
      },
      {
        question: "Is SigNoz really open source like OneUptime?",
        answer:
          "Both are genuinely open source and self-hostable. SigNoz follows an open-core model - its core is permissively licensed while an enterprise (ee) module is under a separate commercial license - and it focuses on observability data. OneUptime is fully Apache 2.0 across the platform and covers the whole incident lifecycle. They solve related but different problems, and OneUptime's single permissive license keeps self-hosting simple.",
      },
      {
        question: "What about SigNoz's usage-based pricing?",
        answer:
          "SigNoz Teams starts at $49/month, then charges $0.30/GB for logs and traces and $0.10 per million metric samples once you exceed the included quota. That is transparent but can be hard to forecast for high or spiky volumes. OneUptime uses predictable pricing - a flat $1/month per active monitor and roughly $0.10/GB for telemetry - so bills stay easy to plan even as data grows.",
      },
      {
        question: "Does SigNoz include uptime monitoring and status pages?",
        answer:
          "No. SigNoz is focused on observability data - logs, metrics, traces, and exceptions - and does not provide synthetic uptime monitors, SSL/port checks, on-call scheduling, incident management, or customer-facing status pages. OneUptime includes all of those alongside its telemetry, so you do not have to bolt on and pay for separate tools.",
      },
      {
        question: "Can I use SigNoz and OneUptime together?",
        answer:
          "Yes, they are complementary. Use SigNoz for deep APM, distributed tracing, and log analysis, and use OneUptime for uptime monitoring, on-call, incident management, and status pages. SigNoz can trigger OneUptime via webhooks so alerts flow straight into on-call and incident workflows.",
      },
      {
        question: "Which is more cost-effective for a full reliability stack?",
        answer:
          "If all you need is APM, SigNoz Community (self-hosted, free) or Teams is cost-effective. But once you add on-call, incident response, and status pages, you are paying for and integrating multiple products. OneUptime bundles monitoring, on-call, incidents, status pages, and telemetry under one predictable bill, which is usually cheaper and simpler than assembling SigNoz plus a paging tool plus a status page tool.",
      },
    ],
  },
  opsgenie: {
    productName: "Opsgenie",
    iconUrl: "/img/opsgenie.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One unified reliability platform vs a sunsetting alert router",
    competitorFocus:
      "Opsgenie is Atlassian's on-call scheduling and alert-routing tool, now being retired and migrated into Jira Service Management and Compass.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incidents, and telemetry in one open-source platform so you never stitch tools together.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Opsgenie is Atlassian's on-call management and alert-routing product. It schedules who is on call, deduplicates alerts from external monitoring tools, and escalates via SMS, phone, email, and push. It has no native monitoring or status page and relies on Atlassian Statuspage and third-party monitors bolted on around it.",
    oneUptimeDescription:
      "OneUptime is an open-source, self-hostable reliability platform that combines uptime and infrastructure monitoring, public and private status pages, on-call and escalations, incident management, and OpenTelemetry logs, metrics, and traces. Everything shares one data model, so an alert, an incident, and a status page update are the same event rather than three integrations. You can self-host for free or use the managed cloud with flat, predictable pricing.",
    description:
      "Opsgenie only ever solved one slice of reliability: routing alerts to the right on-call responder. To actually run reliability you also paid for monitoring, a status page, and incident tooling, then wired them together. Now Atlassian is sunsetting Opsgenie itself, forcing every customer onto Jira Service Management or Compass on a hard deadline. OneUptime replaces the entire stack with one open-source platform where monitoring, on-call, incidents, and status pages already work together.",
    descriptionLine2:
      "Instead of migrating from a dead product into a pricier Atlassian bundle, move to a unified platform that bills a flat $1 per active monitor and can be self-hosted for free.",
    migrationBenefits: [
      "Escape the forced Atlassian migration and end-of-support deadline with a stable open-source platform you control",
      "Replace Opsgenie plus a separate monitor and status page with one unified tool and one data model",
      "Stop paying per responder seat; pay a flat $1 per active monitor with no per-check tiers or caps",
      "Get built-in website, API, server, container, synthetic, SSL, and cron monitoring with no third-party integrations to wire up",
      "Publish unlimited-subscriber status pages that update automatically from the same monitors that page your team",
      "Own your data and avoid vendor lock-in by self-hosting under Apache 2.0, or use predictable managed cloud pricing",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "up to 5 users",
        features: [
          "Basic alerting and on-call schedules",
          "Unlimited email and push notifications",
          "Escalations for small teams",
          "Community support",
        ],
        limitations: [
          "Only 1 routing rule",
          "100 SMS notifications total",
          "3-month data retention",
          "Closed to new signups since June 2025",
        ],
      },
      {
        name: "Essentials",
        price: "$9.45",
        period: "per user / month (annual)",
        features: [
          "Alerting and basic incident management",
          "Postmortems included",
          "On-call schedules and escalations",
        ],
        limitations: [
          "Only 100 incidents per month",
          "5 postmortems per month",
          "SMS and voice capped per user",
          "Only 1 routing rule",
        ],
      },
      {
        name: "Standard",
        price: "$19.95",
        period: "per user / month (annual)",
        features: [
          "Unlimited alerting and incidents",
          "Unlimited SMS and voice notifications",
          "Up to 100 routing rules",
          "Incoming phone routing",
        ],
        limitations: [
          "No native monitoring",
          "No built-in status page",
          "1-year data retention",
          "Email-only support",
        ],
      },
      {
        name: "Enterprise",
        price: "$31.90",
        period: "per user / month (annual)",
        features: [
          "Custom roles and permissions",
          "Advanced reports and analytics",
          "Unlimited data retention",
          "24/7 support",
        ],
        limitations: [
          "Highest per-seat cost",
          "Still no native monitoring or status page",
          "Being migrated to Jira Service Management",
          "End of support April 2027",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A 15-person SRE team needs on-call, monitoring, and a public status page",
        competitorSolution:
          "Opsgenie Standard at $19.95/user for 15 users, plus a separate monitoring tool and Atlassian Statuspage",
        competitorCost:
          "~$300/mo for Opsgenie seats plus separate monitoring and status page bills",
        oneuptimeSolution:
          "OneUptime covers on-call, monitoring, and status page in one platform; pay only for active monitors",
        oneuptimeCost: "~$50/mo for 50 active monitors, or $0 self-hosted",
      },
      {
        scenario:
          "A startup with 5 engineers running 30 monitors and one status page",
        competitorSolution:
          "Opsgenie Free covers 5 users but only 100 SMS total and no monitoring or status page, so add paid tools",
        competitorCost:
          "Extra monthly cost for monitoring and Statuspage on top of Opsgenie",
        oneuptimeSolution:
          "OneUptime generous free tier plus $1 per active monitor and unlimited status page subscribers",
        oneuptimeCost: "~$30/mo, or $0 on the self-hosted or free tier",
      },
      {
        scenario:
          "A 60-person engineering org facing the Opsgenie end-of-support migration",
        competitorSolution:
          "Migrate to Jira Service Management Operations, where incident features sit in Premium at roughly $51/agent/month",
        competitorCost:
          "~$3,000+/mo in JSM Premium seats, a jump over old Opsgenie pricing",
        oneuptimeSolution:
          "Migrate to OneUptime and consolidate monitoring, on-call, incidents, and status pages with monitor-based billing",
        oneuptimeCost:
          "Flat $1 per active monitor, predictable Growth tier ~$99/mo, or free self-hosted",
      },
    ],
    keyDifferences: [
      {
        title: "Unified platform, not one tool",
        description:
          "Opsgenie only routes alerts and manages on-call; you still buy monitoring and a status page separately. OneUptime includes monitoring, status pages, on-call, incidents, and telemetry together.",
        icon: "unified",
      },
      {
        title: "No forced migration",
        description:
          "Atlassian stopped new Opsgenie sales in June 2025 and ends support in April 2027, forcing customers into Jira Service Management or Compass. OneUptime is stable and open-source with no shutdown clock.",
        icon: "incident",
      },
      {
        title: "Native monitoring built in",
        description:
          "Opsgenie has no monitoring of its own and depends on external tools to generate alerts. OneUptime monitors websites, APIs, servers, containers, SSL, and cron jobs from 7+ global probe locations.",
        icon: "monitoring",
      },
      {
        title: "Status pages included",
        description:
          "Opsgenie relies on the separately-priced Atlassian Statuspage. OneUptime ships public and private status pages with unlimited subscribers, custom domains, and free SSL.",
        icon: "status-page",
      },
      {
        title: "Flat, predictable pricing",
        description:
          "Opsgenie bills per user per month across four tiers, and JSM is pricier still. OneUptime charges a flat $1 per active monitor with unlimited free manual monitors and no per-check tiers.",
        icon: "pricing",
      },
      {
        title: "Open-source and self-hostable",
        description:
          "Opsgenie is closed-source Atlassian SaaS with vendor lock-in. OneUptime is Apache 2.0, self-hostable for free, and lets you own your data end to end.",
        icon: "open-source",
      },
    ],
    items: [
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-call schedules",
            description: "Daily, weekly, and custom rotations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate until an alert is acknowledged",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS and phone call alerts",
            description: "Voice and text notifications to responders",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Notify and collaborate in chat",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description: "Vacation overrides and global handoffs",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert deduplication and grouping",
            description: "Combine related alerts into one incident",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited SMS on entry tier",
            description: "Not capped on the lowest paid plan",
            productColumn: "Standard+ only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Included without per-seat billing",
            description: "On-call not priced per responder",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website and API monitoring",
            description: "Uptime and response checks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure monitoring",
            description: "CPU, memory, and disk metrics",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Docker and Kubernetes",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description: "Scripted multi-step user flows",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Expiry and validity checks",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed scheduled jobs",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from 7+ regions plus private probes",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Receives alerts from monitors",
            description: "Ingest alerts via integrations",
            productColumn: "Via integrations",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Built-in status pages",
            description: "Native, not a separate product",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Public and private status pages",
            description: "Internal and external audiences",
            productColumn: "Separate Statuspage",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap or per-subscriber fees",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom domain with free SSL",
            description: "Host on your own domain",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Full visual control",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Publish planned maintenance windows",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Status reflects live monitor state",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Full chronological record",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities and prioritization",
            description: "Classify incident impact",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Post-incident analysis reports",
            productColumn: "Capped on lower tiers",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up work",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Attach response procedures",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams collaboration",
            description: "Coordinate response in chat",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure response performance",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited incidents on entry tier",
            description: "No monthly incident cap",
            productColumn: "Standard+ only",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry & Observability",
        data: [
          {
            title: "Log management",
            description: "Ingest and search logs",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Store and query time-series metrics",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "OpenTelemetry-native traces",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Custom observability dashboards",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group exceptions",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry ingestion",
            description: "Standard OTel data pipeline",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open-source (Apache 2.0)",
            description: "Inspect and extend the code",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable for free",
            description: "Run on your own infrastructure",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Flat per-monitor pricing",
            description: "$1 per active monitor, no per-check tiers",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Priced per user seat",
            description: "Cost scales with responders",
            productColumn: "Per user",
            oneuptimeColumn: "Unlimited users",
          },
          {
            title: "REST API and native webhooks",
            description: "Automate and integrate",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML, RBAC, audit logs",
            description: "Enterprise access controls",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2, ISO 27001, GDPR",
            description: "Security and compliance",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "No forced product migration",
            description: "Not being sunset or retired",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is Opsgenie being shut down?",
        answer:
          "Yes. Atlassian stopped new Opsgenie purchases and trials in June 2025 and has set end of support for April 5, 2027. Existing customers must migrate their data and configuration to Jira Service Management or Compass before that date, which is a forced migration off the product.",
      },
      {
        question:
          "Why move to OneUptime instead of Jira Service Management or Compass?",
        answer:
          "Migrating within Atlassian still leaves you with an alerting tool that needs separate monitoring and status page products, and Jira Service Management incident features sit in the pricier Premium tier at roughly $51 per agent per month. OneUptime replaces the whole stack with one unified, open-source platform and flat per-monitor pricing.",
      },
      {
        question: "Does Opsgenie include monitoring?",
        answer:
          "No. Opsgenie is an alert-routing and on-call tool that ingests alerts from external monitoring systems through integrations. OneUptime has native monitoring for websites, APIs, servers, containers, synthetics, SSL certificates, and cron jobs built in, with 7+ global probe locations.",
      },
      {
        question: "Does Opsgenie include a status page?",
        answer:
          "No. Opsgenie relies on Atlassian Statuspage, a separately-priced product, integrated through a two-way connection. OneUptime includes public and private status pages with unlimited subscribers, custom domains, free SSL, and automatic updates from your monitors at no extra cost.",
      },
      {
        question: "How does OneUptime pricing compare to Opsgenie?",
        answer:
          "Opsgenie charges per user per month across Essentials, Standard, and Enterprise tiers, so costs grow with every responder. OneUptime charges a flat $1 per active monitor with unlimited free manual monitors and no per-check caps, plus a generous free tier and free self-hosting, so pricing stays predictable as your team grows.",
      },
      {
        question: "Can I self-host OneUptime?",
        answer:
          "Yes. OneUptime is open-source under the Apache 2.0 license and can be self-hosted on your own infrastructure for free, giving you full control of your data. Opsgenie is closed-source Atlassian SaaS with no self-hosting option.",
      },
      {
        question: "Will I lose on-call features by switching from Opsgenie?",
        answer:
          "No. OneUptime provides on-call rotations, multi-level escalation policies, overrides and follow-the-sun scheduling, and alerts via SMS, phone call, email, push, Slack, and Microsoft Teams. You keep the on-call capabilities and gain integrated monitoring, incidents, status pages, and telemetry.",
      },
    ],
  },
  squadcast: {
    productName: "Squadcast",
    iconUrl: "/img/squadcast.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One unified reliability platform vs an on-call-only tool",
    competitorFocus:
      "Squadcast (now part of SolarWinds) specializes in on-call scheduling and incident response but relies on external tools for uptime and infrastructure monitoring, logs, metrics, and traces.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry data in a single open-source platform, so you are not stitching together separate tools.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Squadcast is a per-seat SRE platform focused on on-call alerting, escalation, and incident response, with SRE workflows like SLO tracking, service graphs, and runbooks on higher tiers. It ingests alerts from external monitoring tools rather than generating its own uptime or telemetry signals. Following its acquisition by SolarWinds, it is being folded into a broader incident-response portfolio.",
    oneUptimeDescription:
      "OneUptime is an open-source, Apache 2.0 platform that combines uptime and infrastructure monitoring, public and private status pages, on-call and escalation, incident management, and OpenTelemetry logs, metrics, and traces. It is billed at a flat $1 per active monitor per month instead of per user, and can be self-hosted for free. That means one bill, one login, and no per-seat tax as your team grows.",
    description:
      "Squadcast is a capable on-call and incident-response tool, but it does not monitor your systems itself. You still have to buy and connect a separate uptime monitor, an APM or telemetry backend, and often a separate status-page product, then pay Squadcast per user on top. OneUptime brings monitoring, status pages, on-call, incident management, and telemetry into one open-source platform. The result is fewer vendors, one predictable bill, and no tool sprawl.",
    descriptionLine2:
      "Instead of paying per seat and wiring up external monitors, you get uptime checks, telemetry, alerting, and status pages in one place for a flat $1 per active monitor, with free self-hosting always available.",
    migrationBenefits: [
      "Replace Squadcast plus a separate uptime monitor, telemetry backend, and status-page tool with one unified platform",
      "Switch from per-seat pricing to a flat $1 per active monitor, so adding responders never inflates your bill",
      "Get native website, API, server, container, synthetic, SSL, port, and cron monitoring built in, not just alert ingestion",
      "Ingest OpenTelemetry logs, metrics, and traces alongside incidents for real root-cause context Squadcast does not store",
      "Publish unlimited status page subscribers on every plan instead of Squadcast's 5,000-per-page cap on higher tiers",
      "Self-host the entire Apache 2.0 platform for free with full data ownership, or use the managed cloud",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "per month",
        features: [
          "Up to 5 users",
          "Basic on-call scheduling and escalation",
          "175+ alert-source integrations",
          "Incident response basics",
        ],
        limitations: [
          "No native uptime or infrastructure monitoring",
          "No status pages",
          "No SLO tracking or SRE workflows",
        ],
      },
      {
        name: "Pro",
        price: "$12",
        period: "per user / month",
        features: [
          "Unlimited users and services",
          "Core on-call and incident response",
          "Up to 5 teams",
          "6 months data retention",
          "Runbooks and basic automation",
        ],
        limitations: [
          "Limited postmortems (around 5 per month)",
          "No status pages on this tier",
          "No SLO tracker or service graph",
          "No logs, metrics, or traces",
        ],
      },
      {
        name: "Premium",
        price: "$19",
        period: "per user / month",
        features: [
          "Everything in Pro",
          "Status pages (5 pages, 5,000 subscribers each)",
          "SLO tracker and service dependency graph",
          "Custom user roles",
          "Phone support and dedicated account manager",
        ],
        limitations: [
          "Status page subscribers capped per page",
          "Still no native monitoring or telemetry",
          "Cost scales with every added seat",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "contact sales",
        features: [
          "Everything in Premium",
          "On-premise deployment option",
          "Advanced security and controls",
          "Custom onboarding and SLAs",
        ],
        limitations: [
          "Quote-based, negotiated pricing",
          "Per-seat model still applies",
          "No bundled uptime monitoring or telemetry",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "10-person DevOps team needing on-call plus real uptime monitoring for 50 endpoints",
        competitorSolution:
          "Squadcast Premium at $19/user for on-call and status pages, plus a separate uptime monitoring tool for the 50 endpoints",
        competitorCost:
          "$190/mo for Squadcast seats, plus a separate monitoring subscription",
        oneuptimeSolution:
          "OneUptime for on-call, incident management, status pages, and 50 active monitors, with unlimited team seats",
        oneuptimeCost: "About $50/mo for 50 active monitors, seats included",
      },
      {
        scenario:
          "Growing 25-person engineering org wanting incidents, status pages, and telemetry in one place",
        competitorSolution:
          "Squadcast Premium for 25 seats, plus a separate logs/metrics/traces backend since Squadcast stores none",
        competitorCost:
          "$475/mo in Squadcast seats, plus a telemetry vendor billed by data volume",
        oneuptimeSolution:
          "OneUptime for on-call, incidents, status pages, monitors, and OpenTelemetry ingestion, seats included",
        oneuptimeCost:
          "$1 per active monitor plus about $0.10/GB telemetry, no per-seat fees",
      },
      {
        scenario:
          "Startup that wants full reliability tooling but must control cost",
        competitorSolution:
          "Squadcast Pro at $12/user, upgrading to Premium for status pages, plus external monitoring",
        competitorCost: "$12-19 per user every month, rising with headcount",
        oneuptimeSolution:
          "Self-host OneUptime for free, or use the generous free cloud tier and pay only for active monitors",
        oneuptimeCost: "$0 self-hosted, or $1 per active monitor on cloud",
      },
    ],
    keyDifferences: [
      {
        title: "Built-in monitoring, not just alert routing",
        description:
          "Squadcast reacts to alerts from external tools; OneUptime natively monitors websites, APIs, servers, containers, SSL, ports, and cron jobs so the signal and the response live in one platform.",
        icon: "monitoring",
      },
      {
        title: "Truly unified platform",
        description:
          "OneUptime combines monitoring, status pages, on-call, incidents, and telemetry, while Squadcast covers on-call and incidents and leaves monitoring and observability to other vendors.",
        icon: "unified",
      },
      {
        title: "Open source and self-hostable",
        description:
          "OneUptime is Apache 2.0 licensed and can be self-hosted for free with full data ownership, whereas Squadcast is a closed, SaaS-first product now owned by SolarWinds.",
        icon: "open-source",
      },
      {
        title: "Per-monitor pricing, not per-seat",
        description:
          "OneUptime charges a flat $1 per active monitor so responders are free to add, while Squadcast bills $12 to $19 per user every month.",
        icon: "pricing",
      },
      {
        title: "Unlimited status page subscribers",
        description:
          "OneUptime status pages allow unlimited subscribers on every plan, versus Squadcast's cap of about 5,000 subscribers per page on Premium.",
        icon: "subscribers",
      },
      {
        title: "Native telemetry with OpenTelemetry",
        description:
          "OneUptime ingests logs, metrics, and traces to give incidents real root-cause context, something Squadcast does not store or provide.",
        icon: "transparent",
      },
    ],
    items: [
      {
        name: "On-Call & Incident Response",
        data: [
          {
            title: "On-call schedules and rotations",
            description: "Daily, weekly, or custom rotations for responders",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description:
              "Escalate to the next responder or level automatically",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation cover",
            description: "Temporary schedule overrides and follow-the-sun",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS, phone, email, and push alerts",
            description: "Reach responders across multiple channels",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams collaboration",
            description: "Manage incidents from chat",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems and action items",
            description: "Structured retros with follow-up tracking",
            productColumn: "Limited on Pro",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR and incident analytics",
            description: "Measure response and resolution performance",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Included without per-seat fees",
            description: "Add responders without growing the bill",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website and API monitoring",
            description: "Check uptime and response of URLs and endpoints",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure monitoring",
            description: "CPU, memory, and disk metrics from hosts",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Docker and Kubernetes workloads",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description: "Scripted multi-step user flows",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate and port monitoring",
            description: "Catch expiring certs and closed ports",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed scheduled jobs",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Alert ingestion from external monitors",
            description: "Receive alerts routed from third-party tools",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global and private probe locations",
            description: "7+ global probes plus private probes",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public and private status pages",
            description: "Share status internally or externally",
            productColumn: "Premium only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap on people who can subscribe",
            productColumn: "5,000 per page",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom domain with free SSL",
            description: "Host status on your own domain",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Fully brand and script the page",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Status reflects live monitor state",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance windows",
            description: "Announce planned work in advance",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, RSS, Slack, Teams",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry & Observability",
        data: [
          {
            title: "Log management",
            description: "Collect and search application logs",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Store and query time-series metrics",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry native ingestion",
            description: "Standards-based data collection",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Visualize telemetry and reliability data",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application errors",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SLO tracking",
            description: "Track objectives and error budgets",
            productColumn: "Premium only",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Automation",
        data: [
          {
            title: "Workflow automation",
            description: "Automate reliability and response tasks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and native webhooks",
            description: "Programmatic access and event hooks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Third-party integrations",
            description: "Connect monitoring and collaboration tools",
            productColumn: "175+",
            oneuptimeColumn: "2000+ via Zapier",
          },
          {
            title: "AI assistant",
            description: "AI help for reliability workflows",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML and RBAC",
            description: "Enterprise identity and access control",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track who changed what",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2, ISO 27001, GDPR",
            description: "Recognized security and privacy standards",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Pricing & Deployment",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Inspect, extend, and own the code",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Free self-hosting",
            description: "Run the full platform on your own infra",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable per-monitor pricing",
            description: "Flat $1 per active monitor, no per-check tiers",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "No per-seat fees",
            description: "Add responders without growing the bill",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Generous free tier",
            description: "Real capability without a credit card",
            productColumn: "Up to 5 users",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited free manual monitors",
            description: "Static and manual monitors at no cost",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Monitoring, status, on-call, telemetry in one bill",
            description: "One vendor instead of several",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question:
          "Does Squadcast include its own uptime or infrastructure monitoring?",
        answer:
          "No. Squadcast is an on-call and incident-response platform that ingests alerts from external monitoring tools. It does not run its own website, API, server, container, or SSL checks. OneUptime includes all of that natively, so your monitoring and your response live in one platform.",
      },
      {
        question: "How does pricing compare between Squadcast and OneUptime?",
        answer:
          "Squadcast charges per user, roughly $12 per user on Pro and $19 per user on Premium each month, so costs climb as your team grows. OneUptime charges a flat $1 per active monitor with no per-seat fees, plus about $0.10 per GB for telemetry, and self-hosting is free.",
      },
      {
        question: "Does Squadcast offer status pages?",
        answer:
          "Status pages are available on Squadcast's Premium tier and above, with a cap of around 5,000 subscribers per page. OneUptime includes public and private status pages with unlimited subscribers, custom domains, free SSL, and full branding on every plan.",
      },
      {
        question: "Can I store logs, metrics, and traces in Squadcast?",
        answer:
          "No. Squadcast does not store telemetry data; it focuses on alerts, on-call, and incidents. OneUptime is OpenTelemetry-native and ingests logs, metrics, and traces so responders get real root-cause context during an incident.",
      },
      {
        question: "Is OneUptime open source and can I self-host it?",
        answer:
          "Yes. OneUptime is licensed under Apache 2.0 and can be fully self-hosted for free with complete data ownership, or used as a managed cloud service. Squadcast is a closed-source SaaS product, now part of SolarWinds, with self-hosting reserved for Enterprise.",
      },
      {
        question:
          "What happened to Squadcast after the SolarWinds acquisition?",
        answer:
          "Squadcast was acquired by SolarWinds and is being folded into its broader incident-response and observability portfolio. If you prefer an independent, open-source platform with predictable pricing, OneUptime offers monitoring, status pages, on-call, incidents, and telemetry in one place.",
      },
      {
        question: "How hard is it to migrate from Squadcast to OneUptime?",
        answer:
          "Migration is straightforward. You recreate on-call schedules, escalation policies, and services in OneUptime, point your existing alert sources or monitors at it, and add native uptime checks. Because OneUptime is unified, you can also retire separate monitoring, status-page, and telemetry tools during the move.",
      },
    ],
  },
  firehydrant: {
    productName: "FireHydrant",
    iconUrl: "/img/firehydrant.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs an incident tool that needs its own monitoring",
    competitorFocus:
      "FireHydrant specializes in the incident response lifecycle (runbooks, retrospectives, Slack and Teams collaboration, and its newer Signals on-call), but relies on external tools to actually detect problems.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, on-call, incident management, status pages, and telemetry in a single open-source platform, so you detect and respond in one place.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "FireHydrant is a dedicated incident management and response platform built around runbooks, retrospectives, and Slack and Teams-driven collaboration, with status pages and a Signals on-call and alerting module. It is strong at organizing the incident lifecycle once an issue is known, but it does not monitor your systems, so it must be paired with a separate monitoring or observability stack to detect outages.",
    oneUptimeDescription:
      "OneUptime is an open-source, self-hostable reliability platform that combines uptime and infrastructure monitoring, on-call and escalations, incident management, status pages, and OpenTelemetry logs, metrics, and traces. Because detection and response live in the same product, monitors can automatically open, update, and post incidents without stitching multiple vendors together.",
    description:
      "FireHydrant and OneUptime both help teams run a disciplined incident process, but they start from different places. FireHydrant is an incident-first tool that assumes another product is already watching your systems and telling it when something breaks. OneUptime is a unified platform that watches your systems itself and then drives the full incident lifecycle, so a single tool covers detection through resolution and public communication. That means less integration work, one predictable bill, and no gap between the alert and the response.",
    descriptionLine2:
      "Instead of buying FireHydrant for incidents and a separate monitoring vendor to feed it, teams get monitoring, on-call, incidents, status pages, and telemetry from one open-source platform at a flat, predictable price.",
    migrationBenefits: [
      "Replace FireHydrant plus a separate monitoring vendor with one unified platform that both detects and responds.",
      "Built-in website, API, server, container, synthetic, and SSL monitoring automatically opens and updates incidents.",
      "Predictable pricing at $1 per active monitor per month instead of $25 per responder per month.",
      "SMS and phone-call alerts are included, not a paid add-on you buy on top of your plan.",
      "Unlimited status page subscribers with custom domain, free SSL, and full custom HTML, CSS, and JS branding.",
      "Apache 2.0 open source and self-hostable, so you own your incident data with no per-seat lock-in.",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "forever",
        features: [
          "Up to 10 responders",
          "Slack and Teams incident bot",
          "1 public status page",
          "2 runbooks",
          "3 integrations",
        ],
        limitations: [
          "No on-call scheduling (Signals)",
          "No SMS or phone-call alerts",
          "No built-in monitoring or telemetry",
          "Single status page only",
        ],
      },
      {
        name: "Pro",
        price: "$25",
        period: "per responder / month (billed annually)",
        features: [
          "Signals on-call scheduling and escalations",
          "Unlimited public status pages",
          "Unlimited escalation policies and alert rules",
          "SSO and service catalog",
          "5 runbooks and 5 integrations",
        ],
        limitations: [
          "SMS and voice alerts cost extra",
          "No built-in monitoring to detect issues",
          "Private status pages are Enterprise only",
          "Incident analytics are Enterprise only",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "annual contract",
        features: [
          "Private incidents and private status pages",
          "Incident analytics and MTTR reporting",
          "Unlimited runbooks and integrations",
          "FireHydrant AI, SCIM, and audit logs",
          "SLAs and dedicated success manager",
        ],
        limitations: [
          "Still no monitoring or observability included",
          "Custom quote and annual commitment required",
          "Per-responder cost scales with headcount",
          "Alert grouping gated to this tier",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A 10-engineer startup needs on-call, incident response, and a public status page.",
        competitorSolution:
          "FireHydrant Pro at $25 per responder per month, plus a separate monitoring tool to detect outages, plus the SMS and voice add-on for reliable paging.",
        competitorCost: "~$250/mo + monitoring tool + SMS add-on",
        oneuptimeSolution:
          "OneUptime unified: monitoring, on-call, incident management, and a branded status page in one platform.",
        oneuptimeCost: "~$20-50/mo (monitors at $1 each)",
      },
      {
        scenario:
          "A 30-engineer scale-up needs private status pages, incident analytics, and audit logs.",
        competitorSolution:
          "Requires FireHydrant Enterprise on a custom annual contract, and still has no monitoring or telemetry of its own.",
        competitorCost: "Custom Enterprise, roughly $9k-15k+/yr",
        oneuptimeSolution:
          "OneUptime includes private status pages, MTTR analytics, RBAC, and audit logs on its standard predictable tiers.",
        oneuptimeCost: "~$99/mo Growth tier",
      },
      {
        scenario:
          "An SRE team wants to detect outages and run the full incident lifecycle without tool sprawl.",
        competitorSolution:
          "FireHydrant runs the incident process well, but you must buy and integrate a separate monitoring and observability stack to feed it alerts.",
        competitorCost: "FireHydrant + Datadog-style monitoring bill",
        oneuptimeSolution:
          "OneUptime detects with built-in monitors and OpenTelemetry, then automatically creates, updates, and communicates the incident.",
        oneuptimeCost: "One bill, telemetry ~$0.10/GB",
      },
    ],
    keyDifferences: [
      {
        title: "Detection Is Built In",
        description:
          "OneUptime monitors websites, APIs, servers, containers, SSL, and cron jobs to detect issues itself; FireHydrant relies on an external monitoring tool to tell it when something is wrong.",
        icon: "monitoring",
      },
      {
        title: "Unified, Not Incident-Only",
        description:
          "OneUptime covers monitoring, on-call, incidents, status pages, and telemetry in one product, replacing the multi-vendor stack FireHydrant sits inside.",
        icon: "unified",
      },
      {
        title: "Open Source and Self-Hostable",
        description:
          "OneUptime is Apache 2.0 licensed and can run on your own infrastructure for free; FireHydrant is a closed, hosted SaaS.",
        icon: "open-source",
      },
      {
        title: "Predictable Flat Pricing",
        description:
          "OneUptime bills a flat $1 per active monitor with no per-seat charge, while FireHydrant charges $25 per responder per month plus add-ons.",
        icon: "pricing",
      },
      {
        title: "SMS and Voice Included",
        description:
          "OneUptime includes SMS and phone-call alerting in the platform; on FireHydrant, SMS and voice notifications are a paid add-on.",
        icon: "sms",
      },
      {
        title: "Unlimited Status Page Subscribers",
        description:
          "OneUptime status pages support unlimited subscribers with custom domain, free SSL, and full custom branding out of the box.",
        icon: "subscribers",
      },
    ],
    items: [
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description:
              "Chronological record of every incident event and update.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks and automation",
            description: "Automate repetitive response steps and workflows.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Retrospectives / postmortems",
            description:
              "Structured learning and postmortem documents after incidents.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams collaboration",
            description: "Drive incidents from chat with a dedicated bot.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities and custom fields",
            description:
              "Classify and enrich incidents with your own taxonomy.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up tasks to closure after an incident.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR and incident analytics",
            description:
              "Trend analysis and mean-time-to-resolution reporting.",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private incidents",
            description: "Restrict sensitive incidents to specific people.",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring and Detection",
        data: [
          {
            title: "Website / URL monitoring",
            description: "Detect downtime and slow responses on web endpoints.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API availability and response correctness.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure monitoring",
            description: "Track CPU, memory, and disk on hosts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container and Kubernetes monitoring",
            description: "Monitor Docker and Kubernetes workloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description: "Script multi-step user journeys to catch breakages.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron / heartbeat monitoring",
            description: "Detect failed or missed scheduled jobs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from multiple regions plus private probes.",
            productColumn: "",
            oneuptimeColumn: "7+ locations",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Communicate live status to customers.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal or authenticated status pages.",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap on people subscribed to updates.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host the page on your own domain with SSL.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML, CSS, and JS branding",
            description: "Fully control look and feel of the page.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description:
              "Status reflects monitor health without manual posting.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned maintenance windows.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Component groups",
            description: "Organize services into logical groups.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "On-call rotations and schedules",
            description: "Daily, weekly, and custom rotations.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts up the chain.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Notify responders via text message.",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone-call alerts",
            description: "Reach responders with an automated voice call.",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams alerts",
            description: "Page responders through chat platforms.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Mobile push notifications",
            description: "Push alerts to a mobile app.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation",
            description: "Cover shifts and follow-the-sun handoffs.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry and Observability",
        data: [
          {
            title: "Log management",
            description: "Ingest, store, and search application logs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Collect and chart time-series metrics.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed traces",
            description: "Trace requests across services.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry native",
            description: "First-class OpenTelemetry ingestion.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Build custom observability dashboards.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Error and exception tracking",
            description: "Capture and group application exceptions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Inspect, extend, and self-host the code.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable for free",
            description: "Run on your own infrastructure at no license cost.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable pricing",
            description: "Flat, per-monitor cost versus per-responder seats.",
            productColumn: "Per responder",
            oneuptimeColumn: "$1/monitor",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO / SAML",
            description: "Single sign-on for your organization.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track who did what across the platform.",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "AI copilot / assistant",
            description: "AI assistance for incidents and operations.",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2 Type II and ISO 27001",
            description: "Recognized security and compliance attestations.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Does FireHydrant include monitoring to detect outages?",
        answer:
          "No. FireHydrant focuses on the incident response lifecycle and relies on an external monitoring or observability tool to detect problems and trigger alerts. OneUptime includes website, API, server, container, synthetic, SSL, and cron monitoring, so detection and response live in one platform and monitors can open incidents automatically.",
      },
      {
        question:
          "How does OneUptime pricing compare to FireHydrant's per-responder model?",
        answer:
          "FireHydrant Pro is $25 per responder per month billed annually, so costs scale with your team size, and Enterprise features require a custom contract. OneUptime bills a flat $1 per active monitor per month with a generous free tier, unlimited free manual monitors, and no per-seat charge, making spend predictable as your team grows.",
      },
      {
        question:
          "Can OneUptime replace FireHydrant Signals for on-call and alerting?",
        answer:
          "Yes. OneUptime provides on-call rotations, multi-level escalation policies, overrides, and follow-the-sun scheduling, with alerts by SMS, phone call, email, push, Slack, and Microsoft Teams. Unlike FireHydrant, where SMS and voice are a paid add-on, those channels are included.",
      },
      {
        question: "What about status pages, including private ones?",
        answer:
          "FireHydrant offers public status pages, but private status pages and incident analytics are gated to its Enterprise tier. OneUptime provides both public and private status pages with unlimited subscribers, custom domains, free SSL, and full custom branding on standard tiers.",
      },
      {
        question: "Is OneUptime really open source?",
        answer:
          "Yes. OneUptime is licensed under Apache 2.0 and can be self-hosted on your own infrastructure for free, so you fully own your incident and monitoring data. FireHydrant is a closed, hosted SaaS product.",
      },
      {
        question:
          "Does OneUptime handle runbooks and retrospectives like FireHydrant?",
        answer:
          "Yes. OneUptime supports runbooks, incident timelines, severities, postmortems, action items, and Slack and Teams incident collaboration, plus MTTR analytics. You get the incident lifecycle FireHydrant is known for, alongside the monitoring and telemetry it lacks.",
      },
      {
        question: "How hard is it to migrate from FireHydrant to OneUptime?",
        answer:
          "Most teams start by pointing their monitors and alert sources at OneUptime and rebuilding on-call schedules, escalation policies, and status pages, which is straightforward given the unified model. Because OneUptime also detects issues, you can retire a separate monitoring vendor at the same time and consolidate onto one bill.",
      },
    ],
  },
  rootly: {
    productName: "Rootly",
    iconUrl: "/img/rootly.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One unified reliability platform vs a Slack-native incident tool",
    competitorFocus:
      "Rootly automates incident response inside Slack and offers a paired on-call product, but has no monitoring, telemetry, or detection of its own.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, telemetry, status pages, on-call, and incident management in one open-source platform, so detection and response live together.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Rootly is an AI-native, Slack-first incident management platform with a separately priced On-Call product. It excels at automating response workflows, retrospectives, and communications once an incident is declared, and connects to external tools like Datadog, Grafana, and Sentry as alert sources. It does not collect monitoring signals or store telemetry itself and depends on those third-party tools to detect problems.",
    oneUptimeDescription:
      "OneUptime is an open-source, self-hostable reliability platform that combines monitoring, logs, metrics, traces, status pages, on-call, and incident management in one place. Because detection and response share one system, alerts from your own monitors flow straight into incidents and automatic status page updates. Active monitors are billed a flat $1 per month with no per-seat charges, and self-hosting is free.",
    description:
      "Rootly is a capable, Slack-native incident management and on-call tool, but it only starts working after something else has already detected a problem. It has no built-in website, API, or infrastructure monitoring and no telemetry storage, so you still need Datadog, Grafana, or similar tools underneath it, each billed separately and per user. OneUptime takes a different approach: monitoring, telemetry, status pages, on-call, and incident management are one open-source platform, so detection and response are never in separate silos. You get the same incident and on-call capabilities plus the monitors that trigger them, at flat per-monitor pricing with no per-seat fees.",
    descriptionLine2:
      "Consolidate detection and response into one predictable, open-source platform instead of stitching Rootly to a stack of separate monitoring, telemetry, and status page tools.",
    migrationBenefits: [
      "Detect and respond in one platform, with your own monitors triggering incidents and status page updates automatically.",
      "Add native website, API, server, container, synthetic, SSL, and cron monitoring that Rootly does not provide at all.",
      "Store and query logs, metrics, and traces with OpenTelemetry-native observability instead of paying a separate telemetry vendor.",
      "Replace per-user seat fees with a flat $1 per active monitor and unlimited free static monitors, so cost scales with infrastructure, not headcount.",
      "Run status pages with unlimited subscribers, custom domains, and free SSL rather than Rootly's one-status-page Essentials limit.",
      "Own your reliability stack with an Apache 2.0, self-hostable platform that avoids the incident-plus-on-call-plus-monitoring tool sprawl.",
    ],
    competitorPricingTiers: [
      {
        name: "Incident Response Essentials",
        price: "$20",
        period: "per user / month",
        features: [
          "Slack-native incident response",
          "AI chat, AI similar incidents, AI Scribe bot",
          "Retrospectives and advanced metrics",
          "One external status page",
          "SSO and SAML",
        ],
        limitations: [
          "No built-in monitoring or telemetry",
          "Limited to 1 external / 1 internal status page",
          "Advanced workflows are Enterprise-only",
          "Billed per user, annually",
        ],
      },
      {
        name: "On-Call Essentials",
        price: "$20",
        period: "per user / month",
        features: [
          "Schedules, overrides, and escalation policies",
          "Alert grouping and alert routes",
          "Live call routing with one number",
          "Holiday, PTO, and shadow rotations",
          "Mobile app",
        ],
        limitations: [
          "Capped at 20 schedules / escalation policies",
          "Only 1 live-call-routing number",
          "Separate product billed on top of incident response",
          "Per-user pricing",
        ],
      },
      {
        name: "Incident Response Enterprise",
        price: "Custom quote",
        period: "annual contract",
        features: [
          "Custom and dynamic forms, custom incident types",
          "Private incidents and native secrets management",
          "Advanced workflows and audit logs",
          "SSO, SAML, and SCIM",
          "Up to 10 external status pages",
        ],
        limitations: [
          "Quote-based, sales-led pricing",
          "Still no native monitoring or telemetry",
          "On-Call and AI SRE cost extra",
          "Annual prepayment typically required",
        ],
      },
      {
        name: "On-Call Enterprise",
        price: "Custom quote",
        period: "annual contract",
        features: [
          "Dynamic escalation paths",
          "Unlimited schedules",
          "Up to 5 live-call-routing numbers",
          "Custom alert fields",
          "China support",
        ],
        limitations: [
          "Contact sales for pricing",
          "Per-user billing on annual contract",
          "No monitoring or telemetry of its own",
          "Priced separately from incident response",
        ],
      },
      {
        name: "AI SRE",
        price: "Custom quote",
        period: "add-on",
        features: [
          "Root cause identification",
          "Alert correlation with recent changes",
          "Remediation step generation",
          "API and MCP access",
        ],
        limitations: [
          "Enterprise, quote-only pricing",
          "Sold as an add-on to other products",
          "Requires connected third-party telemetry",
          "Does not store telemetry itself",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A 25-person engineering team needs both incident response and on-call.",
        competitorSolution:
          "Rootly Incident Response Essentials plus On-Call Essentials at $20 + $20 per user per month.",
        competitorCost: "~$12,000 / year (25 users)",
        oneuptimeSolution:
          "OneUptime includes incident management and on-call for all users at no per-seat cost; pay only for active monitors.",
        oneuptimeCost: "~$600 / year for 50 monitors, $0 per user",
      },
      {
        scenario:
          "A startup wants monitoring, status pages, on-call, and incident response in one stack.",
        competitorSolution:
          "Rootly for incidents and on-call, plus a separate monitoring/telemetry vendor (Datadog, Grafana) as the detection layer.",
        competitorCost: "Rootly seats + separate monitoring bill",
        oneuptimeSolution:
          "OneUptime covers monitoring, telemetry, status pages, on-call, and incidents in a single platform on the free tier and flat monitor pricing.",
        oneuptimeCost: "Free tier + $1 / active monitor",
      },
      {
        scenario:
          "A 100-user organization needs incidents, on-call, status pages, and observability.",
        competitorSolution:
          "Rootly Incident Response plus On-Call at ~$40 per user per month, with a separate observability platform for logs, metrics, and traces.",
        competitorCost: "~$48,000 / year, before telemetry costs",
        oneuptimeSolution:
          "OneUptime Growth tier plus flat per-monitor and per-GB telemetry pricing, with no per-user fees and self-hosting free.",
        oneuptimeCost: "~$99 / month + usage",
      },
    ],
    keyDifferences: [
      {
        title: "One platform, not three products",
        description:
          "Rootly splits incident response, on-call, and AI SRE into separately priced products. OneUptime delivers monitoring, telemetry, status pages, on-call, and incidents in a single platform.",
        icon: "unified",
      },
      {
        title: "Native monitoring and detection",
        description:
          "Rootly has no monitoring of its own and relies on external tools as alert sources. OneUptime monitors websites, APIs, servers, containers, SSL, ports, and cron jobs from 7+ global probe locations.",
        icon: "monitoring",
      },
      {
        title: "Status pages driven by your monitors",
        description:
          "Rootly status pages update from incident workflows and cap at one external page on Essentials. OneUptime status pages update automatically from monitors and support unlimited subscribers and custom domains.",
        icon: "status-page",
      },
      {
        title: "Open source and self-hostable",
        description:
          "Rootly is a closed-source SaaS. OneUptime is Apache 2.0 licensed, free to self-host, and gives you full control of your reliability data.",
        icon: "open-source",
      },
      {
        title: "Flat, predictable pricing",
        description:
          "Rootly charges $20+ per user per month for each product, so cost grows with headcount. OneUptime bills a flat $1 per active monitor with unlimited free static monitors and no per-seat fees.",
        icon: "transparent",
      },
      {
        title: "On-call and telemetry included",
        description:
          "Rootly on-call is a separate paid product and it stores no telemetry. OneUptime includes on-call plus logs, metrics, and traces in the same platform.",
        icon: "on-call",
      },
    ],
    items: [
      {
        name: "Incident Management",
        data: [
          {
            title: "Slack-native incident response",
            description: "Declare and manage incidents directly in Slack.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Microsoft Teams collaboration",
            description: "Run incident collaboration in Microsoft Teams.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident timelines and severities",
            description: "Track severity, status, and a full event timeline.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems and retrospectives",
            description: "Structured retrospectives with action items.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automated workflows and runbooks",
            description: "Automate response steps and runbooks.",
            productColumn: "Advanced is Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR and incident analytics",
            description: "Metrics and insights on response performance.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "AI incident assistance",
            description: "AI summaries, similar incidents, and scribe.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website and URL monitoring",
            description: "Check uptime and response of web endpoints.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Monitor API endpoints and validate responses.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure monitoring",
            description: "Track CPU, memory, and disk on hosts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description: "Script multi-step user journeys.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed jobs and dead crons.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from multiple regions worldwide.",
            productColumn: "",
            oneuptimeColumn: "7+ locations",
          },
          {
            title: "Ingests monitor alerts natively",
            description: "Turn monitor signals into incidents.",
            productColumn: "Via integrations",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status page",
            description: "Branded, customer-facing status page.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private / internal status page",
            description: "Restricted status pages for stakeholders.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Number of status pages",
            description: "How many pages you can publish.",
            productColumn: "1 on Essentials",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, and RSS updates.",
            productColumn: "Subscriptions",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host the page on your own domain.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML, CSS, and JS",
            description: "Fully customize page markup and styling.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Page reflects live monitor state.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance events",
            description: "Publish planned maintenance windows.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "On-call schedules and rotations",
            description: "Daily, weekly, and custom rotations.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate through tiers automatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation coverage",
            description: "Handle PTO and one-off coverage.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun scheduling",
            description: "Hand off across regions and time zones.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS and phone call alerts",
            description: "Reach responders via SMS and voice.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack, Teams, and push alerts",
            description: "Notify across chat and mobile push.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Schedule limits",
            description: "How many schedules you can create.",
            productColumn: "20 on Essentials",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Included with the platform",
            description: "On-call bundled, not sold separately.",
            productColumn: "Separate product",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry and Observability",
        data: [
          {
            title: "Log management",
            description: "Collect, store, and search logs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Ingest and chart time-series metrics.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native ingestion",
            description: "Store OTel logs, metrics, and traces.",
            productColumn: "Integration only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Build custom observability dashboards.",
            productColumn: "Incident metrics",
            oneuptimeColumn: "tick",
          },
          {
            title: "Error and exception tracking",
            description: "Capture and group application errors.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Telemetry data retention",
            description: "Retain and query stored telemetry.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source and self-hostable",
            description: "Run and modify the platform yourself.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable flat pricing",
            description: "Cost that does not scale with headcount.",
            productColumn: "Per user",
            oneuptimeColumn: "$1 / monitor",
          },
          {
            title: "Free tier",
            description: "Meaningful free plan to start.",
            productColumn: "Startup only",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO and SAML",
            description: "Enterprise single sign-on.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "RBAC",
            description: "Role-based access control.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track user and system activity.",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2 and ISO 27001",
            description: "Security and compliance attestations.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Does Rootly include its own monitoring?",
        answer:
          "No. Rootly does not collect monitoring signals or store telemetry itself. It connects to external tools such as Datadog, Grafana, and Sentry as alert sources, so you still need a separate monitoring platform underneath it. OneUptime includes native website, API, server, container, synthetic, SSL, and cron monitoring, so detection and response live in one platform.",
      },
      {
        question: "How much does Rootly cost in 2026?",
        answer:
          "Rootly Incident Response Essentials and On-Call Essentials are each $20 per user per month, so a team using both effectively pays around $40 per user per month. Enterprise tiers and the AI SRE product are quote-based. OneUptime does not charge per user; you pay a flat $1 per active monitor with unlimited free static monitors.",
      },
      {
        question: "Is Rootly's on-call included with incident response?",
        answer:
          "No. Rootly On-Call is a separate product with its own per-user price, and the Essentials tier caps you at 20 schedules and one live-call-routing number. OneUptime includes on-call scheduling and escalation for all users at no additional per-seat cost, with unlimited schedules.",
      },
      {
        question: "Can OneUptime fully replace Rootly?",
        answer:
          "Yes for most teams. OneUptime provides Slack and Teams incident collaboration, timelines, severities, postmortems, action items, and MTTR analytics, plus on-call rotations and escalation. On top of that it adds the monitoring, telemetry, and status pages that Rootly lacks, so you can consolidate several tools into one.",
      },
      {
        question: "Does OneUptime charge per user like Rootly?",
        answer:
          "No. OneUptime pricing is based on usage, not seats. Active monitors are billed a flat $1 per month each, manual and static monitors are free and unlimited, and telemetry ingestion is roughly $0.10 per GB. Self-hosting the open-source platform is free.",
      },
      {
        question: "Does Rootly have status pages?",
        answer:
          "Yes, but they are driven by incident workflows rather than live monitors, and the Essentials tier is limited to a single external status page. OneUptime status pages update automatically from your monitors and support unlimited subscribers, custom domains with free SSL, and full custom HTML, CSS, and JS.",
      },
      {
        question: "Is OneUptime open source?",
        answer:
          "Yes. OneUptime is licensed under Apache 2.0 and can be self-hosted for free, giving you full control of your reliability and telemetry data. Rootly is a closed-source SaaS product only.",
      },
    ],
  },
  xmatters: {
    productName: "xMatters",
    iconUrl: "/img/xmatters.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs a single-purpose alerting tool",
    competitorFocus:
      "xMatters specializes in enterprise on-call alerting and no-code toolchain workflow automation, but does not monitor your systems or host public status pages.",
    oneuptimeFocus:
      "OneUptime combines monitoring, on-call, incident management, status pages, and OpenTelemetry observability in one open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "xMatters, part of Everbridge, is an enterprise IT alerting and incident response platform built around on-call management and its Flow Designer workflow automation engine. It routes signals from your existing monitoring and DevOps tools to the right responders and coordinates resolution across the toolchain. It is a mature, well-regarded alerting layer, but it depends on other products for monitoring, telemetry, and customer-facing status pages.",
    oneUptimeDescription:
      "OneUptime is an open-source, Apache 2.0, self-hostable reliability platform that unifies monitoring, on-call, incident management, public status pages, and OpenTelemetry-based observability. It replaces several point tools with one system, so alerts arrive with full context from the same platform that detected the problem. Active monitors are billed at a flat one dollar per month, with a generous free tier and free self-hosting.",
    description:
      "xMatters is one of the strongest names in enterprise on-call alerting and workflow automation, and it does that job well. But it is a single layer of the reliability stack: it does not run your monitors, store your logs and traces, or publish a public status page to your customers. That means teams pair xMatters with separate monitoring, observability, and status-page vendors, each with its own per-user or usage bill. OneUptime brings all of those functions into one open-source platform with predictable per-monitor pricing.",
    descriptionLine2:
      "Consolidate alerting, monitoring, incidents, status pages, and telemetry into a single tool and pay a flat one dollar per active monitor instead of stacking per-user seats across multiple vendors.",
    migrationBenefits: [
      "Replace xMatters plus separate monitoring, status-page, and observability tools with one unified platform.",
      "Move from per-user metered pricing to a flat one dollar per active monitor, with no per-check tiers or seat caps.",
      "Publish public status pages with custom domains, free SSL, and unlimited subscribers at no extra cost.",
      "Add website, API, server, container, synthetic, SSL, and cron/heartbeat monitoring that xMatters does not provide.",
      "Ingest OpenTelemetry logs, metrics, and traces alongside alerting so incidents carry full context.",
      "Self-host under Apache 2.0 for complete data control, or run the managed cloud, with no vendor lock-in.",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "up to 10 users",
        features: [
          "On-call scheduling and rotations",
          "Incident management and service catalog",
          "Flow Designer workflow automation",
          "Mobile apps",
          "Unlimited email and push notifications",
        ],
        limitations: [
          "No SMS or voice notifications",
          "Capped at 10 users",
          "Only 3 months of data retention",
          "No status pages or phone support",
        ],
      },
      {
        name: "Starter (Essentials)",
        price: "$9",
        period: "per user / month",
        features: [
          "Everything in Free",
          "50 SMS and 10 voice calls per user/month",
          "Single sign-on (SSO)",
          "Incident attachments",
          "1 year of data retention",
        ],
        limitations: [
          "Capped at 100 users",
          "No playbooks or live call routing",
          "No multilingual messaging",
          "8x5 support only",
        ],
      },
      {
        name: "Base (Standard)",
        price: "$39",
        period: "per user / month",
        features: [
          "Everything in Starter",
          "100 SMS and 20 voice calls per user/month",
          "Playbooks and multilingual messaging",
          "Internal stakeholder status pages",
          "24x7 support",
        ],
        limitations: [
          "SMS and voice remain metered per user",
          "No post-incident reporting",
          "Limited incident attachments",
          "No public customer status pages",
        ],
      },
      {
        name: "Advanced",
        price: "Custom",
        period: "contact sales",
        features: [
          "Everything in Base",
          "Unlimited SMS and voice notifications",
          "Post-incident (timeline) reporting",
          "Unlimited custom roles",
          "Unlimited data retention",
        ],
        limitations: [
          "Sales contact and quote required",
          "No built-in monitoring",
          "No telemetry (logs/metrics/traces)",
          "No public status pages",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A 25-person DevOps team needs on-call alerting plus website and API monitoring.",
        competitorSolution:
          "xMatters Base at $39 per user for alerting, plus a separate monitoring tool.",
        competitorCost: "$975+/mo (users only)",
        oneuptimeSolution:
          "OneUptime unifies on-call, monitoring, and status pages in one platform.",
        oneuptimeCost: "~$100/mo (100 monitors)",
      },
      {
        scenario:
          "A growing SaaS company wants a public status page with unlimited subscribers.",
        competitorSolution:
          "xMatters offers only internal stakeholder pages, so a separate status-page vendor is required.",
        competitorCost: "Extra tool + subscriber fees",
        oneuptimeSolution:
          "OneUptime includes a public status page with custom domain and unlimited subscribers.",
        oneuptimeCost: "$0 add-on",
      },
      {
        scenario:
          "An enterprise wants alerting, incident management, and observability in one place.",
        competitorSolution:
          "xMatters Advanced (custom-priced) for alerting, plus separate APM and log vendors.",
        competitorCost: "Custom + multiple tools",
        oneuptimeSolution:
          "OneUptime unifies alerting, incidents, and OpenTelemetry telemetry.",
        oneuptimeCost: "$1/monitor + ~$0.10/GB",
      },
    ],
    keyDifferences: [
      {
        title: "Unified reliability platform",
        description:
          "xMatters is a single alerting and automation layer. OneUptime combines monitoring, on-call, incidents, status pages, and telemetry so you run one tool instead of stitching several together.",
        icon: "unified",
      },
      {
        title: "Built-in monitoring",
        description:
          "xMatters only reacts to signals from monitoring tools you supply. OneUptime actively monitors websites, APIs, servers, containers, synthetics, SSL, and cron jobs from 7+ global probe locations.",
        icon: "monitoring",
      },
      {
        title: "Public status pages included",
        description:
          "xMatters provides internal stakeholder updates, not customer-facing pages. OneUptime includes public status pages with custom domains, free SSL, custom branding, and unlimited subscribers.",
        icon: "status-page",
      },
      {
        title: "Open source and self-hostable",
        description:
          "xMatters is proprietary SaaS with no self-host option. OneUptime is Apache 2.0 licensed and can be self-hosted for free or run as managed cloud, with no vendor lock-in.",
        icon: "open-source",
      },
      {
        title: "Flat, predictable pricing",
        description:
          "xMatters charges per user per month with metered SMS and voice allotments. OneUptime charges a flat one dollar per active monitor, with unlimited free manual monitors and no seat-based tiers.",
        icon: "pricing",
      },
      {
        title: "Enterprise on-call without add-ons",
        description:
          "OneUptime matches xMatters on rotations, multi-level escalations, overrides, and follow-the-sun, with alerts via SMS, phone, email, push, Slack, and Teams, all in the base platform.",
        icon: "on-call",
      },
    ],
    items: [
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-call schedules & rotations",
            description: "Daily, weekly, and custom rotation scheduling.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description:
              "Escalate through tiers until an alert is acknowledged.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS & voice call alerts",
            description: "Reach responders by text message and phone call.",
            productColumn: "Paid tiers, metered",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides & follow-the-sun",
            description: "Vacation overrides and global handoff coverage.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notifications",
            description: "Mobile push alerts to on-call responders.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack & Microsoft Teams alerts",
            description: "Deliver and acknowledge alerts inside chat tools.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "No-code workflow automation",
            description:
              "Visual builder for alert routing and toolchain actions.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Live call routing / conference bridge",
            description: "Route inbound calls and spin up conference lines.",
            productColumn: "Base+ tiers",
            oneuptimeColumn: "",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website & URL monitoring",
            description: "Uptime and response checks for web endpoints.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API availability and response payloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server & infrastructure metrics",
            description: "Track CPU, memory, and disk on hosts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring (Docker/K8s)",
            description: "Monitor containerized and Kubernetes workloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic & transaction monitoring",
            description: "Scripted multi-step user journey checks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before TLS certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron / heartbeat monitoring",
            description: "Detect missed jobs and silent failures.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from multiple regions plus private probes.",
            productColumn: "",
            oneuptimeColumn: "7+ locations",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public customer status page",
            description: "Externally hosted page for customer communication.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Internal stakeholder pages",
            description: "Private updates for internal stakeholders.",
            productColumn: "Base+ tiers",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap on status-page subscribers.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain + free SSL",
            description: "Host the page on your own domain with SSL.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding & HTML/CSS/JS",
            description: "Fully brand and theme the status page.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, RSS, Slack, and Teams updates.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Status reflects monitor state automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance & component groups",
            description: "Publish maintenance windows and grouped components.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological record of incident activity.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities & prioritization",
            description: "Classify incidents by severity level.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks / playbooks",
            description: "Guided response procedures for responders.",
            productColumn: "Base+ tiers",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems & action items",
            description: "Capture learnings and follow-up tasks.",
            productColumn: "Advanced tier",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack & Teams incident collaboration",
            description: "Coordinate response from within chat tools.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution over time.",
            productColumn: "Advanced tier",
            oneuptimeColumn: "tick",
          },
          {
            title: "Service catalog & dependencies",
            description: "Model services and their ownership.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry & Observability",
        data: [
          {
            title: "Log management",
            description: "Collect, search, and alert on application logs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Store and visualize time-series metrics.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed traces",
            description: "Trace requests across services.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry native",
            description: "Ingest OTel data without proprietary agents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Build dashboards across signals.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Error & exception tracking",
            description: "Capture and group application exceptions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Source-available, community-inspectable code.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hosting",
            description: "Run the platform on your own infrastructure.",
            productColumn: "",
            oneuptimeColumn: "Free",
          },
          {
            title: "Predictable flat pricing",
            description: "Cost tied to monitors, not per-user seats.",
            productColumn: "Per-user, metered",
            oneuptimeColumn: "$1/monitor",
          },
          {
            title: "Free tier",
            description: "No-cost plan to get started.",
            productColumn: "10 users",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO / SAML",
            description: "Single sign-on for centralized access.",
            productColumn: "Starter+ tiers",
            oneuptimeColumn: "tick",
          },
          {
            title: "RBAC & audit logs",
            description: "Role-based access control and audit trails.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API & native webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2 Type II & ISO 27001",
            description: "Enterprise security and compliance attestations.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is xMatters a monitoring tool?",
        answer:
          "No. xMatters focuses on on-call alerting and workflow automation. It ingests signals from monitoring tools you provide but does not monitor websites, APIs, servers, or containers itself. OneUptime includes that monitoring built in, so detection and alerting live in one platform.",
      },
      {
        question: "Does xMatters offer public customer status pages?",
        answer:
          "xMatters provides internal stakeholder updates on higher tiers but is not a public customer status-page product. OneUptime includes public status pages with custom domains, free SSL, custom branding, and unlimited subscribers at no extra cost.",
      },
      {
        question: "How does pricing compare?",
        answer:
          "xMatters charges per user per month (roughly $9 Starter, $39 Base, and custom Advanced) with metered SMS and voice allotments. OneUptime charges a flat one dollar per active monitor, offers unlimited free manual monitors, and prices telemetry ingestion at about $0.10 per GB, so costs stay predictable as teams grow.",
      },
      {
        question: "Can I self-host instead of using SaaS?",
        answer:
          "OneUptime is open source under Apache 2.0 and can be self-hosted for free, or run as managed cloud. xMatters is a proprietary SaaS with no self-hosting option, so your alerting data stays in the vendor's environment.",
      },
      {
        question: "Does OneUptime match xMatters on on-call and escalations?",
        answer:
          "Yes. OneUptime supports daily, weekly, and custom rotations, multi-level escalation policies, overrides and vacation, and follow-the-sun coverage, with alerts via SMS, phone call, email, push, Slack, and Microsoft Teams.",
      },
      {
        question: "Can I recreate my xMatters workflows in OneUptime?",
        answer:
          "Yes. OneUptime provides workflows, a REST API, native webhooks, and 2000+ integrations via Zapier to reproduce alert routing and toolchain automation, plus Sentinel, OneUptime's AI assistant, to help configure them.",
      },
      {
        question: "Will I still need other tools after switching?",
        answer:
          "For most teams, no. OneUptime consolidates monitoring, on-call, incident management, public status pages, and observability, removing the need for a separate xMatters subscription plus monitoring and status-page vendors.",
      },
    ],
  },
  grafana: {
    productName: "Grafana Cloud",
    iconUrl: "/img/grafana.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One turnkey platform vs an assembly-heavy, usage-priced stack",
    competitorFocus:
      "Grafana Cloud specializes in powerful dashboards and observability across metrics, logs, and traces, but leaves you to assemble and tune the pieces yourself.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incidents, and OpenTelemetry telemetry in one turnkey platform with predictable pricing.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Grafana Cloud is Grafana Labs' hosted observability stack, combining Grafana dashboards with Mimir for metrics, Loki for logs, Tempo for traces, Pyroscope for profiling, and k6 for synthetics and load testing. It is highly flexible and best-in-class for visualization, but it is assembled from many independent components with separate usage meters. Setting it up well typically requires significant instrumentation, tuning, and cost management expertise.",
    oneUptimeDescription:
      "OneUptime is an open-source, unified reliability platform that brings monitoring, status pages, on-call, incident management, and OpenTelemetry-native logs, metrics, and traces together in a single product. Everything is designed to work out of the box with predictable, flat pricing of $1 per active monitor per month and telemetry around $0.10/GB. You can use the generous free cloud tier or self-host the whole platform for free.",
    description:
      "Grafana Cloud is a powerful observability toolkit: Grafana dashboards on top of Mimir, Loki, Tempo, and k6, with Grafana Cloud IRM bolted on for on-call and incidents. The power comes with assembly: multiple usage meters, per-active-series metric billing, three-part logs and traces pricing, per-user IRM fees, and a steep setup and tuning curve. OneUptime takes a different approach, delivering monitoring, status pages, on-call, incident management, and OpenTelemetry telemetry as one cohesive product. You get predictable, flat pricing instead of a spreadsheet full of usage meters, and you can self-host the entire stack under Apache 2.0.",
    descriptionLine2:
      "If you want great dashboards without gluing together five products and forecasting a dozen usage meters, OneUptime gives you the whole reliability workflow in one place for a fraction of the operational overhead.",
    migrationBenefits: [
      "Replace the Grafana plus Mimir, Loki, Tempo, and IRM assembly with one unified, turnkey platform",
      "Swap unpredictable per-active-series and three-part GB usage meters for flat $1 per active monitor and ~$0.10/GB telemetry",
      "Get real public and private status pages with unlimited subscribers, which Grafana Cloud does not offer as a product",
      "Keep on-call and incident response built in, instead of paying separate per-active-user Grafana Cloud IRM fees",
      "Stay OpenTelemetry-native for logs, metrics, and traces without stitching together separate backends",
      "Self-host the entire Apache 2.0 platform for free, avoiding the complexity of running Mimir, Loki, and Tempo yourself",
    ],
    competitorPricingTiers: [
      {
        name: "Free",
        price: "$0",
        period: "per month",
        features: [
          "10,000 active metrics series",
          "50 GB logs, 50 GB traces, 50 GB profiles",
          "500 VUh of k6 load testing",
          "3 team users included",
          "14-day retention",
        ],
        limitations: [
          "Tight usage caps hit quickly in production",
          "Only 14-day data retention",
          "No customer-facing status page product",
        ],
      },
      {
        name: "Pro",
        price: "$19/mo + usage",
        period: "base plus usage",
        features: [
          "Metrics at $6.50 per 1,000 billable series",
          "Logs and traces billed per GB (process, write, retain)",
          "$8 per additional active user",
          "13-month metrics retention",
          "Access to full Grafana Cloud stack",
        ],
        limitations: [
          "Multiple independent usage meters are hard to forecast",
          "Costs scale sharply with series and data volume",
          "On-call and incidents billed separately via IRM",
          "Significant setup and tuning expertise required",
        ],
      },
      {
        name: "Grafana Cloud IRM",
        price: "~$20/active user",
        period: "plus $19/mo platform fee",
        features: [
          "On-call schedules and escalation chains",
          "Incident response merged from OnCall and Incident",
          "SMS, phone call, and mobile push alerting",
          "3 active IRM users included free",
        ],
        limitations: [
          "Billed separately from observability usage",
          "OnCall OSS was archived in March 2026",
          "Per-active-user pricing adds up for larger teams",
        ],
      },
      {
        name: "Advanced / Enterprise",
        price: "From $25,000/yr",
        period: "per year commitment",
        features: [
          "Volume discounts on usage",
          "Advanced security and compliance controls",
          "Enterprise support and SLAs",
          "Flexible deployment options",
        ],
        limitations: [
          "High minimum annual commitment",
          "Pricing is custom and opaque",
          "Still built on multiple usage meters",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup monitoring 50 endpoints with modest logs and metrics",
        competitorSolution:
          "Grafana Cloud Pro with metrics, logs, and traces usage plus a few IRM users",
        competitorCost: "$19/mo base plus growing usage and per-user IRM fees",
        oneuptimeSolution:
          "50 active monitors, built-in status page, on-call, and telemetry",
        oneuptimeCost: "~$50/mo ($1 per active monitor) plus minimal telemetry",
      },
      {
        scenario:
          "Scale-up needing observability plus a public status page for customers",
        competitorSolution:
          "Grafana Cloud for dashboards plus a separate third-party status page tool",
        competitorCost: "Grafana usage plus an added status page subscription",
        oneuptimeSolution:
          "Unified monitoring, telemetry, and a branded status page with unlimited subscribers",
        oneuptimeCost:
          "Predictable Growth tier around $99/mo, status pages included",
      },
      {
        scenario: "Team that wants full control and no vendor usage bills",
        competitorSolution:
          "Self-host OSS Grafana, Mimir, Loki, and Tempo and operate each yourself",
        competitorCost:
          "No license fee but heavy engineering and infrastructure overhead",
        oneuptimeSolution:
          "Self-host the entire OneUptime platform under Apache 2.0",
        oneuptimeCost: "Free self-hosted, one unified deployment to operate",
      },
    ],
    keyDifferences: [
      {
        title: "Unified vs assembled stack",
        description:
          "OneUptime delivers monitoring, status pages, on-call, incidents, and telemetry as one product, while Grafana Cloud stitches together Mimir, Loki, Tempo, k6, and IRM.",
        icon: "unified",
      },
      {
        title: "Predictable vs usage-metered pricing",
        description:
          "OneUptime charges a flat $1 per active monitor and ~$0.10/GB telemetry, versus Grafana's per-active-series and three-part per-GB usage meters that are hard to forecast.",
        icon: "pricing",
      },
      {
        title: "Built-in status pages",
        description:
          "OneUptime includes public and private status pages with unlimited subscribers and custom domains, a product Grafana Cloud does not offer.",
        icon: "status-page",
      },
      {
        title: "On-call included, not an add-on",
        description:
          "OneUptime bundles on-call and escalations, while Grafana bills on-call and incidents separately through per-active-user Grafana Cloud IRM.",
        icon: "on-call",
      },
      {
        title: "Open-source and self-hostable",
        description:
          "OneUptime is Apache 2.0 and the whole platform self-hosts for free, without operating Mimir, Loki, and Tempo as separate systems.",
        icon: "open-source",
      },
      {
        title: "Turnkey vs steep setup",
        description:
          "OneUptime works out of the box, while Grafana Cloud typically requires significant instrumentation, tuning, and cost-management expertise to run well.",
        icon: "monitoring",
      },
    ],
    items: [
      {
        name: "Dashboards & Observability",
        data: [
          {
            title: "Custom dashboards",
            description:
              "Build visual dashboards over metrics, logs, and traces",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native ingestion",
            description: "Ingest logs, metrics, and traces via OpenTelemetry",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics backend",
            description: "Time-series metrics storage and querying",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Log management",
            description: "Centralized log aggregation and search",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "End-to-end request tracing across services",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception & error tracking",
            description: "Capture and group application exceptions",
            productColumn: "Via logs/tracing",
            oneuptimeColumn: "tick",
          },
          {
            title: "Turnkey setup",
            description: "Works without assembling separate backends",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Advanced visualization library",
            description: "Deep panel and plugin ecosystem for charts",
            productColumn: "tick",
            oneuptimeColumn: "Core panels",
          },
        ],
      },
      {
        name: "Monitoring & Synthetics",
        data: [
          {
            title: "Website & API monitoring",
            description: "Check uptime and response of URLs and APIs",
            productColumn: "Via k6 synthetics",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic & transaction checks",
            description: "Emulate user journeys from global locations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server & infrastructure monitoring",
            description: "CPU, memory, and disk metrics from hosts",
            productColumn: "Via agent/metrics",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron / heartbeat monitoring",
            description: "Detect missed scheduled jobs",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Port & ping checks",
            description: "TCP port and ICMP reachability tests",
            productColumn: "Via synthetics",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private probe locations",
            description: "Run checks from inside your own network",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Sub-second check intervals",
            description: "Frequent checks down to 1 second",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Customer-facing status and incident history",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal, access-controlled status pages",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify unlimited subscribers at no extra cost",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain + free SSL",
            description: "Host on your own domain with managed SSL",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding & HTML/CSS/JS",
            description: "Fully brand and customize the page",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance windows",
            description: "Communicate planned maintenance",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, RSS, Slack, Teams updates",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-call schedules & rotations",
            description: "Daily, weekly, and custom rotations",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts automatically",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS & phone call alerts",
            description: "Reach responders by SMS and voice",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Mobile push notifications",
            description: "Push alerts to a mobile app",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides & vacation handling",
            description: "Temporary schedule overrides",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun coverage",
            description: "Route alerts across global teams",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Included at no extra per-user fee",
            description: "On-call bundled in the platform price",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological record of incident events",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities & prioritization",
            description: "Classify incidents by severity",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured post-incident reviews",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items & runbooks",
            description: "Track follow-ups and response procedures",
            productColumn: "Partial",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack & Teams collaboration",
            description: "Coordinate incidents in chat tools",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution",
            productColumn: "Via IRM add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Auto-linked to monitors & status",
            description: "Incidents tie into monitoring and status pages",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Full platform available under a permissive license",
            productColumn: "Partial",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable",
            description: "Run the entire platform on your own infrastructure",
            productColumn: "Complex, per-component",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable flat pricing",
            description: "Simple per-monitor pricing without usage guessing",
            productColumn: "",
            oneuptimeColumn: "$1/active monitor",
          },
          {
            title: "Transparent telemetry cost",
            description: "Flat per-GB ingestion pricing",
            productColumn: "Three-part meters",
            oneuptimeColumn: "~$0.10/GB",
          },
          {
            title: "SSO/SAML, RBAC, audit logs",
            description: "Enterprise access control and auditing",
            productColumn: "Enterprise only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Compliance certifications",
            description: "SOC 2 Type II, ISO 27001, GDPR",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API & webhooks",
            description: "Automate and integrate via API",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflows & 2000+ integrations",
            description: "No-code automation and Zapier integrations",
            productColumn: "Partial",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a full replacement for Grafana Cloud?",
        answer:
          "For most reliability teams, yes. OneUptime covers monitoring, OpenTelemetry-native logs, metrics, traces, and dashboards, plus status pages, on-call, and incident management in one product. Grafana Cloud offers deeper, more customizable visualization and a larger plugin ecosystem, so teams that need highly specialized dashboards may still value it, but OneUptime replaces the everyday observability and reliability workflow without the assembly.",
      },
      {
        question: "How does OneUptime pricing compare to Grafana Cloud?",
        answer:
          "OneUptime uses simple, predictable pricing: $1 per active monitor per month, unlimited free manual and static monitors, and telemetry ingestion around $0.10/GB. Grafana Cloud Pro starts at a $19/month platform fee plus multiple usage meters, including $6.50 per 1,000 billable metrics series and a three-part per-GB charge for logs and traces, which makes bills hard to forecast.",
      },
      {
        question: "Does Grafana Cloud include a customer-facing status page?",
        answer:
          "No. Grafana Cloud focuses on dashboards and observability and does not offer a public status page product for your customers. OneUptime includes public and private status pages with unlimited subscribers, custom domains with free SSL, custom branding, and automatic updates from your monitors.",
      },
      {
        question:
          "What happened to Grafana OnCall and how does that affect me?",
        answer:
          "Grafana OnCall OSS entered maintenance mode and was archived in March 2026, with on-call and incident features consolidated into the paid Grafana Cloud IRM app, billed per active user plus a platform fee. OneUptime includes on-call rotations, escalations, and incident management in the platform, with no separate per-active-user fee.",
      },
      {
        question: "Can I self-host instead of using the cloud?",
        answer:
          "Yes. OneUptime is Apache 2.0 licensed and the entire platform self-hosts for free as a single deployment. Self-hosting the Grafana stack means running Grafana plus separate systems like Mimir, Loki, and Tempo yourself, which is powerful but significantly more complex to operate.",
      },
      {
        question: "Is OneUptime OpenTelemetry-native like Grafana?",
        answer:
          "Yes. OneUptime ingests logs, metrics, and traces via OpenTelemetry, so you can point existing OTel instrumentation at it. Unlike Grafana Cloud, you do not need to configure and tune separate backends for each signal type.",
      },
      {
        question: "How hard is it to migrate from Grafana Cloud to OneUptime?",
        answer:
          "Because OneUptime is OpenTelemetry-native, you can redirect your existing OTel exporters to OneUptime and start ingesting immediately. You then recreate the workflows you actually rely on, such as monitors, dashboards, status pages, on-call schedules, and incident processes, in one place instead of across several Grafana components and add-ons.",
      },
    ],
  },
  dynatrace: {
    productName: "Dynatrace",
    iconUrl: "/img/dynatrace.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs a single-purpose enterprise APM suite",
    competitorFocus:
      "Dynatrace specializes in deep, agent-based full-stack APM and observability with Davis AI, but leaves customer status pages, on-call, and incident response to separate tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, OpenTelemetry observability, status pages, on-call, and incident management in one open-source, self-hostable platform with predictable pricing.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Dynatrace is an enterprise-grade full-stack observability and APM platform built around its OneAgent and the Davis AI engine for automatic root-cause analysis and topology mapping. It is powerful and deep for large application estates, but it is priced on consumption through the Dynatrace Platform Subscription (DPS) and is widely regarded as expensive and complex to forecast. It focuses on application and infrastructure telemetry rather than customer-facing status pages or built-in on-call and incident workflows.",
    oneUptimeDescription:
      "OneUptime is an open-source (Apache 2.0), self-hostable platform that combines uptime and infrastructure monitoring, OpenTelemetry-native logs, metrics, and traces, public and private status pages, on-call rotations, and incident management in a single product. It replaces the stack of separate tools most Dynatrace customers still need. Pricing is flat and predictable at one dollar per active monitor per month, with self-hosting completely free.",
    description:
      "Dynatrace is an enterprise APM and observability powerhouse: its OneAgent captures deep code-level detail and Davis AI automates root-cause analysis across large estates. That depth comes with consumption-based DPS pricing that is hard to predict and can climb quickly as hosts, logs, and sessions scale. Dynatrace also stops at telemetry, so teams still buy separate products for customer status pages and for on-call and incident response. OneUptime takes the opposite approach, unifying monitoring, observability, status pages, on-call, and incidents in one open-source platform.",
    descriptionLine2:
      "Instead of a metered enterprise bill plus add-on tools, OneUptime gives you a flat one dollar per active monitor, roughly ten cents per GB of telemetry, and a free self-hosted option, so cost scales in a way you can actually forecast.",
    migrationBenefits: [
      "Replace Dynatrace plus a separate status page tool plus a separate on-call and incident tool with one unified platform",
      "Swap unpredictable DPS consumption billing for a flat one dollar per active monitor per month",
      "Stay OpenTelemetry-native with no proprietary OneAgent lock-in for logs, metrics, and traces",
      "Own your data and run it yourself for free under the Apache 2.0 license, or use managed cloud",
      "Publish customer-facing status pages with unlimited subscribers and a custom domain at no extra cost",
      "Get native on-call rotations, multi-level escalation, and incident postmortems built in, not bolted on",
    ],
    competitorPricingTiers: [
      {
        name: "Infrastructure Monitoring",
        price: "Per host-hour",
        period: "consumption",
        features: [
          "Host CPU, memory, disk, and network metrics",
          "Automatic Smartscape topology mapping",
          "Kubernetes and cloud infrastructure visibility",
          "Included Davis AI anomaly detection",
        ],
        limitations: [
          "No code-level APM or distributed tracing",
          "No customer-facing status pages",
          "No built-in on-call or incident response",
          "Consumption billing is hard to forecast",
        ],
      },
      {
        name: "Full-Stack Monitoring",
        price: "$0.01 / GiB-hour",
        period: "4 GiB min per host",
        features: [
          "Deep code-level APM with OneAgent",
          "Distributed tracing and service flow",
          "Davis AI automatic root-cause analysis",
          "Real user and session monitoring add-ons",
        ],
        limitations: [
          "Memory-weighted billing rises with host RAM",
          "4 GiB minimum billed per host regardless of size",
          "No status pages, on-call, or incident workflows",
          "Costs scale steeply across large fleets",
        ],
      },
      {
        name: "Log Management and Analytics (Grail)",
        price: "$0.20 / GiB ingest",
        period: "plus query and retention",
        features: [
          "Grail data lakehouse ingestion",
          "Retention billed per GiB per day",
          "Pay-per-query analytics on scanned data",
          "Unified with metrics and traces",
        ],
        limitations: [
          "Ingest, retention, and query billed separately",
          "Query-scan charges make heavy analysis costly",
          "Retention windows capped on included tiers",
          "Total log spend is difficult to predict",
        ],
      },
      {
        name: "Digital Experience (RUM and Synthetic)",
        price: "Per session / per action",
        period: "consumption",
        features: [
          "Real user monitoring priced per session",
          "Synthetic checks consume capability units",
          "Session replay available as an add-on",
          "Global synthetic locations",
        ],
        limitations: [
          "Per-session RUM cost grows with traffic",
          "Synthetic actions draw down capability units",
          "No public status page output",
          "Separate metering from core monitoring",
        ],
      },
      {
        name: "Dynatrace Platform Subscription (DPS)",
        price: "Annual commitment",
        period: "prepaid capability units",
        features: [
          "Unlocks all capabilities on demand",
          "Unlimited user seats included",
          "Grail data lakehouse and Smartscape included",
          "Davis AI root-cause included",
        ],
        limitations: [
          "Requires an upfront annual commitment and minimum spend",
          "Davis CoPilot generative AI metered separately",
          "No native customer status pages or on-call",
          "Enterprise sales process, no true free tier",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Growing SaaS team monitoring 50 hosts plus a customer status page and on-call",
        competitorSolution:
          "Full-Stack Monitoring on 50 hosts (roughly $58 per 8 GiB host per month) plus log ingest, plus a separate status page tool and a separate on-call and incident product",
        competitorCost: "$3,000+ per month plus add-on tools",
        oneuptimeSolution:
          "50 active monitors, OpenTelemetry logs, metrics, and traces, a branded status page, and on-call rotations all in one platform",
        oneuptimeCost: "About $99 to $300 per month, or free self-hosted",
      },
      {
        scenario:
          "Startup monitoring 20 servers and publishing a public status page",
        competitorSolution:
          "Infrastructure Monitoring on 20 hosts under an annual DPS commitment, plus a separate hosted status page product",
        competitorCost: "$600+ per month plus annual commitment",
        oneuptimeSolution:
          "20 active monitors at one dollar each with a free public status page and unlimited subscribers included",
        oneuptimeCost: "$20 per month, or free self-hosted",
      },
      {
        scenario:
          "Enterprise with 200 hosts needing full observability, status pages, and on-call for 30 responders",
        competitorSolution:
          "Full-Stack Monitoring across 200 hosts plus Grail logs and RUM, plus a dedicated on-call tool for 30 seats and a dedicated status page product",
        competitorCost: "Six figures per year across DPS and add-ons",
        oneuptimeSolution:
          "200 active monitors, telemetry ingestion, unlimited status page subscribers, and unlimited on-call responders on the Enterprise tier or self-hosted",
        oneuptimeCost: "A small fraction of DPS, or free self-hosted",
      },
    ],
    keyDifferences: [
      {
        title: "One unified platform, not just APM",
        description:
          "Dynatrace is deep observability and APM but stops at telemetry. OneUptime adds status pages, on-call, and incident management in the same product, so you retire multiple tools.",
        icon: "unified",
      },
      {
        title: "Open source and self-hostable",
        description:
          "OneUptime is Apache 2.0 licensed and free to self-host, so you own your data and avoid proprietary OneAgent lock-in. Dynatrace is a closed, commercial platform.",
        icon: "open-source",
      },
      {
        title: "Predictable flat pricing",
        description:
          "OneUptime charges a flat one dollar per active monitor plus about ten cents per GB of telemetry. Dynatrace bills on DPS consumption that is hard to forecast and rises quickly at scale.",
        icon: "transparent",
      },
      {
        title: "Built-in customer status pages",
        description:
          "OneUptime includes public and private status pages with custom domains, branding, and automatic updates from monitors. Dynatrace has no customer-facing status page product.",
        icon: "status-page",
      },
      {
        title: "Native on-call and escalation",
        description:
          "OneUptime ships on-call rotations, multi-level escalation, overrides, and follow-the-sun scheduling. Dynatrace mostly relies on integrations with PagerDuty or Opsgenie.",
        icon: "on-call",
      },
      {
        title: "Unlimited status page subscribers",
        description:
          "OneUptime status pages support unlimited subscribers via email, SMS, webhook, RSS, Slack, and Teams at no extra charge, with no metered add-on required.",
        icon: "subscribers",
      },
    ],
    items: [
      {
        name: "APM and Observability",
        data: [
          {
            title: "Distributed tracing",
            description: "Follow requests across services end to end.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Code-level APM",
            description:
              "Method-level hotspots and deep code profiling via agent.",
            productColumn: "tick",
            oneuptimeColumn: "Via OpenTelemetry",
          },
          {
            title: "AI root-cause analysis",
            description: "Automated cause detection across the topology.",
            productColumn: "tick",
            oneuptimeColumn: "Sentinel AI",
          },
          {
            title: "Automatic topology mapping",
            description: "Dependency and service maps built automatically.",
            productColumn: "tick",
            oneuptimeColumn: "Service map",
          },
          {
            title: "Metrics",
            description: "Time-series metrics collection and dashboards.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Log management",
            description: "Centralized log ingestion and analytics.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application exceptions.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native",
            description: "Built directly on the OpenTelemetry standard.",
            productColumn: "Supported",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Server and infrastructure",
            description: "CPU, memory, disk, and network monitoring.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Docker and Kubernetes visibility.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Website and URL uptime",
            description: "Simple availability and response checks.",
            productColumn: "Synthetic",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed scheduled jobs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Ping and port monitoring",
            description: "Low-level reachability checks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction",
            description: "Scripted multi-step user journeys.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private probe locations",
            description: "Monitor from inside your own network.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status page",
            description: "Customer-facing availability page.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status page",
            description: "Internal or authenticated status page.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap or per-subscriber charge.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host on your own domain with SSL.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS",
            description: "Fully brand the page with custom code.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned maintenance windows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Status reflects live monitor state.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, and RSS updates.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "On-call rotations",
            description: "Daily, weekly, and custom schedules.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation",
            description: "Escalate through tiers automatically.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Notify responders by text message.",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call alerts",
            description: "Escalate with a voice call.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams alerts",
            description: "Push alerts into chat channels.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation",
            description: "Temporary schedule swaps and cover.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun scheduling",
            description: "Hand off across global time zones.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological record of an incident.",
            productColumn: "Problems",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities",
            description: "Classify incidents by impact level.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured after-incident reviews.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up tasks to closure.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Documented response procedures.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams collaboration",
            description: "Coordinate response inside chat.",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Inspect, extend, and contribute to the code.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable",
            description: "Run the platform on your own infrastructure.",
            productColumn: "Managed (paid)",
            oneuptimeColumn: "Free",
          },
          {
            title: "Predictable flat pricing",
            description: "Costs you can forecast in advance.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Free tier",
            description: "Start using the product at no cost.",
            productColumn: "15-day trial",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO, SAML, and RBAC",
            description: "Enterprise identity and access controls.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track configuration and access changes.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2 and ISO 27001",
            description: "Independently audited security posture.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Does Dynatrace include customer-facing status pages?",
        answer:
          "No. Dynatrace focuses on internal observability and does not offer a public status page product, so teams typically buy a separate tool. OneUptime includes public and private status pages with custom domains, branding, unlimited subscribers, and automatic updates from your monitors at no extra cost.",
      },
      {
        question: "Why is Dynatrace considered expensive?",
        answer:
          "Dynatrace bills through the Dynatrace Platform Subscription, a consumption model where full-stack hosts, logs, queries, RUM sessions, and synthetics each draw down prepaid capability units. Costs are hard to forecast and rise quickly at scale. OneUptime charges a flat one dollar per active monitor plus about ten cents per GB of telemetry, so your bill is predictable.",
      },
      {
        question:
          "Does Dynatrace have built-in on-call and incident management?",
        answer:
          "Dynatrace has problem detection and basic alerting but relies mainly on integrations with dedicated tools like PagerDuty and Opsgenie for on-call scheduling and incident response. OneUptime provides native on-call rotations, multi-level escalation, incident timelines, postmortems, and runbooks in the same platform.",
      },
      {
        question: "Can I self-host instead of paying for a cloud subscription?",
        answer:
          "Dynatrace offers a self-managed deployment called Dynatrace Managed, but it is still a paid commercial license. OneUptime is open source under Apache 2.0 and completely free to self-host, so you own your data and avoid vendor lock-in, or you can use the managed cloud.",
      },
      {
        question: "How does OneUptime compare on deep APM?",
        answer:
          "Dynatrace goes deeper on code-level profiling and automatic topology through its proprietary OneAgent and Davis AI. OneUptime is OpenTelemetry-native for logs, metrics, and traces, which avoids agent lock-in and covers the observability needs of most teams while also giving you monitoring, status pages, on-call, and incidents in one place.",
      },
      {
        question: "Will I actually save money by switching?",
        answer:
          "Most teams save the most by consolidating tools. Moving off Dynatrace plus a separate status page product plus a separate on-call and incident tool onto OneUptime removes several bills at once, and the flat per-monitor pricing replaces unpredictable consumption charges. Self-hosting can reduce software cost to zero.",
      },
      {
        question:
          "Is migration difficult given Dynatrace uses a proprietary agent?",
        answer:
          "OneUptime is built on OpenTelemetry, the open standard, so you instrument once with vendor-neutral SDKs and collectors instead of a proprietary agent. You can run OneUptime alongside Dynatrace during a transition and cut over gradually as you consolidate monitoring, status pages, and on-call.",
      },
    ],
  },
  splunk: {
    productName: "Splunk",
    iconUrl: "/img/splunk.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One open-source reliability platform vs Splunk's costly, fragmented stack",
    competitorFocus:
      "Splunk is an enterprise powerhouse for log analytics, SIEM, and observability at massive scale, but it is expensive, complex, and split across many separately priced products.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry logs, metrics, and traces in a single open-source platform with flat, predictable pricing.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Splunk Observability Cloud pairs infrastructure monitoring, APM, RUM, and synthetics with Splunk's industry-leading log analytics and SIEM platform, now owned by Cisco. It is genuinely powerful at enterprise scale, but pricing is per-host plus usage-based ingestion, tiers are billed annually, and capabilities are spread across many add-ons. On-call lives in the legacy VictorOps-based Splunk On-Call product and the newer Incident Intelligence add-on.",
    oneUptimeDescription:
      "OneUptime is an open-source (Apache 2.0), self-hostable platform that combines monitoring, public and private status pages, on-call rotations, incident management, and OpenTelemetry-native logs, metrics, and traces. Active monitors are billed a flat $1/month each and telemetry ingestion is roughly $0.10/GB, with no per-host tiers, mandatory annual commitments, or add-on sprawl. You get the whole reliability toolchain in one place, or run it free on your own infrastructure.",
    description:
      "Splunk is a formidable log-analytics and observability platform built for large enterprises with big budgets and dedicated Splunk administrators. Its power comes at a cost: per-host tiers billed annually, usage-based ingestion that can run well over one hundred dollars per GB per day on the core platform, and functionality fragmented across Infrastructure, APM, RUM, Synthetics, Log Observer, and the separate Splunk On-Call product. OneUptime takes the opposite approach, bundling the entire monitoring, status-page, on-call, incident-management, and telemetry workflow into one open-source platform. Pricing is flat and transparent at $1 per active monitor per month, so costs stay predictable as you grow.",
    descriptionLine2:
      "For teams that want full-stack reliability without enterprise pricing, annual lock-in, or stitching six Splunk products together, OneUptime delivers the same core workflows in a single, self-hostable tool.",
    migrationBenefits: [
      "Replace Splunk's per-host tiers and per-GB ingestion with a flat $1/active monitor and roughly $0.10/GB telemetry",
      "Consolidate monitoring, status pages, on-call, incidents, and OpenTelemetry data into one platform instead of many Splunk add-ons",
      "Get public and private status pages with unlimited subscribers, a capability Splunk simply does not offer",
      "Own your data and avoid annual lock-in by self-hosting the open-source (Apache 2.0) platform for free",
      "Skip dedicated Splunk administrators and SPL expertise with a simpler, unified operational model",
      "Keep full OpenTelemetry-native logs, metrics, and traces without runaway ingestion bills",
    ],
    competitorPricingTiers: [
      {
        name: "Infrastructure",
        price: "$15",
        period: "per host/month (billed annually)",
        features: [
          "Infrastructure monitoring",
          "Log Observer Connect",
          "Synthetic uptime monitoring",
          "Incident Intelligence",
          "Database monitoring add-on",
        ],
        limitations: [
          "No APM, RUM, or browser synthetics",
          "Annual commitment required",
          "Log analytics needs Splunk platform ingestion",
        ],
      },
      {
        name: "App & Infrastructure",
        price: "$60",
        period: "per host/month (billed annually)",
        features: [
          "Everything in Infrastructure",
          "APM with Always-On Profiling",
          "Synthetic API monitoring",
          "Kubernetes and cloud integrations",
        ],
        limitations: [
          "No Real User Monitoring",
          "Usage-based charges for logs and custom metrics",
          "Priced per host, scales fast at volume",
        ],
      },
      {
        name: "End-to-End",
        price: "$75",
        period: "per host/month (billed annually)",
        features: [
          "Everything in App & Infrastructure",
          "Real User Monitoring",
          "Synthetic browser monitoring",
          "Full-stack observability",
        ],
        limitations: [
          "Highest per-host tier before add-ons",
          "No built-in public status pages",
          "Ingestion overages billed separately",
        ],
      },
      {
        name: "Log Analytics / SIEM (Splunk Cloud)",
        price: "Usage-based",
        period: "ingest or workload pricing",
        features: [
          "Industry-leading log search and SPL",
          "Security (SIEM) and compliance use cases",
          "Long retention options",
          "Deep enterprise integrations",
        ],
        limitations: [
          "Ingest pricing historically $100+/GB/day",
          "Complex to size and administer",
          "Costs can spike with data growth",
        ],
      },
      {
        name: "Splunk On-Call",
        price: "Add-on",
        period: "per user/month",
        features: [
          "On-call schedules and escalations",
          "Alert routing and incident timelines",
          "Mobile app and ChatOps",
          "Integrations with Splunk alerts",
        ],
        limitations: [
          "Legacy VictorOps product, uncertain roadmap",
          "Priced separately per user",
          "Overlaps with newer Incident Intelligence",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup running 50 hosts that needs monitoring, basic APM, and a public status page",
        competitorSolution:
          "Splunk End-to-End at $75/host/month, billed annually, plus a separate third-party status page tool since Splunk has none",
        competitorCost: "~$45,000/yr + status page tool + log ingestion",
        oneuptimeSolution:
          "50 active monitors at $1 each, status pages with unlimited subscribers included, telemetry billed at ~$0.10/GB",
        oneuptimeCost: "~$50/mo + telemetry (or free self-hosted)",
      },
      {
        scenario:
          "Mid-size platform team with 200 hosts needing full observability plus on-call for 25 engineers",
        competitorSolution:
          "Splunk App & Infrastructure at $60/host/month plus Splunk On-Call per user and usage-based log ingestion",
        competitorCost: "~$150,000+/yr before ingestion overages",
        oneuptimeSolution:
          "Active monitors at $1 each, on-call rotations and escalations included, OpenTelemetry logs/metrics/traces at ~$0.10/GB",
        oneuptimeCost: "Growth tier ~$99/mo + usage, on-call included",
      },
      {
        scenario:
          "Engineering team ingesting roughly 500 GB/day of logs, metrics, and traces",
        competitorSolution:
          "Splunk platform ingest or workload pricing, historically well over $100/GB/day, on top of per-host observability tiers",
        competitorCost: "Six figures annually for ingestion alone",
        oneuptimeSolution:
          "OpenTelemetry-native ingestion at roughly $0.10/GB with dashboards, exceptions, and tracing built in",
        oneuptimeCost: "~$1,500/mo at 500 GB/day (or free self-hosted)",
      },
    ],
    keyDifferences: [
      {
        title: "Open source and self-hostable",
        description:
          "OneUptime is Apache 2.0 licensed and can be self-hosted for free with full data ownership; Splunk is proprietary and, at scale, requires substantial annual contracts.",
        icon: "open-source",
      },
      {
        title: "One unified platform",
        description:
          "OneUptime bundles monitoring, status pages, on-call, incidents, and telemetry in one tool, while Splunk spreads these across Observability Cloud tiers, the Splunk platform, and Splunk On-Call.",
        icon: "unified",
      },
      {
        title: "Flat, predictable pricing",
        description:
          "OneUptime charges a flat $1 per active monitor per month with no per-host tiers or annual lock-in; Splunk uses per-host tiers plus usage-based ingestion that can escalate quickly.",
        icon: "pricing",
      },
      {
        title: "Built-in status pages",
        description:
          "OneUptime includes public and private status pages with custom domains and free SSL, while Splunk has no native status page product at all.",
        icon: "status-page",
      },
      {
        title: "Unlimited status page subscribers",
        description:
          "OneUptime supports unlimited status page subscribers at no extra charge; Splunk offers no equivalent, so teams must buy a separate status page vendor.",
        icon: "subscribers",
      },
      {
        title: "Integrated on-call and incidents",
        description:
          "OneUptime includes on-call rotations, escalation policies, and incident management natively, whereas Splunk splits this between the legacy VictorOps-based On-Call and Incident Intelligence add-ons.",
        icon: "on-call",
      },
    ],
    items: [
      {
        name: "Observability & Log Analytics",
        data: [
          {
            title: "Log management",
            description: "Collect, search, and analyze log data",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics monitoring",
            description: "Time-series metrics and alerting",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native",
            description: "Standards-based OTel ingestion",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application errors",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SIEM / security analytics",
            description: "Security information and event management",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Log ingestion pricing",
            description: "Cost to ingest telemetry data",
            productColumn: "$100+/GB/day (Splunk)",
            oneuptimeColumn: "~$0.10/GB",
          },
          {
            title: "Custom dashboards",
            description: "Build charts and dashboards",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website / URL monitoring",
            description: "Check uptime of web endpoints",
            productColumn: "Synthetics add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Monitor API endpoints and responses",
            productColumn: "Synthetics add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server / infrastructure monitoring",
            description: "CPU, memory, and disk metrics",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container / Kubernetes monitoring",
            description: "Docker and Kubernetes visibility",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic / transaction monitoring",
            description: "Scripted browser and API checks",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron / heartbeat monitoring",
            description: "Detect missed scheduled jobs",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global + private probe locations",
            description: "Check from multiple regions",
            productColumn: "tick",
            oneuptimeColumn: "7+ global + private",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Externally visible status page",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal or restricted status pages",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap on status page subscribers",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain + free SSL",
            description: "Host status page on your domain",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Fully brand and customize the page",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance windows",
            description: "Communicate planned downtime",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, Slack, RSS",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-call schedules and rotations",
            description: "Daily, weekly, and custom rotations",
            productColumn: "Splunk On-Call",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts",
            productColumn: "Splunk On-Call",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description: "Vacation overrides and global handoff",
            productColumn: "Splunk On-Call",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS and phone call alerts",
            description: "Reach responders via SMS and voice",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push and email alerts",
            description: "Mobile push and email notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "ChatOps notifications",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call included in platform",
            description: "No separate product or license",
            productColumn: "Separate add-on",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological incident activity",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities and prioritization",
            description: "Classify incident impact",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured post-incident reviews",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items and runbooks",
            description: "Track follow-ups and procedures",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack / Teams incident collaboration",
            description: "Coordinate response in chat",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Status page updates from incidents",
            description: "Auto-publish incident status",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source (self-hostable)",
            description: "Apache 2.0 licensed platform",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Flat, predictable pricing",
            description: "Simple per-monitor cost",
            productColumn: "Per-host + usage",
            oneuptimeColumn: "$1/monitor/mo",
          },
          {
            title: "No annual commitment required",
            description: "Pay as you go without lock-in",
            productColumn: "Annual tiers",
            oneuptimeColumn: "tick",
          },
          {
            title: "Free tier",
            description: "Generous no-cost starting plan",
            productColumn: "Limited trial",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and native webhooks",
            description: "Programmatic access and automation",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflows and automation",
            description: "Build automated response flows",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML, RBAC, audit logs",
            description: "Enterprise access controls",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2, ISO 27001, GDPR",
            description: "Security and compliance attestations",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a full replacement for Splunk?",
        answer:
          "For most teams focused on monitoring, observability, status pages, on-call, and incident management, yes. OneUptime covers OpenTelemetry-native logs, metrics, and traces plus the full reliability workflow in one platform. Splunk still leads in heavy-duty SIEM and security analytics at very large enterprise scale, so if your primary need is advanced SIEM you may keep Splunk for that specific use case.",
      },
      {
        question: "How does OneUptime pricing compare to Splunk?",
        answer:
          "OneUptime bills active monitors at a flat $1 per month each, with unlimited free manual monitors and telemetry ingestion at roughly $0.10 per GB. Splunk Observability Cloud is priced per host, from $15 to $75+ per host per month billed annually, plus usage-based log ingestion that on the core Splunk platform has historically run well over $100 per GB per day. For most teams OneUptime is dramatically cheaper and far more predictable.",
      },
      {
        question: "Does Splunk offer status pages?",
        answer:
          "No. Splunk has no native public or private status page product, so teams using Splunk typically buy a separate status page vendor. OneUptime includes public and private status pages with custom domains, free SSL, custom branding, and unlimited subscribers at no extra cost.",
      },
      {
        question: "What happened to Splunk On-Call and VictorOps?",
        answer:
          "Splunk On-Call is the rebranded VictorOps product Splunk acquired. Splunk has since introduced Incident Intelligence within Observability Cloud, leaving the standalone On-Call product with an uncertain roadmap. OneUptime includes on-call rotations, escalation policies, and incident management natively, so there is no separate product to license or migrate.",
      },
      {
        question: "Can I self-host OneUptime like I run Splunk on-premises?",
        answer:
          "Yes. OneUptime is open source under the Apache 2.0 license and can be fully self-hosted for free with complete data ownership. Unlike Splunk's enterprise licensing, there are no per-host fees or annual contracts when you run it yourself, and you can also use the managed cloud if you prefer.",
      },
      {
        question: "Will migrating from Splunk mean losing observability depth?",
        answer:
          "OneUptime is OpenTelemetry-native, so it ingests standards-based logs, metrics, and traces with dashboards, exceptions, and error tracking built in. You keep full-stack observability without runaway ingestion bills or managing separate Splunk add-ons for infrastructure, APM, RUM, and synthetics.",
      },
      {
        question: "Is OneUptime enterprise-ready for security and compliance?",
        answer:
          "Yes. OneUptime supports SSO/SAML, role-based access control, and audit logs, and is SOC 2 Type II, ISO 27001, and GDPR compliant. Enterprise support is available, and self-hosting gives security-sensitive teams full control over where their data lives.",
      },
    ],
  },
  sentry: {
    productName: "Sentry",
    iconUrl: "/img/sentry.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One unified reliability platform vs a code-only error tracker",
    competitorFocus:
      "Sentry specializes in code-level error and performance monitoring, but it has no status pages, on-call scheduling, or incident-response product.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, telemetry, status pages, on-call, and incident management in a single open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Sentry is a developer-focused error and performance monitoring tool with session replay, distributed tracing, code profiling, and its Seer AI debugging agent. It excels at catching application exceptions and slow transactions and pinpointing the exact line of code responsible. It has recently added basic URL uptime and cron monitoring, but it is not built for infrastructure monitoring, status pages, or incident response.",
    oneUptimeDescription:
      "OneUptime is an open-source, unified observability and reliability platform. It combines uptime and infrastructure monitoring, OpenTelemetry logs, metrics and traces, status pages, on-call scheduling, and incident management in one tool. Teams can self-host it for free or use the managed cloud with predictable per-monitor pricing.",
    description:
      "Sentry is one of the best tools available for catching code-level errors and diagnosing performance regressions, and developers rely on its stack traces and session replay every day. But it is a single-purpose developer tool: it has no status pages, no on-call or paging, and no incident-management workflow, so teams end up pairing it with separate products like Statuspage and PagerDuty. OneUptime takes a different approach, unifying monitoring, telemetry, status pages, on-call, and incidents in one open-source platform. Instead of stitching several point tools together, you run your entire reliability stack in one place.",
    descriptionLine2:
      "Keep an OpenTelemetry-native approach to telemetry while replacing usage-based event billing and tool sprawl with predictable one-dollar-per-monitor pricing on a single, self-hostable platform.",
    migrationBenefits: [
      "Replace Sentry plus separate status page and on-call tools with one unified platform.",
      "Keep OpenTelemetry-native logs, metrics, and traces without proprietary SDK lock-in.",
      "Add real uptime, server, container, and synthetic monitoring that Sentry does not offer.",
      "Get built-in public and private status pages with unlimited subscribers and free SSL.",
      "Gain full on-call scheduling, multi-level escalation, and incident management with postmortems.",
      "Move to predictable one-dollar-per-monitor pricing instead of usage-based event billing.",
    ],
    competitorPricingTiers: [
      {
        name: "Developer",
        price: "$0",
        period: "/month",
        features: [
          "5K errors per month",
          "5M tracing spans",
          "50 session replays",
          "1 cron and uptime monitor",
          "30-day data retention",
        ],
        limitations: [
          "Limited to a single user",
          "No SSO, SAML, or audit logs",
          "No status pages, on-call, or incidents",
        ],
      },
      {
        name: "Team",
        price: "$26",
        period: "/month (billed annually)",
        features: [
          "Unlimited users",
          "50K errors per month included",
          "Session replay and distributed tracing",
          "Third-party integrations",
          "Up to 90-day data retention",
        ],
        limitations: [
          "Usage-based overage on events",
          "No SSO or SAML",
          "No status pages or on-call",
          "No incident-management workflow",
        ],
      },
      {
        name: "Business",
        price: "$80",
        period: "/month (billed annually)",
        features: [
          "Everything in Team",
          "SSO, SAML, and SCIM",
          "Advanced dashboards and quota management",
          "Custom uptime and cron monitors",
          "Cross-team issue routing",
        ],
        limitations: [
          "Seer AI is a $40 per-user add-on",
          "No native status pages",
          "No on-call or phone paging",
          "Costs scale with event volume",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "",
        features: [
          "Volume discounts and reserved capacity",
          "Dedicated support and account manager",
          "Advanced security and compliance",
          "Custom data retention",
        ],
        limitations: [
          "Custom annual contracts required",
          "Still error-monitoring focused",
          "No native status pages or on-call",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup with 20 monitors that needs error tracking, a public status page, and on-call for 8 engineers",
        competitorSolution:
          "Sentry Business for errors and telemetry, plus a separate status page tool and a separate on-call and paging tool",
        competitorCost: "$80/mo Sentry + extra status page and on-call tools",
        oneuptimeSolution:
          "OneUptime unified: error and telemetry ingestion, 20 monitors, status page, and on-call in one platform",
        oneuptimeCost: "~$20/mo (20 monitors at $1 each)",
      },
      {
        scenario:
          "Scaling SaaS ingesting high error, span, and replay volume across many services",
        competitorSolution:
          "Sentry with usage-based overage billing on errors, spans, and replays, plus the Seer AI add-on",
        competitorCost: "$200-500+/mo as event volume grows",
        oneuptimeSolution:
          "OneUptime OpenTelemetry ingestion billed by data volume with a generous free allowance",
        oneuptimeCost: "~$0.10 per GB ingested",
      },
      {
        scenario:
          "30-person team wanting a full reliability stack: monitoring, status page, on-call, incidents, and telemetry",
        competitorSolution:
          "Sentry covers errors and telemetry only, so uptime, status page, on-call, and incident tools are bought separately",
        competitorCost: "$80/mo Sentry + three or four more tools",
        oneuptimeSolution:
          "OneUptime delivers the entire stack in one platform, self-hosted free or on a predictable managed tier",
        oneuptimeCost: "One platform, ~$99/mo Growth",
      },
    ],
    keyDifferences: [
      {
        title: "Unified platform, not a point tool",
        description:
          "Sentry focuses on code-level errors and performance. OneUptime combines monitoring, telemetry, status pages, on-call, and incidents in one place, ending tool sprawl.",
        icon: "unified",
      },
      {
        title: "Built-in status pages",
        description:
          "Sentry has no status page product. OneUptime includes public and private status pages with unlimited subscribers, custom domains, free SSL, and automatic updates from monitors.",
        icon: "status-page",
      },
      {
        title: "Real on-call and incident response",
        description:
          "Sentry sends alert notifications but has no on-call rotations or paging. OneUptime adds escalation policies, SMS and phone paging, postmortems, and MTTR analytics.",
        icon: "on-call",
      },
      {
        title: "Truly open source",
        description:
          "Sentry is source-available under the Functional Source License, not OSI open source at release. OneUptime is Apache 2.0 and free to self-host with no strings attached.",
        icon: "open-source",
      },
      {
        title: "Full-stack monitoring",
        description:
          "Beyond code errors, OneUptime monitors websites, APIs, servers, containers, synthetics, SSL, and ports from global and private probes, which Sentry does not offer.",
        icon: "monitoring",
      },
      {
        title: "Predictable pricing",
        description:
          "Sentry bills by event volume with overages and per-user AI add-ons. OneUptime charges a flat one dollar per active monitor with telemetry at roughly ten cents per GB.",
        icon: "pricing",
      },
    ],
    items: [
      {
        name: "Error & Performance Monitoring",
        data: [
          {
            title: "Error & exception tracking",
            description:
              "Capture and group application exceptions with stack traces.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description:
              "Follow requests across services with OpenTelemetry traces.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Session replay",
            description:
              "Video-like reproductions of user sessions around an error.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Code-level profiling",
            description:
              "CPU profiles that pinpoint slow functions line by line.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Release health & source maps",
            description:
              "Track regressions across releases with mapped stack traces.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "AI root-cause assistance",
            description: "AI help to explain errors and suggest fixes.",
            productColumn: "Seer add-on ($40/user)",
            oneuptimeColumn: "Sentinel AI",
          },
          {
            title: "Logs, metrics & dashboards",
            description: "Structured telemetry alongside errors and traces.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Uptime & Infrastructure Monitoring",
        data: [
          {
            title: "Website & URL uptime",
            description:
              "Continuously check that public endpoints are reachable.",
            productColumn: "Basic (beta)",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API responses, status codes, and payloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server & infrastructure metrics",
            description: "Monitor CPU, memory, and disk on hosts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Track Docker and Kubernetes workload health.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic & transaction monitoring",
            description: "Scripted multi-step user journeys from probes.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before TLS certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron & heartbeat monitoring",
            description: "Detect missed or late scheduled jobs.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from multiple regions and private networks.",
            productColumn: "",
            oneuptimeColumn: "7+ locations",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Communicate live status and incidents to customers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal status views for teams and stakeholders.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers at no extra cost.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain + free SSL",
            description: "Host the page on your own domain with managed SSL.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding & CSS",
            description:
              "Match the page to your brand with custom HTML/CSS/JS.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned maintenance windows in advance.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Reflect monitor state on the page automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description: "Email, SMS, webhook, RSS, Slack, and Teams updates.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-call schedules & rotations",
            description: "Daily, weekly, and custom rotation schedules.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts up the chain.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides & vacation",
            description: "Temporary schedule overrides for time off.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun coverage",
            description: "Hand off on-call across regions and time zones.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Notify responders by text message.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call / voice alerts",
            description: "Escalate critical alerts via phone call.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack & Microsoft Teams alerts",
            description: "Route notifications into chat channels.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Email alerts",
            description: "Send alert notifications by email.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "A chronological record of everything that happened.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severity levels",
            description: "Classify incidents by impact and urgency.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured post-incident reviews and reports.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up tasks to prevent recurrence.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Documented response procedures for responders.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack & Teams collaboration",
            description: "Coordinate incident response inside chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolve across incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Auto-create incidents from monitors",
            description: "Open incidents automatically when monitors fail.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source license",
            description: "Freely licensed, community-driven codebase.",
            productColumn: "Source-available (FSL)",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "Self-hostable",
            description: "Run the full platform on your own infrastructure.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable flat pricing",
            description: "Costs that do not swing with event volume.",
            productColumn: "",
            oneuptimeColumn: "$1/monitor",
          },
          {
            title: "SSO / SAML",
            description: "Enterprise single sign-on for access control.",
            productColumn: "Business+",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track who changed what across the platform.",
            productColumn: "Business+",
            oneuptimeColumn: "tick",
          },
          {
            title: "Role-based access control",
            description: "Granular permissions by role and team.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API & webhooks",
            description: "Automate and integrate with your own systems.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflow automation",
            description: "No-code workflows to react to events.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is Sentry open source?",
        answer:
          "Sentry is source-available and self-hostable under the Functional Source License, which converts to Apache 2.0 two years after each release, so it is not OSI-approved open source at the time of release. OneUptime is fully open source under Apache 2.0 today and free to self-host.",
      },
      {
        question: "Does Sentry have status pages?",
        answer:
          "No. Sentry does not offer a status page product, so you would pair it with a separate tool such as Statuspage. OneUptime includes public and private status pages with unlimited subscribers, custom domains, free SSL, custom branding, and automatic updates from your monitors.",
      },
      {
        question: "Does Sentry offer on-call and incident management?",
        answer:
          "Sentry can send alert notifications to Slack, email, and integrations, but it has no on-call scheduling, escalation policies, or incident-management workflow. OneUptime adds on-call rotations, multi-level escalation, SMS and phone paging, postmortems, runbooks, and MTTR analytics.",
      },
      {
        question: "Can Sentry monitor uptime and infrastructure?",
        answer:
          "Sentry has added basic URL uptime and cron monitoring, but it does not cover server and infrastructure metrics, container health, synthetic transactions, SSL certificates, or ping and port checks. OneUptime handles all of these from seven-plus global probe locations plus private probes.",
      },
      {
        question: "How does pricing compare?",
        answer:
          "Sentry uses usage-based event billing, so costs scale with errors, spans, and replays, and its Seer AI is a $40 per-user add-on. OneUptime bills active monitors at a flat $1 per month each, ingests telemetry at roughly $0.10 per GB, offers unlimited free static monitors, and has a generous free tier.",
      },
      {
        question: "Can I keep using OpenTelemetry if I move to OneUptime?",
        answer:
          "Yes. OneUptime is OpenTelemetry-native for logs, metrics, and traces, so you can point your existing instrumentation at it without adopting a proprietary SDK.",
      },
      {
        question: "Do I lose error tracking by moving from Sentry?",
        answer:
          "No. OneUptime includes exception and error tracking alongside logs, metrics, and traces. It does not offer session replay or code profiling, so some teams run OneUptime for full-stack reliability and keep Sentry only where they need deep code-level replay.",
      },
    ],
  },
  appdynamics: {
    productName: "AppDynamics",
    iconUrl: "/img/appdynamics.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One open-source unified platform vs a heavyweight, per-core APM agent",
    competitorFocus:
      "AppDynamics specializes in deep, agent-based application performance monitoring for large enterprises, but leaves customer status pages, on-call scheduling, and incident response to separate tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, OpenTelemetry, status pages, on-call, and incident management in one open-source platform with flat per-monitor pricing.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "AppDynamics, now part of Cisco and Splunk, is an enterprise APM and business performance monitoring suite that instruments applications with proprietary agents for code-level transaction tracing, database visibility, and Business iQ analytics. It excels at deep, agent-based visibility into large Java, .NET, and cloud applications. It is licensed per CPU core, sold through enterprise sales, and does not include customer status pages, on-call rotations, or built-in incident management.",
    oneUptimeDescription:
      "OneUptime is an open-source (Apache 2.0), self-hostable reliability platform that combines uptime monitoring, OpenTelemetry logs, metrics and traces, public status pages, on-call scheduling, and incident management in one place. It uses open standards instead of proprietary agents, so you keep your existing instrumentation. Active monitors are billed at a flat $1 per month, telemetry ingestion is about $0.10 per GB, and self-hosting is free.",
    description:
      "AppDynamics gives you deep, code-level insight into application performance, but it is a single-purpose, agent-based APM tool priced per CPU core and aimed squarely at large enterprises. To cover the rest of reliability you still need a separate status page product, a separate paging tool, and a separate incident workflow. OneUptime takes a different approach: one open-source platform that spans monitoring, telemetry, status pages, on-call, and incident response. Instead of licensing every core across your fleet, you pay a flat $1 per active monitor with no per-check tiers or caps.",
    descriptionLine2:
      "Keep your OpenTelemetry instrumentation, drop the proprietary agents and per-core bill, and consolidate three or four tools into one predictable platform you can self-host for free.",
    migrationBenefits: [
      "Consolidate APM, uptime monitoring, status pages, on-call, and incident management into one platform instead of stitching AppDynamics to Statuspage.io and PagerDuty.",
      "Replace per-CPU-core licensing that grows with every host and core with predictable, flat $1-per-month active monitors and no caps.",
      "Keep your existing OpenTelemetry instrumentation with no proprietary bytecode agents to install, tune, or maintain.",
      "Own your stack by self-hosting the Apache 2.0 codebase for free, or use managed cloud, with no vendor lock-in.",
      "Publish public and private status pages with unlimited subscribers, something AppDynamics does not offer at all.",
      "Get native on-call rotations, escalation policies, and incident collaboration without buying a separate paging product.",
    ],
    competitorPricingTiers: [
      {
        name: "Infrastructure Monitoring",
        price: "$6 / CPU core",
        period: "per month, billed annually",
        features: [
          "Server and host visibility",
          "Infrastructure metrics and health rules",
          "Container and Kubernetes visibility",
          "Baselining and alerting",
        ],
        limitations: [
          "No application code-level tracing",
          "Cost scales with every monitored core",
          "No customer status pages or on-call",
          "No incident management workflow",
        ],
      },
      {
        name: "Premium (Standard APM)",
        price: "$33 / CPU core",
        period: "per month, billed annually",
        features: [
          "Full APM transaction tracing",
          "Code-level diagnostics and snapshots",
          "Database and remote service visibility",
          "Health-rule alerting and baselining",
        ],
        limitations: [
          "No business performance monitoring",
          "No customer status pages",
          "No native on-call or incident management",
          "Bill multiplies across every core",
        ],
      },
      {
        name: "Enterprise",
        price: "$50 / CPU core",
        period: "per month, billed annually",
        features: [
          "Everything in Premium",
          "Business iQ performance monitoring",
          "Transaction analytics",
          "Anomaly detection and Cognition Engine",
        ],
        limitations: [
          "Enterprise sales engagement required",
          "Real User Monitoring billed separately",
          "No status pages, on-call, or incidents",
          "Expensive at fleet scale",
        ],
      },
      {
        name: "Enterprise for SAP",
        price: "$95 / CPU core",
        period: "per month, billed annually",
        features: [
          "All Enterprise capabilities",
          "SAP ABAP code-level visibility",
          "Business transaction monitoring for SAP",
          "Deep dependency mapping",
        ],
        limitations: [
          "Highest per-core list price",
          "Proprietary agent lock-in",
          "No status pages or on-call built in",
          "Custom contract and volume terms",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Early-stage SaaS startup that needs app performance visibility, uptime checks, and a public status page",
        competitorSolution:
          "AppDynamics Premium APM across roughly 30 CPU cores, plus a separate status page product and a separate paging tool",
        competitorCost: "~$990/mo APM plus extra tools",
        oneuptimeSolution:
          "OpenTelemetry traces and metrics, uptime monitors, a branded status page, and on-call all in one plan",
        oneuptimeCost: "~$99/mo (Growth)",
      },
      {
        scenario:
          "Mid-size engineering team monitoring around 100 CPU cores plus customer-facing status and paging",
        competitorSolution:
          "AppDynamics Enterprise at $50 per core, plus Statuspage Business and a PagerDuty plan per user",
        competitorCost: "$5,000+/mo combined",
        oneuptimeSolution:
          "Around 200 active monitors, telemetry ingestion, unlimited status page subscribers, and on-call in one platform",
        oneuptimeCost: "~$300-$500/mo",
      },
      {
        scenario:
          "Regulated enterprise that wants full data ownership and self-hosting",
        competitorSolution:
          "AppDynamics on-premises, still licensed per CPU core with heavyweight agents and a paid contract",
        competitorCost: "Custom, per-core license",
        oneuptimeSolution:
          "Self-host the Apache 2.0 platform on your own infrastructure with the full feature set",
        oneuptimeCost: "$0 license (self-host)",
      },
    ],
    keyDifferences: [
      {
        title: "Unified platform vs single-purpose APM",
        description:
          "AppDynamics is APM only, so you bolt on separate tools for status pages, paging, and incidents. OneUptime delivers monitoring, telemetry, status pages, on-call, and incident management in one place.",
        icon: "unified",
      },
      {
        title: "Open source vs proprietary agents",
        description:
          "OneUptime is Apache 2.0 and OpenTelemetry-native, so you keep open instrumentation and can read the code. AppDynamics relies on proprietary, closed-source agents that lock you into Cisco.",
        icon: "open-source",
      },
      {
        title: "Flat per-monitor vs per-CPU-core pricing",
        description:
          "AppDynamics charges $33 to $50 per CPU core every month, so the bill grows with every host you add. OneUptime charges a flat $1 per active monitor with no per-check tiers or caps.",
        icon: "pricing",
      },
      {
        title: "Built-in customer status pages",
        description:
          "OneUptime includes public and private status pages with unlimited subscribers, custom domains, and free SSL. AppDynamics has no customer-facing status page capability at all.",
        icon: "status-page",
      },
      {
        title: "Native on-call and escalations",
        description:
          "OneUptime ships on-call rotations, multi-level escalation, and alerts via SMS, phone call, Slack, and Teams. AppDynamics has health-rule alerts but no native on-call scheduling.",
        icon: "on-call",
      },
      {
        title: "Predictable, transparent cost",
        description:
          "OneUptime publishes a generous free tier and simple tiers with self-hosting free. AppDynamics requires enterprise sales, quotes per core, and adds separate charges for RUM and security.",
        icon: "transparent",
      },
    ],
    items: [
      {
        name: "APM & Application Performance",
        data: [
          {
            title: "Code-level transaction tracing",
            description: "Trace requests through application code paths.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Follow requests across services and hops.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic code diagnostics",
            description: "Deep bytecode-level call graphs and snapshots.",
            productColumn: "tick",
            oneuptimeColumn: "Via OpenTelemetry",
          },
          {
            title: "Business performance monitoring",
            description:
              "Correlate app health with business KPIs (Business iQ).",
            productColumn: "Enterprise only",
            oneuptimeColumn: "",
          },
          {
            title: "Database query visibility",
            description: "Slow query and remote service monitoring.",
            productColumn: "tick",
            oneuptimeColumn: "Via OpenTelemetry",
          },
          {
            title: "Error and exception tracking",
            description: "Capture and group application exceptions.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Instrumentation model",
            description: "How code is instrumented for telemetry.",
            productColumn: "Proprietary agents",
            oneuptimeColumn: "Open standard",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website and URL monitoring",
            description: "Check availability and response of web endpoints.",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API endpoints and payloads.",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description: "Scripted browser and multi-step checks.",
            productColumn: "Add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed scheduled jobs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure monitoring",
            description: "CPU, memory, and disk for hosts.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container and Kubernetes monitoring",
            description: "Visibility into containers and clusters.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from multiple regions worldwide.",
            productColumn: "Add-on",
            oneuptimeColumn: "7+ locations",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Customer-facing uptime and incident pages.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal or authenticated status pages.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host on your own domain with SSL.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS",
            description: "Fully brand and style the page.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Publish planned maintenance windows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Push monitor status to the page automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Health-rule alerting",
            description: "Threshold and baseline-based alerts.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations",
            description: "Daily, weekly, and custom rotations.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS and phone call alerts",
            description: "Reach responders by SMS and voice.",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Notify chat channels on alerts.",
            productColumn: "Via integration",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation",
            description: "Temporary schedule overrides.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun scheduling",
            description: "Rotate coverage across time zones.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Track events across an incident lifecycle.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities and states",
            description: "Classify and manage incident severity.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured post-incident reviews.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items and runbooks",
            description: "Track follow-ups and response steps.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams incident collaboration",
            description: "Coordinate response in chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "AI-assisted analysis",
            description: "AI anomaly detection and assistance.",
            productColumn: "tick",
            oneuptimeColumn: "Sentinel AI",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Inspect and extend the source code.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable for free",
            description: "Run the full platform on your own infra.",
            productColumn: "Paid on-prem",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable flat pricing",
            description: "Simple, published per-unit cost.",
            productColumn: "",
            oneuptimeColumn: "$1/monitor",
          },
          {
            title: "Free tier",
            description: "Start without a sales contract.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO / SAML",
            description: "Enterprise single sign-on.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "RBAC and audit logs",
            description: "Role-based access and audit trails.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Compliance (SOC 2, ISO 27001, GDPR)",
            description: "Recognized security and privacy compliance.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a full replacement for AppDynamics?",
        answer:
          "For most teams, yes. OneUptime is OpenTelemetry-native, so it collects logs, metrics, traces, and exceptions and shows them on dashboards, while also covering uptime monitoring, status pages, on-call, and incidents that AppDynamics does not include. AppDynamics still offers deeper proprietary bytecode-level auto-instrumentation and Business iQ analytics, so evaluate whether that specific depth is essential for your applications.",
      },
      {
        question:
          "How does OneUptime pricing compare to AppDynamics per-CPU-core licensing?",
        answer:
          "AppDynamics is licensed per CPU core, roughly $33 per core for Premium APM and $50 per core for Enterprise, billed annually, so your cost rises with every host and core you add. OneUptime charges a flat $1 per month per active monitor with no per-check tiers or caps, telemetry ingestion is about $0.10 per GB, and self-hosting is free.",
      },
      {
        question: "Does AppDynamics include status pages and on-call?",
        answer:
          "No. AppDynamics is an APM tool and does not provide customer-facing status pages or native on-call scheduling. Teams typically add separate products such as Statuspage and PagerDuty. OneUptime includes both status pages with unlimited subscribers and on-call rotations with escalation in the same platform.",
      },
      {
        question: "Do I have to rip out my existing instrumentation to switch?",
        answer:
          "No. OneUptime is built on OpenTelemetry, an open standard, so you send telemetry using vendor-neutral SDKs and collectors rather than proprietary agents. That means less lock-in and an easier path off AppDynamics agents over time.",
      },
      {
        question:
          "Can I self-host OneUptime the way I run AppDynamics on-premises?",
        answer:
          "Yes, and it is free. OneUptime is open source under Apache 2.0 and can be self-hosted on your own infrastructure with the full feature set, so you pay only for the compute you run. AppDynamics on-premises is still a paid, per-core licensed product.",
      },
      {
        question: "Is OneUptime enterprise-ready for security and compliance?",
        answer:
          "Yes. OneUptime provides SSO and SAML, role-based access control, and audit logs, and it is SOC 2 Type II, ISO 27001, and GDPR compliant. Enterprise plans and support are available alongside the free and self-hosted options.",
      },
      {
        question: "What do teams gain by consolidating onto OneUptime?",
        answer:
          "They collapse APM, uptime monitoring, status pages, on-call, and incident management into one platform, which removes tool sprawl, reduces integration overhead, and makes cost predictable. Instead of licensing every core and paying separately for paging and status pages, they pay a flat per-monitor rate and can self-host for free.",
      },
    ],
  },
  elastic: {
    productName: "Elastic Observability",
    iconUrl: "/img/elastic-stack.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs a data-heavy observability stack",
    competitorFocus:
      "Elastic Observability specializes in ELK-based logs, metrics, and APM at scale, but it stops at telemetry and leaves status pages, on-call, and incident workflows to other tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, OpenTelemetry logs/metrics/traces, status pages, on-call, and incident management in a single open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Elastic Observability is built on the Elasticsearch and Kibana stack, offering powerful and flexible log analytics, metrics, APM, and search across large volumes of telemetry. It is highly capable but operationally heavy, requiring cluster sizing, shard and index management, and careful data-volume governance to control cost. Pricing is consumption-based on ingest and retention, so bills scale with the amount of data you send.",
    oneUptimeDescription:
      "OneUptime is an open-source (Apache 2.0), self-hostable reliability platform that combines uptime and infrastructure monitoring, OpenTelemetry-native logs, metrics, and traces, public and private status pages, on-call scheduling, and incident management in one place. Active monitors are billed a flat 1 dollar per month and telemetry ingestion is roughly 0.10 dollars per GB, so costs stay predictable. Self-hosting is completely free.",
    description:
      "Elastic Observability is a strong choice when your primary need is deep, search-driven log and APM analytics, and you have the engineering capacity to run and tune the underlying Elasticsearch clusters. But observability is only half of reliability. Elastic has no built-in status pages, on-call rotations, escalation policies, or incident management, so teams end up bolting on separate tools for the workflows that actually resolve outages. OneUptime brings monitoring, telemetry, status pages, on-call, and incident response together in one open-source platform.",
    descriptionLine2:
      "Instead of paying rising, data-volume-based bills and stitching Elastic to PagerDuty, Statuspage, and an incident tool, you get one predictable platform with flat 1 dollar per month monitors and free self-hosting.",
    migrationBenefits: [
      "Replace a logs-and-APM-only stack with a unified platform that also covers status pages, on-call, and incident management",
      "Swap consumption-based ingest and retention billing for predictable flat 1 dollar per month active monitors and roughly 0.10 dollars per GB telemetry",
      "Keep OpenTelemetry-native logs, metrics, and traces without vendor-specific agents or lock-in",
      "Eliminate the operational burden of sizing, scaling, and tuning Elasticsearch clusters and shards",
      "Publish unlimited-subscriber status pages with a custom domain and free SSL that Elastic does not offer",
      "Self-host the entire platform for free under a permissive Apache 2.0 license instead of AGPL-gated tiers",
    ],
    competitorPricingTiers: [
      {
        name: "Logs Essentials (Serverless)",
        price: "$0.07/GB ingested",
        period: "usage-based",
        features: [
          "Ad hoc log analysis and search",
          "Dashboards and integrations",
          "Alerting on log data",
          "Retention from ~$0.017/GB per month",
        ],
        limitations: [
          "Logs only, no APM, SLOs, or ML",
          "Bills grow with data volume",
          "No status pages, on-call, or incidents",
        ],
      },
      {
        name: "Observability Complete (Serverless)",
        price: "$0.09/GB ingested",
        period: "usage-based",
        features: [
          "Everything in Logs Essentials",
          "APM, metrics, and traces",
          "SLOs, ML, and AI-assisted pipelines",
          "Metrics from ~$0.023/GB ingested",
        ],
        limitations: [
          "Synthetics are a paid add-on (~$0.0123/run)",
          "Retention and egress billed separately",
          "No on-call, status pages, or incident tools",
        ],
      },
      {
        name: "Elastic Cloud Hosted",
        price: "From ~$99/mo",
        period: "resource-based",
        features: [
          "Standard, Gold, Platinum, Enterprise tiers",
          "Full Elastic Stack observability features",
          "Price scales with nodes, storage, and zones",
          "SSO/SAML and advanced security on higher tiers",
        ],
        limitations: [
          "Support tiers add 5-15% of consumption",
          "Cost climbs quickly with retention and scale",
          "Cluster capacity planning still required",
        ],
      },
      {
        name: "Self-Managed (Basic)",
        price: "Free (AGPL)",
        period: "self-hosted",
        features: [
          "Elasticsearch and Kibana core features",
          "Logs, metrics, and basic APM",
          "Run on your own infrastructure",
          "AGPLv3 / SSPL / Elastic License options",
        ],
        limitations: [
          "You operate and scale every cluster",
          "Advanced features gated behind paid tiers",
          "No reliability workflows out of the box",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup that needs uptime monitoring, a public status page, and on-call for a small SaaS app",
        competitorSolution:
          "Elastic Observability for logs and APM, plus separate tools for status pages and on-call",
        competitorCost:
          "Elastic consumption billing plus extra status page and paging subscriptions",
        oneuptimeSolution:
          "OneUptime for monitors, status page, on-call, incidents, and telemetry in one platform",
        oneuptimeCost: "Generous free tier, then ~$1/month per active monitor",
      },
      {
        scenario:
          "Growth-stage team ingesting roughly 100 GB of logs and traces per month across services",
        competitorSolution:
          "Elastic Observability Complete on serverless with retention and egress",
        competitorCost:
          "Roughly $9+/month in ingest alone plus retention, egress, and add-ons that grow with volume",
        oneuptimeSolution:
          "OneUptime OpenTelemetry ingestion plus flat-priced monitors and included reliability workflows",
        oneuptimeCost:
          "~$0.10/GB ingested plus ~$1/month per monitor, or free self-hosted",
      },
      {
        scenario:
          "Enterprise wanting full control and data residency without escalating cluster costs",
        competitorSolution:
          "Self-managed Elastic clusters that the team sizes, scales, and tunes in-house",
        competitorCost:
          "Free license but significant engineering and infrastructure operating cost",
        oneuptimeSolution:
          "Self-hosted OneUptime under Apache 2.0 with monitoring, status, on-call, and incidents built in",
        oneuptimeCost: "$0 in license fees, fully self-hosted",
      },
    ],
    keyDifferences: [
      {
        title: "Unified platform, not just telemetry",
        description:
          "Elastic delivers logs, metrics, and APM, but OneUptime adds monitoring, status pages, on-call, and incidents in the same platform so you are not stitching tools together.",
        icon: "unified",
      },
      {
        title: "Truly permissive open source",
        description:
          "OneUptime is Apache 2.0 and free to self-host, while Elastic's core is AGPL/SSPL with many observability features gated behind paid Elastic tiers.",
        icon: "open-source",
      },
      {
        title: "Built-in status pages",
        description:
          "OneUptime includes public and private status pages with unlimited subscribers, custom domains, and free SSL. Elastic has no status page capability at all.",
        icon: "status-page",
      },
      {
        title: "Native on-call and escalation",
        description:
          "OneUptime provides on-call rotations, multi-level escalation, and alerts via SMS, phone call, email, push, Slack, and Teams. Elastic offers alerting but no on-call scheduling.",
        icon: "on-call",
      },
      {
        title: "Incident management included",
        description:
          "OneUptime has incident timelines, severities, postmortems, action items, and MTTR analytics. Elastic leaves incident response to third-party tools.",
        icon: "incident",
      },
      {
        title: "Predictable pricing",
        description:
          "OneUptime charges a flat $1/month per active monitor and ~$0.10/GB telemetry. Elastic bills on ingest, retention, and egress, so costs rise with data volume.",
        icon: "pricing",
      },
    ],
    items: [
      {
        name: "Logs & Observability",
        data: [
          {
            title: "Log management and search",
            description:
              "Collect, index, and search application and infrastructure logs.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Ingest and visualize time-series metrics.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing / APM",
            description:
              "Trace requests across services to find latency and errors.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native",
            description:
              "First-class support for OpenTelemetry data without proprietary agents.",
            productColumn: "Supported",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Build custom dashboards over telemetry data.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception / error tracking",
            description: "Capture and group application exceptions and errors.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "No cluster or shard management",
            description:
              "Avoid sizing, scaling, and tuning search clusters yourself.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring & Uptime",
        data: [
          {
            title: "Website / URL monitoring",
            description: "Check that public endpoints stay up and fast.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API responses, status codes, and payloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic / transaction monitoring",
            description: "Run scripted browser and multi-step checks.",
            productColumn: "Add-on (paid)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server / infrastructure monitoring",
            description: "Track CPU, memory, and disk on hosts.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron / heartbeat monitoring",
            description: "Detect missed scheduled jobs and background tasks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description:
              "Check availability from multiple regions plus private probes.",
            productColumn: "Synthetics locations",
            oneuptimeColumn: "7+ regions",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Communicate uptime and incidents to customers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description:
              "Restrict status to internal or authenticated audiences.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers at no extra cost.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host the status page on your own domain with SSL.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Match the status page to your brand.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned maintenance windows in advance.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Reflect monitor status on the page automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Alerting on telemetry",
            description: "Trigger alerts from logs, metrics, and thresholds.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations",
            description: "Schedule daily, weekly, or custom rotations.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description:
              "Escalate unacknowledged alerts to the next responder.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation",
            description: "Swap shifts and cover time off cleanly.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS and phone call alerts",
            description: "Reach responders via SMS and voice, not just email.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Deliver alerts into team chat channels.",
            productColumn: "Webhook only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun scheduling",
            description: "Route alerts across global teams by time zone.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Track the full lifecycle of each incident.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities and prioritization",
            description: "Classify incidents by impact and urgency.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Document root cause and lessons learned.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items and runbooks",
            description: "Assign follow-ups and link response playbooks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack / Teams incident collaboration",
            description: "Coordinate response directly in chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure and improve time to resolution.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source license",
            description: "Freely inspect, modify, and self-host the platform.",
            productColumn: "AGPL / SSPL",
            oneuptimeColumn: "Apache 2.0",
          },
          {
            title: "Free self-hosting",
            description:
              "Run the full product on your own infrastructure at no license cost.",
            productColumn: "Core only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable flat pricing",
            description:
              "Avoid bills that scale with data ingest and retention.",
            productColumn: "",
            oneuptimeColumn: "$1/monitor/mo",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate with your own systems.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflow automation",
            description: "Build automated responses and integrations.",
            productColumn: "Usage-based",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML, RBAC, audit logs",
            description: "Enterprise access control and governance.",
            productColumn: "Higher tiers",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2, ISO 27001, GDPR",
            description: "Recognized security and compliance posture.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a full replacement for Elastic Observability?",
        answer:
          "For most teams, yes. OneUptime provides OpenTelemetry-native logs, metrics, traces, dashboards, and exception tracking, and it adds monitoring, status pages, on-call, and incident management that Elastic does not include. If your primary need is extremely deep, search-heavy log analytics at very large scale, Elastic's search engine is more specialized, but OneUptime covers the full reliability workflow in one platform.",
      },
      {
        question: "How does pricing compare between OneUptime and Elastic?",
        answer:
          "Elastic Observability bills on consumption, charging separately for ingest, retention, and egress, so your bill grows with data volume. OneUptime charges a flat 1 dollar per month per active monitor and roughly 0.10 dollars per GB for telemetry ingestion, with a generous free tier and free self-hosting, making costs far more predictable.",
      },
      {
        question:
          "Does Elastic Observability include status pages and on-call?",
        answer:
          "No. Elastic focuses on logs, metrics, and APM and does not offer status pages, on-call rotations, escalation policies, or incident management. Teams typically add separate tools like Statuspage and PagerDuty. OneUptime includes all of these in one platform.",
      },
      {
        question: "Is OneUptime really open source?",
        answer:
          "Yes. OneUptime is licensed under the permissive Apache 2.0 license and can be fully self-hosted for free. Elastic's core is now available under AGPLv3 and SSPL, but many observability features remain gated behind paid Elastic tiers, and AGPL is a more restrictive copyleft license than Apache 2.0.",
      },
      {
        question: "How hard is it to operate compared with Elastic?",
        answer:
          "Running Elastic yourself means sizing clusters, managing shards and indices, and tuning for performance and cost, which is a meaningful ongoing engineering burden. OneUptime is designed to be simpler to self-host and also offers a fully managed cloud, so you can avoid cluster operations entirely.",
      },
      {
        question: "Can I migrate my OpenTelemetry data to OneUptime?",
        answer:
          "Yes. OneUptime is OpenTelemetry-native, so if you already emit logs, metrics, and traces via OpenTelemetry you can point your collectors at OneUptime without adopting proprietary agents, avoiding vendor lock-in.",
      },
      {
        question:
          "Does OneUptime meet enterprise security and compliance needs?",
        answer:
          "Yes. OneUptime supports SSO/SAML, RBAC, and audit logs, and maintains SOC 2 Type II, ISO 27001, and GDPR compliance, so it fits enterprise requirements while remaining open source and self-hostable.",
      },
    ],
  },
  site24x7: {
    productName: "Site24x7",
    iconUrl: "/img/site24x7.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One open-source platform vs a monitoring suite with add-on sprawl",
    competitorFocus:
      "Site24x7 is a broad Zoho ManageEngine monitoring suite spanning uptime, APM, infrastructure, network, and real user monitoring, but with a dated console and shallow on-call and incident depth.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry observability in one open-source platform with predictable per-monitor pricing.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Site24x7 is an all-in-one monitoring product from Zoho's ManageEngine division, covering website uptime, application performance monitoring, server and network infrastructure, and real user monitoring. It is a mature, feature-broad suite, but its console feels dated and its cost is built around a base plan plus many separate add-ons for host monitors, advanced monitors, logs, synthetic runs, and RUM page views. Incident response and on-call scheduling are comparatively shallow, and the platform is closed source with no self-host option.",
    oneUptimeDescription:
      "OneUptime is an open-source, Apache 2.0 licensed platform that combines monitoring, status pages, on-call rotations, incident management, and OpenTelemetry-native logs, metrics, and traces in a single app. Active monitors are billed at a flat $1 per month with no per-check tiers or caps, and telemetry ingestion runs about $0.10 per GB. Teams can run it fully hosted or self-host the whole platform for free.",
    description:
      "Site24x7 and OneUptime both promise all-in-one monitoring, but they take very different paths. Site24x7 is a broad, closed-source suite from ManageEngine whose real cost climbs as you stack add-ons for host monitors, advanced monitors, logs, synthetic runs, and RUM page views. OneUptime is open source and delivers comparable monitoring breadth alongside far deeper on-call and incident management, plus OpenTelemetry-native observability. Pricing is a predictable flat $1 per active monitor per month, with a generous free tier and free self-hosting.",
    descriptionLine2:
      "If you want monitoring plus real incident response and status pages without maintaining an add-on spreadsheet, OneUptime gives you one platform at one predictable price.",
    migrationBenefits: [
      "Replace Site24x7's add-on maze with a flat $1 per month per active monitor, with no separate host, advanced, network, or synthetic add-ons.",
      "Get unlimited status page subscribers with free custom domains and SSL, instead of 250-subscriber caps and per-page add-on packs.",
      "Own your stack with OneUptime's Apache 2.0 open-source, self-hostable platform and avoid closed-source vendor lock-in.",
      "Gain deeper incident management including postmortems, action items, runbooks, and MTTR analytics that Site24x7 does not match.",
      "Consolidate OpenTelemetry-native logs, metrics, and traces in one place without proprietary agents or per-GB retention tiers.",
      "Work in one modern, unified UI across monitoring, on-call, status pages, and incidents instead of Site24x7's dated, siloed console.",
    ],
    competitorPricingTiers: [
      {
        name: "Lite (All-in-One)",
        price: "$9",
        period: "/month",
        features: [
          "5 websites and 2 servers",
          "Basic uptime monitoring",
          "1 minute check intervals",
          "Email support",
        ],
        limitations: [
          "No APM or advanced monitors",
          "Very low included monitor counts",
          "Add-ons required to scale at all",
        ],
      },
      {
        name: "Professional (All-in-One)",
        price: "$42",
        period: "/month",
        features: [
          "1 APM application",
          "5 servers and 20 websites",
          "10 network components",
          "4 GB log ingestion",
          "100K RUM page views",
        ],
        limitations: [
          "Hosts, logs, RUM, synthetics billed as add-ons",
          "On-call scheduling is basic",
          "No postmortems, action items, or runbooks",
        ],
      },
      {
        name: "Enterprise (All-in-One)",
        price: "$625+",
        period: "/month",
        features: [
          "Everything in Professional",
          "Anomaly detection (Zia AI)",
          "Event correlation",
          "Infrastructure event management",
        ],
        limitations: [
          "High base price plus add-ons",
          "Closed source, no self-host option",
          "Add-on pricing complexity remains",
        ],
      },
      {
        name: "StatusIQ (Status Page)",
        price: "$9",
        period: "/page/month",
        features: [
          "Public and private status pages",
          "250 subscribers included",
          "Custom domain and branding",
          "Slack and Teams integration",
        ],
        limitations: [
          "Priced separately from monitoring",
          "Subscriber add-ons at $10 per 250",
          "$10 per additional status page",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup monitoring 50 websites and servers with a public status page",
        competitorSolution:
          "Site24x7 Professional plus basic and host monitor add-ons, plus a separate StatusIQ page",
        competitorCost: "~$90+/month with add-ons",
        oneuptimeSolution:
          "50 active monitors at $1 each with a status page included",
        oneuptimeCost: "~$50/month",
      },
      {
        scenario:
          "Growing team needing on-call rotations and incident postmortems",
        competitorSolution:
          "Site24x7 alerting with basic on-call schedules; postmortems and runbooks handled in external tools",
        competitorCost: "Higher tier plus third-party tools",
        oneuptimeSolution:
          "Built-in multi-level escalation, rotations, overrides, postmortems, runbooks, and MTTR analytics",
        oneuptimeCost: "Included at $1 per monitor",
      },
      {
        scenario:
          "Platform team consolidating logs, metrics, and traces with OpenTelemetry",
        competitorSolution:
          "Site24x7 APM plus log ingestion add-ons priced per GB by retention window",
        competitorCost: "Add-on based, scales with GB",
        oneuptimeSolution:
          "OpenTelemetry-native logs, metrics, and traces in one platform",
        oneuptimeCost: "~$0.10 per GB ingested",
      },
    ],
    keyDifferences: [
      {
        title: "Open source and self-hostable",
        description:
          "OneUptime is Apache 2.0 licensed and can be self-hosted for free, while Site24x7 is fully closed source with no self-host option.",
        icon: "open-source",
      },
      {
        title: "Predictable flat pricing",
        description:
          "OneUptime charges a flat $1 per active monitor per month, versus Site24x7's base plan plus a stack of host, advanced, log, synthetic, and RUM add-ons.",
        icon: "pricing",
      },
      {
        title: "Truly unified platform",
        description:
          "Monitoring, status pages, on-call, and incident management live in one OneUptime app, while Site24x7 splits status pages into a separately priced StatusIQ product.",
        icon: "unified",
      },
      {
        title: "Deeper incident management",
        description:
          "OneUptime adds postmortems, action items, runbooks, and MTTR analytics that Site24x7's lighter incident features do not match.",
        icon: "incident",
      },
      {
        title: "Unlimited status page subscribers",
        description:
          "OneUptime status pages support unlimited subscribers with free SSL, while Site24x7 caps subscribers at 250 per page and sells more in add-on packs.",
        icon: "subscribers",
      },
      {
        title: "Stronger on-call and escalation",
        description:
          "OneUptime offers multi-level escalation, rotations, overrides, and follow-the-sun scheduling, where Site24x7's on-call scheduling stays basic.",
        icon: "on-call",
      },
    ],
    items: [
      {
        name: "Monitoring Suite",
        data: [
          {
            title: "Website and URL monitoring",
            description:
              "Check availability and response of public and internal endpoints.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure monitoring",
            description: "Track CPU, memory, and disk on hosts and VMs.",
            productColumn: "Host add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Application performance monitoring",
            description:
              "Trace application requests and diagnose slow transactions.",
            productColumn: "tick",
            oneuptimeColumn: "OTel-native",
          },
          {
            title: "Network device monitoring (SNMP)",
            description: "Poll routers, switches, and network gear over SNMP.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Real user monitoring (RUM)",
            description:
              "Measure real browser page-load performance from end users.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Synthetic and transaction monitoring",
            description:
              "Script multi-step user journeys from global locations.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container and Kubernetes monitoring",
            description: "Monitor Docker and Kubernetes workloads.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Fastest check interval",
            description: "Minimum time between monitor checks.",
            productColumn: "1 min minimum",
            oneuptimeColumn: "1s intervals",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Publicly share service health and history.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Restrict visibility with authentication or IP rules.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Included with the platform",
            description: "Status pages bundled rather than sold separately.",
            productColumn: "Separate add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No cap on the number of status page subscribers.",
            productColumn: "250/page + add-ons",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain with free SSL",
            description: "Host the status page on your own domain with SSL.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Fully control look and feel of the page.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce and track planned maintenance windows.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications (email/SMS/Slack/RSS)",
            description: "Notify subscribers across multiple channels.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "Multi-channel alerts (email/SMS/voice/push)",
            description:
              "Reach responders across email, SMS, phone call, and push.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations",
            description: "Daily, weekly, and custom on-call rotations.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description:
              "Escalate through tiers until an alert is acknowledged.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation coverage",
            description: "Swap on-call coverage for time off.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun scheduling",
            description: "Rotate coverage across global time zones.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Route alerts into team chat channels.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call and push notifications",
            description: "Wake responders with voice calls and mobile push.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological record of incident activity.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severity levels",
            description: "Classify incidents by impact and urgency.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured post-incident reviews.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up tasks to closure.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Attach response procedures to incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams incident collaboration",
            description: "Coordinate response in chat channels.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution over time.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry and Observability",
        data: [
          {
            title: "Log management",
            description: "Ingest, search, and retain application logs.",
            productColumn: "Add-on (per GB)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Collect and visualize time-series metrics.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed traces",
            description: "Follow requests across services.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native ingestion",
            description: "First-class OpenTelemetry logs, metrics, and traces.",
            productColumn: "Limited",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom dashboards",
            description: "Build dashboards across signals.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application exceptions.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Telemetry pricing model",
            description: "How log and telemetry ingestion is billed.",
            productColumn: "Tiered add-on",
            oneuptimeColumn: "~$0.10/GB",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source and self-hostable",
            description:
              "Run the full platform yourself under an open license.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Transparent flat pricing",
            description: "Predictable per-monitor cost without add-on math.",
            productColumn: "Add-on based",
            oneuptimeColumn: "$1/monitor",
          },
          {
            title: "Free tier",
            description: "Ongoing free usage beyond a trial period.",
            productColumn: "30-day trial",
            oneuptimeColumn: "Generous free tier",
          },
          {
            title: "Unlimited free static monitors",
            description: "Manual and static monitors at no cost.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML and RBAC",
            description: "Enterprise identity and role-based access.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track configuration and access changes.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and native webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "AI assistance",
            description: "AI-driven detection and copilots.",
            productColumn: "Zia AI",
            oneuptimeColumn: "Sentinel AI",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a good Site24x7 alternative?",
        answer:
          "Yes. OneUptime covers the monitoring breadth most teams use Site24x7 for, including website, server, container, synthetic, SSL, and cron monitoring, and adds deeper on-call, incident management, status pages, and OpenTelemetry observability in one open-source platform with predictable per-monitor pricing.",
      },
      {
        question: "How does OneUptime pricing compare to Site24x7?",
        answer:
          "OneUptime charges a flat $1 per active monitor per month with unlimited free static monitors and telemetry at roughly $0.10 per GB. Site24x7 starts low but relies on a base plan plus separate add-ons for host monitors, advanced monitors, logs, synthetic runs, and RUM page views, so the real bill grows as you scale.",
      },
      {
        question: "Does Site24x7 have on-call and escalation like OneUptime?",
        answer:
          "Site24x7 offers alerting with basic on-call schedules, but its escalation and rotation capabilities are limited. OneUptime provides full multi-level escalation policies, daily, weekly, and custom rotations, overrides for time off, and follow-the-sun coverage built in.",
      },
      {
        question: "Is Site24x7 open source?",
        answer:
          "No. Site24x7 is a closed-source SaaS product from Zoho's ManageEngine division with no self-host option. OneUptime is open source under the Apache 2.0 license and can be self-hosted for free or used as a managed cloud service.",
      },
      {
        question: "Can OneUptime replace Site24x7's StatusIQ status pages?",
        answer:
          "Yes. OneUptime includes public and private status pages with custom domains, free SSL, custom branding, scheduled maintenance, and unlimited subscribers at no extra cost. Site24x7 sells status pages as the separate StatusIQ product with a 250-subscriber cap per page and add-on packs for more.",
      },
      {
        question:
          "Does OneUptime support OpenTelemetry logs, metrics, and traces?",
        answer:
          "Yes. OneUptime is OpenTelemetry-native, so you can send logs, metrics, and traces directly without proprietary agents, and correlate them with monitors and incidents. Telemetry ingestion is billed at about $0.10 per GB instead of retention-tiered add-ons.",
      },
      {
        question: "What does Site24x7 do better than OneUptime?",
        answer:
          "Site24x7 has a longer-established suite with deep SNMP network-device monitoring and real user monitoring (RUM) that OneUptime does not currently offer. If those are core requirements, Site24x7 may fit; if you want unified monitoring, on-call, incidents, and status pages with open-source flexibility and predictable pricing, OneUptime is the stronger choice.",
      },
    ],
  },
  cronitor: {
    productName: "Cronitor",
    iconUrl: "/img/cronitor.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs a focused cron and uptime monitor",
    competitorFocus:
      "Cronitor specializes in developer-friendly cron job, heartbeat, and uptime monitoring, but leaves real on-call scheduling and deep incident management to third-party tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry observability in one open-source, self-hostable platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Cronitor is a developer-focused monitoring service best known for its deep, schedule-aware cron job and heartbeat monitoring, alongside website and API uptime checks and hosted status pages. It offers clean analytics and strong alert-routing integrations, but pricing is per-monitor at $2 per month plus per-user charges, and it relies on tools like PagerDuty or Opsgenie for true on-call scheduling and escalation.",
    oneUptimeDescription:
      "OneUptime is an open-source, self-hostable reliability platform that combines monitoring, status pages, on-call scheduling, incident management, and OpenTelemetry-based logs, metrics, and traces. Active monitors are a flat $1 per month each with unlimited team members, and you can run it in the managed cloud or on your own infrastructure for free.",
    description:
      "Cronitor is an excellent, developer-friendly tool for watching cron jobs, background tasks, and uptime, and its status pages are simple to stand up. But as your team grows you hit its edges: alerts route out to a separate on-call tool, incident management stops at the status page, and per-monitor plus per-user pricing climbs quickly. OneUptime covers the same cron and uptime monitoring while adding native on-call rotations, full incident management, and OpenTelemetry observability in a single platform. It is open-source, self-hostable, and bills active monitors at a flat $1 each with no per-user fees.",
    descriptionLine2:
      "Instead of stitching Cronitor together with PagerDuty and a separate observability stack, you get one predictable, unified platform you can even host yourself.",
    migrationBenefits: [
      "Cut per-monitor cost in half with a flat $1 per month per active monitor versus Cronitor's $2, and pay nothing extra per user.",
      "Get built-in on-call rotations, multi-level escalation, and overrides so you can retire a separate PagerDuty or Opsgenie subscription.",
      "Run full incident management with severities, postmortems, action items, runbooks, and MTTR analytics instead of status-page-only incidents.",
      "Publish status pages with unlimited subscribers, free custom branding, and private pages, with no $25 to $50 per month add-ons or subscriber caps.",
      "Add OpenTelemetry logs, metrics, traces, dashboards, and error tracking to unify observability alongside your uptime and cron monitoring.",
      "Own your data with an open-source, Apache 2.0, self-hostable platform, or use the managed cloud with predictable, transparent pricing.",
    ],
    competitorPricingTiers: [
      {
        name: "Hacker (Free)",
        price: "$0",
        period: "per month",
        features: [
          "5 monitors included",
          "Cron, heartbeat, website, and API monitoring",
          "Email and Slack alerts",
          "1 basic status page",
          "5-minute check frequency",
        ],
        limitations: [
          "No SMS or phone call alerts",
          "Only 50 status page subscribers",
          "No team management or private pages",
          "No premium integrations",
        ],
      },
      {
        name: "Business",
        price: "$2/monitor + $5/user",
        period: "per month",
        features: [
          "Unlimited monitors (charged per monitor)",
          "30-second check frequency",
          "12-month data retention and SMS alerts",
          "10 alert integrations incl. PagerDuty, Opsgenie",
          "Team roles and SAML SSO ($5/user)",
        ],
        limitations: [
          "No native on-call scheduling or escalation",
          "500 subscriber cap (+$25/mo per extra 1,000)",
          "Branded pages $25/mo, private pages $50/mo",
          "Costs scale per monitor and per user",
        ],
      },
      {
        name: "Enterprise",
        price: "From $6,000/year",
        period: "per year",
        features: [
          "Custom monitor and user pricing",
          "Dedicated engineer and priority support",
          "Unlimited status pages",
          "Flexible invoice billing",
        ],
        limitations: [
          "Annual contract and custom quote required",
          "Still no built-in on-call scheduling",
          "Observability limited to monitoring data",
          "Higher entry price point",
        ],
      },
    ],
    useCases: [
      {
        scenario: "Startup running 50 monitors with a 5-person team",
        competitorSolution:
          "Business plan: 50 monitors at $2 each plus per-user charges",
        competitorCost: "~$125/month",
        oneuptimeSolution:
          "50 active monitors at $1 each with unlimited team members included",
        oneuptimeCost: "$50/month",
      },
      {
        scenario:
          "Growing SaaS with 100 monitors and a branded private status page",
        competitorSolution:
          "100 monitors ($200) plus users, branded ($25) and private ($50) page add-ons",
        competitorCost: "~$300/month",
        oneuptimeSolution:
          "100 monitors at $1 with branded and private status pages and unlimited subscribers included",
        oneuptimeCost: "$100/month",
      },
      {
        scenario:
          "Team that also needs real on-call rotations and incident postmortems",
        competitorSolution:
          "Cronitor for monitoring plus a separate PagerDuty or Opsgenie subscription for on-call",
        competitorCost: "Cronitor + $100+/month add-on tool",
        oneuptimeSolution:
          "Monitoring, on-call rotations, escalation, and postmortems in one platform",
        oneuptimeCost: "Included, from $1/monitor",
      },
    ],
    keyDifferences: [
      {
        title: "Open source and self-hostable",
        description:
          "OneUptime is Apache 2.0 licensed and can run on your own infrastructure for free, while Cronitor is a closed-source SaaS only.",
        icon: "open-source",
      },
      {
        title: "Built-in on-call and escalation",
        description:
          "OneUptime includes on-call rotations, multi-level escalation, and overrides natively; Cronitor routes alerts out to PagerDuty or Opsgenie for that.",
        icon: "on-call",
      },
      {
        title: "Full incident management",
        description:
          "OneUptime adds severities, postmortems, action items, runbooks, and MTTR analytics, whereas Cronitor incidents live only on the status page.",
        icon: "incident",
      },
      {
        title: "One unified platform",
        description:
          "OneUptime combines monitoring, status pages, on-call, incidents, and OpenTelemetry observability, replacing several point tools Cronitor leaves separate.",
        icon: "unified",
      },
      {
        title: "Predictable flat pricing",
        description:
          "OneUptime charges a flat $1 per active monitor with no per-user fees; Cronitor is $2 per monitor plus $5 per user with paid page add-ons.",
        icon: "pricing",
      },
      {
        title: "Unlimited status page subscribers",
        description:
          "OneUptime status pages support unlimited subscribers, while Cronitor caps subscribers at 50 (free) or 500 (paid) with charges beyond that.",
        icon: "subscribers",
      },
    ],
    items: [
      {
        name: "Cron and Uptime Monitoring",
        data: [
          {
            title: "Cron job and heartbeat monitoring",
            description:
              "Track scheduled jobs and background tasks with alerts when they miss or fail.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Website and API uptime monitoring",
            description:
              "Check availability and response of websites and API endpoints.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Schedule-aware cron analytics",
            description:
              "Cron expression parsing, duration tracking, and exit code categorization.",
            productColumn: "tick",
            oneuptimeColumn: "Heartbeat-based",
          },
          {
            title: "Check frequency",
            description: "How often monitors run their checks.",
            productColumn: "30s (paid)",
            oneuptimeColumn: "1s to 24h",
          },
          {
            title: "Server and infrastructure agent",
            description:
              "Monitor CPU, memory, and disk on servers via an agent.",
            productColumn: "Heartbeat only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description: "Scripted multi-step browser flows and user journeys.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global and private probe locations",
            description:
              "Run checks from multiple regions and your own private probes.",
            productColumn: "tick",
            oneuptimeColumn: "7+ and private",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before TLS certificates expire.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description:
              "Customer-facing pages fed automatically from monitors.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal pages with access control.",
            productColumn: "$50/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host the status page on your own domain with SSL.",
            productColumn: "Branded $25/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and logo",
            description: "Apply your brand to the status page.",
            productColumn: "$25/mo add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML, CSS, and JS",
            description: "Fully customize page markup and styling.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber limit",
            description: "How many people can subscribe to updates.",
            productColumn: "50 to 500 cap",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Component groups and scheduled maintenance",
            description: "Group components and announce maintenance windows.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notification channels",
            description: "How subscribers receive updates.",
            productColumn: "Email and RSS",
            oneuptimeColumn: "Email/SMS/Slack",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "Email and Slack alerts",
            description: "Route alerts to email and Slack.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Microsoft Teams alerts",
            description: "Route alerts to Microsoft Teams.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Send alert notifications by SMS.",
            productColumn: "Paid plan only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call alerts",
            description: "Escalate to a phone call for critical alerts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notification alerts",
            description: "Native mobile push notifications.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations",
            description: "Daily, weekly, and custom on-call schedules.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts across responders.",
            productColumn: "Via PagerDuty",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description: "Vacation overrides and global handoffs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Status page incidents",
            description: "Create and publish incidents to a status page.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident timelines",
            description: "Chronological record of incident activity.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severity levels",
            description: "Classify incidents by severity.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured post-incident reviews.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items and follow-ups",
            description: "Track remediation tasks after incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Documented response procedures.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams incident collaboration",
            description: "Coordinate response inside chat tools.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR and incident analytics",
            description: "Measure response and resolution performance.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry and Observability",
        data: [
          {
            title: "Log management",
            description: "Ingest, search, and alert on logs.",
            productColumn: "Cron logs only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Store and chart custom metrics.",
            productColumn: "Cron metrics",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native ingestion",
            description: "Send telemetry using OpenTelemetry standards.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Error and exception tracking",
            description: "Capture and group application exceptions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom dashboards",
            description: "Build dashboards across telemetry data.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Source-available under a permissive license.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable",
            description: "Run the full platform on your own infrastructure.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Per-monitor price",
            description: "Cost of an active monitor.",
            productColumn: "$2/monitor/mo",
            oneuptimeColumn: "$1/monitor/mo",
          },
          {
            title: "Per-user charges",
            description: "Cost per additional team member.",
            productColumn: "$5/user/mo",
            oneuptimeColumn: "Unlimited free",
          },
          {
            title: "SSO and SAML",
            description: "Enterprise single sign-on.",
            productColumn: "$5/user/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflow automation",
            description: "No-code automation and workflows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and webhooks",
            description: "Programmatic access and native webhooks.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2 and ISO 27001",
            description: "Security and compliance certifications.",
            productColumn: "SOC 2",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a good alternative to Cronitor?",
        answer:
          "Yes. OneUptime covers the cron job, heartbeat, website, and API monitoring Cronitor is known for, and adds native on-call scheduling, full incident management, and OpenTelemetry observability in one platform. It is open-source and self-hostable, with active monitors billed at a flat $1 per month and no per-user fees.",
      },
      {
        question:
          "Does OneUptime monitor cron jobs and heartbeats like Cronitor?",
        answer:
          "Yes. OneUptime supports cron and heartbeat monitoring so you get alerted when a scheduled job fails to check in or runs late. It also adds server, container, synthetic, SSL, and port monitoring so you can consolidate more of your stack in one place.",
      },
      {
        question: "How does OneUptime pricing compare to Cronitor?",
        answer:
          "Cronitor charges $2 per monitor per month plus $5 per user, with paid add-ons for branded and private status pages. OneUptime charges a flat $1 per active monitor per month with unlimited team members and status pages included, which typically cuts the bill roughly in half at the same monitor count.",
      },
      {
        question: "Does Cronitor include on-call scheduling and escalation?",
        answer:
          "No. Cronitor routes alerts to channels like Slack, email, PagerDuty, and Opsgenie, but it does not manage who is on call or escalate unacknowledged alerts, so teams pair it with a separate on-call tool. OneUptime includes on-call rotations, multi-level escalation, and overrides natively.",
      },
      {
        question: "What incident management does OneUptime add over Cronitor?",
        answer:
          "Cronitor incidents live on the status page for communication. OneUptime adds severities, timelines, postmortems, action items, runbooks, Slack and Teams collaboration, and MTTR analytics so you can run the full incident lifecycle in one tool.",
      },
      {
        question: "Are there limits on status page subscribers?",
        answer:
          "Cronitor caps status page subscribers at 50 on the free plan and 500 on Business, with charges for more. OneUptime status pages support unlimited subscribers, plus a custom domain, free SSL, custom branding, and private pages at no extra add-on cost.",
      },
      {
        question: "Can I self-host OneUptime?",
        answer:
          "Yes. OneUptime is open-source under the Apache 2.0 license and can be self-hosted on your own infrastructure for free, giving you full control of your data. You can also use the managed cloud with the same predictable, transparent pricing. Cronitor is a closed-source SaaS with no self-hosting option.",
      },
    ],
  },
  "healthchecks-io": {
    productName: "Healthchecks.io",
    iconUrl: "/img/healthchecks.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs a single-purpose cron monitor",
    competitorFocus:
      "Healthchecks.io specializes in cron-job and scheduled-task monitoring using a dead-man's-switch model, and does nothing beyond it.",
    oneuptimeFocus:
      "OneUptime covers cron and heartbeat monitoring plus uptime, infrastructure, status pages, on-call, and incident management in one platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Healthchecks.io is an open-source, self-hostable service for monitoring cron jobs and scheduled tasks. Each job sends a periodic HTTP ping, and if a ping is late or missing, Healthchecks.io alerts you through channels like email, Slack, SMS, or PagerDuty. It is purpose-built for backups, batch scripts, and background workers, but does not do uptime, infrastructure, or synthetic monitoring.",
    oneUptimeDescription:
      "OneUptime is an open-source, Apache 2.0 platform that unifies monitoring, status pages, on-call, incident management, and OpenTelemetry-native telemetry. It includes the same cron and heartbeat monitoring Healthchecks.io offers, plus website, API, server, container, synthetic, and SSL monitoring. Teams replace several point tools with one predictable, self-hostable system.",
    description:
      "Healthchecks.io is excellent at one narrow job: telling you when a scheduled task fails to run. But cron monitoring is only a slice of reliability, and Healthchecks.io has no uptime monitoring, status pages, on-call scheduling, or incident management. OneUptime includes the same dead-man's-switch heartbeat monitoring and then covers everything Healthchecks.io leaves out. You get one open-source platform instead of stitching together several tools.",
    descriptionLine2:
      "Keep your cron alerts and gain uptime and infrastructure monitoring, public status pages, escalation policies, and postmortems, all under one predictable price of $1 per active monitor.",
    migrationBenefits: [
      "Keep your dead-man's-switch cron and heartbeat checks with the same ping-based workflow you already use.",
      "Add website, API, server, container, synthetic, and SSL monitoring that Healthchecks.io does not offer.",
      "Publish public or private status pages with unlimited subscribers and free custom-domain SSL.",
      "Build real on-call rotations and multi-level escalation policies instead of only firing notifications.",
      "Run full incident management with timelines, severities, postmortems, and MTTR analytics.",
      "Consolidate multiple point tools into one open-source platform at a flat, predictable price.",
    ],
    competitorPricingTiers: [
      {
        name: "Hobbyist",
        price: "$0",
        period: "forever",
        features: [
          "20 monitored cron/heartbeat checks",
          "100 log entries per check",
          "All chat and webhook integrations (email, Slack, Discord, etc.)",
          "Projects and read-only team members",
          "Pinging and management APIs",
        ],
        limitations: [
          "Cron/heartbeat monitoring only",
          "No SMS, WhatsApp, or phone-call alerts",
          "No uptime, infra, or synthetic monitoring",
          "No status pages, on-call, or incidents",
        ],
      },
      {
        name: "Business",
        price: "$20",
        period: "per month (or $16/mo billed annually)",
        features: [
          "100 monitored checks",
          "1,000 log entries per check",
          "50 SMS/WhatsApp credits per month",
          "20 phone-call credits per month",
          "Email support",
        ],
        limitations: [
          "Still cron/heartbeat monitoring only",
          "SMS and phone-call credits are capped",
          "No status pages or on-call scheduling",
          "No incident management or telemetry",
        ],
      },
      {
        name: "Business Plus",
        price: "$80",
        period: "per month (or $64/mo billed annually)",
        features: [
          "1,000 monitored checks",
          "1,000 log entries per check",
          "500 SMS/WhatsApp credits per month",
          "100 phone-call credits per month",
          "Priority email support",
        ],
        limitations: [
          "Only scales the number of cron checks",
          "No uptime or infrastructure monitoring",
          "No status pages, on-call, or incidents",
          "No unified observability or telemetry",
        ],
      },
      {
        name: "Self-Hosted (Open Source)",
        price: "$0",
        period: "self-managed",
        features: [
          "Full cron/heartbeat monitoring engine",
          "Run as many checks as your hardware allows",
          "All notification integrations",
          "Open-source BSD-licensed codebase",
        ],
        limitations: [
          "You run and maintain the servers",
          "Cron monitoring scope only",
          "No status pages, on-call, or incidents",
          "No uptime, infra, or telemetry",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A startup monitoring 40 backup and batch jobs that also needs website uptime checks and a public status page",
        competitorSolution:
          "Business plan for the cron checks, plus separate uptime and status-page tools bolted on",
        competitorCost: "$20/mo for Healthchecks.io plus extra tools",
        oneuptimeSolution:
          "40 active monitors covering cron, heartbeat, and website uptime, with a built-in status page",
        oneuptimeCost: "$40/mo, status page included",
      },
      {
        scenario:
          "An ops team wanting SMS and phone alerts on 80 scheduled jobs with real on-call rotations and escalation",
        competitorSolution:
          "Business plan with capped 50 SMS and 20 call credits, plus a separate on-call tool like PagerDuty",
        competitorCost: "$20/mo plus PagerDuty seats",
        oneuptimeSolution:
          "80 active monitors with built-in on-call rotations, escalation, SMS, and phone-call alerts",
        oneuptimeCost: "$80/mo, on-call included",
      },
      {
        scenario:
          "A growing company monitoring 300 tasks plus servers and services, wanting incidents and postmortems",
        competitorSolution:
          "Business Plus plan for the checks, plus separate infrastructure monitoring and incident tools",
        competitorCost: "$80/mo plus multiple add-on tools",
        oneuptimeSolution:
          "300 active monitors across cron, infra, and services with incidents and telemetry in one platform",
        oneuptimeCost: "$300/mo at $1/monitor, or self-host free",
      },
    ],
    keyDifferences: [
      {
        title: "Unified reliability platform",
        description:
          "OneUptime combines cron monitoring, uptime, status pages, on-call, and incidents in one place, while Healthchecks.io does cron only.",
        icon: "unified",
      },
      {
        title: "Beyond cron monitoring",
        description:
          "OneUptime adds website, API, server, container, synthetic, and SSL monitoring that Healthchecks.io simply does not have.",
        icon: "monitoring",
      },
      {
        title: "Built-in status pages",
        description:
          "OneUptime includes public and private status pages with unlimited subscribers and free SSL; Healthchecks.io has none.",
        icon: "status-page",
      },
      {
        title: "Real on-call and escalation",
        description:
          "OneUptime provides on-call rotations and multi-level escalation policies, not just one-shot notification fan-out.",
        icon: "on-call",
      },
      {
        title: "Incident management",
        description:
          "OneUptime runs incident timelines, severities, postmortems, and MTTR analytics that Healthchecks.io does not offer.",
        icon: "incident",
      },
      {
        title: "Predictable flat pricing",
        description:
          "OneUptime charges a flat $1 per active monitor with no per-check tiers or capped SMS and call credits.",
        icon: "pricing",
      },
    ],
    items: [
      {
        name: "Cron Job & Heartbeat Monitoring",
        data: [
          {
            title: "Dead-man's-switch heartbeat checks",
            description: "Alert when a scheduled job stops pinging on time.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Crontab schedule expressions",
            description: "Define expected run schedules with cron syntax.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Grace time and late detection",
            description: "Allow expected slack before flagging a job as late.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Start, success, and fail signals",
            description:
              "Measure execution time and capture failures via pings.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Ping / heartbeat API",
            description: "Simple HTTP URL each job calls to report its status.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Log capture per ping",
            description: "Attach output or diagnostics to each recorded ping.",
            productColumn: "100-1000 entries",
            oneuptimeColumn: "tick",
          },
          {
            title: "Status badges",
            description: "Embeddable badges showing a check's current state.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Check states (up/late/down/paused)",
            description: "Track lifecycle states for each monitored job.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Uptime & Infrastructure Monitoring",
        data: [
          {
            title: "Website / URL monitoring",
            description:
              "Check that public endpoints are reachable and healthy.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API responses, status codes, and payloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server / infrastructure metrics",
            description: "Monitor CPU, memory, and disk on your servers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring (Docker/K8s)",
            description: "Track health of containerized workloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic / transaction monitoring",
            description: "Script multi-step user flows to catch regressions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Port and ping monitoring",
            description: "Check TCP ports and network reachability.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Test from multiple regions plus private probes.",
            productColumn: "",
            oneuptimeColumn: "7+ locations",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Communicate real-time status to customers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Restricted status pages for internal audiences.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers at no extra cost.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain with free SSL",
            description: "Host the status page on your own domain.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Fully style the status page to match your brand.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance events",
            description: "Publish planned maintenance windows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description:
              "Status pages reflect live monitor state automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Email notifications",
            description: "Send alerts to email recipients.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Deliver alerts by text message.",
            productColumn: "Capped credits",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone-call alerts",
            description: "Escalate with voice calls.",
            productColumn: "Capped credits",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Post alerts into team chat channels.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notifications",
            description: "Mobile push alerts to responders.",
            productColumn: "Via Pushover/ntfy",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations",
            description: "Daily, weekly, or custom schedules for responders.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate to the next responder if unacknowledged.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description: "Handle vacations and global on-call coverage.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Track a chronological record of each incident.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severity levels",
            description: "Classify incidents by impact and urgency.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Document root cause and follow-up after incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items and runbooks",
            description: "Assign follow-ups and link operational runbooks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack/Teams incident collaboration",
            description: "Coordinate response directly in chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution and trends.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source and self-hostable",
            description: "Run the platform on your own infrastructure.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API",
            description: "Programmatically manage resources.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Native webhooks",
            description: "Send events to external systems.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO / SAML",
            description: "Enterprise single sign-on for teams.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Role-based access control",
            description: "Granular permissions across the platform.",
            productColumn: "Read/read-write",
            oneuptimeColumn: "tick",
          },
          {
            title: "Telemetry (logs, metrics, traces)",
            description: "OpenTelemetry-native observability data.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track user and system actions for compliance.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Flat per-monitor pricing",
            description: "Predictable cost that does not tier by check count.",
            productColumn: "Tiered by checks",
            oneuptimeColumn: "$1/monitor",
          },
        ],
      },
    ],
    faq: [
      {
        question:
          "Does OneUptime support the same cron and heartbeat monitoring as Healthchecks.io?",
        answer:
          "Yes. OneUptime offers dead-man's-switch heartbeat and cron monitoring with ping URLs, cron schedules, grace periods, and late or failure detection, the same core workflow Healthchecks.io provides. You keep your scheduled-task alerts and gain everything else in one platform.",
      },
      {
        question: "What does OneUptime do that Healthchecks.io cannot?",
        answer:
          "OneUptime adds website, API, server, container, synthetic, and SSL monitoring, public and private status pages, on-call rotations with escalation, full incident management, and OpenTelemetry-native logs, metrics, and traces. Healthchecks.io is limited to cron and scheduled-task monitoring.",
      },
      {
        question:
          "Is OneUptime open source and self-hostable like Healthchecks.io?",
        answer:
          "Yes. OneUptime is Apache 2.0 licensed and fully self-hostable at no cost, just like Healthchecks.io's BSD-licensed code. The difference is scope: OneUptime is a complete reliability platform rather than a single-purpose cron monitor.",
      },
      {
        question: "How does pricing compare?",
        answer:
          "Healthchecks.io charges tiered plans by check count, from Free with 20 checks to Business Plus at $80 per month for 1,000 checks, with capped SMS and phone-call credits. OneUptime charges a flat $1 per active monitor, keeps manual monitors free, and bundles status pages, on-call, and incidents at no extra cost.",
      },
      {
        question: "Can I get SMS and phone-call alerts without credit caps?",
        answer:
          "OneUptime includes SMS, phone-call, email, push, Slack, and Microsoft Teams alerting as part of its on-call system. Healthchecks.io meters SMS and phone calls with monthly credit limits, such as 50 SMS and 20 calls on the Business plan, so heavy alerting can require upgrades.",
      },
      {
        question:
          "Does Healthchecks.io have status pages or on-call scheduling?",
        answer:
          "No. Healthchecks.io has no status pages, on-call rotations, escalation policies, or incident management; it only sends notifications when a check is late or fails. OneUptime provides all of these natively, so you do not need separate tools like Statuspage or PagerDuty.",
      },
      {
        question:
          "How hard is it to migrate from Healthchecks.io to OneUptime?",
        answer:
          "Migration is straightforward because the heartbeat model is the same: point your existing cron pings at OneUptime's monitor URLs and configure schedules and grace periods. From there you can progressively add uptime monitors, status pages, and on-call policies without changing your jobs.",
      },
    ],
  },
  instatus: {
    productName: "Instatus",
    iconUrl: "/img/instatus.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "One unified reliability platform vs a fast but single-purpose status page tool",
    competitorFocus:
      "Instatus specializes in fast, inexpensive, beautifully designed hosted status pages, but leaves deep monitoring and full observability to other tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry logs, metrics, and traces in one open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Instatus is a hosted status page provider known for some of the fastest-loading, cleanest status pages on the market and flat pricing with no per-seat fees. It has since added basic uptime monitoring, on-call, and incident communication, making it a solid choice for teams that mainly need to keep customers informed during outages. However, it stops short of the deep monitoring and observability an engineering team needs to actually detect and diagnose those outages.",
    oneUptimeDescription:
      "OneUptime is an open-source, Apache 2.0 licensed reliability platform that combines monitoring, status pages, on-call, incident management, and OpenTelemetry-based logs, metrics, and traces. Every status page includes unlimited subscribers, and active monitors are billed a flat $1 per month with unlimited free static monitors. It can be used as a generous free hosted service or self-hosted for free with no seat or subscriber caps.",
    description:
      "Instatus and OneUptime both help you communicate reliability to customers, but they solve very different scopes. Instatus is purpose-built for polished, high-performance status pages and adds lightweight monitoring and on-call on top. OneUptime is a full reliability platform that detects incidents with deep monitoring, manages on-call and postmortems, ingests OpenTelemetry logs, metrics, and traces, and publishes status pages with unlimited subscribers. If you want one tool instead of a status page plus a separate monitoring stack plus an incident tool, OneUptime consolidates it all.",
    descriptionLine2:
      "With predictable $1-per-monitor pricing, unlimited status page subscribers, and an Apache 2.0 open-source core you can self-host, OneUptime removes both tool sprawl and pricing surprises.",
    migrationBenefits: [
      "Replace Instatus plus your separate monitoring, on-call, and telemetry tools with one unified platform.",
      "Get full OpenTelemetry observability with logs, metrics, and traces that Instatus does not offer at all.",
      "Publish status pages with unlimited subscribers on every plan, versus Instatus caps of 200 to 25,000.",
      "Add deep infrastructure and container monitoring for CPU, memory, disk, Docker, and Kubernetes.",
      "Pay a predictable $1 per active monitor with unlimited free static monitors, avoiding tier jumps to $300/mo.",
      "Own your data with an open-source, self-hostable Apache 2.0 core and no vendor lock-in.",
    ],
    competitorPricingTiers: [
      {
        name: "Starter (Free)",
        price: "$0",
        period: "per month",
        features: [
          "15 monitors",
          "2-minute check interval",
          "1 public status page",
          "200 subscribers",
          "5 team members",
        ],
        limitations: [
          "Email alerts only",
          "No custom domain",
          "No SSO or SAML",
          "No logs, metrics, or traces",
        ],
      },
      {
        name: "Pro",
        price: "$20",
        period: "per month",
        features: [
          "50 monitors",
          "30-second check interval",
          "Email and SMS alerts",
          "Custom domain and 5,000 subscribers",
          "50 team members",
        ],
        limitations: [
          "Basic uptime monitoring only",
          "5,000 subscriber cap",
          "No SSO or SAML",
          "No observability or APM",
        ],
      },
      {
        name: "Business",
        price: "$300",
        period: "per month",
        features: [
          "Up to 1,000 monitors",
          "SMS and phone call alerts",
          "SAML SSO included",
          "All status page types",
          "25,000 subscribers",
        ],
        limitations: [
          "Steep jump from the Pro tier",
          "No full observability or APM",
          "No postmortems or MTTR analytics",
          "25,000 subscriber cap",
        ],
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "per year",
        features: [
          "SCIM user provisioning",
          "99.99% SLA",
          "Priority support",
          "Multiple SSO connections",
        ],
        limitations: [
          "Custom contract and annual commitment",
          "Still status-page-centric",
          "No telemetry or trace pipeline",
          "No self-host option",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A startup needs a branded status page plus uptime monitoring for its main application.",
        competitorSolution:
          "Instatus Pro for a custom-domain status page and 50 uptime monitors.",
        competitorCost: "$20/mo plus a separate tool for logs and metrics",
        oneuptimeSolution:
          "A OneUptime status page with a handful of active monitors and telemetry included.",
        oneuptimeCost: "Free tier or a few dollars per month",
      },
      {
        scenario:
          "A growing SaaS has 20,000 status page subscribers and needs on-call escalations and SMS alerts.",
        competitorSolution:
          "Instatus Business for 25,000 subscribers, SMS and phone alerts, and 50 on-call members.",
        competitorCost: "$300/mo, or $3,600/yr",
        oneuptimeSolution:
          "OneUptime with unlimited subscribers, full escalation policies, and pay-per-monitor pricing.",
        oneuptimeCost: "About $99/mo Growth tier plus $1 per monitor",
      },
      {
        scenario:
          "An engineering team wants status pages, monitoring, on-call, incidents, and OpenTelemetry logs and traces in one place.",
        competitorSolution:
          "Instatus for status and uptime, plus separate APM, log, and incident tools.",
        competitorCost:
          "$300/mo Instatus plus $500 to $2,000/mo for observability tools",
        oneuptimeSolution:
          "OneUptime unified: monitoring, status pages, on-call, incidents, and telemetry together.",
        oneuptimeCost: "$1 per monitor plus about $0.10/GB telemetry",
      },
    ],
    keyDifferences: [
      {
        title: "One platform instead of a stack",
        description:
          "Instatus covers status pages and light monitoring, so teams bolt on separate tools for observability and incidents. OneUptime unifies monitoring, status pages, on-call, incidents, and telemetry.",
        icon: "unified",
      },
      {
        title: "Open source and self-hostable",
        description:
          "Instatus is a closed hosted service. OneUptime is Apache 2.0 licensed, so you can self-host for free, audit the code, and avoid vendor lock-in.",
        icon: "open-source",
      },
      {
        title: "Unlimited status page subscribers",
        description:
          "Instatus caps subscribers at 200 on Free, 5,000 on Pro, and 25,000 on Business. OneUptime includes unlimited subscribers on every status page.",
        icon: "subscribers",
      },
      {
        title: "Full-stack monitoring",
        description:
          "Instatus offers basic uptime checks. OneUptime adds server, container, synthetic transaction, and cron heartbeat monitoring with intervals as low as one second.",
        icon: "monitoring",
      },
      {
        title: "Predictable, transparent pricing",
        description:
          "Instatus jumps from $20 to $300 per month for more monitors and SSO. OneUptime charges a flat $1 per active monitor with unlimited free static monitors and no subscriber caps.",
        icon: "transparent",
      },
      {
        title: "Complete incident lifecycle",
        description:
          "Instatus handles incident communication on the status page. OneUptime adds postmortems, action items, runbooks, MTTR analytics, and Slack and Teams collaboration.",
        icon: "incident",
      },
    ],
    items: [
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description:
              "Customer-facing pages showing real-time component status.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description:
              "Internal or authenticated status pages for staff and partners.",
            productColumn: "Business plan",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom domain with free SSL",
            description:
              "Host the status page on your own domain with managed SSL.",
            productColumn: "Pro and up",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding",
            description: "Logos, colors, and themes to match your brand.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTML, CSS, and JS",
            description: "Deep visual customization of the status page.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Component groups",
            description: "Group services and components into logical sections.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned maintenance windows in advance.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers with no cap.",
            productColumn: "Capped 200 to 25k",
            oneuptimeColumn: "Unlimited",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Website and URL monitoring",
            description:
              "Check availability and response of web pages and endpoints.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description: "Validate API responses, status codes, and payloads.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire or misconfigure.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Ping and port monitoring",
            description: "Check reachability of hosts and specific ports.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infra monitoring",
            description: "Track CPU, memory, and disk with an agent.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Monitor Docker and Kubernetes workloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic transaction monitoring",
            description:
              "Script multi-step user journeys to catch flow breakage.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed or failed scheduled jobs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "Email alerts",
            description: "Notify responders and teams by email.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Text message notifications for incidents.",
            productColumn: "Pro and up",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call alerts",
            description: "Voice calls to responders for urgent issues.",
            productColumn: "Business plan",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notifications",
            description: "Mobile push alerts to on-call responders.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams alerts",
            description: "Route alerts into Slack and Microsoft Teams.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations",
            description: "Daily, weekly, and custom rotation schedules.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate through tiers until someone acknowledges.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description:
              "Vacation overrides and global follow-the-sun coverage.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological record of updates during an incident.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident severities",
            description: "Classify incidents by impact and priority.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Status page incident updates",
            description:
              "Publish investigating, identified, and resolved updates.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured retrospectives after incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up tasks from incidents to closure.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Documented response procedures for responders.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams collaboration",
            description: "Coordinate incident response inside chat tools.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution and trends.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Telemetry and Observability",
        data: [
          {
            title: "Log management",
            description:
              "Ingest, search, and retain application and infra logs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics",
            description: "Collect and chart time-series metrics.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services to find bottlenecks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native",
            description: "First-class OpenTelemetry ingestion with no lock-in.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom dashboards",
            description: "Build dashboards across logs, metrics, and traces.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application exceptions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Application performance monitoring",
            description: "APM across services and endpoints.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description:
              "Fully open-source codebase you can inspect and extend.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable",
            description: "Run the entire platform on your own infrastructure.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO and SAML",
            description: "Single sign-on for team access control.",
            productColumn: "Business plan",
            oneuptimeColumn: "tick",
          },
          {
            title: "Role-based access control",
            description: "Granular permissions across teams and resources.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Audit logs",
            description: "Track who changed what and when.",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API",
            description: "Programmatic access to platform resources.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflows and automation",
            description: "No-code automation across the platform.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Sentinel AI",
            description:
              "AI assistance for reliability and incident workflows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question:
          "Does Instatus include monitoring, or do I need a separate tool?",
        answer:
          "Instatus includes basic uptime monitoring for websites, APIs, SSL, ping, and DNS, which is enough to trigger status page updates. For server, container, synthetic transaction, or heartbeat monitoring, and for any logs, metrics, or traces, you would run a separate tool. OneUptime covers all of these in one platform.",
      },
      {
        question: "How does Instatus pricing compare to OneUptime?",
        answer:
          "Instatus uses flat plans: Free, Pro at $20 per month, and Business at $300 per month, with subscriber and monitor limits per tier. OneUptime charges a flat $1 per active monitor with unlimited free static monitors, telemetry at about $0.10 per GB, and predictable tiers such as Growth around $99 per month. Self-hosting OneUptime is free.",
      },
      {
        question: "Can Instatus handle logs, metrics, and traces?",
        answer:
          "No. Instatus focuses on status pages and uptime checks and does not offer log management, metrics, distributed tracing, or APM. OneUptime is OpenTelemetry-native and ingests logs, metrics, and traces alongside monitoring and status pages.",
      },
      {
        question: "How many status page subscribers do I get?",
        answer:
          "Instatus caps subscribers at 200 on Free, 5,000 on Pro, and 25,000 on Business. OneUptime includes unlimited subscribers on every status page, with notifications via email, SMS, webhook, RSS, Slack, and Teams.",
      },
      {
        question:
          "Does OneUptime have on-call and incident management like Instatus?",
        answer:
          "Yes, and more depth. OneUptime provides on-call rotations, multi-level escalation policies, overrides, and follow-the-sun coverage, plus incident timelines, severities, postmortems, action items, runbooks, and MTTR analytics with Slack and Teams collaboration.",
      },
      {
        question: "Is OneUptime really open source and self-hostable?",
        answer:
          "Yes. OneUptime is licensed under Apache 2.0, so you can read the source, contribute, and self-host the full platform for free with no seat or subscriber caps. Instatus is a closed, hosted-only service.",
      },
      {
        question: "How hard is it to migrate from Instatus to OneUptime?",
        answer:
          "Most teams recreate their status page components and monitors in OneUptime, point their custom domain over, and import subscribers. Because OneUptime also replaces your separate monitoring and incident tooling, migration usually consolidates several subscriptions into one platform.",
      },
    ],
  },
  freshping: {
    productName: "Freshping",
    iconUrl: "/img/freshping.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One unified reliability platform vs a discontinued uptime tool",
    competitorFocus:
      "Freshping offered simple, low-cost uptime checks and basic status pages, but Freshworks discontinued it in March 2026 with no on-call, incident management, or deep monitoring and no replacement product.",
    oneuptimeFocus:
      "OneUptime unifies uptime and synthetic monitoring, infrastructure and telemetry, status pages, on-call, and incident management in one open-source platform you can self-host and keep forever.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Freshping was Freshworks' entry-level uptime monitoring service, paired with the Freshstatus status page product. It offered HTTP, ping, TCP, and SSL checks at 1-minute intervals from around 10 global locations, with a generous free tier. Freshworks shut Freshping down on March 6, 2026, and has not released a replacement uptime monitoring product.",
    oneUptimeDescription:
      "OneUptime is an open-source, Apache 2.0 licensed, self-hostable platform that combines uptime and synthetic monitoring, infrastructure metrics, OpenTelemetry logs, metrics and traces, public status pages, on-call scheduling, and incident management. Active monitors are billed at a flat $1 per month each, telemetry ingestion is roughly $0.10/GB, and self-hosting is free. Because it is open source, the platform can never be taken away from you.",
    description:
      "Freshping was a popular choice for teams that wanted cheap, simple uptime checks and a basic status page. But its monitoring stopped at surface-level HTTP and ping checks, it never offered real on-call or incident management, and Freshworks discontinued the product entirely in March 2026. OneUptime covers the same uptime and status-page needs and goes far beyond them, adding synthetic, API, and infrastructure monitoring, full on-call and incident workflows, and OpenTelemetry observability. As an open-source platform, it gives you a permanent home instead of another tool that can be shut down.",
    descriptionLine2:
      "Migrate off the retired Freshping to a unified platform with predictable $1 per month monitors, unlimited status page subscribers, and no vendor lock-in.",
    migrationBenefits: [
      "Replace a discontinued product with an actively developed, open-source platform you can self-host and control forever.",
      "Go beyond HTTP and ping with synthetic, API, server, container, SSL, port, and cron/heartbeat monitoring in one place.",
      "Add real on-call scheduling and multi-level escalation with SMS, phone call, push, Slack, and Microsoft Teams alerts.",
      "Manage incidents end to end with timelines, severities, postmortems, action items, runbooks, and MTTR analytics.",
      "Publish status pages with unlimited subscribers, custom domains, free SSL, and full branding at no per-subscriber cost.",
      "Keep costs predictable at a flat $1 per active monitor with unlimited free static monitors and no surprise tiers.",
    ],
    competitorPricingTiers: [
      {
        name: "Sprout",
        price: "$0",
        period: "/month",
        features: [
          "50 monitors",
          "1-minute check intervals",
          "Around 10 global check locations",
          "Public status pages",
          "Email, SMS, and Slack alerts",
        ],
        limitations: [
          "No SSL certificate monitoring",
          "No on-call or incident management",
          "Product discontinued in March 2026",
        ],
      },
      {
        name: "Blossom",
        price: "$11",
        period: "/month",
        features: [
          "Everything in Sprout",
          "SSL monitoring and expiry alerts",
          "Custom HTTP headers",
          "Response-string checks",
          "More third-party integrations",
        ],
        limitations: [
          "No synthetic or infrastructure monitoring",
          "No escalation policies or on-call",
          "Product discontinued in March 2026",
        ],
      },
      {
        name: "Garden",
        price: "$36",
        period: "/month",
        features: [
          "Everything in Blossom",
          "Up to 80 checks",
          "Up to 50 users",
          "15 integrations",
          "2-year data retention",
        ],
        limitations: [
          "No APM, logs, metrics, or traces",
          "No incident management workflows",
          "Product discontinued in March 2026",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A startup monitoring 50 websites and APIs with a public status page",
        competitorSolution:
          "Freshping Sprout free tier, which is now discontinued",
        competitorCost: "$0/mo (no longer available)",
        oneuptimeSolution:
          "50 active monitors on OneUptime plus a branded status page with unlimited subscribers",
        oneuptimeCost: "About $50/mo, or free when self-hosted",
      },
      {
        scenario:
          "A growing team needing SSL monitoring, on-call rotations, and incident management",
        competitorSolution:
          "Freshping Garden plus separate on-call and incident tools",
        competitorCost: "$36/mo + extra tools (e.g. PagerDuty ~$21/user/mo)",
        oneuptimeSolution:
          "OneUptime with monitors, on-call, escalation, and incidents all included",
        oneuptimeCost: "About $99/mo Growth tier, all-in",
      },
      {
        scenario:
          "An engineering org wanting uptime, logs, metrics, traces, and status pages with no vendor lock-in",
        competitorSolution:
          "Not possible on Freshping; would require several separate SaaS products",
        competitorCost: "Multiple subscriptions, hard to predict",
        oneuptimeSolution:
          "OneUptime self-hosted, unifying monitoring, telemetry, on-call, and status pages",
        oneuptimeCost: "$0 software cost (self-hosted)",
      },
    ],
    keyDifferences: [
      {
        title: "Actively Developed vs Discontinued",
        description:
          "Freshworks shut Freshping down in March 2026 with no replacement, while OneUptime is open source and actively developed, so it can never be taken away.",
        icon: "open-source",
      },
      {
        title: "Deep Monitoring Coverage",
        description:
          "Freshping stopped at HTTP, ping, TCP, and SSL checks; OneUptime adds synthetic, API, server, container, port, and cron/heartbeat monitoring.",
        icon: "monitoring",
      },
      {
        title: "Real On-Call and Escalation",
        description:
          "Freshping had no on-call scheduling; OneUptime includes rotations, multi-level escalation, and alerts via SMS, phone call, push, Slack, and Teams.",
        icon: "on-call",
      },
      {
        title: "Full Incident Management",
        description:
          "Freshping offered no incident workflows; OneUptime provides timelines, severities, postmortems, action items, runbooks, and MTTR analytics.",
        icon: "incident",
      },
      {
        title: "Unlimited Status Page Subscribers",
        description:
          "OneUptime status pages support unlimited subscribers with a custom domain and free SSL, while Freshstatus limits status page capabilities by plan.",
        icon: "subscribers",
      },
      {
        title: "One Unified Platform",
        description:
          "Instead of stitching Freshping, a status page, and separate on-call and APM tools together, OneUptime delivers everything in a single platform.",
        icon: "unified",
      },
    ],
    items: [
      {
        name: "Uptime Monitoring & Status Pages",
        data: [
          {
            title: "HTTP/HTTPS website monitoring",
            description:
              "Check websites and endpoints for availability and response.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Ping, TCP, and port checks",
            description:
              "Layer-3 and layer-4 reachability checks for hosts and services.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Track certificate validity and expiry.",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "1-second check intervals",
            description: "High-frequency checks for critical services.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check from multiple regions around the world.",
            productColumn: "~10 locations",
            oneuptimeColumn: "7+ locations",
          },
          {
            title: "Private probes",
            description: "Monitor internal services from inside your network.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Public status pages",
            description: "Communicate uptime and incidents to customers.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Actively supported product",
            description: "The service is still maintained and available.",
            productColumn: "Discontinued",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring Depth",
        data: [
          {
            title: "API and transaction monitoring",
            description: "Multi-step synthetic checks across API flows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Server and infrastructure metrics",
            description: "Monitor CPU, memory, and disk on hosts.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Monitor Docker and Kubernetes workloads.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat monitoring",
            description: "Detect missed scheduled jobs and background tasks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Response-string and keyword checks",
            description: "Verify page content, not just status codes.",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom HTTP headers",
            description: "Send auth or custom headers with checks.",
            productColumn: "Paid plans",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Share real-time status with customers.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Internal-only status for teams.",
            productColumn: "Freshstatus",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom domain and free SSL",
            description: "Host the status page on your own domain.",
            productColumn: "Paid add-on",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "No per-subscriber charges or caps.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom HTML, CSS, and JS branding",
            description: "Fully brand and customize the page.",
            productColumn: "Logo & colors",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned maintenance windows.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description:
              "Notify via email, SMS, webhook, RSS, Slack, or Teams.",
            productColumn: "Email/Slack",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Status reflects monitor state automatically.",
            productColumn: "Needed Freshping",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "On-call scheduling and rotations",
            description: "Daily, weekly, and custom rotation schedules.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate unacknowledged alerts through tiers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description: "Vacation overrides and global handoffs.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Notify responders by text message.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call alerts",
            description: "Escalate with automated phone calls.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notification alerts",
            description: "Mobile push notifications to responders.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Route alerts into chat tools.",
            productColumn: "Slack only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Email alerts",
            description: "Notify responders by email.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management & Observability",
        data: [
          {
            title: "Incident timelines and severities",
            description: "Track incidents with severity and full history.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems and action items",
            description: "Document root cause and follow-up work.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Attach response procedures to incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure and improve response times.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Logs, metrics, and traces",
            description: "OpenTelemetry-native observability data.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exceptions and error tracking",
            description: "Capture and triage application errors.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Dashboards",
            description: "Build custom dashboards over your data.",
            productColumn: "Basic reports",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source (Apache 2.0)",
            description: "Inspect, extend, and own the code.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable",
            description: "Run on your own infrastructure for free.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Flat $1 per active monitor",
            description: "Predictable per-monitor pricing, no per-check tiers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited free static monitors",
            description: "Manual and static monitors at no cost.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO / SAML",
            description: "Enterprise single sign-on.",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "RBAC and audit logs",
            description: "Role-based access control and activity trails.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Actively maintained",
            description: "Ongoing development and support.",
            productColumn: "Discontinued",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is Freshping still available in 2026?",
        answer:
          "No. Freshworks discontinued Freshping on March 6, 2026. Free accounts were disabled immediately, paid plans stopped renewing, and the data export window closed around June 4, 2026. Freshworks has not released a replacement uptime monitoring product, so existing users need to migrate to a new platform.",
      },
      {
        question: "What is the best Freshping alternative?",
        answer:
          "OneUptime is a strong replacement because it covers everything Freshping did, uptime monitoring and status pages, and adds synthetic and infrastructure monitoring, on-call, incident management, and observability. It is open source and self-hostable, so you never have to worry about the product being shut down again.",
      },
      {
        question:
          "How does OneUptime pricing compare to Freshping's old plans?",
        answer:
          "Freshping charged $0 to $36 per month by tier with fixed monitor caps. OneUptime bills active monitors at a flat $1 each per month with unlimited free static monitors and no per-check tiers, plus telemetry ingestion at roughly $0.10 per GB. Self-hosting OneUptime is completely free.",
      },
      {
        question: "Did Freshping offer on-call or incident management?",
        answer:
          "No. Freshping focused only on uptime checks and status pages, with basic email, SMS, and Slack alerts. It had no on-call scheduling, escalation policies, or incident management. OneUptime includes full on-call rotations, multi-level escalation, and incident workflows out of the box.",
      },
      {
        question: "Can OneUptime replace both Freshping and Freshstatus?",
        answer:
          "Yes. OneUptime provides monitoring and status pages in one platform, so you do not need a separate status page product. Status pages support unlimited subscribers, custom domains with free SSL, custom branding, and automatic updates from your monitors.",
      },
      {
        question: "Can I self-host OneUptime instead of using a SaaS?",
        answer:
          "Yes. OneUptime is open source under the Apache 2.0 license and can be self-hosted for free on your own infrastructure. This removes vendor lock-in and ensures the platform can never be discontinued out from under you, unlike Freshping.",
      },
      {
        question:
          "What monitoring does OneUptime support that Freshping did not?",
        answer:
          "Beyond HTTP, ping, and SSL checks, OneUptime adds API and synthetic transaction monitoring, server and infrastructure metrics such as CPU, memory, and disk, container monitoring for Docker and Kubernetes, port and cron/heartbeat checks, and full OpenTelemetry logs, metrics, and traces.",
      },
    ],
  },
  prometheus: {
    productName: "Prometheus",
    iconUrl: "/img/prometheus.svg",
    price: "",
    oneuptimePrice: "",
    tagline: "One integrated open-source platform vs a DIY metrics stack",
    competitorFocus:
      "Prometheus is a best-in-class open-source engine for time-series metrics collection and PromQL-based alerting, but it stops at metrics and expects you to assemble everything else.",
    oneuptimeFocus:
      "OneUptime is an open-source, unified platform that pairs metrics, logs, and traces with uptime monitoring, status pages, on-call, and incident management out of the box.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Prometheus is a mature, CNCF-graduated open-source monitoring system built around a pull-based time-series database and the PromQL query language. Alerting is handled by its companion Alertmanager, which offers strong deduplication, silencing, and routing. It is metrics-only by design, so dashboards, long-term storage, logs, traces, and probing all come from separate tools you integrate yourself.",
    oneUptimeDescription:
      "OneUptime is an Apache 2.0, self-hostable observability and reliability platform that brings OpenTelemetry metrics, logs, and traces together with uptime and synthetic monitoring, status pages, on-call scheduling, and incident management. Instead of stitching together Prometheus, Grafana, Alertmanager, exporters, remote storage, a status page tool, and a paging tool, you run one system. Self-hosting is free and the managed cloud uses flat, predictable pricing.",
    description:
      "Prometheus is the de facto open-source standard for infrastructure and application metrics, and OneUptime does not try to replace PromQL's power for time-series analysis. The difference is scope. Prometheus gives you a metrics engine and Alertmanager, then leaves you to bolt on Grafana for dashboards, Thanos or Mimir for long-term storage, dozens of exporters for coverage, plus separate products for status pages, on-call rotations, and incident response. OneUptime folds all of that into one open-source platform so a single team can go from a metric spike to a paged engineer, a public status update, and a completed postmortem without leaving the tool.",
    descriptionLine2:
      "If you love Prometheus for metrics but are tired of maintaining six other systems around it, OneUptime gives you the same open-source freedom with far less assembly and operational overhead.",
    migrationBenefits: [
      "Replace the Prometheus plus Grafana plus Alertmanager plus exporters plus remote-storage stack with one open-source platform you deploy and upgrade once.",
      "Add uptime, synthetic, SSL, and heartbeat monitoring that Prometheus cannot do natively, alongside your existing metrics.",
      "Get real on-call scheduling with rotations, multi-level escalation, overrides, and follow-the-sun that Alertmanager routing does not provide.",
      "Publish public and private status pages with unlimited subscribers and a custom domain, driven automatically from your monitors.",
      "Run full incident management with timelines, severities, postmortems, action items, and MTTR analytics in the same tool that raised the alert.",
      "Keep open-source freedom and self-hosting at no license cost, with an option to move to flat, predictable managed pricing when you want it off your plate.",
    ],
    competitorPricingTiers: [
      {
        name: "Prometheus Server",
        price: "Free",
        period: "open source",
        features: [
          "Pull-based time-series metrics database",
          "PromQL query language",
          "Rich exporter ecosystem for infrastructure and apps",
          "Service discovery and recording rules",
          "Apache 2.0 license, fully self-hosted",
        ],
        limitations: [
          "Metrics only, no logs, traces, or uptime checks",
          "Local storage retention is limited by default",
          "No dashboards without a separate tool",
        ],
      },
      {
        name: "Alertmanager",
        price: "Free",
        period: "open source",
        features: [
          "Alert deduplication, grouping, and silencing",
          "Routing to email, Slack, PagerDuty, and webhooks",
          "High-availability clustering",
          "Inhibition rules to suppress noisy alerts",
        ],
        limitations: [
          "No on-call scheduling or rotations",
          "No escalation policies or overrides",
          "You still bring the paging tool it routes to",
        ],
      },
      {
        name: "Dashboards and probing",
        price: "Free stack",
        period: "self-assembled",
        features: [
          "Grafana for visualization and dashboards",
          "Blackbox exporter for basic endpoint probing",
          "Node exporter and cAdvisor for host and container metrics",
          "Pushgateway for batch and cron jobs",
        ],
        limitations: [
          "Each component is deployed and upgraded separately",
          "Blackbox probing is not full synthetic monitoring",
          "No status pages or incident tooling in the stack",
        ],
      },
      {
        name: "Long-term storage",
        price: "Free license + infra",
        period: "self-managed",
        features: [
          "Thanos, Mimir, or VictoriaMetrics via remote write",
          "Object storage backend for historical metrics",
          "Downsampling and global query views",
          "Retention beyond the local Prometheus window",
        ],
        limitations: [
          "Meaningful compute, storage, and engineering cost",
          "Adds another distributed system to operate",
          "Ongoing tuning and capacity planning required",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "A startup needs infrastructure metrics, uptime checks, a public status page, and on-call paging",
        competitorSolution:
          "Run Prometheus and Alertmanager, add Grafana for dashboards and Blackbox exporter for probing, then buy a separate status page product and a separate paging product to fill the gaps.",
        competitorCost:
          "Free licenses, but real engineering time plus paid status page and paging tools that often run $50 to $150+ per month combined",
        oneuptimeSolution:
          "Ingest metrics into OneUptime, add URL and SSL monitors, publish a status page, and configure on-call rotations and escalation in the same platform.",
        oneuptimeCost:
          "Free self-hosted, or roughly a handful of active monitors at $1 each per month on managed cloud",
      },
      {
        scenario:
          "A growing team must retain metrics long term and alert on more than infrastructure",
        competitorSolution:
          "Add Thanos or Mimir with object storage for retention and stand up extra alert rules, accepting a larger distributed system to operate.",
        competitorCost:
          "Free software plus compute, object storage, and the ongoing operational overhead of running remote-storage clusters",
        oneuptimeSolution:
          "Keep metrics, logs, and traces with built-in retention in OneUptime and alert across all three signals without extra clusters.",
        oneuptimeCost:
          "Telemetry ingestion around $0.10 per GB with no separate storage cluster to run",
      },
      {
        scenario:
          "An incident fires and the team needs to page, communicate, and run a postmortem",
        competitorSolution:
          "Alertmanager routes the alert, then engineers switch to a chat tool, a status page tool, and a document to coordinate, communicate, and review.",
        competitorCost:
          "Multiple additional subscriptions and constant context switching between disconnected tools",
        oneuptimeSolution:
          "OneUptime raises the incident, pages the right responder, posts to the status page, and hosts the timeline, action items, and postmortem in one place.",
        oneuptimeCost:
          "Included in the same platform at no additional per-incident cost",
      },
    ],
    keyDifferences: [
      {
        title: "Both are truly open source",
        description:
          "Prometheus is Apache 2.0 and OneUptime is Apache 2.0, so neither locks you in. The difference is that OneUptime ships an integrated platform rather than a single component you build around.",
        icon: "open-source",
      },
      {
        title: "Unified instead of assembled",
        description:
          "Prometheus is metrics only and expects you to add Grafana, Alertmanager, exporters, remote storage, a status page, and a paging tool. OneUptime delivers all of that as one system.",
        icon: "unified",
      },
      {
        title: "Uptime and synthetic monitoring",
        description:
          "Prometheus has no native uptime, synthetic, or transaction monitoring beyond basic Blackbox probing. OneUptime includes website, API, SSL, port, ping, and cron monitoring across global probes.",
        icon: "monitoring",
      },
      {
        title: "Status pages included",
        description:
          "Prometheus offers nothing for customer communication. OneUptime provides public and private status pages with unlimited subscribers, custom domains, and automatic updates from monitors.",
        icon: "status-page",
      },
      {
        title: "Real on-call, not just routing",
        description:
          "Alertmanager can deduplicate and route alerts but has no schedules or escalation. OneUptime adds rotations, multi-level escalation, overrides, and follow-the-sun paging by SMS, call, and push.",
        icon: "on-call",
      },
      {
        title: "Full incident management",
        description:
          "Prometheus stops at raising an alert. OneUptime carries the incident through timelines, severities, Slack and Teams collaboration, postmortems, action items, and MTTR analytics.",
        icon: "incident",
      },
    ],
    items: [
      {
        name: "Metrics and Alerting",
        data: [
          {
            title: "Time-series metrics",
            description: "Collect and store numeric metrics over time.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "PromQL query language",
            description: "Native PromQL for slicing and aggregating metrics.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Exporter ecosystem",
            description: "Pull metrics from a large library of exporters.",
            productColumn: "tick",
            oneuptimeColumn: "OTel-native",
          },
          {
            title: "Alert deduplication and routing",
            description: "Group, silence, and route alerts to receivers.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Built-in metric dashboards",
            description: "Visualize metrics without a separate tool.",
            productColumn: "Needs Grafana",
            oneuptimeColumn: "tick",
          },
          {
            title: "Built-in long-term storage",
            description: "Retain historical metrics without extra clusters.",
            productColumn: "Needs Thanos/Mimir",
            oneuptimeColumn: "tick",
          },
          {
            title: "Logs and traces",
            description: "Correlate metrics with logs and distributed traces.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application exceptions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring",
        data: [
          {
            title: "Server and infra metrics",
            description: "Track CPU, memory, and disk usage.",
            productColumn: "Node exporter",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring",
            description: "Monitor Docker and Kubernetes workloads.",
            productColumn: "cAdvisor/exporter",
            oneuptimeColumn: "tick",
          },
          {
            title: "Website and URL uptime",
            description: "Check that endpoints are up and responsive.",
            productColumn: "Blackbox exporter",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction",
            description: "Script multi-step user journeys.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire.",
            productColumn: "Partial (exporter)",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron and heartbeat checks",
            description: "Detect missed scheduled jobs.",
            productColumn: "Pushgateway",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Test from multiple regions worldwide.",
            productColumn: "",
            oneuptimeColumn: "7+ locations",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status page",
            description: "Communicate uptime to customers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status page",
            description: "Share status with internal audiences only.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers at no extra cost.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain with free SSL",
            description: "Host the page on your own domain.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance",
            description: "Announce planned work in advance.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Reflect monitor state on the page automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS",
            description: "Match the page to your brand.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call and Alerting",
        data: [
          {
            title: "On-call rotations",
            description: "Daily, weekly, or custom schedules.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation",
            description: "Escalate when an alert is not acknowledged.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation",
            description: "Swap coverage for time off.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Follow-the-sun",
            description: "Route to the on-duty region automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS and phone call alerts",
            description: "Reach responders by SMS and voice.",
            productColumn: "Via webhook",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notification alerts",
            description: "Native mobile push to on-call engineers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams alerts",
            description: "Deliver alerts to chat channels.",
            productColumn: "Via receivers",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "Chronological record of what happened.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severities",
            description: "Classify incidents by impact.",
            productColumn: "Alert labels",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Structured retrospectives after incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up work to closure.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Guide responders through remediation.",
            productColumn: "Annotation links",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams collaboration",
            description: "Coordinate response in chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure and improve response times.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform and Pricing",
        data: [
          {
            title: "Open source",
            description: "Freely licensed and inspectable.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Self-hostable",
            description: "Run entirely on your own infrastructure.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unified platform",
            description: "One system instead of assembled components.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Managed cloud option",
            description: "First-party hosted service from the maker.",
            productColumn: "Third-party only",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO and SAML",
            description: "Enterprise single sign-on.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "RBAC and audit logs",
            description: "Fine-grained access control and audit trail.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Predictable managed pricing",
            description: "Flat per-monitor cost with no surprises.",
            productColumn: "",
            oneuptimeColumn: "$1/monitor",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime trying to replace Prometheus for metrics?",
        answer:
          "No. Prometheus and PromQL are excellent for time-series metrics, and OneUptime does not compete on that specific engine. OneUptime is OpenTelemetry-native and gives you metrics, logs, and traces plus everything Prometheus does not do, such as uptime monitoring, status pages, on-call, and incident management, in one open-source platform.",
      },
      {
        question: "Prometheus is free, so how is OneUptime cheaper?",
        answer:
          "Prometheus software is free, but a production setup is never just Prometheus. You also run Grafana, Alertmanager, exporters, and remote storage like Thanos or Mimir, and you still buy separate status page and paging tools. OneUptime replaces that whole stack, which lowers engineering time and third-party subscriptions even if you self-host it for free.",
      },
      {
        question: "Can Prometheus do uptime monitoring and status pages?",
        answer:
          "Not natively. The Blackbox exporter can perform basic endpoint probing, but Prometheus has no synthetic or transaction monitoring and no status page capability at all. OneUptime includes website, API, SSL, port, ping, and cron monitoring plus public and private status pages with unlimited subscribers.",
      },
      {
        question: "Does Alertmanager handle on-call scheduling?",
        answer:
          "No. Alertmanager is strong at deduplication, silencing, and routing alerts, but it has no concept of schedules, rotations, or escalation policies. OneUptime provides full on-call with rotations, multi-level escalation, overrides, follow-the-sun, and alerting by SMS, phone call, email, push, Slack, and Teams.",
      },
      {
        question: "What about long-term metric retention?",
        answer:
          "Prometheus keeps recent data locally and relies on remote write to systems like Thanos, Mimir, or VictoriaMetrics for long-term storage, which adds another distributed system to operate. OneUptime provides built-in retention for metrics, logs, and traces so you do not run a separate storage cluster.",
      },
      {
        question: "Can I keep using my existing Prometheus and exporters?",
        answer:
          "Yes. OneUptime is OpenTelemetry-native and can ingest telemetry from your existing pipelines, so you can adopt it incrementally. Many teams start by adding the capabilities Prometheus lacks, such as status pages and on-call, before consolidating further.",
      },
      {
        question: "Is OneUptime open source like Prometheus?",
        answer:
          "Yes. OneUptime is licensed under Apache 2.0 and is fully self-hostable at no license cost, just like Prometheus. The difference is that OneUptime is an integrated reliability platform rather than a single component you assemble a larger stack around.",
      },
    ],
  },
  zabbix: {
    productName: "Zabbix",
    iconUrl: "/img/zabbix.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "Powerful open-source monitoring vs a complete reliability platform",
    competitorFocus:
      "Zabbix specializes in deep, agent-, SNMP-, and IPMI-based infrastructure and network monitoring, but ships no status pages, on-call scheduling, or incident workflow.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry logs, metrics, and traces in a single open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Zabbix is a mature, fully open-source monitoring system built for infrastructure, network, and server metrics using agents, SNMP, IPMI, and web checks. It is free to self-host and highly customizable, with powerful triggers, templates, and auto-discovery. However, it is heavy to deploy and tune, carries a dated interface, and leaves status pages, on-call rotations, and incident response to other tools.",
    oneUptimeDescription:
      "OneUptime is an Apache 2.0 open-source platform that combines monitoring, status pages, on-call, incident management, and OpenTelemetry telemetry in one place. You can self-host it for free or use the managed cloud with predictable, flat pricing. It removes the tool sprawl and glue work that Zabbix leaves behind.",
    description:
      "Zabbix is one of the most capable open-source infrastructure and network monitoring engines available, trusted for SNMP, agent, and IPMI data collection at scale. But it stops at monitoring: there are no built-in status pages, no on-call rotations, no incident postmortems, and no OpenTelemetry tracing, so teams stitch together three or four extra tools around it. OneUptime is also open source and self-hostable, but delivers monitoring, status pages, on-call, incident management, and full telemetry as one product. That means one login, one data model, and one predictable bill instead of a maintenance-heavy stack.",
    descriptionLine2:
      "Keep the open-source freedom you want from Zabbix, but replace the tool sprawl and manual glue with a single unified platform that covers alerting, status pages, and incidents out of the box.",
    migrationBenefits: [
      "Replace Zabbix plus separate status-page, on-call, and incident tools with one open-source platform.",
      "Public and private status pages with unlimited subscribers and free custom-domain SSL, built in.",
      "Native on-call rotations, multi-level escalation, and vacation overrides with SMS, phone call, and push alerts.",
      "Full incident management with timelines, severities, postmortems, action items, runbooks, and MTTR analytics.",
      "OpenTelemetry-native logs, metrics, and traces alongside monitoring, so there is no separate tracing stack.",
      "Predictable pricing at a flat $1 per active monitor, or self-host for free, with no per-server support contract to negotiate.",
    ],
    competitorPricingTiers: [
      {
        name: "Zabbix Software",
        price: "Free",
        period: "self-hosted",
        features: [
          "Fully open source (GPL), no license fee",
          "Unlimited hosts, metrics, and users",
          "SNMP, agent, IPMI, and web monitoring",
          "Triggers, templates, and auto-discovery",
          "Community support and documentation",
        ],
        limitations: [
          "You deploy, scale, and patch the entire stack yourself",
          "No official SLA or guaranteed response time",
          "No status pages, on-call scheduling, or incident workflow",
        ],
      },
      {
        name: "Silver Support",
        price: "$325",
        period: "/month (billed annually)",
        features: [
          "8x5 support availability",
          "1 business day maximum response",
          "Direct access to Zabbix experts",
          "5 years of guaranteed security fixes",
        ],
        limitations: [
          "Covers a single Zabbix server, no proxies",
          "No 24x7 or emergency response",
          "Infrastructure is still fully self-managed",
        ],
      },
      {
        name: "Gold Support",
        price: "From $825",
        period: "/month (billed annually)",
        features: [
          "8x5 support with 4-hour response",
          "Priced per server and per proxy",
          "Distributed monitoring assistance",
          "Online education included",
        ],
        limitations: [
          "Cost scales with every server and proxy",
          "No 24x7 emergency coverage",
          "Still no status pages, on-call, or incident tooling",
        ],
      },
      {
        name: "Platinum Support",
        price: "Custom",
        period: "/month",
        features: [
          "24x7 availability",
          "2-hour emergency response",
          "Per server and per proxy coverage",
          "Distributed monitoring and education",
        ],
        limitations: [
          "Custom quote required, opaque pricing",
          "Per-server and per-proxy costs add up",
          "Add-on services billed separately",
        ],
      },
      {
        name: "Enterprise / Global",
        price: "Custom",
        period: "/month",
        features: [
          "24x7 with 1 to 1.5-hour response",
          "Unlimited servers and proxies",
          "High availability and hands-on assistance",
          "Multi-entity, worldwide contract (Global)",
        ],
        limitations: [
          "Enterprise contract and negotiation required",
          "Pricing is not published",
          "No native status page, on-call, or incident features",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup that needs monitoring, a public status page, and on-call in one week",
        competitorSolution:
          "Self-host Zabbix for infrastructure monitoring, then add a separate status-page tool and an on-call tool, plus the engineering time to run and connect them.",
        competitorCost: "$0 software + infra + eng time + extra tools",
        oneuptimeSolution:
          "Use OneUptime for monitoring, status pages, and on-call together; roughly 20 active monitors on the cloud plan.",
        oneuptimeCost: "~$20/mo all-in (or free tier)",
      },
      {
        scenario:
          "Ops team monitoring 60 servers that wants a support SLA and distributed monitoring",
        competitorSolution:
          "Run Zabbix with proxies and buy Gold support priced per server and per proxy, while continuing to manage the database and servers.",
        competitorCost: "From $825/mo support + self-run infra",
        oneuptimeSolution:
          "Monitor 60 servers as active monitors on OneUptime, or move to the Growth tier, with alerting and dashboards included.",
        oneuptimeCost: "~$60/mo, or Growth ~$99/mo",
      },
      {
        scenario:
          "Enterprise needing 24x7 support, public status pages, and incident postmortems",
        competitorSolution:
          "Negotiate a Zabbix Enterprise or Global support contract, then license and integrate separate status-page, on-call, and incident-management products.",
        competitorCost: "Custom (thousands/mo) + multiple add-on tools",
        oneuptimeSolution:
          "Adopt OneUptime Enterprise or self-host it, covering monitoring, status pages, on-call, incidents, and telemetry in one platform.",
        oneuptimeCost: "Predictable Enterprise, or self-host free",
      },
    ],
    keyDifferences: [
      {
        title: "One unified platform, not a monitoring engine plus bolt-ons",
        description:
          "Zabbix monitors infrastructure well but relies on separate tools for status pages, on-call, and incidents. OneUptime delivers all of it in a single product with one data model.",
        icon: "unified",
      },
      {
        title: "Built-in status pages",
        description:
          "Zabbix has no native status pages. OneUptime includes public and private status pages with custom domains, free SSL, branding, and unlimited subscribers.",
        icon: "status-page",
      },
      {
        title: "Native on-call scheduling",
        description:
          "Zabbix sends alerts but has no rotations, escalation calendars, or overrides. OneUptime provides full on-call scheduling with SMS, phone call, push, Slack, and Teams.",
        icon: "on-call",
      },
      {
        title: "End-to-end incident management",
        description:
          "Zabbix tracks problems and events but has no postmortems, action items, or runbooks. OneUptime offers timelines, severities, postmortems, and MTTR analytics.",
        icon: "incident",
      },
      {
        title: "Open source on both sides, modern by default",
        description:
          "Both are open source and self-hostable, but OneUptime pairs that freedom with a modern UI and OpenTelemetry-native logs, metrics, and traces Zabbix does not provide.",
        icon: "open-source",
      },
      {
        title: "Predictable, flat pricing",
        description:
          "Zabbix software is free but real costs come from per-server support contracts and ops time. OneUptime is a flat $1 per active monitor, or free to self-host.",
        icon: "pricing",
      },
    ],
    items: [
      {
        name: "Infrastructure Monitoring",
        data: [
          {
            title: "Agent-based host monitoring",
            description:
              "Collect CPU, memory, disk, and process metrics from servers via an agent.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SNMP monitoring",
            description:
              "Poll network devices, switches, and appliances over SNMP.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "IPMI monitoring",
            description: "Monitor hardware health via IPMI sensors.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Network device monitoring",
            description: "Track routers, switches, and network gear.",
            productColumn: "tick",
            oneuptimeColumn: "Ping/port only",
          },
          {
            title: "Auto-discovery of hosts",
            description:
              "Automatically discover hosts and services on a network segment.",
            productColumn: "tick",
            oneuptimeColumn: "Containers/K8s",
          },
          {
            title: "Container and Kubernetes monitoring",
            description: "Monitor Docker containers and Kubernetes clusters.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom metrics and scripts",
            description: "Collect user-defined metrics via scripts or API.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Monitoring Coverage",
        data: [
          {
            title: "Website and URL monitoring",
            description:
              "Check that web pages and endpoints respond correctly.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "API monitoring",
            description:
              "Validate API endpoints, status codes, and response bodies.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic / browser monitoring",
            description: "Run scripted browser flows to simulate real users.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before TLS certificates expire.",
            productColumn: "Via templates",
            oneuptimeColumn: "tick",
          },
          {
            title: "Cron / heartbeat monitoring",
            description: "Detect when scheduled jobs fail to check in.",
            productColumn: "Via trapper items",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check services from multiple regions out of the box.",
            productColumn: "Self-deployed",
            oneuptimeColumn: "7+ locations",
          },
          {
            title: "Check intervals down to 1 second",
            description: "Poll critical checks as frequently as every second.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status pages",
            description: "Publicly share service health with your users.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status pages",
            description: "Share internal status with authenticated audiences.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom domain with free SSL",
            description:
              "Host the status page on your own domain with managed SSL.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Let any number of users subscribe to updates.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description:
              "Fully brand and customize the status page look and feel.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance updates",
            description: "Announce planned maintenance to subscribers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Subscriber notifications",
            description:
              "Notify via email, SMS, webhook, RSS, Slack, and Teams.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Alerting on issues",
            description:
              "Fire alerts when triggers or monitors detect problems.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Email notifications",
            description: "Send alerts by email.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS notifications",
            description: "Send alerts by text message.",
            productColumn: "Via gateway",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call alerts",
            description: "Escalate with automated voice calls.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Route alerts into chat channels.",
            productColumn: "Via webhooks",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations and schedules",
            description: "Daily, weekly, or custom rotations with a roster.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate to the next responder when unacknowledged.",
            productColumn: "Basic steps",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and follow-the-sun",
            description: "Handle vacations and hand off across time zones.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Incident timelines",
            description: "See a chronological record of an incident.",
            productColumn: "Problems/events",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severity levels",
            description: "Classify incidents by severity.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems",
            description: "Document root cause and learnings after resolution.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Action items",
            description: "Track follow-up tasks from incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Attach response procedures to incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack / Teams incident collaboration",
            description: "Coordinate response directly in chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure and trend mean time to resolution.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source",
            description: "Source-available under an open license.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Free to self-host",
            description: "Run the full platform on your own infrastructure.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Managed cloud option",
            description: "Vendor-hosted SaaS with no infra to run.",
            productColumn: "From EUR 50/mo",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry logs, metrics, traces",
            description: "Native ingestion of OTel telemetry.",
            productColumn: "Metrics + logs",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML, RBAC, and audit logs",
            description: "Enterprise access control and audit trails.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SOC 2 and ISO 27001 (cloud)",
            description:
              "Independent security and compliance attestations for the hosted service.",
            productColumn: "",
            oneuptimeColumn: "SOC 2, ISO 27001",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is Zabbix really free, and what does OneUptime cost?",
        answer:
          "Zabbix software is free and open source, but real costs come from the infrastructure and staff time to run it, plus support subscriptions that start around $325 per month and scale per server and proxy. OneUptime is also free to self-host, or on the cloud it is a flat $1 per active monitor with a generous free tier and predictable tiers such as Growth around $99 per month.",
      },
      {
        question: "Does Zabbix include status pages?",
        answer:
          "No. Zabbix has dashboards for operators but no public or private status pages for customers. OneUptime includes both, with custom domains, free SSL, custom branding, component groups, scheduled maintenance, and unlimited subscribers who can be notified by email, SMS, webhook, RSS, Slack, or Teams.",
      },
      {
        question: "Can Zabbix handle on-call scheduling and escalations?",
        answer:
          "Zabbix can send notifications and run basic escalation steps inside an action, but it has no on-call rotations, calendars, overrides, or follow-the-sun scheduling. OneUptime provides full on-call management with daily, weekly, and custom rotations, multi-level escalation, vacation overrides, and alerts by SMS, phone call, push, email, Slack, and Teams.",
      },
      {
        question: "How does incident management compare?",
        answer:
          "Zabbix models issues as problems and events but has no incident postmortems, action items, runbooks, or MTTR analytics. OneUptime offers end-to-end incident management with timelines, severities, postmortems, action items, runbooks, Slack and Teams collaboration, and MTTR reporting.",
      },
      {
        question: "Is OneUptime open source and self-hostable like Zabbix?",
        answer:
          "Yes. OneUptime is Apache 2.0 licensed and can be self-hosted for free, just like Zabbix. The difference is scope: OneUptime bundles monitoring, status pages, on-call, incidents, and telemetry into one platform instead of leaving those to separate tools.",
      },
      {
        question: "What about distributed tracing and OpenTelemetry?",
        answer:
          "Zabbix focuses on metrics and log monitoring and does not provide OpenTelemetry-native distributed tracing. OneUptime is OpenTelemetry-native, ingesting logs, metrics, and traces with dashboards and exception tracking alongside your monitors.",
      },
      {
        question:
          "How hard is Zabbix to set up and maintain compared to OneUptime?",
        answer:
          "Zabbix is powerful but heavy: you install and tune the server, database, and proxies, manage templates, and maintain the stack over time, and its interface feels dated. OneUptime is designed to be quick to stand up, whether self-hosted or on the managed cloud, with a modern UI and no separate tools to integrate for status pages, on-call, or incidents.",
      },
    ],
  },
  nagios: {
    productName: "Nagios",
    iconUrl: "/img/nagios.svg",
    price: "",
    oneuptimePrice: "",
    tagline:
      "A modern open-source all-in-one platform vs a legacy monitoring-only tool",
    competitorFocus:
      "Nagios is a battle-tested, plugin-driven engine for infrastructure and network monitoring, but it stops at up/down checks and leaves status pages, on-call, and incident response to other tools.",
    oneuptimeFocus:
      "OneUptime unifies monitoring, status pages, on-call, incident management, and OpenTelemetry observability in a single open-source platform.",
    annualSavings: "",
    lastUpdated: "2026",
    productDescription:
      "Nagios is one of the original open-source monitoring tools, offered as the free Nagios Core engine and the commercial Nagios XI edition with a configuration GUI, dashboards, and reporting. It excels at server, host, and network device monitoring through a vast library of community plugins. However, it depends on config files or paid add-ons, carries a dated interface, and has no native status pages, on-call scheduling, or incident management.",
    oneUptimeDescription:
      "OneUptime is a modern, Apache 2.0 open-source platform that brings monitoring, status pages, on-call, incident management, and OpenTelemetry logs, metrics, and traces together in one place. It replaces the plugin-and-add-on sprawl of legacy tooling with a unified web app, predictable pricing, and a free self-hosted option.",
    description:
      "Nagios pioneered open-source infrastructure monitoring and remains a dependable up/down checking engine, but it was built for a pre-cloud, config-file era. Standing up modern reliability workflows means bolting on a separate status page tool, PagerDuty for on-call, and a logging product for observability. OneUptime delivers all of that in one open-source platform: monitoring, status pages, on-call, incident management, and full telemetry. You get modern reliability tooling without the plugin wrangling or the stack of separate subscriptions.",
    descriptionLine2:
      "Consolidate Nagios plus its add-ons into a single platform billed at a flat $1 per active monitor, with unlimited status page subscribers and a free self-hosted edition.",
    migrationBenefits: [
      "Replace config files and plugin sprawl with a modern web UI where new monitors are set up in seconds.",
      "Get public and private status pages with unlimited subscribers built in, no Statuspage-style add-on required.",
      "Add real on-call rotations, multi-level escalation, and SMS and phone alerting without bolting on PagerDuty.",
      "Run full incident management with timelines, severities, postmortems, and MTTR analytics natively.",
      "Unify logs, metrics, and traces via OpenTelemetry instead of licensing Nagios Log Server separately.",
      "Swap unpredictable per-node perpetual licenses plus annual maintenance for a flat $1 per month per active monitor.",
    ],
    competitorPricingTiers: [
      {
        name: "Nagios Core",
        price: "Free",
        period: "open source",
        features: [
          "Free and open source, fully self-hosted",
          "Host, service, and network monitoring engine",
          "Huge library of community plugins",
          "Notifications and problem acknowledgement",
        ],
        limitations: [
          "Configuration is file-based, no setup wizards",
          "Very basic, dated web interface",
          "No status pages, on-call, or incident management",
        ],
      },
      {
        name: "Nagios XI Free Edition",
        price: "Free",
        period: "up to 7 nodes",
        features: [
          "Most Standard features included",
          "Configuration GUI and dashboards",
          "Web-based monitoring management",
        ],
        limitations: [
          "Capped at 7 nodes or 100 services",
          "No official support included",
          "No status pages or native incident response",
        ],
      },
      {
        name: "Nagios XI Standard",
        price: "From $2,595",
        period: "100-node license",
        features: [
          "Infrastructure monitoring and graphing",
          "70+ config wizards and dashboards",
          "REST API and enhanced alerting",
          "Automation and notification handling",
        ],
        limitations: [
          "Per-node perpetual license plus annual maintenance",
          "No built-in status pages or on-call scheduling",
          "Advanced reporting requires Enterprise",
        ],
      },
      {
        name: "Nagios XI Enterprise",
        price: "From $4,690",
        period: "100-node add-on",
        features: [
          "SLA and scheduled reports",
          "Business Process Intelligence",
          "Capacity planning and audit logs",
          "Bulk modification tools",
        ],
        limitations: [
          "Add-on cost on top of Standard license",
          "Still no native status pages or on-call rotations",
          "Logs and network analysis are separate products",
        ],
      },
      {
        name: "Nagios Sitewide",
        price: "Contact Sales",
        period: "custom",
        features: [
          "Multiple unlimited-node instances",
          "Distributed monitoring with Nagios Fusion",
          "All Enterprise features included",
        ],
        limitations: [
          "Opaque, quote-based pricing",
          "Separate licenses for log and network products",
          "No modern status page or incident tooling",
        ],
      },
    ],
    useCases: [
      {
        scenario:
          "Startup monitoring 50 servers that also needs a public status page and on-call alerts",
        competitorSolution:
          "Nagios XI Standard 100-node license plus a separate status page tool and PagerDuty for on-call",
        competitorCost: "$2,595 license + maintenance + add-on subscriptions",
        oneuptimeSolution:
          "50 active monitors, built-in status page, and native on-call in one platform",
        oneuptimeCost: "$50/month, or free when self-hosted",
      },
      {
        scenario:
          "Growing SaaS with 200 monitored nodes needing SLA reporting and escalations",
        competitorSolution:
          "Nagios XI Enterprise 200-node license plus PagerDuty and a status page service",
        competitorCost:
          "$6,490 license + ~20-25% annual maintenance + subscriptions",
        oneuptimeSolution:
          "200 active monitors with SLA-grade incident analytics, on-call, and status pages included",
        oneuptimeCost: "$200/month all-in on Growth-tier features",
      },
      {
        scenario:
          "Platform team wanting monitoring, status pages, on-call, incidents, and telemetry in one place",
        competitorSolution:
          "Nagios XI plus Nagios Log Server, PagerDuty, and a hosted status page to cover the gaps",
        competitorCost:
          "Multiple licenses and subscriptions to stitch together",
        oneuptimeSolution:
          "One unified open-source platform covering every function with OpenTelemetry ingestion",
        oneuptimeCost: "$1/monitor + ~$0.10/GB telemetry, free self-hosted",
      },
    ],
    keyDifferences: [
      {
        title: "Unified platform, not a single tool",
        description:
          "OneUptime combines monitoring, status pages, on-call, incident management, and telemetry in one app, while Nagios covers only monitoring and hands the rest off to add-ons and third-party services.",
        icon: "unified",
      },
      {
        title: "Built-in modern status pages",
        description:
          "OneUptime ships public and private status pages with custom domains, branding, and unlimited subscribers. Nagios has no status page product at all.",
        icon: "status-page",
      },
      {
        title: "Native on-call and escalation",
        description:
          "OneUptime provides on-call rotations, multi-level escalation, overrides, and SMS, phone, push, Slack, and Teams alerts. Nagios relies on basic notifications or an external tool like PagerDuty.",
        icon: "on-call",
      },
      {
        title: "Full incident management",
        description:
          "OneUptime includes incident timelines, severities, postmortems, action items, runbooks, and MTTR analytics. Nagios only acknowledges problems.",
        icon: "incident",
      },
      {
        title: "Modern OpenTelemetry observability",
        description:
          "OneUptime is OpenTelemetry-native with logs, metrics, traces, dashboards, and error tracking. Nagios is check-based and sells log management as a separate product.",
        icon: "monitoring",
      },
      {
        title: "Predictable, transparent pricing",
        description:
          "OneUptime bills a flat $1 per active monitor with no per-check tiers, versus Nagios per-node perpetual licenses plus 20-25% annual maintenance.",
        icon: "pricing",
      },
    ],
    items: [
      {
        name: "Infrastructure Monitoring",
        data: [
          {
            title: "Server and host resource monitoring",
            description:
              "Track CPU, memory, disk, and process health on servers.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Network and SNMP device monitoring",
            description:
              "Monitor routers, switches, and SNMP-enabled hardware.",
            productColumn: "tick",
            oneuptimeColumn: "",
          },
          {
            title: "Website and API uptime monitoring",
            description: "Check HTTP endpoints and API responses from a probe.",
            productColumn: "Via plugins",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSL certificate monitoring",
            description: "Alert before certificates expire or become invalid.",
            productColumn: "Via plugins",
            oneuptimeColumn: "tick",
          },
          {
            title: "Container monitoring (Docker/K8s)",
            description: "Monitor container and Kubernetes workload health.",
            productColumn: "Via plugins",
            oneuptimeColumn: "tick",
          },
          {
            title: "Synthetic and transaction monitoring",
            description:
              "Script multi-step user flows to catch broken journeys.",
            productColumn: "Via plugins",
            oneuptimeColumn: "tick",
          },
          {
            title: "Global probe locations",
            description: "Check availability from multiple regions worldwide.",
            productColumn: "Self-hosted only",
            oneuptimeColumn: "7+ locations",
          },
          {
            title: "GUI setup wizards",
            description: "Add hosts and services without editing config files.",
            productColumn: "XI only",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Modern Observability & Telemetry",
        data: [
          {
            title: "Log management",
            description: "Centralize, search, and alert on application logs.",
            productColumn: "Separate product",
            oneuptimeColumn: "tick",
          },
          {
            title: "Metrics and time-series data",
            description: "Store and query numeric metrics over time.",
            productColumn: "Perf graphs",
            oneuptimeColumn: "tick",
          },
          {
            title: "Distributed tracing",
            description: "Trace requests across services to find bottlenecks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "OpenTelemetry-native ingestion",
            description: "Ingest telemetry using the open OTel standard.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Exception and error tracking",
            description: "Capture and group application exceptions.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom dashboards",
            description:
              "Build tailored views of monitoring and telemetry data.",
            productColumn: "XI only",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Status Pages",
        data: [
          {
            title: "Public status page",
            description: "Communicate live status to customers.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Private status page",
            description: "Share internal status with authenticated users.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Unlimited subscribers",
            description: "Notify any number of subscribers at no extra cost.",
            productColumn: "",
            oneuptimeColumn: "Unlimited",
          },
          {
            title: "Custom domain with free SSL",
            description: "Host the status page on your own domain.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Custom branding and HTML/CSS/JS",
            description: "Fully style the page to match your brand.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Scheduled maintenance events",
            description: "Announce planned maintenance windows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Automatic updates from monitors",
            description: "Reflect monitor status on the page automatically.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Email and basic notifications",
            description: "Send alerts when checks change state.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "SMS alerts",
            description: "Notify responders by text message.",
            productColumn: "Via gateway",
            oneuptimeColumn: "tick",
          },
          {
            title: "Phone call alerts",
            description: "Escalate with automated voice calls.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Push notifications",
            description: "Alert responders via mobile push.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "On-call rotations and schedules",
            description: "Rotate coverage daily, weekly, or custom.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Multi-level escalation policies",
            description: "Escalate to the next responder if unacknowledged.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "Overrides and vacation coverage",
            description: "Swap on-call responsibility temporarily.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Microsoft Teams alerts",
            description: "Route alerts into chat channels.",
            productColumn: "Via integrations",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Incident Management",
        data: [
          {
            title: "Problem acknowledgement",
            description: "Acknowledge active problems to silence alerts.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Incident timelines",
            description: "Track a chronological record of each incident.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Severity levels",
            description: "Classify incidents by impact.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Postmortems and action items",
            description: "Document root cause and follow-up tasks.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Runbooks",
            description: "Attach response procedures to incidents.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "Slack and Teams incident collaboration",
            description: "Coordinate response directly from chat.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
          {
            title: "MTTR analytics",
            description: "Measure mean time to resolution over time.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
      {
        name: "Platform & Pricing",
        data: [
          {
            title: "Open source and self-hostable",
            description:
              "Run the platform on your own infrastructure for free.",
            productColumn: "tick",
            oneuptimeColumn: "tick",
          },
          {
            title: "Modern web interface",
            description: "Clean, current UI for daily operations.",
            productColumn: "Dated",
            oneuptimeColumn: "tick",
          },
          {
            title: "Pricing model",
            description: "How the product is billed as you grow.",
            productColumn: "Per-node license",
            oneuptimeColumn: "$1/monitor",
          },
          {
            title: "Free tier",
            description: "Usable free plan to get started.",
            productColumn: "7 nodes",
            oneuptimeColumn: "Generous",
          },
          {
            title: "REST API and webhooks",
            description: "Automate and integrate programmatically.",
            productColumn: "XI only",
            oneuptimeColumn: "tick",
          },
          {
            title: "Workflow automation",
            description: "Build no-code automations across the platform.",
            productColumn: "Basic",
            oneuptimeColumn: "tick",
          },
          {
            title: "SSO/SAML, RBAC, and audit logs",
            description: "Enterprise access control and compliance.",
            productColumn: "Enterprise",
            oneuptimeColumn: "tick",
          },
          {
            title: "Sentinel AI",
            description: "AI assistance for reliability workflows.",
            productColumn: "",
            oneuptimeColumn: "tick",
          },
        ],
      },
    ],
    faq: [
      {
        question: "Is OneUptime a drop-in replacement for Nagios?",
        answer:
          "OneUptime covers everything most teams use Nagios for, including server, host, website, API, container, SSL, and port monitoring, and adds status pages, on-call, incident management, and OpenTelemetry observability that Nagios lacks. Deeply SNMP-centric network device monitoring is Nagios' historic strength, so evaluate that specific use case, but for cloud and application reliability OneUptime replaces Nagios plus several add-on tools.",
      },
      {
        question: "Can I self-host OneUptime like Nagios Core?",
        answer:
          "Yes. OneUptime is Apache 2.0 open source and fully self-hostable at no license cost, just like Nagios Core. The difference is that the self-hosted OneUptime includes status pages, on-call, and incident management out of the box, whereas Nagios would need extra products for the same coverage.",
      },
      {
        question: "Does Nagios have built-in status pages?",
        answer:
          "No. Neither Nagios Core nor Nagios XI ships a customer-facing status page product, so teams typically buy a separate service like Statuspage. OneUptime includes public and private status pages with custom domains, branding, and unlimited subscribers at no additional cost.",
      },
      {
        question: "How does Nagios handle on-call and escalations?",
        answer:
          "Nagios has basic contact-group notifications and simple escalations, but no real on-call rotations, calendars, overrides, or phone and push alerting, so most teams integrate PagerDuty or similar. OneUptime provides native rotations, multi-level escalation, overrides, and SMS, phone, push, Slack, and Teams alerts.",
      },
      {
        question: "What does Nagios XI actually cost?",
        answer:
          "Nagios XI is licensed per node. A 100-node Standard license starts around $2,595 and a 100-node Enterprise license around $4,690, both as perpetual licenses with roughly 20-25% annual maintenance for support and updates. OneUptime instead bills a flat $1 per month per active monitor with a generous free tier and free self-hosting.",
      },
      {
        question:
          "Does OneUptime support modern observability and OpenTelemetry?",
        answer:
          "Yes. OneUptime is OpenTelemetry-native with logs, metrics, traces, dashboards, and exception tracking in the same platform as your monitors and incidents. Nagios is check-based and sells log management as a separate Nagios Log Server product.",
      },
      {
        question:
          "Can OneUptime monitor internal servers behind a firewall like Nagios?",
        answer:
          "Yes. OneUptime supports private probes and server or infrastructure agents so you can monitor internal hosts, containers, and services that are not exposed to the public internet, while also offering 7-plus global probe locations for external checks.",
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
  // Own-property check so keys like "constructor" don't resolve via the prototype.
  if (!Object.prototype.hasOwnProperty.call(products, product)) {
    return undefined as unknown as Product;
  }
  return products[product] as Product;
};

export default ProductCompare;
