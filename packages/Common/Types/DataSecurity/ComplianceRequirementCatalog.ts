import ComplianceFramework, {
  COMPLIANCE_FRAMEWORK_INFO,
} from "./ComplianceFramework";
import {
  DATA_SECURITY_CHECKS,
  DataSecurityCheckInfo,
  FrameworkRequirementRef,
} from "./DataSecurityCheckCatalog";
import { DataTypeInfo, getBuiltInDataType } from "./DataTypeCatalog";

/*
 * THE FRAMEWORK REQUIREMENTS DATA SECURITY GIVES EVIDENCE FOR, AND HOW EACH
 * FRAMEWORK SCORES.
 *
 * A requirement passes when no open issue of the checks mapped to it sits
 * on a store in the framework's scope, fails when one does, and is not
 * evaluated when no store is in scope. A framework's score is the share of
 * its evaluated requirements that pass. The scope comes from the data: PCI
 * DSS covers stores where card numbers were found, HIPAA stores with health
 * data, the security frameworks every store (ComplianceFramework.ts).
 *
 * Two requirements are met by Data Security itself - an inventory of data
 * and its classification - and pass once every in-scope store has been
 * scanned for content or its configuration read.
 */

export interface ComplianceRequirementInfo {
  framework: ComplianceFramework;
  requirement: string;
  title: string;
  // Met by running Data Security itself rather than by a check.
  isMetByInventory?: boolean | undefined;
}

function req(
  framework: ComplianceFramework,
  requirement: string,
  title: string,
  isMetByInventory?: boolean,
): ComplianceRequirementInfo {
  return { framework, requirement, title, isMetByInventory };
}

const F: typeof ComplianceFramework = ComplianceFramework;

export const COMPLIANCE_REQUIREMENTS: ReadonlyArray<ComplianceRequirementInfo> =
  [
    req(F.GDPR, "Art. 5(1)(c)", "Data minimisation"),
    req(F.GDPR, "Art. 5(1)(e)", "Storage limitation"),
    req(F.GDPR, "Art. 25", "Data protection by design and by default"),
    req(F.GDPR, "Art. 28", "Processors"),
    req(F.GDPR, "Art. 30", "Records of processing activities", true),
    req(F.GDPR, "Art. 32", "Security of processing"),
    req(F.GDPR, "Arts. 44-49", "Transfers to third countries"),
    req(F.CCPA, "1798.100(c)", "Collection limited to what is necessary"),
    req(F.CCPA, "1798.150", "Reasonable security procedures"),
    req(F.HIPAA, "164.308(a)(7)", "Contingency plan"),
    req(F.HIPAA, "164.312(a)(1)", "Access control"),
    req(F.HIPAA, "164.312(a)(2)(iv)", "Encryption and decryption"),
    req(F.HIPAA, "164.312(b)", "Audit controls"),
    req(F.HIPAA, "164.312(e)(1)", "Transmission security"),
    req(F.PCIDSS, "3.3.1", "Sensitive authentication data is not kept after authorisation"),
    req(F.PCIDSS, "3.4.1", "Card numbers are masked when displayed"),
    req(F.PCIDSS, "3.5.1", "Card numbers are unreadable wherever they are stored"),
    req(F.PCIDSS, "4.2.1", "Strong cryptography protects card data in transit"),
    req(F.PCIDSS, "7.2", "Access is defined and assigned by need"),
    req(F.PCIDSS, "8.3.2", "Authentication factors are unreadable when stored"),
    req(F.PCIDSS, "10.2", "Audit logs record access to card data"),
    req(F.SOC2, "A1.2", "Backup and recovery"),
    req(F.SOC2, "CC6.1", "Logical access security"),
    req(F.SOC2, "CC6.7", "Transmission of information"),
    req(F.SOC2, "CC7.2", "Monitoring of system components"),
    req(F.ISO27001, "A.5.9", "Inventory of information and other associated assets"),
    req(F.ISO27001, "A.5.12", "Classification of information", true),
    req(F.ISO27001, "A.5.15", "Access control"),
    req(F.ISO27001, "A.5.34", "Privacy and protection of PII"),
    req(F.ISO27001, "A.8.11", "Data masking"),
    req(F.ISO27001, "A.8.12", "Data leakage prevention"),
    req(F.ISO27001, "A.8.13", "Information backup"),
    req(F.ISO27001, "A.8.15", "Logging"),
    req(F.ISO27001, "A.8.24", "Use of cryptography"),
    req(F.NISTCSF, "ID.AM-07", "Inventories of data and metadata are maintained"),
    req(F.NISTCSF, "PR.AA-05", "Access permissions are managed"),
    req(F.NISTCSF, "PR.DS-01", "Data at rest is protected"),
    req(F.NISTCSF, "PR.DS-02", "Data in transit is protected"),
    req(F.NISTCSF, "PR.DS-11", "Backups of data are kept and tested"),
    req(F.NISTCSF, "DE.CM-09", "Data and its use are monitored"),
    req(F.LGPD, "Art. 6", "Necessity and purpose limitation"),
    req(F.LGPD, "Art. 33", "International transfer of data"),
    req(F.LGPD, "Art. 46", "Security measures"),
    req(F.DPDP, "Sec. 8(5)", "Reasonable security safeguards"),
    req(F.DPDP, "Sec. 8(7)", "Erasure when the purpose is served"),
    req(F.DPDP, "Sec. 16", "Transfer outside India"),
  ];

