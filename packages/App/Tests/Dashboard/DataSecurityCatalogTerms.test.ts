import { describe, expect, test } from "@jest/globals";
import { DATA_SECURITY_CATALOG_TERMS } from "../../FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityCatalogTerms";
import {
  COMPLIANCE_FRAMEWORK_INFO,
  ComplianceFrameworkInfo,
} from "Common/Types/DataSecurity/ComplianceFramework";
import {
  COMPLIANCE_REQUIREMENTS,
  ComplianceRequirementInfo,
  ComplianceRequirementStatus,
} from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory, {
  DATA_CATEGORY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataCategory";
import DataConfidence from "Common/Types/DataSecurity/DataConfidence";
import {
  CheckRemediation,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckGroup,
  DataSecurityCheckInfo,
  DataSecurityCheckStatus,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity, {
  DATA_SENSITIVITY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import DataStoreEnvironment from "Common/Types/DataSecurity/DataStoreEnvironment";
import {
  DataStoreFamily,
  DataStoreKind,
} from "Common/Types/DataSecurity/DataStoreKind";
import {
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DataStoreExposure,
} from "Common/Types/DataSecurity/DataStorePosture";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "Common/Types/DataSecurity/DataTypeCatalog";
import { DataStoreLocationKind } from "Common/Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  DataSecurityResponseAction,
  describeDataSecurityResponseAction,
  getDataSecurityResponseActions,
} from "Common/Types/DataSecurity/DataSecurityResponseAction";

/*
 * The Data Security pages draw their catalogs as written and translate each
 * line when they draw it; the extractor only finds literals, so each line
 * must be in DATA_SECURITY_CATALOG_TERMS. A data type, check, framework or
 * requirement added without it would show in English in every language.
 */

const registered: Set<string> = new Set(DATA_SECURITY_CATALOG_TERMS);

function expectRegistered(what: string, values: Array<string>): void {
  const missing: Array<string> = values.filter((value: string): boolean => {
    return Boolean(value && value.trim()) && !registered.has(value);
  });

  // Each one listed here is missing: add it to DataSecurityCatalogTerms.ts.
  expect([what, missing]).toEqual([what, []]);
}

describe("Data Security's catalog terms", () => {
  test("every built-in data type's name and description", () => {
    expectRegistered(
      "data types",
      DATA_TYPE_CATALOG.flatMap((info: DataTypeInfo): Array<string> => {
        return [info.name, info.description];
      }),
    );
  });

  test("every check's title, description, why it matters, and every step of how to fix it", () => {
    expectRegistered(
      "checks",
      DATA_SECURITY_CHECKS.flatMap(
        (check: DataSecurityCheckInfo): Array<string> => {
          return [check.title, check.description, check.whyItMatters];
        },
      ),
    );
    expectRegistered(
      "remediation steps",
      DATA_SECURITY_CHECKS.flatMap(
        (check: DataSecurityCheckInfo): Array<string> => {
          return Object.values(check.remediation).flatMap(
            (remediation: CheckRemediation | undefined): Array<string> => {
              return remediation ? [...remediation.steps] : [];
            },
          );
        },
      ),
    );
  });

  test("every framework's name and scope, and every requirement's title", () => {
    expectRegistered(
      "frameworks",
      Object.values(COMPLIANCE_FRAMEWORK_INFO).flatMap(
        (info: ComplianceFrameworkInfo): Array<string> => {
          return [info.fullName, info.scope];
        },
      ),
    );
    expectRegistered(
      "requirements",
      COMPLIANCE_REQUIREMENTS.map(
        (requirement: ComplianceRequirementInfo): string => {
          return requirement.title;
        },
      ),
    );
  });

  test("every value a pill, a filter or a column shows, and what each level means", () => {
    expectRegistered("values", [
      ...Object.values(DataSensitivity),
      ...Object.values(DATA_SENSITIVITY_DESCRIPTION),
      ...Object.values(DataCategory),
      ...Object.values(DATA_CATEGORY_DESCRIPTION),
      ...Object.values(DataConfidence),
      ...Object.values(DataStoreExposure),
      ...Object.values(DATA_STORE_EXPOSURE_DESCRIPTION),
      ...Object.values(DataSecurityIssueStatus),
      ...Object.values(DataStoreKind),
      ...Object.values(DataStoreFamily),
      ...Object.values(DataStoreEnvironment),
      ...Object.values(DataStorePrincipalType),
      ...Object.values(DataStoreAccessLevel),
      ...Object.values(DataStoreLocationKind),
      ...Object.values(DataSecurityCheckGroup),
      ...Object.values(DataSecurityCheckStatus),
      ...Object.values(ComplianceRequirementStatus),
    ]);
  });

  test("what every response action changes, on every kind of store it acts on", () => {
    const sentences: Array<string> = Object.values(DataStoreKind).flatMap(
      (kind: DataStoreKind): Array<string> => {
        return getDataSecurityResponseActions(kind).map(
          (action: DataSecurityResponseAction): string => {
            return describeDataSecurityResponseAction(action, kind);
          },
        );
      },
    );

    // Five sentences: three clouds' buckets, a snapshot, and a database's snapshots.
    expect(new Set(sentences).size).toBe(5);
    expect(ALL_DATA_SECURITY_RESPONSE_ACTIONS).toHaveLength(2);
    expectRegistered("response actions", sentences);
  });

  test("each term is listed once", () => {
    expect(registered.size).toBe(DATA_SECURITY_CATALOG_TERMS.length);
  });
});
