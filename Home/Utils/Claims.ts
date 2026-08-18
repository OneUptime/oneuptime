/*
 * Governed claims matrix.
 *
 * This file is the single source of truth for what OneUptime marketing pages
 * are allowed to say about uptime, support, compliance, encryption,
 * deployment, migration, scale, discounts, and contract terms.
 *
 * Why it exists: several statements on the site read as contractual
 * commitments ("99.99% uptime SLA", "guaranteed response times") while the
 * documents that actually bind us — /legal/sla, /legal/security, /legal/dpa —
 * say something different. A buyer who notices that stops trusting everything
 * else on the page. So every claim now carries:
 *
 *   - a status from a fixed vocabulary (see ClaimStatuses below),
 *   - the exact sentence marketing may use,
 *   - the qualifier that must travel with it,
 *   - a link to the document that makes it true.
 *
 * Rules for editing this file:
 *
 *   1. A claim's `statement` is the approved language. Pages should not
 *      paraphrase it into something stronger.
 *   2. Never upgrade a `status` without the evidence that justifies the new
 *      word. "In progress" does not become "Certified" because a deal needs it.
 *   3. Anything with `reviewRequired: true` is waiting on legal or security
 *      sign-off. It is still published as written, but the wording is
 *      deliberately conservative until the reviewer confirms the evidence.
 *   4. RetiredClaims and BannedClaimPatterns below are enforced by
 *      Tests/ClaimsGovernance.test.ts, which fails the build if retired
 *      language reappears anywhere in Home/Views.
 */

export type ClaimStatusKey =
  | "certified"
  | "attested"
  | "compliant"
  | "aligned"
  | "in-progress"
  | "customer-configurable";

export type ClaimCategoryKey =
  | "sla"
  | "support"
  | "compliance"
  | "encryption"
  | "deployment"
  | "migration"
  | "scale"
  | "discounts"
  | "contract";

export type ClaimScope = "cloud" | "self-hosted" | "both";

export interface ClaimStatusDefinition {
  key: ClaimStatusKey;
  label: string;
  // What the word means. This is the definition published on the trust center.
  definition: string;
  // The test a claim must pass before it may carry this status.
  evidenceBar: string;
  // Tailwind colour family used for the badge.
  color: "emerald" | "blue" | "violet" | "slate" | "amber" | "cyan";
}

export const ClaimStatuses: Array<ClaimStatusDefinition> = [
  {
    key: "certified",
    label: "Certified",
    definition:
      "An accredited certification body audited us against a published scheme and issued a certificate.",
    evidenceBar:
      "A named certification body, a certificate number, and a scope statement.",
    color: "emerald",
  },
  {
    key: "attested",
    label: "Attested",
    definition:
      "An independent third party examined our controls and issued a report or opinion. Certificates are not issued under these schemes.",
    evidenceBar:
      "A third-party report we can share, in full or in summary, under NDA.",
    color: "blue",
  },
  {
    key: "compliant",
    label: "Compliant",
    definition:
      "We meet a legal or regulatory obligation that has no certification scheme. The commitment lives in a contract, not a certificate.",
    evidenceBar:
      "A signed agreement — DPA, BAA, or order form — that states the obligation.",
    color: "violet",
  },
  {
    key: "aligned",
    label: "Aligned",
    definition:
      "We build and operate to a framework's controls, but no independent certificate or attestation exists for it. Includes self-assessments and regimes where the customer, not the vendor, is the one certified.",
    evidenceBar:
      "Control documentation or a self-assessment we will hand over on request.",
    color: "slate",
  },
  {
    key: "in-progress",
    label: "In progress",
    definition:
      "Work is underway and not finished. This status must never be presented as achieved, and no date may be promised on a marketing page.",
    evidenceBar: "An owner and a live workstream. Nothing else.",
    color: "amber",
  },
  {
    key: "customer-configurable",
    label: "Customer-configurable",
    definition:
      "We ship the capability. Whether it is switched on, and how it is configured, is the customer's decision — which is the normal case for self-hosted deployments.",
    evidenceBar:
      "A documented setting, chart value, or product control the customer can verify.",
    color: "cyan",
  },
];

export interface ClaimCategory {
  key: ClaimCategoryKey;
  name: string;
  description: string;
  // The document that governs this category.
  governingDocument: string;
  governingDocumentUrl: string;
}

