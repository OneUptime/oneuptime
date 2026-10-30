/*
 * THE FRAMEWORKS DATA SECURITY REPORTS ON.
 *
 * Each data type says which frameworks care about it (DataTypeCatalog.ts),
 * and each check says which requirements it is evidence for
 * (DataSecurityCheckCatalog.ts), so a framework's scope - the stores it
 * applies to - and its score both come from what the scans found. The
 * values are the names people say, so they are what the UI prints.
 */
enum ComplianceFramework {
  GDPR = "GDPR",
  CCPA = "CCPA",
  HIPAA = "HIPAA",
  PCIDSS = "PCI DSS",
  SOC2 = "SOC 2",
  ISO27001 = "ISO 27001",
  NISTCSF = "NIST CSF",
  LGPD = "LGPD",
  DPDP = "DPDP",
}

export default ComplianceFramework;

export const ALL_COMPLIANCE_FRAMEWORKS: ReadonlyArray<ComplianceFramework> = [
  ComplianceFramework.GDPR,
  ComplianceFramework.CCPA,
  ComplianceFramework.HIPAA,
  ComplianceFramework.PCIDSS,
  ComplianceFramework.SOC2,
  ComplianceFramework.ISO27001,
  ComplianceFramework.NISTCSF,
  ComplianceFramework.LGPD,
  ComplianceFramework.DPDP,
];

export interface ComplianceFrameworkInfo {
  framework: ComplianceFramework;
  // The full name, for the framework's page.
  fullName: string;
  // One line on which stores it applies to.
  scope: string;
  /*
   * Whether it applies to every store (a security framework) or only to the
   * stores holding data it protects (a privacy or payment one).
   */
  appliesToEveryStore: boolean;
}

export const COMPLIANCE_FRAMEWORK_INFO: Readonly<
  Record<ComplianceFramework, ComplianceFrameworkInfo>
> = {
  [ComplianceFramework.GDPR]: {
    framework: ComplianceFramework.GDPR,
    fullName: "EU General Data Protection Regulation",
    scope: "Stores that hold personal data.",
    appliesToEveryStore: false,
  },
  [ComplianceFramework.CCPA]: {
    framework: ComplianceFramework.CCPA,
    fullName: "California Consumer Privacy Act, as amended by the CPRA",
    scope: "Stores that hold personal information.",
    appliesToEveryStore: false,
  },
  [ComplianceFramework.HIPAA]: {
    framework: ComplianceFramework.HIPAA,
    fullName: "HIPAA Security Rule",
    scope: "Stores that hold health data.",
    appliesToEveryStore: false,
  },
  [ComplianceFramework.PCIDSS]: {
    framework: ComplianceFramework.PCIDSS,
    fullName: "PCI DSS v4.0",
    scope: "Stores where card numbers were found.",
    appliesToEveryStore: false,
  },
  [ComplianceFramework.SOC2]: {
    framework: ComplianceFramework.SOC2,
    fullName: "SOC 2 Trust Services Criteria",
    scope: "Every data store.",
    appliesToEveryStore: true,
  },
  [ComplianceFramework.ISO27001]: {
    framework: ComplianceFramework.ISO27001,
    fullName: "ISO/IEC 27001:2022",
    scope: "Every data store.",
    appliesToEveryStore: true,
  },
  [ComplianceFramework.NISTCSF]: {
    framework: ComplianceFramework.NISTCSF,
    fullName: "NIST Cybersecurity Framework 2.0",
    scope: "Every data store.",
    appliesToEveryStore: true,
  },
  [ComplianceFramework.LGPD]: {
    framework: ComplianceFramework.LGPD,
    fullName: "Brazil's General Data Protection Law",
    scope: "Stores that hold personal data of people in Brazil.",
    appliesToEveryStore: false,
  },
  [ComplianceFramework.DPDP]: {
    framework: ComplianceFramework.DPDP,
    fullName: "India's Digital Personal Data Protection Act, 2023",
    scope: "Stores that hold personal data of people in India.",
    appliesToEveryStore: false,
  },
};

export function isComplianceFramework(
  value: unknown,
): value is ComplianceFramework {
  return (
    typeof value === "string" &&
    (ALL_COMPLIANCE_FRAMEWORKS as ReadonlyArray<string>).includes(value)
  );
}
