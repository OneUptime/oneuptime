/*
 * Pricing plan matrix for the /pricing page and the machine-readable
 * pricing surfaces (/data/pricing.json, /pricing.md, /llms-full.txt).
 */

export interface PricingPlan {
  key: string;
  name: string;
  monthlyPricePerUser: string;
  yearlyMonthlyPricePerUser: string;
  description: string;
}

export interface PricingFeature {
  name: string;
  plans: Record<string, string | boolean>;
}

export interface PricingCategory {
  name: string;
  data: Array<PricingFeature>;
}

export const PricingPlans: Array<PricingPlan> = [
  {
    key: "free",
    name: "Free",
    monthlyPricePerUser: "$0",
    yearlyMonthlyPricePerUser: "$0",
    description: "For individuals and small projects. No credit card required.",
  },
  {
    key: "growth",
    name: "Growth",
    monthlyPricePerUser: "$22",
    yearlyMonthlyPricePerUser: "$20",
    description:
      "Per user per month. For growing teams. 14 day free trial included.",
  },
  {
    key: "scale",
    name: "Scale",
    monthlyPricePerUser: "$99",
    yearlyMonthlyPricePerUser: "$84",
    description: "Per user per month. Everything in Growth plus more.",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    monthlyPricePerUser: "Custom",
    yearlyMonthlyPricePerUser: "Custom",
    description:
      "Enterprise grade offering. Custom pricing - contact sales at https://oneuptime.com/enterprise/demo.",
  },
];