export const ClaimCategories: Array<ClaimCategory> = [
  {
    key: "sla",
    name: "Service levels",
    description:
      "Uptime targets, how availability is measured, and what you get if we miss.",
    governingDocument: "Service Level Agreement",
    governingDocumentUrl: "/legal/sla",
  },
  {
    key: "support",
    name: "Support",
    description:
      "First-response targets by severity, support hours, and what a support agreement covers.",
    governingDocument: "Service Level Agreement, section 5",
    governingDocumentUrl: "/legal/sla",
  },
  {
    key: "compliance",
    name: "Compliance",
    description:
      "Certifications, attestations, and frameworks — each with the evidence behind it.",
    governingDocument: "Security at OneUptime",
    governingDocumentUrl: "/legal/security",
  },
  {
    key: "encryption",
    name: "Encryption and data protection",
    description:
      "How data is protected in transit and at rest, and who holds the keys.",
    governingDocument: "Security at OneUptime",
    governingDocumentUrl: "/legal/security",
  },
  {
    key: "deployment",
    name: "Deployment and data residency",
    description:
      "Where OneUptime can run, and where your data physically sits.",
    governingDocument: "Self-hosted deployment guide",
    governingDocumentUrl: "/enterprise/self-hosted",
  },
  {
    key: "migration",
    name: "Migration and portability",
    description:
      "Getting data in, getting it out, and moving between deployment models.",
    governingDocument: "Data Processing Addendum",
    governingDocumentUrl: "/legal/dpa",
  },
  {
    key: "scale",
    name: "Scale",
    description:
      "What the platform is built to handle, stated as architecture rather than as a headline number.",
    governingDocument: "Production readiness checklist",
    governingDocumentUrl: "/enterprise/self-hosted",
  },
  {
    key: "discounts",
    name: "Discounts",
    description: "Published discounts, and which ones need a conversation.",
    governingDocument: "Pricing",
    governingDocumentUrl: "/pricing",
  },
  {
    key: "contract",
    name: "Contract terms",
    description:
      "What is standard, what is negotiable, and what has to be in an order form.",
    governingDocument: "Terms of Use",
    governingDocumentUrl: "/legal/terms",
  },
];

export interface Claim {
  id: string;
  category: ClaimCategoryKey;
  subject: string;
  status: ClaimStatusKey;
  scope: ClaimScope;
  // The approved sentence. Pages use this wording; they do not strengthen it.
  statement: string;
  // The caveat that must travel with the statement wherever it appears.
  qualifier: string;
  // What a buyer can ask for to verify it.
  evidence: string;
  // Where the binding version of this claim lives.
  sourceUrl: string;
  // True when legal or security still has to confirm the underlying evidence.
  reviewRequired?: boolean;
  reviewNote?: string;
}

