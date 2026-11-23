import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceRequirementResult,
  ComplianceScopeExclusions,
  getChecksForRequirement,
  isStoreInFrameworkScope,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  ComplianceScopeSetting,
  ComplianceScopeStore,
  getComplianceScopeExclusions,
} from "../../../Types/DataSecurity/ComplianceScope";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceTurnedOff,
  DataSecurityEvidenceIssue,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataSecurityCheckInfo } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { isDeclaredDataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import {
  AiEvidenceRequirement,
  AiIssueRecord,
  AiStoreRecord,
} from "../AI/DataSecurity/DataSecurityAiInput";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ResourceDataSecurity, { ScopedStore } from "./ResourceDataSecurity";

/*
 * WHAT A FRAMEWORK'S AUDIT EVIDENCE IS WORKED OUT FROM, BY PLAIN CODE
 * (#10375).
 *
 * For each of the framework's requirements, over the period a person
 * picked: the stores in its scope, as the framework's score scopes them -
 * what each store holds, and what the resource it is on turned off
 * (ResourceDataSecurity, ComplianceScope); the checks that are evidence for
 * it, and which fail; its issues opened and fixed in the period, and how
 * fast; its accepted risks with their reasons and expiry; and the
 * resources that turned it off, with theirs (named as the reader may read
 * them). Then the issue history the evidence cites.
 *
 * The counts are the project's, as its score is; the stores named are the
 * ones the reader may read - a role held to some labels names those alone.
 * Read as OneUptime, the project scoped; nothing here asks OneUptime AI.
 */

// The most of a project's stores and issues one framework's evidence reads.
const MAX_STORES: number = 10000;
const MAX_ISSUES: number = 20000;
// The most issues of the history an export lists, the latest first.
export const MAX_EVIDENCE_HISTORY: number = 500;

const HOUR_IN_MS: number = 60 * 60 * 1000;

export interface AuditEvidenceRead {
  framework: DataSecurityComplianceFramework;
  requirements: Array<AiEvidenceRequirement>;
  issueHistory: Array<DataSecurityEvidenceIssue>;
  // The stores in the framework's scope the reader may read.
  readableStoreIds: Array<string>;
}

// The middle value of a list, or undefined for none.
export function median(values: ReadonlyArray<number>): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  const middle: number = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function timeOf(value: Date | string | null | undefined): number {
  const time: number = value ? new Date(value).getTime() : NaN;

  return Number.isFinite(time) ? time : NaN;
}

export interface EvidenceIssueInput {
  id: string;
  title: string;
  checkId: string;
  severity: string;
  status: string;
  storeId: string;
  firstDetectedAt?: Date | string | undefined;
  resolvedAt?: Date | string | undefined;
  acceptedReason?: string | undefined;
  acceptedUntil?: Date | string | undefined;
}

/*
 * One requirement's evidence, by plain code from the stores it covers and
 * their issues of its checks: pure, so a test can hold every number.
 */
export function buildRequirementEvidence(data: {
  requirement: ComplianceRequirementResult;
  checks: ReadonlyArray<DataSecurityCheckInfo>;
  stores: ReadonlyArray<{ id: string; name: string }>;
  // The stores the reader may read, which alone are named.
  readable: ReadonlySet<string>;
  issues: ReadonlyArray<EvidenceIssueInput>;
  turnedOff: ReadonlyArray<DataSecurityComplianceTurnedOff>;
  since: Date;
}): AiEvidenceRequirement {
  const covered: Set<string> = new Set(
    data.stores.map((store: { id: string }): string => {
      return store.id.toLowerCase();
    }),
  );
  const checkIds: Set<string> = new Set(
    data.checks.map((check: DataSecurityCheckInfo): string => {
      return check.id;
    }),
  );
  const issues: Array<EvidenceIssueInput> = data.issues.filter(
    (issue: EvidenceIssueInput): boolean => {
      return covered.has(issue.storeId.toLowerCase()) && checkIds.has(issue.checkId);
    },
  );
  const open: Array<EvidenceIssueInput> = issues.filter(
    (issue: EvidenceIssueInput): boolean => {
      return issue.status === DataSecurityIssueStatus.Open;
    },
  );
  const since: number = data.since.getTime();
  const opened: Array<EvidenceIssueInput> = issues.filter(
    (issue: EvidenceIssueInput): boolean => {
      return timeOf(issue.firstDetectedAt) >= since;
    },
  );
  const fixed: Array<EvidenceIssueInput> = issues.filter(
    (issue: EvidenceIssueInput): boolean => {
      return (
        issue.status === DataSecurityIssueStatus.Resolved &&
        timeOf(issue.resolvedAt) >= since
      );
    },
  );
  const hoursToFix: Array<number> = fixed
    .map((issue: EvidenceIssueInput): number => {
      return (
        (timeOf(issue.resolvedAt) - timeOf(issue.firstDetectedAt)) / HOUR_IN_MS
      );
    })
    .filter((hours: number): boolean => {
      return Number.isFinite(hours) && hours >= 0;
    });
  const failing: Set<string> = new Set(
    open.map((issue: EvidenceIssueInput): string => {
      return issue.checkId;
    }),
  );
  const names: Map<string, string> = new Map(
    data.stores.map((store: { id: string; name: string }): [string, string] => {
      return [store.id.toLowerCase(), store.name];
    }),
  );

  return {
    requirement: data.requirement.requirement,
    title: data.requirement.title,
    status: data.requirement.status,
    stores: data.stores
      .filter((store: { id: string }): boolean => {
        return data.readable.has(store.id.toLowerCase());
      })
      .map((store: { id: string; name: string }): AiStoreRecord => {
        return { _id: store.id, name: store.name };
      }),
    checks: data.checks.length,
    failingChecks: data.checks
      .filter((check: DataSecurityCheckInfo): boolean => {
        return failing.has(check.id);
      })
      .map((check: DataSecurityCheckInfo): string => {
        return check.title;
      }),
    failingStores: new Set(
      open.map((issue: EvidenceIssueInput): string => {
        return issue.storeId.toLowerCase();
      }),
    ).size,
    openIssues: open.length,
    opened: opened.length,
    fixed: fixed.length,
    stillOpen: open.length,
    medianHoursToFix: median(hoursToFix),
    acceptedRisks: issues
      .filter((issue: EvidenceIssueInput): boolean => {
        return (
          issue.status === DataSecurityIssueStatus.Accepted &&
          data.readable.has(issue.storeId.toLowerCase())
        );
      })
      .map((issue: EvidenceIssueInput) => {
        return {
          issue: {
            _id: issue.id,
            title: issue.title,
            acceptedReason: issue.acceptedReason,
            acceptedUntil: issue.acceptedUntil
              ? new Date(issue.acceptedUntil)
              : undefined,
          } as AiIssueRecord,
          storeName: names.get(issue.storeId.toLowerCase()) || "",
        };
      }),
    turnedOff: data.turnedOff
      .filter((entry: DataSecurityComplianceTurnedOff): boolean => {
        return (
          entry.requirement === null ||
          entry.requirement === data.requirement.requirement
        );
      })
      .map((entry: DataSecurityComplianceTurnedOff) => {
        return {
          id: entry.id,
          resourceName: entry.resource.name || "",
          resourceKind: entry.resource.kind,
          reason: entry.note,
          isWholeFramework: entry.requirement === null,
        };
      }),
  };
}

// The issues of the history an export cites: opened or fixed in the period, the latest first.
export function buildEvidenceIssueHistory(data: {
  issues: ReadonlyArray<EvidenceIssueInput>;
  storeNames: ReadonlyMap<string, string>;
  readable: ReadonlySet<string>;
  since: Date;
}): Array<DataSecurityEvidenceIssue> {
  const since: number = data.since.getTime();

  return data.issues
    .filter((issue: EvidenceIssueInput): boolean => {
      return (
        data.readable.has(issue.storeId.toLowerCase()) &&
        (timeOf(issue.firstDetectedAt) >= since ||
          (issue.status === DataSecurityIssueStatus.Resolved &&
            timeOf(issue.resolvedAt) >= since))
      );
    })
    .sort((a: EvidenceIssueInput, b: EvidenceIssueInput): number => {
      return (timeOf(b.firstDetectedAt) || 0) - (timeOf(a.firstDetectedAt) || 0);
    })
    .slice(0, MAX_EVIDENCE_HISTORY)
    .map((issue: EvidenceIssueInput): DataSecurityEvidenceIssue => {
      const opened: number = timeOf(issue.firstDetectedAt);
      const resolved: number =
        issue.status === DataSecurityIssueStatus.Resolved
          ? timeOf(issue.resolvedAt)
          : NaN;
      const hours: number = (resolved - opened) / HOUR_IN_MS;

      return {
        issueId: issue.id,
        title: issue.title,
        storeName: data.storeNames.get(issue.storeId.toLowerCase()) || "",
        checkId: issue.checkId,
        severity: issue.severity,
        status: issue.status,
        openedAt: Number.isFinite(opened) ? new Date(opened).toISOString() : "",
        ...(Number.isFinite(resolved)
          ? { resolvedAt: new Date(resolved).toISOString() }
          : {}),
        ...(Number.isFinite(hours) && hours >= 0
          ? { hoursToFix: Math.round(hours) }
          : {}),
      };
    });
}

export default class AuditEvidenceReader {
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<AuditEvidenceRead> {
    const framework: DataSecurityComplianceFramework | undefined = (
      await ResourceDataSecurity.readProjectCompliance(
        data.projectId,
        data.props,
      )
    ).find((entry: DataSecurityComplianceFramework): boolean => {
      return entry.framework === data.framework;
    });

    if (!framework) {
      throw new BadDataException("This framework could not be found.");
    }

    const stores: Array<DataStore> = (
      await DataStoreService.findBy({
        query: { projectId: data.projectId, isArchived: false },
        select: {
          _id: true,
          name: true,
          kind: true,
          cloudResourceId: true,
          serviceId: true,
          databaseServerId: true,
          dataTypeIds: true,
          subjectCountries: true,
          configurationReadAt: true,
          contentScannedAt: true,
        },
        skip: 0,
        limit: MAX_STORES,
        props: { isRoot: true },
      })
    ).filter((store: DataStore): boolean => {
      return Boolean(store.id) && !isDeclaredDataStoreKind(store.kind);
    });
    const readable: Set<string> = new Set(
      (
        await DataStoreService.findBy({
          query: { projectId: data.projectId, isArchived: false },
          select: { _id: true },
          skip: 0,
          limit: MAX_STORES,
          props: data.props,
        })
      ).map((store: DataStore): string => {
        return store.id!.toString().toLowerCase();
      }),
    );
    const settings: Array<ComplianceScopeSetting> =
      await ResourceDataSecurity.readProjectSettings(data.projectId);
    const scoped: Array<ScopedStore> = await ResourceDataSecurity.toScopedStores(
      stores,
    );
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      data.framework,
      scoped.map((store: ScopedStore): ComplianceScopeStore => {
        return { id: store.id, owner: store.owner };
      }),
      settings,
    );
    const inScope: Array<ScopedStore> = scoped.filter(
      (store: ScopedStore): boolean => {
        return (
          isStoreInFrameworkScope(data.framework, store.input) &&
          !exclusions.storeIds?.has(store.id)
        );
      },
    );
    const storeNames: Map<string, string> = new Map(
      stores.map((store: DataStore): [string, string] => {
        return [store.id!.toString().toLowerCase(), store.name || ""];
      }),
    );
    const checkIds: Array<string> = [
      ...new Set(
        framework.requirements.flatMap(
          (requirement: ComplianceRequirementResult): Array<string> => {
            return requirement.checkIds;
          },
        ),
      ),
    ];
    const issues: Array<EvidenceIssueInput> =
      inScope.length > 0 && checkIds.length > 0
        ? (
            await DataSecurityIssueService.findBy({
              query: {
                projectId: data.projectId,
                dataStoreId: new Includes(
                  inScope.map((store: ScopedStore): ObjectID => {
                    return new ObjectID(store.id);
                  }),
                ),
                checkId: new Includes(checkIds),
              },
              select: {
                _id: true,
                title: true,
                checkId: true,
                severity: true,
                status: true,
                dataStoreId: true,
                firstDetectedAt: true,
                resolvedAt: true,
                acceptedReason: true,
                acceptedUntil: true,
              },
              skip: 0,
              limit: MAX_ISSUES,
              props: { isRoot: true },
            })
          ).map((issue: DataSecurityIssue): EvidenceIssueInput => {
            return {
              id: issue.id!.toString(),
              title: issue.title || "",
              checkId: issue.checkId || "",
              severity: issue.severity || "",
              status: issue.status || "",
              storeId: issue.dataStoreId?.toString() || "",
              firstDetectedAt: issue.firstDetectedAt,
              resolvedAt: issue.resolvedAt,
              acceptedReason: issue.acceptedReason,
              acceptedUntil: issue.acceptedUntil,
            };
          })
        : [];
    const since: Date = new Date(
      data.now.getTime() - data.periodInDays * 24 * HOUR_IN_MS,
    );

    return {
      framework,
      requirements: framework.requirements.map(
        (requirement: ComplianceRequirementResult): AiEvidenceRequirement => {
          const turnedOffHere: ReadonlySet<string> | undefined =
            exclusions.requirementStoreIds?.get(requirement.requirement);

          return buildRequirementEvidence({
            requirement,
            checks: getChecksForRequirement(
              data.framework,
              requirement.requirement,
            ),
            stores: inScope
              .filter((store: ScopedStore): boolean => {
                return !turnedOffHere?.has(store.id);
              })
              .map((store: ScopedStore): { id: string; name: string } => {
                return {
                  id: store.id,
                  name: storeNames.get(store.id.toLowerCase()) || "",
                };
              }),
            readable,
            issues,
            turnedOff: framework.turnedOff || [],
            since,
          });
        },
      ),
      issueHistory: buildEvidenceIssueHistory({
        issues,
        storeNames,
        readable,
        since,
      }),
      readableStoreIds: inScope
        .map((store: ScopedStore): string => {
          return store.id.toLowerCase();
        })
        .filter((id: string): boolean => {
          return readable.has(id);
        }),
    };
  }
}
