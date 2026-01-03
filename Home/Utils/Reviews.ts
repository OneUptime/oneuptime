export interface Review {
  name: string;
  role: string;
  company: string;
  text: string;
  title: string;
}

const reviews: Review[] = [
  {
    name: "Marcus Thompson",
    role: "CTO",
    company: "Cloudwave Technologies",
    text: "OneUptime replaced our fragmented monitoring stack. We consolidated Datadog, PagerDuty, and Statuspage into one platform. The cost savings alone justified the switch, but the unified experience is what keeps us here.",
    title: "Replaced 3 tools with one platform",
  },
  {
    name: "Priya Sharma",
    role: "Director of Engineering",
    company: "Finova Systems",
    text: "The open-source nature was crucial for our compliance team. We self-host on our own infrastructure, which means our monitoring data never leaves our environment. Perfect for financial services.",
    title: "Self-hosted compliance solved",
  },
  {
    name: "Sarah Mitchell",
    role: "VP of Engineering",
    company: "Nexus Labs",
    text: "Switching from PagerDuty saved us over $40k annually. OneUptime's on-call scheduling is just as powerful, and the incident timeline feature is something PagerDuty never offered.",
    title: "Cut costs without compromise",
  },
  {
    name: "Rajesh Venkataraman",
    role: "Site Reliability Engineer",
    company: "DataStream Analytics",
    text: "The OpenTelemetry integration changed how we debug production issues. Correlating traces with logs and metrics in one view reduced our mean time to resolution from hours to minutes.",
    title: "OpenTelemetry done right",
  },
  {
    name: "Emily Chen",
    role: "DevOps Lead",
    company: "CloudFirst Inc",
    text: "We monitor 400+ microservices across three cloud providers. OneUptime handles the complexity without slowing down. The service map visualization alone is worth it.",
    title: "Multi-cloud visibility achieved",
  },
  {
    name: "James O'Brien",
    role: "Platform Engineer",
    company: "Sterling Financial",
    text: "Our status page gets 50k monthly visitors. The customization options let us match our brand perfectly, and the subscriber notifications have reduced our support ticket volume by 35%.",
    title: "Status pages customers trust",
  },
  {
    name: "Wei Zhang",
    role: "Engineering Manager",
    company: "Quantum Computing Co",
    text: "We migrated from New Relic and immediately saw a 65% reduction in our observability spend. The APM capabilities are comparable, and we're not paying per-host anymore.",
    title: "Enterprise features, startup pricing",
  },
  {
    name: "Arjun Mehta",
    role: "SRE Team Lead",
    company: "SecureStack",
    text: "Alert fatigue was killing our team's productivity. OneUptime's intelligent grouping and customizable thresholds cut our noise by 80%. Now every alert actually matters.",
    title: "Finally, alerts that matter",
  },
  {
    name: "Rachel Foster",
    role: "Head of Infrastructure",
    company: "MedTech Solutions",
    text: "HIPAA compliance requires strict data handling. Self-hosting OneUptime in our private cloud gives us the audit trail and access controls we need for healthcare.",
    title: "Healthcare-ready monitoring",
  },
  {
    name: "Alex Reynolds",
    role: "Senior DevOps Engineer",
    company: "RetailBox",
    text: "The synthetic monitoring caught a payment gateway issue at 3 AM before any customers noticed. That single catch probably saved us six figures in lost revenue.",
    title: "Proactive beats reactive",
  },
  {
    name: "Michelle Park",
    role: "Director of SRE",
    company: "GameForge Studios",
    text: "During our last game launch, we had 2 million concurrent users. OneUptime's real-time dashboards helped us scale our infrastructure on the fly without a single dropped connection.",
    title: "Battle-tested at scale",
  },
  {
    name: "Carlos Rodriguez",
    role: "Platform Architect",
    company: "ShopStream",
    text: "The REST API is fantastic. We've automated our entire monitoring setup through Terraform, and new services get monitors automatically as part of our CI/CD pipeline.",
    title: "Infrastructure as code ready",
  },
  {
    name: "Jennifer Walsh",
    role: "VP of Operations",
    company: "SaaS Metrics",
    text: "Our on-call engineers used to dread their shifts. OneUptime's fair rotation scheduling and clear escalation paths have genuinely improved team morale and retention.",
    title: "On-call that doesn't burn out",
  },
  {
    name: "Ryan Murphy",
    role: "DevOps Manager",
    company: "LogiTech Solutions",
    text: "We monitor 200+ endpoints across 15 countries. The global probe network gives us accurate latency data from every region our customers are in.",
    title: "True global monitoring",
  },
  {
    name: "Ananya Krishnan",
    role: "Site Reliability Lead",
    company: "EduLearn Platform",
    text: "Having logs, metrics, and traces in one place eliminated the context-switching that was slowing down our incident response. Everything we need is one click away.",
    title: "Unified observability works",
  },
  {
    name: "Michael Torres",
    role: "Infrastructure Lead",
    company: "AI Dynamics",
    text: "We evaluated Grafana Cloud, Splunk, and OneUptime. OneUptime won on total cost of ownership and ease of use. Our junior engineers were productive on day one.",
    title: "Easy to learn, powerful to use",
  },
  {
    name: "Stephanie Barnes",
    role: "Engineering Director",
    company: "Wanderlust Travel",
    text: "The incident timeline automatically captures every action during an outage. Our post-mortems went from blame sessions to genuine learning opportunities.",
    title: "Blameless post-mortems enabled",
  },
  {
    name: "Daniel Kim",
    role: "SRE Manager",
    company: "StreamVision Media",
    text: "We're contractually obligated to maintain 99.95% uptime. OneUptime's SLA tracking and automated reports give our enterprise clients the transparency they demand.",
    title: "SLA reporting simplified",
  },
  {
    name: "Laura Bennett",
    role: "Platform Lead",
    company: "CryptoVault Exchange",
    text: "In crypto, security isn't optional. Self-hosting our monitoring means our infrastructure topology stays private. No third-party vendor has visibility into our systems.",
    title: "Security-first approach",
  },
  {
    name: "Kevin Nguyen",
    role: "DevOps Engineer",
    company: "HealthFirst Platform",
    text: "The Kubernetes integration auto-discovers new pods and creates monitors automatically. As our cluster scales, our monitoring scales with it. Zero manual intervention.",
    title: "Kubernetes-native monitoring",
  },
  {
    name: "Natalie Scott",
    role: "VP of Technology",
    company: "InsureTech Global",
    text: "Distributed tracing across our 60+ microservices used to be a nightmare. OneUptime's service map shows us exactly where requests slow down or fail.",
    title: "Microservices made visible",
  },
  {
    name: "Jason Liu",
    role: "Lead SRE",
    company: "PayFlow Systems",
    text: "PCI-DSS requires us to control our monitoring data. Self-hosted OneUptime lets us run everything in our compliant environment without compromising on features.",
    title: "PCI compliance maintained",
  },
  {
    name: "Olivia Turner",
    role: "Engineering Manager",
    company: "TalentHub HR",
    text: "The Slack and Microsoft Teams integrations are seamless. Alerts come with full context, and we can acknowledge and resolve incidents without leaving our chat tool.",
    title: "ChatOps that actually works",
  },
  {
    name: "Brian McCarthy",
    role: "DevOps Lead",
    company: "ChainLink Logistics",
    text: "We consolidated five separate monitoring tools into OneUptime. The unified dashboard means our NOC team finally has a single pane of glass for everything.",
    title: "True single pane of glass",
  },
  {
    name: "Catherine Hall",
    role: "Director of Engineering",
    company: "LegalDoc Systems",
    text: "We submitted a feature request on GitHub. The team shipped it in their next release. Try getting that responsiveness from Datadog or New Relic.",
    title: "Community that delivers",
  },
  {
    name: "Thomas Anderson",
    role: "Platform Engineer",
    company: "IoT Networks Inc",
    text: "We monitor 15,000 IoT devices reporting every 30 seconds. OneUptime handles the ingestion volume without breaking a sweat. The data retention policies keep costs manageable.",
    title: "IoT scale no problem",
  },
  {
    name: "Maria Santos",
    role: "SRE Lead",
    company: "NewsWire Digital",
    text: "Breaking news means unpredictable traffic spikes. OneUptime's monitoring stays responsive even when our servers are under 20x normal load.",
    title: "Reliable when it matters most",
  },
  {
    name: "William Foster",
    role: "Infrastructure Architect",
    company: "Metropolitan Bank",
    text: "The role-based access control and audit logging satisfy our regulators. We get enterprise-grade governance without enterprise-grade complexity.",
    title: "Enterprise governance built-in",
  },
  {
    name: "Emma Richardson",
    role: "DevOps Manager",
    company: "AdTech Solutions",
    text: "We white-label OneUptime's status pages for our clients. They see our branding, we see a unified dashboard. It's a key part of our managed services offering.",
    title: "White-label for agencies",
  },
  {
    name: "Andrew Park",
    role: "Platform Lead",
    company: "TeleConnect Services",
    text: "Latency monitoring from 20+ global locations helped us identify that our Asian users were hitting an overloaded CDN node. Fixed it before anyone complained.",
    title: "Global performance insights",
  },
];

// divide reviews array into three equal lists. This is helpful for the UI
const reviewsList1: Array<Review> = [];
const reviewsList2: Array<Review> = [];
const reviewsList3: Array<Review> = [];

for (let i: number = 0; i < reviews.length; i++) {
  if (i % 3 === 0) {
    reviewsList1.push(reviews[i]!);
  } else if (i % 3 === 1) {
    reviewsList2.push(reviews[i]!);
  } else {
    reviewsList3.push(reviews[i]!);
  }
}

export default { reviewsList1, reviewsList2, reviewsList3 };