export const Claims: Array<Claim> = [
  // ---------------------------------------------------------------- SLA ----
  {
    id: "sla-cloud-enterprise",
    category: "sla",
    subject: "Enterprise uptime target (OneUptime Cloud)",
    status: "compliant",
    scope: "cloud",
    statement:
      "99.95% monthly uptime target for Enterprise plans on OneUptime Cloud.",
    qualifier:
      "Applies to Enterprise plans with a signed order form. Service credits are the sole remedy.",
    evidence:
      "Section 1 of the SLA, and live availability at status.oneuptime.com.",
    sourceUrl: "/legal/sla",
  },
  {
    id: "sla-cloud-paid",
    category: "sla",
    subject: "Paid plan uptime target (OneUptime Cloud)",
    status: "compliant",
    scope: "cloud",
    statement:
      "99.9% monthly uptime target for Growth, Scale, and other paid self-serve plans.",
    qualifier:
      "Measured monthly against the core web application and API, excluding announced maintenance.",
    evidence: "Sections 1 and 2 of the SLA.",
    sourceUrl: "/legal/sla",
  },
  {
    id: "sla-free-plans",
    category: "sla",
    subject: "Free, trial, and beta plans",
    status: "aligned",
    scope: "cloud",
    statement:
      "Free, trial, and beta plans are provided on a best-effort basis with no uptime commitment.",
    qualifier:
      "Availability is published for every plan, but no service credits apply.",
    evidence: "Section 1 of the SLA.",
    sourceUrl: "/legal/sla",
  },
  {
    id: "sla-service-credits",
    category: "sla",
    subject: "Service credits",
    status: "compliant",
    scope: "cloud",
    statement:
      "If we miss the monthly uptime target, you can claim a service credit of 10%, 25%, or 50% of that month's fees.",
    qualifier:
      "Claims are made by email within 30 days. Credits are the sole and exclusive remedy under the SLA.",
    evidence: "Sections 3, 4, and 6 of the SLA.",
    sourceUrl: "/legal/sla",
  },
  {
    id: "sla-self-hosted",
    category: "sla",
    subject: "Self-hosted availability",
    status: "customer-configurable",
    scope: "self-hosted",
    statement:
      "Uptime of a self-hosted deployment is owned by the team that runs it. We ship the high-availability building blocks: database operators, Pod Disruption Budgets, autoscaling, and a dedicated worker tier.",
    qualifier:
      "The OneUptime Cloud SLA does not extend to infrastructure you operate.",
    evidence:
      "The Helm chart's production readiness checklist and configuration reference.",
    sourceUrl: "/enterprise/self-hosted",
  },
  {
    id: "sla-status-evidence",
    category: "sla",
    subject: "Availability evidence",
    status: "attested",
    scope: "cloud",
    statement:
      "Real-time and historical availability for OneUptime Cloud are published at status.oneuptime.com.",
    qualifier:
      "Measured by external monitoring, using the same definition of downtime as the SLA.",
    evidence: "The public status page and its incident history.",
    sourceUrl: "https://status.oneuptime.com",
  },

  // ------------------------------------------------------------ SUPPORT ----
  {
    id: "support-p1",
    category: "support",
    subject: "P1 (critical) first response",
    status: "compliant",
    scope: "cloud",
    statement:
      "One-hour first-response target for P1 issues, 24/7, on paid plans.",
    qualifier:
      "A target, not a credit-backed guarantee. Enterprise order forms may set different targets.",
    evidence: "Section 5 of the SLA.",
    sourceUrl: "/legal/sla",
  },
  {
    id: "support-p2-p4",
    category: "support",
    subject: "P2 to P4 first response",
    status: "compliant",
    scope: "cloud",
    statement:
      "Four business hours for P2, one business day for P3, and three business days for P4.",
    qualifier:
      "Business hours are Monday to Friday, 09:00-18:00 UTC, excluding public holidays.",
    evidence: "Section 5 of the SLA.",
    sourceUrl: "/legal/sla",
  },
  {
    id: "support-enterprise-channel",
    category: "support",
    subject: "Enterprise support channel",
    status: "compliant",
    scope: "both",
    statement:
      "Enterprise agreements include a private support channel and a named engineering contact, with severity levels and response targets set in the order form.",
    qualifier:
      "Scope, hours, and escalation paths are whatever the order form says — not what a marketing page says.",
    evidence: "Your executed order form.",
    sourceUrl: "/enterprise/demo",
  },
  {
    id: "support-community",
    category: "support",
    subject: "Community support",
    status: "aligned",
    scope: "self-hosted",
    statement:
      "The Community Edition is supported through public GitHub issues and discussions, with no response-time commitment.",
    qualifier:
      "Maintainers answer as capacity allows. Response targets require a commercial agreement.",
    evidence: "The public issue tracker.",
    sourceUrl: "https://github.com/OneUptime/oneuptime/issues",
  },
  {
    id: "support-vulnerability-remediation",
    category: "support",
    subject: "Vulnerability remediation targets",
    status: "aligned",
    scope: "both",
    statement:
      "We triage reported vulnerabilities by severity and target remediation within 7 days for critical, 30 days for high, and 90 days for medium.",
    qualifier:
      "Internal targets, not contractual commitments. Self-hosted deployments receive the fix in a release you choose when to apply.",
    evidence: "Section 2 of the security page.",
    sourceUrl: "/legal/security",
  },

  // --------------------------------------------------------- COMPLIANCE ----
  {
    id: "compliance-soc2",
    category: "compliance",
    subject: "SOC 2 Type II",
    status: "attested",
    scope: "cloud",
    statement:
      "SOC 2 Type II report covering security, availability, and confidentiality, renewed annually.",
    qualifier:
      "SOC 2 produces an auditor's report, not a certificate. The report is shared under NDA.",
    evidence: "Full report on request from soc@oneuptime.com, under NDA.",
    sourceUrl: "/legal/soc-2",
  },
  {
    id: "compliance-soc3",
    category: "compliance",
    subject: "SOC 3",
    status: "attested",
    scope: "cloud",
    statement: "SOC 3 report, the general-use summary of the same examination.",
    qualifier: "Shareable without an NDA.",
    evidence: "Request from soc@oneuptime.com.",
    sourceUrl: "/legal/soc-3",
  },
  {
    id: "compliance-iso-27001",
    category: "compliance",
    subject: "ISO/IEC 27001",
    status: "certified",
    scope: "cloud",
    statement:
      "ISO/IEC 27001 certified information security management system.",
    qualifier:
      "Certification covers OneUptime Cloud and the organisation that builds the platform, not a customer's self-hosted deployment.",
    evidence: "Certificate of registration, including scope, on request.",
    sourceUrl: "/legal/iso-27001",
    reviewRequired: true,
    reviewNote:
      "Confirm certification body, certificate number, scope statement, and expiry before this is used in an RFP response.",
  },
  {
    id: "compliance-iso-27017",
    category: "compliance",
    subject: "ISO/IEC 27017",
    status: "certified",
    scope: "cloud",
    statement:
      "ISO/IEC 27017 cloud-services security controls, audited alongside ISO 27001.",
    qualifier: "Extends the 27001 scope; it is not a standalone certification.",
    evidence: "Certificate of registration on request.",
    sourceUrl: "/legal/iso-27017",
    reviewRequired: true,
    reviewNote: "Confirm the certificate lists 27017 in scope.",
  },
  {
    id: "compliance-iso-27018",
    category: "compliance",
    subject: "ISO/IEC 27018",
    status: "certified",
    scope: "cloud",
    statement:
      "ISO/IEC 27018 controls for protecting personally identifiable information in public clouds.",
    qualifier: "Extends the 27001 scope; it is not a standalone certification.",
    evidence: "Certificate of registration on request.",
    sourceUrl: "/legal/iso-27018",
    reviewRequired: true,
    reviewNote: "Confirm the certificate lists 27018 in scope.",
  },
  {
    id: "compliance-iso-9001",
    category: "compliance",
    subject: "ISO 9001",
    status: "certified",
    scope: "cloud",
    statement: "ISO 9001 certified quality management system.",
    qualifier:
      "Covers how we build and operate the service, not product features.",
    evidence: "Certificate on request.",
    sourceUrl: "/legal/iso-9001",
    reviewRequired: true,
    reviewNote: "Confirm certification body and current certificate validity.",
  },
  {
    id: "compliance-gdpr",
    category: "compliance",
    subject: "GDPR",
    status: "compliant",
    scope: "both",
    statement:
      "GDPR compliant as a processor, with a Data Processing Addendum, Standard Contractual Clauses, and EU data residency available.",
    qualifier:
      "GDPR has no certification scheme. The commitment is contractual, in the DPA.",
    evidence: "Executed DPA and the subprocessor list.",
    sourceUrl: "/legal/gdpr",
  },
  {
    id: "compliance-ccpa",
    category: "compliance",
    subject: "CCPA / CPRA",
    status: "compliant",
    scope: "both",
    statement:
      "CCPA and CPRA compliant, with consumer privacy rights honoured for all customers.",
    qualifier: "A statutory obligation, not a certification.",
    evidence: "Privacy policy and DPA.",
    sourceUrl: "/legal/ccpa",
  },
  {
    id: "compliance-hipaa",
    category: "compliance",
    subject: "HIPAA",
    status: "compliant",
    scope: "both",
    statement:
      "HIPAA compliant as a business associate, with a Business Associate Agreement available for covered entities.",
    qualifier:
      "HIPAA has no certification scheme, and a BAA must be executed before PHI is processed.",
    evidence: "Executed BAA.",
    sourceUrl: "/legal/hipaa",
  },
  {
    id: "compliance-pci",
    category: "compliance",
    subject: "PCI DSS",
    status: "aligned",
    scope: "cloud",
    statement:
      "Card payments are handled by PCI DSS certified payment providers. OneUptime never stores primary account numbers.",
    qualifier:
      "Our scope is limited by design: we do not process or store cardholder data ourselves.",
    evidence:
      "Payment provider attestations of compliance, and our subprocessor list.",
    sourceUrl: "/legal/pci",
    reviewRequired: true,
    reviewNote:
      "Confirm whether a SAQ has been completed and, if so, which type — the current page implies an audit report exists.",
  },
  {
    id: "compliance-csa-star",
    category: "compliance",
    subject: "CSA STAR",
    status: "aligned",
    scope: "cloud",
    statement:
      "CAIQ self-assessment completed against the Cloud Controls Matrix.",
    qualifier:
      "A self-assessment. STAR Level 2 certification would require a third-party audit.",
    evidence: "The completed CAIQ on request.",
    sourceUrl: "/legal/csa-star",
    reviewRequired: true,
    reviewNote:
      "The CSA STAR page currently says 'certified' while the trust center says CAIQ on file. Pick one and correct the other.",
  },
  {
    id: "compliance-fedramp",
    category: "compliance",
    subject: "FedRAMP",
    status: "in-progress",
    scope: "cloud",
    statement: "FedRAMP Moderate authorization is in progress.",
    qualifier:
      "Not yet authorized, and no date is promised. FedRAMP does not apply to self-hosted deployments, which fall under your own ATO.",
    evidence: "Status update from compliance@oneuptime.com.",
    sourceUrl: "/legal/fedramp",
  },
  {
    id: "compliance-gxp",
    category: "compliance",
    subject: "21 CFR Part 11, EU GMP Annex 11, GAMP 5, GxP",
    status: "aligned",
    scope: "both",
    statement:
      "Controls that support electronic records and signatures, with validation documentation and a GxP qualification package available. OneUptime is a GAMP 5 Category 4 configurable product.",
    qualifier:
      "None of these regimes certify a vendor. Validation of your system, in your environment, is yours to perform — we supply the documentation that supports it.",
    evidence:
      "Validation and qualification packages from compliance@oneuptime.com.",
    sourceUrl: "/legal/21-cfr-part-11",
    reviewRequired: true,
    reviewNote:
      "The 21 CFR Part 11 and Annex 11 pages currently say 'certified compliant'. No certification scheme exists for either; that wording must be corrected on those pages.",
  },
  {
    id: "compliance-penetration-testing",
    category: "compliance",
    subject: "Penetration testing",
    status: "attested",
    scope: "cloud",
    statement: "Independent third-party penetration testing at least annually.",
    qualifier:
      "Summary reports are available under NDA to qualifying customers.",
    evidence: "Summary report from security@oneuptime.com.",
    sourceUrl: "/legal/security",
  },
  {
    id: "compliance-accessibility",
    category: "compliance",
    subject: "Accessibility (WCAG 2.2 AA)",
    status: "aligned",
    scope: "both",
    statement:
      "A VPAT / Accessibility Conformance Report against WCAG 2.2 Level AA and EN 301 549 is published.",
    qualifier:
      "A VPAT is a self-assessment prepared to a standard template, not a third-party certification.",
    evidence: "The published VPAT.",
    sourceUrl: "/legal/vpat",
  },

  // --------------------------------------------------------- ENCRYPTION ----
  {
    id: "encryption-in-transit",
    category: "encryption",
    subject: "Encryption in transit",
    status: "attested",
    scope: "cloud",
    statement:
      "All traffic to and from OneUptime Cloud is encrypted with TLS 1.2 or higher.",
    qualifier: "In scope for our SOC 2 Type II examination.",
    evidence: "SOC 2 report and the security page.",
    sourceUrl: "/legal/security",
  },
  {
    id: "encryption-at-rest",
    category: "encryption",
    subject: "Encryption at rest",
    status: "attested",
    scope: "cloud",
    statement:
      "Customer data on OneUptime Cloud is encrypted at rest with AES-256 or equivalent on managed database and object storage.",
    qualifier: "In scope for our SOC 2 Type II examination.",
    evidence: "SOC 2 report and the security page.",
    sourceUrl: "/legal/security",
  },
  {
    id: "encryption-self-hosted",
    category: "encryption",
    subject: "Encryption on self-hosted deployments",
    status: "customer-configurable",
    scope: "self-hosted",
    statement:
      "On a self-hosted deployment you terminate TLS and configure storage encryption with your own infrastructure and keys.",
    qualifier:
      "The platform supports it; the configuration, and the keys, are yours.",
    evidence: "The Helm chart configuration reference.",
    sourceUrl: "/enterprise/self-hosted",
  },
  {
    id: "encryption-key-management",
    category: "encryption",
    subject: "Key management",
    status: "attested",
    scope: "cloud",
    statement:
      "Encryption keys for OneUptime Cloud are managed in our cloud providers' key management services, with rotation and audit logging.",
    qualifier:
      "Customer-managed keys on OneUptime Cloud are not offered as a standard feature — self-host or use a private cloud deployment if you need to hold the keys.",
    evidence: "Security page, section 3.",
    sourceUrl: "/legal/security",
  },
  {
    id: "encryption-tenant-isolation",
    category: "encryption",
    subject: "Tenant isolation",
    status: "attested",
    scope: "cloud",
    statement:
      "Customer data is logically segregated, with access enforced at the application and database layers.",
    qualifier:
      "Logical, not physical, isolation on multi-tenant cloud. A private cloud deployment gives you dedicated databases.",
    evidence: "SOC 2 report and the security page.",
    sourceUrl: "/legal/security",
  },
  {
    id: "encryption-secrets-redaction",
    category: "encryption",
    subject: "AI features and data handling",
    status: "customer-configurable",
    scope: "both",
    statement:
      "AI investigations are read-only and secrets are redacted before anything reaches a model. Self-hosted deployments can point AI features at an in-cluster model, or leave them switched off.",
    qualifier:
      "Which model provider is used, and whether AI features are enabled at all, is your choice.",
    evidence: "The Helm chart's local-AI guide.",
    sourceUrl: "/enterprise/self-hosted",
  },

  // --------------------------------------------------------- DEPLOYMENT ----
  {
    id: "deployment-self-hosted",
    category: "deployment",
    subject: "Self-hosted deployment",
    status: "customer-configurable",
    scope: "self-hosted",
    statement:
      "The full platform runs on your own Kubernetes cluster via our Helm chart, or on a single host with Docker Compose.",
    qualifier:
      "The Community Edition is the complete product under Apache 2.0; the Enterprise Edition adds hardened images and a support agreement.",
    evidence: "The public Helm chart and its installation guide.",
    sourceUrl: "/enterprise/self-hosted",
  },
  {
    id: "deployment-air-gapped",
    category: "deployment",
    subject: "Air-gapped operation",
    status: "customer-configurable",
    scope: "self-hosted",
    statement:
      "OneUptime runs with no outbound connectivity: mirror the images to your registry, disable the update check, and keep DNS internal.",
    qualifier:
      "Features that call an external service by design — hosted AI models, third-party notification transports — need an internal equivalent or must stay off.",
    evidence: "The Helm chart configuration reference.",
    sourceUrl: "/enterprise/self-hosted",
  },
  {
    id: "deployment-hardened-images",
    category: "deployment",
    subject: "Hardened images",
    status: "customer-configurable",
    scope: "self-hosted",
    statement:
      "Enterprise Edition container images ship additional security controls and are selected with a single chart value.",
    qualifier: "Enterprise Edition images require a valid license.",
    evidence: "The chart's image configuration and your license.",
    sourceUrl: "/enterprise/self-hosted",
  },
  {
    id: "deployment-data-residency",
    category: "deployment",
    subject: "Data residency",
    status: "compliant",
    scope: "both",
    statement:
      "Enterprise customers choose the region their data is stored in — AWS, Azure, GCP, or on-premises.",
    qualifier:
      "An organisation lives in a single region. Region selection is agreed in the order form and set at provisioning time.",
    evidence: "Order form and the data residency page.",
    sourceUrl: "/legal/data-residency",
  },
  {
    id: "deployment-open-source",
    category: "deployment",
    subject: "Open source",
    status: "aligned",
    scope: "both",
    statement:
      "The entire platform is Apache-2.0 licensed and developed in public on GitHub.",
    qualifier:
      "Auditable by anyone, and free to run yourself for as long as you like.",
    evidence: "The public repository and its license.",
    sourceUrl: "https://github.com/OneUptime/oneuptime",
  },

  // ---------------------------------------------------------- MIGRATION ----
  {
    id: "migration-portability",
    category: "migration",
    subject: "Data portability",
    status: "customer-configurable",
    scope: "both",
    statement:
      "Your data is exportable through the API at any time, and the self-hosted and cloud editions share one schema.",
    qualifier:
      "Moving between cloud and self-hosted is a data migration, not a re-platform.",
    evidence: "The public API reference.",
    sourceUrl: "/reference",
  },
  {
    id: "migration-assistance",
    category: "migration",
    subject: "Migration assistance",
    status: "compliant",
    scope: "both",
    statement:
      "Enterprise agreements can include migration and upgrade assistance from our engineers.",
    qualifier:
      "Scope and effort are agreed in the order form; it is not included by default on self-serve plans.",
    evidence: "Your order form.",
    sourceUrl: "/enterprise/demo",
  },
  {
    id: "migration-deletion",
    category: "migration",
    subject: "Deletion on termination",
    status: "compliant",
    scope: "cloud",
    statement:
      "On termination, customer data is deleted in line with the retention terms in the DPA.",
    qualifier: "Backups age out on their own documented cycle.",
    evidence: "The DPA.",
    sourceUrl: "/legal/dpa",
  },

  // -------------------------------------------------------------- SCALE ----
  {
    id: "scale-horizontal",
    category: "scale",
    subject: "Horizontal scale",
    status: "customer-configurable",
    scope: "both",
    statement:
      "Telemetry storage scales horizontally through ClickHouse sharding and replication, with a dedicated writer tier that keeps insert concurrency bounded as the worker fleet autoscales.",
    qualifier:
      "Throughput on a self-hosted deployment is a function of the cluster you give it.",
    evidence: "The production readiness checklist in the chart docs.",
    sourceUrl: "/enterprise/self-hosted",
  },
  {
    id: "scale-monitor-limits",
    category: "scale",
    subject: "Monitor and user limits",
    status: "aligned",
    scope: "both",
    statement:
      "There are no product-imposed caps on monitors, team members, alerts, or API calls.",
    qualifier:
      "On OneUptime Cloud, usage-based pricing applies. On a self-hosted deployment, your infrastructure is the limit.",
    evidence: "The pricing page.",
    sourceUrl: "/pricing",
  },
  {
    id: "scale-probe-locations",
    category: "scale",
    subject: "Monitoring vantage points",
    status: "customer-configurable",
    scope: "both",
    statement:
      "Probes can be deployed in any region, network, or cluster you choose, so checks run from where your users are.",
    qualifier:
      "Self-hosted deployments run the probes they deploy. Counts of hosted probe locations must not be published without an owner who maintains the number.",
    evidence: "The chart's probe configuration.",
    sourceUrl: "/enterprise/self-hosted",
  },

  // ---------------------------------------------------------- DISCOUNTS ----
  {
    id: "discount-annual",
    category: "discounts",
    subject: "Annual billing",
    status: "compliant",
    scope: "cloud",
    statement:
      "Annual billing is discounted against monthly billing, at the annual price published for each plan.",
    qualifier:
      "Do not publish a single percentage — the discount differs per plan, and a headline figure that does not match the price table is the fastest way to lose a buyer's trust.",
    evidence: "The plan table on the pricing page.",
    sourceUrl: "/pricing",
  },
  {
    id: "discount-volume",
    category: "discounts",
    subject: "Volume discounts",
    status: "aligned",
    scope: "cloud",
    statement:
      "Volume discounts are available on high monitor counts, high telemetry ingest, and extended retention.",
    qualifier:
      "Quoted case by case by sales. No specific percentage is published.",
    evidence: "A written quote from sales@oneuptime.com.",
    sourceUrl: "/pricing",
  },
  {
    id: "discount-open-source",
    category: "discounts",
    subject: "Non-profit, education, and open-source",
    status: "aligned",
    scope: "cloud",
    statement:
      "There is no non-profit, education, or open-source discount on OneUptime Cloud. The software itself is free to self-host at any scale instead.",
    qualifier:
      "Everyone on the cloud service pays the same published price. Say this plainly rather than implying a programme we do not run.",
    evidence: "The pricing page FAQ and the Apache 2.0 license.",
    sourceUrl: "/pricing",
  },
  {
    id: "discount-self-host",
    category: "discounts",
    subject: "Self-hosting cost",
    status: "aligned",
    scope: "self-hosted",
    statement:
      "The Community Edition is free to run yourself, with no license fee at any scale.",
    qualifier:
      "You still pay for your own infrastructure, and support requires a commercial agreement.",
    evidence: "The Apache 2.0 license.",
    sourceUrl: "https://github.com/OneUptime/oneuptime",
  },

  // ----------------------------------------------------------- CONTRACT ----
  {
    id: "contract-order-form",
    category: "contract",
    subject: "Enterprise terms",
    status: "compliant",
    scope: "both",
    statement:
      "Enterprise commitments — uptime targets, support hours, data residency, and security obligations — are set in a signed order form.",
    qualifier:
      "Where a marketing page and an order form disagree, the order form governs.",
    evidence: "Your executed order form.",
    sourceUrl: "/legal/terms",
  },
  {
    id: "contract-invoicing",
    category: "contract",
    subject: "Invoicing terms",
    status: "aligned",
    scope: "cloud",
    statement:
      "Annual invoicing and purchase-order workflows are available on enterprise agreements.",
    qualifier:
      "Payment terms are agreed per contract. No specific net terms are promised on a marketing page.",
    evidence: "Your order form.",
    sourceUrl: "/enterprise/demo",
  },
  {
    id: "contract-dpa-baa",
    category: "contract",
    subject: "DPA and BAA",
    status: "compliant",
    scope: "both",
    statement:
      "A Data Processing Addendum is available for all customers, and a Business Associate Agreement for covered entities.",
    qualifier:
      "Both must be executed before the corresponding data is processed.",
    evidence: "The published DPA and a countersigned BAA.",
    sourceUrl: "/legal/dpa",
  },
  {
    id: "contract-security-review",
    category: "contract",
    subject: "Security review and questionnaires",
    status: "compliant",
    scope: "both",
    statement:
      "We complete security questionnaires and share evidence — reports, policies, and control documentation — under NDA.",
    qualifier: "Turnaround is agreed with your procurement team.",
    evidence: "Request from security@oneuptime.com.",
    sourceUrl: "/trust",
  },
  {
    id: "contract-deprecation",
    category: "contract",
    subject: "Version support window",
    status: "compliant",
    scope: "self-hosted",
    statement:
      "The latest three major versions are fully supported, and older versions receive security fixes for a further 12 months.",
    qualifier:
      "Support cannot help with a version that has left the supported window.",
    evidence: "The deprecation policy.",
    sourceUrl: "/legal/deprecation-policy",
  },
];