const Pricing: Array<PricingCategory> = [
  {
    name: "Status Page",
    data: [
      {
        name: "Public Status Page",
        plans: {
          free: "1",
          growth: "Unlimited",
          scale: "Unlimited",
          enterprise: "Unlimited",
        },
      },
      {
        name: "Subscribers",
        plans: {
          free: "100",
          growth: "Unlimited",
          scale: "Unlimited",
          enterprise: "Unlimited",
        },
      },
      {
        name: "Custom Branding",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "SSL Certificate",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Custom Domain",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Private Status Page",
        plans: {
          free: false,
          growth: "Unlimited",
          scale: "Unlimited",
          enterprise: "Unlimited",
        },
      },
      {
        name: "Private Status Page Users",
        plans: {
          free: false,
          growth: "Unlimited",
          scale: "Unlimited",
          enterprise: "Unlimited",
        },
      },
    ],
  },
  {
    name: "Incident Management",
    data: [
      {
        name: "Basic Incident Management",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Public Postmortem Notes",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Private Postmortem Notes",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Incident Workflows",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Custom Incident State",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Custom Incident Severity",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
  {
    name: "Monitoring",
    data: [
      {
        name: "Static / Manual Monitors",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Website Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "API Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Synthetic Monitoring (with Playwright)",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },

      {
        name: "IPv4 Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },

      {
        name: "IPv6 Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Inbound Webhook / Heartbeat Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "VM or Server Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Network Monitoring",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Container Monitoring",
        plans: {
          free: "Coming Soon",
          growth: "Coming Soon",
          scale: "Coming Soon",
          enterprise: "Coming Soon",
        },
      },
      {
        name: "Kubernetes Cluster Monitoring",
        plans: {
          free: "Coming Soon",
          growth: "Coming Soon",
          scale: "Coming Soon",
          enterprise: "Coming Soon",
        },
      },
    ],
  },
  {
    name: "On-Call and Alerts",
    data: [
      {
        name: "SMS Alerts",
        plans: {
          free: "$0.10/SMS",
          growth: "$0.10/SMS",
          scale: "$0.10/SMS",
          enterprise: "$0.10/SMS",
        },
      },
      {
        name: "Phone Call Alerts",
        plans: {
          free: "$0.10/min",
          growth: "$0.10/min",
          scale: "$0.10/min",
          enterprise: "$0.10/min",
        },
      },
      {
        name: "Bring Your Own Twilio",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Email Alerts",
        plans: {
          free: "Free",
          growth: "Free",
          scale: "Free",
          enterprise: "Free",
        },
      },
      {
        name: "On-Call Escalation",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "On-Call Rotation",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Advanced Workflows",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Logs and Events",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Webhook Alerts",
        plans: {
          free: "Coming Soon",
          growth: "Coming Soon",
          scale: "Coming Soon",
          enterprise: "Coming Soon",
        },
      },
      {
        name: "Vacation and OOO Policy",
        plans: {
          free: "Coming Soon",
          growth: "Coming Soon",
          scale: "Coming Soon",
          enterprise: "Coming Soon",
        },
      },
      {
        name: "On-Call Pay",
        plans: {
          free: "Coming Soon",
          growth: "Coming Soon",
          scale: "Coming Soon",
          enterprise: "Coming Soon",
        },
      },
      {
        name: "Reports",
        plans: {
          free: "Coming Soon",
          growth: "Coming Soon",
          scale: "Coming Soon",
          enterprise: "Coming Soon",
        },
      },
    ],
  },
  {
    name: "Logs Management",
    data: [
      {
        name: "Ingest with OpenTelemetry",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Ingest with Fluentd",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Ingest +1000 Sources",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Application Logs",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Container Logs",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Data Rentention",
        plans: {
          free: "15 days",
          growth: "Custom",
          scale: "Custom",
          enterprise: "Custom",
        },
      },
      {
        name: "Workflows",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Advanced Team Permissions",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
  {
    name: "Telemetry / APM",
    data: [
      {
        name: "Metrics",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Traces",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Error Tracking",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Ingest Pricing",
        plans: {
          free: "$0.10/GB",
          growth: "$0.10/GB",
          scale: "$0.10/GB",
          enterprise: "$0.10/GB",
        },
      },
      {
        name: "Data Rentention",
        plans: {
          free: "15 days",
          growth: "Custom",
          scale: "Custom",
          enterprise: "Custom",
        },
      },
      {
        name: "Workflows",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Advanced Team Permissions",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
  {
    name: "Error Tracking",
    data: [
      {
        name: "Track Errors and Exceptions",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Cross Microservice Issues",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Distributed Tracing",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Stack Traces",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Version Management",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Data Rentention",
        plans: {
          free: "15 days",
          growth: "Custom",
          scale: "Custom",
          enterprise: "Custom",
        },
      },
      {
        name: "Workflows",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Advanced Team Permissions",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
  {
    name: "AI Agent",
    data: [
      {
        name: "LLM Token Pricing",
        plans: {
          free: "$0.02/1K tokens",
          growth: "$0.02/1K tokens",
          scale: "$0.02/1K tokens",
          enterprise: "$0.02/1K tokens",
        },
      },
      {
        name: "Bring Your Own LLM",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Incident Analysis & Insights",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Root Cause Suggestions",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Automated Runbook Generation",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Log Analysis & Anomaly Detection",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Fix Errors Automatically",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Integrate with GitHub, GitLab",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Integrate with Slack / Teams",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
  {
    name: "Support and More",
    data: [
      {
        name: "Support",
        plans: {
          free: "Email Support",
          growth: "Email Support",
          scale: "Email and Chat Support",
          enterprise: "Email, Chat, Phone Support",
        },
      },
      {
        name: "Support SLA",
        plans: {
          free: "5 business day",
          growth: "1 business day",
          scale: "6 hours",
          enterprise: "1 hour priority",
        },
      },
      {
        name: "Service SLA",
        plans: {
          free: "99.00%",
          growth: "99.90%",
          scale: "99.95%",
          enterprise: "99.99%",
        },
      },
    ],
  },
  {
    name: "Advanced Features",
    data: [
      {
        name: "API Access",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
      {
        name: "Advanced Workflows",
        plans: {
          free: false,
          growth: "500 Runs / month",
          scale: "2000 Runs  /month",
          enterprise: "Unlimited Runs",
        },
      },
      {
        name: "5000+ Integrations",
        plans: {
          free: false,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
  {
    name: "Billing",
    data: [
      {
        name: "Billing Period",
        plans: {
          free: "Free",
          growth: "Monthly or Yearly",
          scale: "Monthly or Yearly",
          enterprise: "Custom",
        },
      },
      {
        name: "Payment Method",
        plans: {
          free: false,
          growth: "Visa / Mastercard / Amex / Bitcoin",
          scale: "Visa / Mastercard / Amex / Bitcoin",
          enterprise: "Visa / Mastercard / Amex / ACH / Invoices / Bitcoin",
        },
      },
      {
        name: "Cancel Anytime",
        plans: {
          free: true,
          growth: true,
          scale: true,
          enterprise: true,
        },
      },
    ],
  },
];

export default Pricing;