export function getRequirementsOf(
  framework: ComplianceFramework,
): Array<ComplianceRequirementInfo> {
  return COMPLIANCE_REQUIREMENTS.filter((info: ComplianceRequirementInfo) => {
    return info.framework === framework;
  });
}

// The checks that are evidence for a requirement.
export function getChecksForRequirement(
  framework: ComplianceFramework,
  requirement: string,
): Array<DataSecurityCheckInfo> {
  return DATA_SECURITY_CHECKS.filter((check: DataSecurityCheckInfo) => {
    return check.requirements.some((ref: FrameworkRequirementRef) => {
      return ref.framework === framework && ref.requirement === requirement;
    });
  });
}

export interface ComplianceStoreInput {
  id: string;
  dataTypeIds: ReadonlyArray<string>;
  // Countries whose people's data the store holds (from country-bound types).
  subjectCountries?: ReadonlyArray<string> | undefined;
  // Whether its content was scanned or its configuration read.
  isEvaluated: boolean;
}

/*
 * Whether a store is in a framework's scope: every store for a security
 * framework; for the others, a store holding a data type that framework
 * protects - or, for a country's own law, data of people in that country.
 */
export function isStoreInFrameworkScope(
  framework: ComplianceFramework,
  store: ComplianceStoreInput,
): boolean {
  if (COMPLIANCE_FRAMEWORK_INFO[framework].appliesToEveryStore) {
    return true;
  }

  if (framework === ComplianceFramework.LGPD) {
    return (store.subjectCountries || []).includes("BR");
  }

  if (framework === ComplianceFramework.DPDP) {
    return (store.subjectCountries || []).includes("IN");
  }

  return store.dataTypeIds.some((dataTypeId: string) => {
    const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    return Boolean(info?.frameworks.includes(framework));
  });
}

export enum ComplianceRequirementStatus {
  Passing = "Passing",
  Failing = "Failing",
  NotEvaluated = "Not evaluated",
}

export interface ComplianceIssueInput {
  storeId: string;
  checkId: string;
}

export interface ComplianceRequirementResult {
  requirement: string;
  title: string;
  status: ComplianceRequirementStatus;
  checkIds: Array<string>;
  failingIssueCount: number;
}

export interface ComplianceFrameworkResult {
  framework: ComplianceFramework;
  // 0 to 100, or null when nothing could be evaluated.
  score: number | null;
  storesInScope: number;
  requirements: Array<ComplianceRequirementResult>;
}

export function scoreComplianceFramework(
  framework: ComplianceFramework,
  stores: ReadonlyArray<ComplianceStoreInput>,
  openIssues: ReadonlyArray<ComplianceIssueInput>,
): ComplianceFrameworkResult {
  const inScope: Array<ComplianceStoreInput> = stores.filter(
    (store: ComplianceStoreInput) => {
      return isStoreInFrameworkScope(framework, store);
    },
  );
  const inScopeIds: Set<string> = new Set(
    inScope.map((store: ComplianceStoreInput) => {
      return store.id;
    }),
  );
  const evaluated: boolean = inScope.some((store: ComplianceStoreInput) => {
    return store.isEvaluated;
  });

  const requirements: Array<ComplianceRequirementResult> = getRequirementsOf(
    framework,
  ).map((info: ComplianceRequirementInfo) => {
    const checkIds: Array<string> = getChecksForRequirement(
      framework,
      info.requirement,
    ).map((check: DataSecurityCheckInfo) => {
      return check.id;
    });

    if (!evaluated) {
      return {
        requirement: info.requirement,
        title: info.title,
        status: ComplianceRequirementStatus.NotEvaluated,
        checkIds,
        failingIssueCount: 0,
      };
    }

    if (info.isMetByInventory) {
      const allEvaluated: boolean = inScope.every(
        (store: ComplianceStoreInput) => {
          return store.isEvaluated;
        },
      );

      return {
        requirement: info.requirement,
        title: info.title,
        status: allEvaluated
          ? ComplianceRequirementStatus.Passing
          : ComplianceRequirementStatus.Failing,
        checkIds,
        failingIssueCount: 0,
      };
    }

    const failing: number = openIssues.filter((issue: ComplianceIssueInput) => {
      return inScopeIds.has(issue.storeId) && checkIds.includes(issue.checkId);
    }).length;

    return {
      requirement: info.requirement,
      title: info.title,
      status:
        checkIds.length === 0
          ? ComplianceRequirementStatus.NotEvaluated
          : failing > 0
            ? ComplianceRequirementStatus.Failing
            : ComplianceRequirementStatus.Passing,
      checkIds,
      failingIssueCount: failing,
    };
  });

  const scored: Array<ComplianceRequirementResult> = requirements.filter(
    (result: ComplianceRequirementResult) => {
      return result.status !== ComplianceRequirementStatus.NotEvaluated;
    },
  );
  const passing: number = scored.filter(
    (result: ComplianceRequirementResult) => {
      return result.status === ComplianceRequirementStatus.Passing;
    },
  ).length;

  return {
    framework,
    score:
      scored.length === 0 ? null : Math.round((passing / scored.length) * 100),
    storesInScope: inScope.length,
    requirements,
  };
}