/*
 * Language that used to appear on the site and must not come back. The
 * governance test in Tests/ClaimsGovernance.test.ts scans Home/Views for each
 * pattern and fails with `reason` and `replacement` so whoever hits it knows
 * what to write instead.
 */
export interface RetiredClaim {
  pattern: RegExp;
  // A human-readable version of the pattern, for test output.
  example: string;
  reason: string;
  replacement: string;
  claimId: string;
}

export const RetiredClaims: Array<RetiredClaim> = [
  {
    pattern: /99\.99\s*%\s*(?:uptime\s*)?SLA/i,
    example: "99.99% uptime SLA",
    reason:
      "The SLA commits to 99.9% on paid plans and 99.95% on Enterprise. 99.99% is not a number we are contractually on the hook for.",
    replacement:
      "99.95% uptime target on Enterprise plans (99.9% on paid self-serve plans).",
    claimId: "sla-cloud-enterprise",
  },
  {
    pattern: /99\.00\s*%\s*SLA/i,
    example: "99.00% SLA",
    reason:
      "Free plans carry no uptime commitment at all, so publishing a number for them invents one.",
    replacement: "Best effort, no uptime commitment.",
    claimId: "sla-free-plans",
  },
  {
    pattern: /financial(?:ly)?[- ]backed\s+(?:reliability\s+)?guarantee/i,
    example: "financial-backed reliability guarantee",
    reason:
      "Service credits are capped at a percentage of monthly fees and are the sole remedy. 'Financially backed guarantee' overstates that.",
    replacement:
      "Service credits of up to 50% of monthly fees if we miss the target.",
    claimId: "sla-service-credits",
  },
  {
    pattern:
      /guarantee[ds]?\s+(?:\d+[- ])?(?:response|first[- ]response)\s*times?/i,
    example: "guaranteed response times",
    reason:
      "Section 5 of the SLA states response times are targets, not guaranteed credits.",
    replacement: "One-hour first-response target for P1 issues, 24/7.",
    claimId: "support-p1",
  },
  {
    pattern: /guaranteed\s+1-hour\s+response/i,
    example: "guaranteed 1-hour response time",
    reason: "Same as above — a target, not a guarantee.",
    replacement: "One-hour P1 first-response target.",
    claimId: "support-p1",
  },
  {
    pattern: /15\s*minutes?\s+for\s+critical/i,
    example: "15 minutes for critical issues",
    reason:
      "No document commits to 15 minutes. The published P1 target is one hour.",
    replacement: "One-hour first-response target for P1 issues, 24/7.",
    claimId: "support-p1",
  },
  {
    pattern: /99\.99%\s*delivery\s*guarantee/i,
    example: "99.99% delivery guarantee",
    reason:
      "Alert delivery depends on third-party carriers and providers. There is no measurement behind this number and no remedy attached to it.",
    replacement:
      "Redundant delivery across email, SMS, voice, push, and chat, with escalation if an alert is not acknowledged.",
    claimId: "sla-service-credits",
  },
  {
    pattern: /17\s*%\s*discount/i,
    example: "Annual plans have a 17% discount",
    reason:
      "The published annual prices work out to different discounts per plan, none of them 17%. A number that does not match the price table on the same page reads as carelessness at best.",
    replacement:
      "Annual billing is discounted; the annual price for each plan is shown in the table above.",
    claimId: "discount-annual",
  },
  {
    pattern: /certified\s+compliant\s+with/i,
    example: "certified compliant with 21 CFR Part 11",
    reason:
      "21 CFR Part 11, Annex 11, and GAMP 5 have no vendor certification scheme. The customer validates their own system.",
    replacement:
      "Controls that support 21 CFR Part 11, with validation documentation available. Validation of your system is yours to perform.",
    claimId: "compliance-gxp",
  },
];

