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
    price: "$21-$49",
    oneuptimePrice: "$0",
    tagline: "Complete observability platform vs expensive alerting-only tool",
    competitorFocus: "On-call alerting and incident response only - monitoring, status pages sold separately",
    oneuptimeFocus: "Complete platform: Monitoring + Status Pages + On-Call + Incident Management - all included",
    annualSavings: "$10,000+",
    lastUpdated: "December 2024",
    productDescription:
      "Per user/month (billed annually). Professional plan starts at $21/user, Business at $41/user. For a team of 10 engineers, that's $210-$490/month just for on-call. Add-ons like AIOps ($699/mo), Status Pages ($89/mo per 1000 subscribers), and AI features ($415/mo) cost extra.",
    oneUptimeDescription:
      "Complete observability platform with monitoring, on-call scheduling, incident management, and unlimited status pages - all included. Free tier available with generous limits. Paid plans include everything with no hidden costs.",
    description:
      "PagerDuty is the market leader in incident management and on-call scheduling, trusted by many enterprises. However, it's primarily an alerting tool that requires separate integrations for monitoring and additional purchases for status pages. OneUptime provides a complete, unified observability platform at a fraction of the cost.",
    descriptionLine2:
      "Stop paying $500-1000/month for a fragmented stack. Get monitoring, status pages, on-call, and incident management in one platform.",
    hiddenCosts: [
      "AIOps add-on starts at $699/month for noise reduction and intelligent alerting",
      "Status Pages add-on costs $89/month per 1,000 subscribers",
      "Premium Status Pages start at $599/month per 1,000 subscribers",
      "PagerDuty Advance (AI features) starts at $415/month",
      "Stakeholder licenses cost $150/month per 50 users for read-only access",
      "SMS/phone notifications limited to 100/month on Free plan",
      "No built-in monitoring - requires Datadog, New Relic, or similar ($50-500+/month)",
    ],
    migrationBenefits: [
      "Import existing on-call schedules and escalation policies",
      "700+ integrations work with OneUptime via webhooks and API",
      "Run both platforms in parallel during migration",
      "No per-user pricing means adding team members is free",
      "Built-in monitoring eliminates need for separate tools",
      "Unlimited status page subscribers included",
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
        competitorSolution: "PagerDuty Business + Status Pages add-on + Monitoring",
        competitorCost: "$1,025/month + $89/month + $200/month = $1,314/month",
        oneuptimeSolution: "OneUptime with unlimited status pages and subscribers",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "Enterprise with 100 engineers and stakeholder access",
        competitorSolution: "PagerDuty Enterprise + Stakeholder licenses + Add-ons",
        competitorCost: "$5,000+/month + add-ons",
        oneuptimeSolution: "OneUptime Enterprise with unlimited users",
        oneuptimeCost: "Contact for enterprise pricing",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to PagerDuty?",
        answer:
          "PagerDuty is an excellent on-call and incident management tool, but it's primarily focused on alerting. You need to purchase separate tools for monitoring (like Datadog or New Relic at $50-500+/month) and pay extra for status pages ($89-599/month per 1000 subscribers). OneUptime provides a complete platform with built-in monitoring, unlimited status pages with unlimited subscribers, on-call scheduling, and incident management - all in one unified solution. For a typical 10-person team, you could save $3,000-5,000+ annually by switching to OneUptime.",
      },
      {
        question: "What about PagerDuty's 700+ integrations?",
        answer:
          "PagerDuty integrates with monitoring tools because it doesn't have built-in monitoring - you need those integrations to receive alerts. OneUptime has built-in monitoring for websites, APIs, servers, and containers, so many integrations become unnecessary. We still offer 2000+ integrations via Zapier, native Slack/Teams integration, and a comprehensive API and webhook system. The difference is our integrations enhance your workflow rather than fill gaps in core functionality.",
      },
      {
        question: "How much can I realistically save switching from PagerDuty?",
        answer:
          "Let's break it down for a typical 10-person team: PagerDuty Professional ($210/mo) + Datadog/monitoring ($150/mo) + StatusPage.io ($99/mo) = $459/month or $5,508/year. With OneUptime, you get all of this functionality starting from $0 on the free tier. Even our Growth plan at $99/month saves you over $4,300 annually. Larger teams see even bigger savings since OneUptime doesn't charge per-user for most features.",
      },
      {
        question: "Does OneUptime match PagerDuty's on-call features?",
        answer:
          "Yes. OneUptime provides all essential on-call features: multiple rotation schedules (daily, weekly, custom), multi-level escalation policies, vacation/sick leave overrides, follow-the-sun scheduling for global teams, and alerts via SMS, phone call, email, push notifications, Slack, and Microsoft Teams. We also include features that PagerDuty charges extra for, like unlimited status pages and built-in monitoring.",
      },
      {
        question: "What about PagerDuty's AIOps features?",
        answer:
          "PagerDuty's AIOps (alert noise reduction, intelligent grouping) is a paid add-on starting at $699/month. OneUptime includes intelligent alert deduplication and grouping in all plans. We focus on providing practical noise reduction without requiring expensive AI add-ons. For teams that need advanced ML-based operations, OneUptime's approach is often sufficient and saves significant costs.",
      },
      {
        question: "Can I migrate from PagerDuty to OneUptime?",
        answer:
          "Yes. You can import your existing on-call schedules and escalation policies. OneUptime can receive webhooks from any system PagerDuty integrates with, so you can migrate gradually. Many teams run both platforms in parallel during migration, redirecting monitors and integrations to OneUptime one by one. Our support team provides migration assistance for complex setups.",
      },
      {
        question: "Is OneUptime reliable enough for enterprise use?",
        answer:
          "Absolutely. OneUptime is built on a distributed, high-availability infrastructure deployed across multiple cloud providers. We're SOC 2 compliant, offer SSO/SAML, provide role-based access control, and maintain audit logs. We also offer self-hosting options for organizations that need complete control over their data and infrastructure.",
      },
    ],
    keyDifferences: [
      {
        title: "Built-in Monitoring",
        description: "Monitor websites, APIs, servers, and containers without purchasing Datadog, New Relic, or Pingdom",
        icon: "monitoring",
      },
      {
        title: "Unlimited Status Pages",
        description: "Public and private status pages with unlimited subscribers included - PagerDuty charges $89-599/mo extra",
        icon: "status-page",
      },
      {
        title: "No Per-User Pricing Trap",
        description: "Add team members without watching costs climb - PagerDuty charges $21-49 per additional user",
        icon: "savings",
      },
      {
        title: "Unified Platform",
        description: "One dashboard, one vendor, one bill - no integration complexity between 4-5 separate tools",
        icon: "unified",
      },
      {
        title: "Open Source & Self-Hostable",
        description: "Apache 2.0 licensed - audit the code, self-host on your infrastructure, no vendor lock-in",
        icon: "open-source",
      },
      {
        title: "No Hidden Add-on Costs",
        description: "No surprise charges for AIOps ($699/mo), AI features ($415/mo), or stakeholder licenses ($150/mo)",
        icon: "transparent",
      },
    ],
    items: [
      {
        name: "On-Call & Alerting",
        data: [
          {
            title: "Multi-channel Alerts",
            description: "SMS, phone call, email, push notifications, Slack, Microsoft Teams",
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
    price: "$0-$1,499",
    oneuptimePrice: "$0",
    tagline: "Complete reliability platform vs status-pages-only tool",
    competitorFocus: "Status pages only - no monitoring, no on-call, no incident management",
    oneuptimeFocus: "Complete platform: Status Pages + Monitoring + On-Call + Incident Management",
    annualSavings: "$5,000+",
    lastUpdated: "December 2024",
    productDescription:
      "Per month. Free plan limited to 100 subscribers and 2 team members. Hobby ($29) allows 250 subscribers. Startup ($99) allows 1,000 subscribers. Business ($399) allows 5,000 subscribers. Enterprise ($1,499) allows 25,000 subscribers. Private pages are separate starting at $79/month.",
    oneUptimeDescription:
      "Unlimited status pages with unlimited subscribers on all plans including free. Plus get built-in monitoring, on-call scheduling, and incident management - features Statuspage doesn't offer at all.",
    description:
      "Atlassian Statuspage is a dedicated status page product that does one thing well - hosted status pages. However, it charges per subscriber, has no built-in monitoring (so you won't know when to update your status), and offers no incident management or on-call scheduling. You'll need to purchase 3-4 additional tools to get a complete solution.",
    descriptionLine2:
      "Why pay per subscriber and still need separate monitoring, on-call, and incident management tools? OneUptime includes everything.",
    hiddenCosts: [
      "Subscriber limits: 100 (Free), 250 (Hobby), 1,000 (Startup), 5,000 (Business), 25,000 (Enterprise)",
      "Private pages start at $79/month with only 50 authenticated subscribers",
      "Audience-specific pages start at $300/month",
      "Team member limits: 2 (Free), 5 (Hobby), 10 (Startup), 25 (Business), 50 (Enterprise)",
      "No monitoring included - requires Pingdom, Datadog, etc. ($50-200+/month)",
      "No on-call scheduling - requires PagerDuty, OpsGenie, etc. ($100-500+/month)",
      "No incident management - requires Incident.io, FireHydrant, etc. ($100-300+/month)",
      "Custom CSS/JS only on Business+ plans ($399+/month)",
      "SMS notifications require Startup+ plan ($99+/month)",
    ],
    migrationBenefits: [
      "No subscriber limits - add unlimited subscribers immediately",
      "Built-in monitoring automatically updates your status page",
      "On-call scheduling ensures the right person is notified",
      "Incident management provides complete workflow",
      "Import existing components and subscriber lists",
      "Same notification channels: email, SMS, webhook, RSS",
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
        competitorSolution: "Statuspage Enterprise (still under cap) + monitoring + on-call",
        competitorCost: "$1,499 + $150 + $300 = $1,949/month",
        oneuptimeSolution: "OneUptime with unlimited everything",
        oneuptimeCost: "$0-299/month",
      },
      {
        scenario: "SaaS company needing private status pages for enterprise clients",
        competitorSolution: "Statuspage Corporate Private ($599) + monitoring + on-call",
        competitorCost: "$599 + $150 + $300 = $1,049/month",
        oneuptimeSolution: "OneUptime with unlimited private status pages",
        oneuptimeCost: "$0-299/month",
      },
    ],
    faq: [
      {
        question: "How does OneUptime compare to Atlassian Statuspage?",
        answer:
          "Statuspage is a dedicated status page product - it only does status pages. You need separate tools for monitoring (to know when services are down), on-call scheduling (to notify the right person), and incident management (to coordinate response). That means 4 different vendors and 4 different bills. OneUptime provides status pages with unlimited subscribers PLUS built-in monitoring, on-call scheduling, and incident management in one platform. Your status pages can automatically update based on monitor status - something Statuspage can't do without external integrations.",
      },
      {
        question: "What about Statuspage's subscriber limits?",
        answer:
          "Statuspage charges based on subscriber count: Free (100), Hobby $29 (250), Startup $99 (1,000), Business $399 (5,000), Enterprise $1,499 (25,000). If you have 30,000 subscribers, you need custom pricing. OneUptime has NO subscriber limits on any plan. Your status page can have 100 or 1,000,000 subscribers at no additional cost. This alone can save you thousands annually.",
      },
      {
        question: "How does automatic status page updating work?",
        answer:
          "OneUptime's built-in monitoring continuously checks your services. When a monitor detects an issue, it can automatically update your status page to show degraded or down status. When the issue resolves, the status page updates automatically. With Statuspage, you need to integrate external monitoring tools and set up automation - or manually update status, which delays communication to your users.",
      },
      {
        question: "Can I customize my OneUptime status page like Statuspage?",
        answer:
          "Yes, and often with more flexibility. OneUptime status pages support custom domains (with free SSL), custom branding (logos, colors, favicon), and custom HTML/CSS/JavaScript on all paid plans - Statuspage restricts custom code to Business ($399/month) and above. You can also create component groups, show historical uptime, and display real-time metrics.",
      },
      {
        question: "Does OneUptime support private status pages?",
        answer:
          "Yes. OneUptime supports password-protected private status pages on all plans. Statuspage charges separately for private pages starting at $79/month with only 50 authenticated subscribers, scaling up to $1,499/month for 5,000 subscribers. With OneUptime, you get unlimited private status pages with unlimited authenticated subscribers.",
      },
      {
        question: "What notification channels does OneUptime support?",
        answer:
          "OneUptime supports all the same channels as Statuspage: email, SMS, webhooks, and RSS feeds. We also support Slack, Microsoft Teams, and push notifications. Unlike Statuspage, SMS is included on our free plan - Statuspage requires the $99/month Startup plan for SMS.",
      },
      {
        question: "Why would I choose OneUptime over Statuspage?",
        answer:
          "Choose OneUptime if you want a complete solution. With Statuspage alone, you still need monitoring ($50-200/mo), on-call scheduling ($100-500/mo), and incident management ($100-300/mo). That's $250-1,000/month in additional tools. OneUptime includes all of this, plus unlimited subscribers, for $0-299/month depending on your needs. You also get the benefit of everything being integrated - no webhook gymnastics to connect 4 different tools.",
      },
    ],
    keyDifferences: [
      {
        title: "Unlimited Subscribers",
        description: "No per-subscriber pricing - Statuspage charges $29-1,499/mo based on subscriber count",
        icon: "subscribers",
      },
      {
        title: "Built-in Monitoring",
        description: "Automatic status updates when issues are detected - Statuspage requires external tools",
        icon: "monitoring",
      },
      {
        title: "On-Call Scheduling",
        description: "Alert the right people when incidents occur - Statuspage offers no alerting",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description: "Full incident workflow with timelines and postmortems - not just status updates",
        icon: "incident",
      },
      {
        title: "Complete Platform",
        description: "Replace 4 tools with 1 - monitoring, status pages, on-call, and incident management",
        icon: "unified",
      },
      {
        title: "SMS on Free Plan",
        description: "SMS notifications included free - Statuspage requires $99/month Startup plan",
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
    price: "$10-$100+",
    productDescription: "Per month. Synthetic Monitoring starts at $10/month. Real User Monitoring (RUM) is separate at $10/month. Pricing scales based on number of uptime checks, page views, and advanced features. Enterprise pricing requires contact.",
    oneUptimeDescription:
      "Unlimited monitors from 7+ global locations. Plus get status pages with unlimited subscribers, on-call scheduling, and incident management - all included. No per-monitor pricing.",
    oneuptimePrice: "$0",
    tagline: "Complete observability without per-monitor pricing",
    competitorFocus: "Uptime monitoring only - status pages, on-call, incident management are separate products or don't exist",
    oneuptimeFocus: "Complete platform: Unlimited Monitoring + Status Pages + On-Call + Incident Management",
    annualSavings: "$3,000+",
    lastUpdated: "December 2024",
    description:
      "Pingdom (now owned by SolarWinds) is one of the oldest monitoring tools, known for reliable uptime monitoring with 100+ probe locations. However, it uses per-check pricing that gets expensive as you scale, offers no incident management or on-call scheduling, and status pages are a limited separate feature. You'll need additional tools to build a complete observability stack.",
    descriptionLine2:
      "Stop paying per monitor and per page view. Get unlimited monitoring plus status pages, on-call, and incident management in one platform.",
    hiddenCosts: [
      "Pricing based on number of uptime checks - scales up as you add monitors",
      "Real User Monitoring (RUM) charged separately based on page views",
      "Transaction checks (synthetic monitoring) cost more than basic uptime",
      "No on-call scheduling - requires PagerDuty, OpsGenie, etc. ($100-500+/month)",
      "No incident management - requires separate tool ($100-300+/month)",
      "Status page features are basic and limited",
      "No integrations with incident management - alerts only via email/SMS/webhook",
    ],
    migrationBenefits: [
      "Remove per-monitor pricing - add unlimited monitors",
      "Keep same monitoring locations with global probe network",
      "Add on-call scheduling you didn't have before",
      "Get status pages with unlimited subscribers",
      "Full incident management workflow included",
      "API-compatible for easy migration",
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
        competitorSolution: "Pingdom Transaction monitoring + on-call + status page",
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
        title: "Unlimited Monitors",
        description: "No per-monitor pricing - monitor every endpoint without cost concerns",
        icon: "unlimited",
      },
      {
        title: "Included Status Pages",
        description: "Full-featured status pages with unlimited subscribers - not a limited add-on",
        icon: "status-page",
      },
      {
        title: "On-Call Scheduling",
        description: "Full on-call with rotations and escalations - Pingdom has no scheduling",
        icon: "on-call",
      },
      {
        title: "Incident Management",
        description: "Complete incident workflow from detection to postmortem",
        icon: "incident",
      },
      {
        title: "Server Monitoring Included",
        description: "CPU, memory, disk metrics included - no separate agent purchase",
        icon: "monitoring",
      },
      {
        title: "Single Unified Platform",
        description: "Replace Pingdom + PagerDuty + StatusPage with one tool",
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
  "incident.io": {
    productName: "Incident.io",
    iconUrl: "/img/incident-io.svg",
    price: "$0-$25",
    productDescription:
      "Per user/month. Basic is free (limited features, Slack only). Team is $15-19/user (with on-call add-on +$10/user). Pro is $25/user (with on-call add-on +$20/user). For a team of 10 on Pro with on-call: $450/month. Enterprise requires custom pricing.",
    oneUptimeDescription:
      "Complete incident management plus monitoring, status pages, and on-call scheduling. No per-user pricing trap. All features included, not sold as add-ons.",
    oneuptimePrice: "$0",
    tagline: "Complete incident lifecycle platform vs Slack-only incident response",
    competitorFocus: "Incident management focused on Slack - monitoring and status pages require separate tools",
    oneuptimeFocus: "Full lifecycle: Detection (Monitoring) + Response (Incidents) + Communication (Status Pages) + On-Call",
    annualSavings: "$6,000+",
    lastUpdated: "December 2024",
    description:
      "Incident.io is a modern, beautifully designed incident management tool that excels at Slack-native incident response. It's great for coordinating teams during incidents. However, it lacks monitoring (to detect incidents) and status pages (to communicate with customers). On-call scheduling is a paid add-on. You'll need to integrate 2-3 other tools for a complete solution.",
    descriptionLine2:
      "Great incident response is just one part. You also need detection (monitoring) and communication (status pages). OneUptime provides the complete incident lifecycle.",
    hiddenCosts: [
      "On-call scheduling is an add-on: +$10/user/mo (Team) or +$20/user/mo (Pro)",
      "Team plan limits: 3 workflows, 3 custom fields, Slack only",
      "Pro required for Microsoft Teams support ($25/user)",
      "No monitoring included - requires Datadog, PagerDuty, etc.",
      "No status pages - requires StatusPage, Better Uptime, etc.",
      "Per-user pricing scales quickly with team growth",
      "Private incidents only on Pro plan ($25/user)",
      "Basic plan limited to Slack integration only",
    ],
    migrationBenefits: [
      "Add monitoring you didn't have before",
      "Add status pages with unlimited subscribers",
      "On-call included, not a paid add-on",
      "No per-user pricing - add team members freely",
      "Slack and Microsoft Teams included on all plans",
      "Complete incident lifecycle in one platform",
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
        competitorSolution: "Incident.io Pro + On-call add-on + Monitoring + Status Page",
        competitorCost: "$250 + $200 + $150 + $99 = $699/month",
        oneuptimeSolution: "OneUptime with everything included",
        oneuptimeCost: "$0/month (Free tier) or $99/month (Growth)",
      },
      {
        scenario: "25-person team with multiple environments",
        competitorSolution: "Incident.io Enterprise + on-call + monitoring + status pages",
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
        description: "Detect incidents automatically - Incident.io has zero monitoring capabilities",
        icon: "monitoring",
      },
      {
        title: "Included Status Pages",
        description: "Communicate with customers during incidents - not available in Incident.io",
        icon: "status-page",
      },
      {
        title: "On-Call Included",
        description: "Full on-call scheduling included - Incident.io charges +$10-20/user extra",
        icon: "on-call",
      },
      {
        title: "No Per-User Pricing",
        description: "Add team members without cost scaling - Incident.io charges per user",
        icon: "savings",
      },
      {
        title: "Complete Lifecycle",
        description: "Detection, Response, Communication, Learning - all in one platform",
        icon: "unified",
      },
      {
        title: "Teams on All Plans",
        description: "Microsoft Teams included free - Incident.io requires $25/user Pro plan",
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
