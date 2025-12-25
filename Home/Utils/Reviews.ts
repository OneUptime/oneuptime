export interface Review {
  name: string;
  role: string;
  company: string;
  text: string;
  title: string;
}

const reviews: Review[] = [
  {
    name: "Anderson Miller",
    role: "CTO",
    company: "GK2 Cloud",
    text: "Thanks for building OneUptime, it really is fantastic. We are getting more excited every day! The open-source nature means we can customize it exactly to our needs.",
    title: "OneUptime is fantastic!",
  },
  {
    name: "Reg Thompson",
    role: "Director of Engineering",
    company: "Skillable",
    text: "We use OneUptime to reliably monitor endpoint availability globally, and it delivers. The multi-region monitoring gives us confidence in our uptime numbers.",
    title: "Global monitoring that delivers",
  },
  {
    name: "Sarah Chen",
    role: "VP of Engineering",
    company: "Nexus Labs",
    text: "Switching from PagerDuty saved us over $40k annually. OneUptime's on-call scheduling is just as powerful, and the incident management workflow is even better.",
    title: "Replaced PagerDuty, no regrets",
  },
  {
    name: "Marcus Johnson",
    role: "Site Reliability Engineer",
    company: "DataStream Inc",
    text: "The OpenTelemetry integration was a game-changer. We can now correlate traces, logs, and metrics in one place. Our MTTR dropped by 60%.",
    title: "OpenTelemetry done right",
  },
  {
    name: "Emily Rodriguez",
    role: "DevOps Lead",
    company: "CloudFirst",
    text: "Self-hosting OneUptime gives us complete control over our monitoring data. No more worrying about third-party outages affecting our incident response.",
    title: "Self-hosted and reliable",
  },
  {
    name: "James Park",
    role: "Platform Engineer",
    company: "Fintech Systems",
    text: "The status page feature is incredible. Our customers love the transparency, and we've seen a 40% reduction in support tickets during incidents.",
    title: "Status pages that customers love",
  },
  {
    name: "Lisa Wang",
    role: "Engineering Manager",
    company: "Quantum Analytics",
    text: "We migrated from Datadog and cut our observability costs by 70%. OneUptime handles our 500+ services without breaking a sweat.",
    title: "70% cost reduction from Datadog",
  },
  {
    name: "David Kumar",
    role: "SRE Team Lead",
    company: "SecureOps",
    text: "The alerting system is incredibly flexible. We've set up complex escalation policies that match our exact workflow. No more alert fatigue.",
    title: "Finally, smart alerting",
  },
  {
    name: "Rachel Foster",
    role: "Head of Infrastructure",
    company: "Meditech Solutions",
    text: "HIPAA compliance was a concern, but self-hosting OneUptime solved that. We have full control over our monitoring data in our own infrastructure.",
    title: "Perfect for compliance",
  },
  {
    name: "Alex Thompson",
    role: "Senior DevOps Engineer",
    company: "Retail Cloud",
    text: "The synthetic monitoring catches issues before our customers do. We've prevented three major outages in the last quarter alone.",
    title: "Proactive issue detection",
  },
  {
    name: "Michelle Lee",
    role: "Director of SRE",
    company: "Gaming Network",
    text: "Handling 10 million users during game launches requires solid monitoring. OneUptime scales beautifully and the real-time dashboards are fantastic.",
    title: "Scales with our growth",
  },
  {
    name: "Chris Martinez",
    role: "Platform Architect",
    company: "E-Commerce Plus",
    text: "The API is well-documented and powerful. We've integrated OneUptime into our CI/CD pipeline for automated monitoring of new deployments.",
    title: "API-first approach works",
  },
  {
    name: "Jessica Brown",
    role: "VP of Operations",
    company: "SaaS Dynamics",
    text: "On-call rotations used to be a nightmare. OneUptime's scheduling is intuitive and fair. Our team morale has noticeably improved.",
    title: "On-call that doesn't burn out",
  },
  {
    name: "Ryan O'Connor",
    role: "DevOps Manager",
    company: "Logistics Pro",
    text: "We monitor 200+ endpoints across 15 regions. OneUptime's global probe network gives us accurate data from every corner of the world.",
    title: "True global coverage",
  },
  {
    name: "Amanda Patel",
    role: "Site Reliability Lead",
    company: "EdTech Solutions",
    text: "The log management integrated with monitoring is exactly what we needed. No more context switching between tools during incidents.",
    title: "Everything in one place",
  },
  {
    name: "Michael Zhang",
    role: "Infrastructure Lead",
    company: "AI Innovations",
    text: "We were spending too much on New Relic. OneUptime gives us the same capabilities at a fraction of the cost. The ROI was immediate.",
    title: "Best value in observability",
  },
  {
    name: "Stephanie Wilson",
    role: "Engineering Director",
    company: "Travel Tech",
    text: "The incident timeline feature is brilliant. Post-mortems are now data-driven and our team has learned so much from past incidents.",
    title: "Learn from every incident",
  },
  {
    name: "Daniel Kim",
    role: "SRE Manager",
    company: "Streaming Media",
    text: "99.99% uptime is our target, and OneUptime helps us achieve it. The SLA monitoring and reporting makes our leadership happy.",
    title: "SLA tracking made easy",
  },
  {
    name: "Lauren Davis",
    role: "Platform Lead",
    company: "Crypto Exchange",
    text: "Security is paramount in our industry. Having full control over our monitoring infrastructure with self-hosted OneUptime is non-negotiable.",
    title: "Security-first monitoring",
  },
  {
    name: "Kevin Nguyen",
    role: "DevOps Engineer",
    company: "Health Platform",
    text: "The Docker and Kubernetes monitoring works out of the box. We had it running in production within an hour of starting the setup.",
    title: "Container monitoring done right",
  },
  {
    name: "Natalie Scott",
    role: "VP of Technology",
    company: "Insurance Tech",
    text: "We needed something that could handle our complex microservices architecture. OneUptime's distributed tracing has been invaluable.",
    title: "Microservices visibility",
  },
  {
    name: "Jason Chen",
    role: "Lead SRE",
    company: "Payment Systems",
    text: "PCI compliance requires careful vendor management. Self-hosting OneUptime means one less vendor with access to our infrastructure data.",
    title: "Compliance simplified",
  },
  {
    name: "Olivia Turner",
    role: "Engineering Manager",
    company: "HR Software",
    text: "The Slack integration is seamless. Our team gets alerts right where they work, with all the context they need to respond quickly.",
    title: "Slack integration is perfect",
  },
  {
    name: "Brian Murphy",
    role: "DevOps Lead",
    company: "Supply Chain Co",
    text: "We've consolidated five different monitoring tools into OneUptime. The unified view has dramatically improved our operational efficiency.",
    title: "One tool to rule them all",
  },
  {
    name: "Catherine Hall",
    role: "Director of Engineering",
    company: "Legal Tech",
    text: "The team behind OneUptime is incredibly responsive. They shipped a feature we requested within two weeks. Try getting that from a big vendor.",
    title: "Community that listens",
  },
  {
    name: "Thomas Anderson",
    role: "Platform Engineer",
    company: "IoT Systems",
    text: "Monitoring 10,000+ IoT devices requires efficiency. OneUptime handles the volume without any performance degradation.",
    title: "Handles massive scale",
  },
  {
    name: "Maria Garcia",
    role: "SRE Lead",
    company: "News Platform",
    text: "During breaking news events, our traffic spikes 20x. OneUptime's monitoring never misses a beat, and the alerts are always on point.",
    title: "Reliable under pressure",
  },
  {
    name: "William Foster",
    role: "Infrastructure Architect",
    company: "Banking Solutions",
    text: "The audit logging and role-based access control meet our regulatory requirements. Enterprise-grade features without enterprise pricing.",
    title: "Enterprise-ready platform",
  },
  {
    name: "Emma Richardson",
    role: "DevOps Manager",
    company: "Marketing Tech",
    text: "Our clients love the white-labeled status pages. It looks professional and saves us from building our own status page infrastructure.",
    title: "White-label ready",
  },
  {
    name: "Andrew Kim",
    role: "Platform Lead",
    company: "Telecom Services",
    text: "The uptime checks from multiple global locations give us accurate latency data. We've used it to optimize our CDN configuration.",
    title: "Global latency insights",
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