export type GetClaimsByCategoryFunction = (
  category: ClaimCategoryKey,
) => Array<Claim>;

export const getClaimsByCategory: GetClaimsByCategoryFunction = (
  category: ClaimCategoryKey,
): Array<Claim> => {
  return Claims.filter((claim: Claim) => {
    return claim.category === category;
  });
};

export type GetClaimFunction = (id: string) => Claim | null;

export const getClaim: GetClaimFunction = (id: string): Claim | null => {
  return (
    Claims.find((claim: Claim) => {
      return claim.id === id;
    }) || null
  );
};

export type GetClaimStatusFunction = (
  key: ClaimStatusKey,
) => ClaimStatusDefinition;

export const getClaimStatus: GetClaimStatusFunction = (
  key: ClaimStatusKey,
): ClaimStatusDefinition => {
  const status: ClaimStatusDefinition | undefined = ClaimStatuses.find(
    (claimStatus: ClaimStatusDefinition) => {
      return claimStatus.key === key;
    },
  );

  if (!status) {
    throw new Error(`Unknown claim status: ${key}`);
  }

  return status;
};

export interface ClaimCategoryGroup {
  category: ClaimCategory;
  claims: Array<Claim>;
}

export type GetClaimsMatrixFunction = () => Array<ClaimCategoryGroup>;

// Categories in publication order, each with its claims. Drives the trust center.
export const getClaimsMatrix: GetClaimsMatrixFunction =
  (): Array<ClaimCategoryGroup> => {
    return ClaimCategories.map((category: ClaimCategory) => {
      return {
        category,
        claims: getClaimsByCategory(category.key),
      };
    });
  };

export type GetClaimsNeedingReviewFunction = () => Array<Claim>;

// The legal / security review queue.
export const getClaimsNeedingReview: GetClaimsNeedingReviewFunction =
  (): Array<Claim> => {
    return Claims.filter((claim: Claim) => {
      return claim.reviewRequired === true;
    });
  };

export default Claims;
