import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreOwnerTeam from "../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../Models/DatabaseModels/DataStoreOwnerUser";
import DataSecurityCheckSetting from "../../../Models/DatabaseModels/DataSecurityCheckSetting";
import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityFlow from "../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityResidencyRule from "../../../Models/DatabaseModels/DataSecurityResidencyRule";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import SecurityEntityRisk from "../../../Models/DatabaseModels/SecurityEntityRisk";
import DataStoreAccessService from "../../Services/DataStoreAccessService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../Services/DataStoreOwnerUserService";
import DataStoreService from "../../Services/DataStoreService";
import DataSecurityCheckSettingService from "../../Services/DataSecurityCheckSettingService";
import DataSecurityCustomDataTypeService from "../../Services/DataSecurityCustomDataTypeService";
import DataSecurityFlowService from "../../Services/DataSecurityFlowService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataSecurityResidencyRuleService from "../../Services/DataSecurityResidencyRuleService";
import DataSecuritySettingService from "../../Services/DataSecuritySettingService";
import SecurityEntityRiskService from "../../Services/SecurityEntityRiskService";
import DataSecurityFlows from "./DataSecurityFlows";
import DataSecurityIntegrations, {
  OpenedIssueForIntegrations,
} from "./DataSecurityIntegrations";
import DataSecurityIssueReconciler, {
  ReconcileStoreOutput,
  ReconciledIssue,
} from "./DataSecurityIssueReconciler";
import DataSecurityIssueAlerts, {
  ClosedDataSecurityIssue,
} from "./DataSecurityIssueAlerts";
import DataSecurityIdentities, {
  IdentityGrant,
  IdentityStoreFacts,
  buildIdentityDrafts,
} from "./DataSecurityIdentities";
import logger from "../Logger";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import DataSensitivity, {
  isDataSensitivity,
} from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DataStoreFamily,
  DataStoreKind,
  DataStoreKindInfo,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
  getDataStoreExposure,
} from "../../../Types/DataSecurity/DataStorePosture";
import {
  DataStoreCheckInput,
  EvaluatedCheck,
  FINDING_FRESHNESS_IN_DAYS,
  evaluateDataStoreChecks,
  isFindingCounted,
  isUnscrubbedTelemetryFinding,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  getStoreSensitivity,
  SensitivityFinding,
  StoreSensitivity,
} from "../../../Types/DataSecurity/DataSecurityRisk";
import {
  getResidencyViolations,
  getSubjectCountries,
  ResidencyRuleInput,
  ResidencyViolation,
} from "../../../Types/DataSecurity/DataSecurityResidency";
import { dataStoreEntityValue } from "../../../Types/DataSecurity/DataStoreKey";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  securityEntityKey,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityEntityRiskContribution } from "../../../Types/SecurityCase/SecurityEntityRisk";
import { customDataTypeId } from "../../../Utils/DataSecurity/CustomDataTypeDetector";

/*
 * WORKING OUT WHAT IS TRUE OF A PROJECT'S STORES, AND WHAT IS WRONG.
 *
 * Run after every scan and configuration read, after a person changes
 * anything that decides a check, and once a day for every project (so an
 * accepted risk expires on time and stale data ages into its check). For
 * each store, from what the scans found in the last
 * FINDING_FRESHNESS_IN_DAYS days and what its configuration says:
 *
 *  1. its sensitivity and data types (DataSecurityRisk) - a person's
 *     override wins;
 *  2. its exposure (DataStorePosture), and whose data it holds;
 *  3. every applicable check (DataSecurityCheckCatalog), with the
 *     project's check settings and residency rules;
 *  4. its issues, opened, updated and resolved (DataSecurityIssueReconciler);
 *  5. its summary - open issues, worst severity, risk - for every list.
 *
 * Flows and copies are worked out first, because a copy of production data
 * is evidence for a check; the integrations - cases, alerts, owners - run
 * last, on what opened. Then every identity the stores' grants name is
 * worked out from them, with the stores' sensitivity as this evaluation
 * found it (DataSecurityIdentities).
 */

const PAGE_SIZE: number = 1000;

// The most stores one evaluation reaches; a project beyond it is evaluated in parts.
export const MAX_STORES_PER_EVALUATION: number = 10000;

// A project's own data type: what it is called, and what it makes a store.
interface CustomDataTypeFacts {
  name: string;
  sensitivity: DataSensitivity;
  category: DataCategory;
}

interface StoreFacts {
  findings: Array<SensitivityFinding>;
  unscrubbedDataTypeIds: Set<string>;
  hasOwner: boolean;
  readers: Set<string>;
  // The readers not used in 90 days: principal -> the name people know it by.
  unusedReaders: Map<string, string>;
  copiedFromProductionStoreName: string | null;
  aiProvidersReached: Set<string>;
  hasRecentSecurityActivity: boolean;
  issues: Array<DataSecurityIssue>;
}

// How long a new column that holds personal data stays an issue, unless it is dropped sooner.
const NEW_PERSONAL_DATA_COLUMN_WINDOW_IN_DAYS: number = 14;

// The columns Data Observability saw added whose names say they hold personal data.
export function readNewPersonalDataColumns(
  state: JSONObject,
  now: Date,
): Array<string> | undefined {
  const raw: unknown = state["newPersonalDataColumns"];

  if (!Array.isArray(raw)) {
    return undefined;
  }

  const since: number =
    now.getTime() - NEW_PERSONAL_DATA_COLUMN_WINDOW_IN_DAYS * 86_400_000;

  return (raw as Array<JSONObject>)
    .filter((item: JSONObject): boolean => {
      return Date.parse(String(item["seenAt"])) >= since;
    })
    .map((item: JSONObject): string => {
      return `${String(item["column"])} (${String(item["dataType"])})`;
    });
}

function newFacts(): StoreFacts {
  return {
    findings: [],
    unscrubbedDataTypeIds: new Set(),
    hasOwner: false,
    readers: new Set(),
    unusedReaders: new Map(),
    copiedFromProductionStoreName: null,
    aiProvidersReached: new Set(),
    hasRecentSecurityActivity: false,
    issues: [],
  };
}

export default class DataSecurityEvaluator {
  public static async evaluateProject(projectId: ObjectID): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(projectId);

    if (setting.isConfigurationScanEnabled === false) {
      // Checks are off for the project: nothing new opens, nothing closes.
      return;
    }

    const stores: Array<DataStore> = await this.readStores(projectId);

    if (stores.length === 0) {
      return;
    }

    // Flows and copies first: a copy of production data is a check's evidence.
    try {
      await DataSecurityFlows.computeProjectFlows(projectId, stores);
    } catch (error) {
      logger.error(
        `DataSecurity: could not work out flows of project ${projectId.toString()}:`,
      );
      logger.error(error);
    }

    const facts: Map<string, StoreFacts> = new Map();

    for (const store of stores) {
      facts.set(store.id!.toString(), newFacts());
    }

    const custom: Map<string, CustomDataTypeFacts> =
      await this.readCustomTypes(projectId);
    // What the issues call the project's own data types.
    const dataTypeNames: Record<string, string> = {};

    for (const [dataTypeId, customType] of custom) {
      if (customType.name) {
        dataTypeNames[dataTypeId] = customType.name;
      }
    }

    await this.readFindings(projectId, now, facts, custom);
    await this.readOwners(projectId, facts);

    const grants: Array<IdentityGrant> = await this.readAccess(
      projectId,
      facts,
    );

    await this.readFlows(projectId, stores, facts);
    await this.readIssues(projectId, facts);
    await this.readSecurityActivity(projectId, stores, facts, now);

    const checkSettings: {
      disabled: Set<string>;
      overrides: Map<string, SecuritySeverity>;
    } = await this.readCheckSettings(projectId);
    const residencyRules: Array<ResidencyRuleInput> =
      await this.readResidencyRules(projectId);

    const opened: Array<OpenedIssueForIntegrations> = [];
    const closed: Array<ClosedDataSecurityIssue> = [];
    // Each store as this evaluation found it, for the identities that reach it.
    const evaluated: Map<string, IdentityStoreFacts> = new Map();

    for (const store of stores) {
      const storeFacts: StoreFacts | undefined = facts.get(
        store.id!.toString(),
      );

      if (!storeFacts) {
        continue;
      }

      try {
        const result: {
          output: ReconcileStoreOutput;
          sensitivity: DataSensitivity;
          dataTypeIds: Array<string>;
        } = await this.evaluateStore({
          projectId,
          store,
          facts: storeFacts,
          checkSettings,
          residencyRules,
          dataTypeNames,
          now,
        });

        evaluated.set(store.id!.toString(), {
          sensitivity: result.sensitivity,
          dataTypeIds: result.dataTypeIds,
          estimatedRecords: store.estimatedRecords,
          provider: store.provider,
        });

        for (const issue of result.output.opened) {
          opened.push(this.forIntegrations(store, issue, result.sensitivity));
        }

        closed.push(...result.output.closed);
      } catch (error) {
        logger.error(
          `DataSecurity: could not evaluate store ${store.id?.toString()}:`,
        );
        logger.error(error);
      }
    }

    if (opened.length > 0) {
      await DataSecurityIntegrations.onIssuesOpened({
        projectId,
        setting,
        issues: opened,
      });
    }

    // An alert ends with its issue: nobody is paged for a closed exposure.
    if (closed.length > 0) {
      await DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId,
        issues: closed,
      });
    }

    // Who can reach the stores, one identity at a time.
    try {
      await DataSecurityIdentities.write({
        projectId,
        drafts: buildIdentityDrafts(grants, evaluated, now),
        now,
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not work out the identities of project ${projectId.toString()}:`,
      );
      logger.error(error);
    }
  }

  private static forIntegrations(
    store: DataStore,
    issue: ReconciledIssue,
    sensitivity: DataSensitivity,
  ): OpenedIssueForIntegrations {
    return {
      issueId: issue.issueId,
      checkId: issue.checkId,
      title: issue.title,
      severity: issue.severity,
      riskScore: issue.riskScore,
      dataStoreId: store.id!,
      dataStoreName: store.name || "",
      dataStoreKey: store.storeKey || "",
      dataStoreKind: store.kind,
      sensitivity,
      cloudResourceId: store.cloudResourceId || undefined,
      databaseServerId: store.databaseServerId || undefined,
      serviceId: store.serviceId || undefined,
    };
  }

  public static async evaluateStore(data: {
    projectId: ObjectID;
    store: DataStore;
    facts: StoreFacts;
    checkSettings: {
      disabled: Set<string>;
      overrides: Map<string, SecuritySeverity>;
    };
    residencyRules: Array<ResidencyRuleInput>;
    // What the project calls its own data types, by id.
    dataTypeNames?: Readonly<Record<string, string>> | undefined;
    now: Date;
  }): Promise<{
    output: ReconcileStoreOutput;
    sensitivity: DataSensitivity;
    dataTypeIds: Array<string>;
  }> {
    const { store, facts, now } = data;
    const computed: StoreSensitivity = getStoreSensitivity(facts.findings);
    const sensitivity: DataSensitivity = isDataSensitivity(
      store.sensitivityOverride,
    )
      ? store.sensitivityOverride
      : computed.sensitivity;
    const posture: DataStorePostureFacts =
      (store.posture as DataStorePostureFacts | undefined) || {};
    const exposure: DataStoreExposure = getDataStoreExposure(posture);
    const subjectCountries: Array<string> = getSubjectCountries(
      computed.dataTypeIds,
    );
    const residencyViolations: Array<ResidencyViolation> =
      getResidencyViolations(data.residencyRules, {
        region: store.region,
        replicationRegions: posture.replicationRegions,
        dataCategories: computed.dataCategories,
        subjectCountries,
      });
    const state: JSONObject =
      (store.contentScanState as JSONObject | undefined) || {};
    const plaintextPasswordFields: Array<string> = Array.isArray(
      state["plaintextPasswordFields"],
    )
      ? (state["plaintextPasswordFields"] as Array<string>)
      : [];
    const kindInfo: DataStoreKindInfo | undefined = getDataStoreKindInfo(
      store.kind,
    );

    const input: DataStoreCheckInput = {
      kind: store.kind as DataStoreKind,
      name: store.name || "",
      region: store.region,
      environment:
        (store.environment as DataStoreEnvironment | undefined) ||
        DataStoreEnvironment.Unknown,
      sensitivity,
      dataTypeIds: computed.dataTypeIds,
      dataCategories: computed.dataCategories,
      posture,
      isPublicByDesign: Boolean(store.isPublicByDesign),
      hasOwner: facts.hasOwner,
      lastActivityAt: store.lastActivityAt || null,
      readerCount: posture.readAt ? facts.readers.size : null,
      unusedReaderNames: posture.readAt
        ? [...facts.unusedReaders.values()].sort()
        : null,
      copiedFromProductionStoreName: facts.copiedFromProductionStoreName,
      unscrubbedDataTypeIds:
        kindInfo?.family === DataStoreFamily.Telemetry
          ? [...facts.unscrubbedDataTypeIds]
          : [],
      dataTypeNames: data.dataTypeNames,
      aiProvidersReached: [...facts.aiProvidersReached],
      isAiData: Boolean(store.isAiData),
      residencyViolations,
      plaintextPasswordFields,
      newPersonalDataColumns: readNewPersonalDataColumns(state, now),
      now,
    };

    const checks: Array<EvaluatedCheck> = evaluateDataStoreChecks(input, {
      disabledCheckIds: data.checkSettings.disabled,
      severityOverrides: data.checkSettings.overrides,
    });

    /*
     * A sensitive store's "no owner" check means nothing for a store whose
     * data nobody has scanned yet, and Public stores have no issue severity
     * for most checks anyway (DataSecurityCheckCatalog).
     */
    const output: ReconcileStoreOutput =
      await DataSecurityIssueReconciler.reconcileStore({
        projectId: data.projectId,
        dataStoreId: store.id!,
        exposure,
        estimatedRecords: store.estimatedRecords,
        isProduction: store.environment === DataStoreEnvironment.Production,
        hasRecentSecurityActivity: facts.hasRecentSecurityActivity,
        dataTypeIds: computed.dataTypeIds,
        checks,
        existingIssues: facts.issues,
        now,
      });

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: store.id!,
      data: {
        sensitivity: computed.sensitivity,
        dataTypeIds: computed.dataTypeIds,
        dataCategories: computed.dataCategories,
        subjectCountries,
        exposure,
        findingCount: facts.findings.length,
        openIssueCount: output.openIssueCount,
        highestIssueSeverity: output.highestSeverity,
        riskScore: output.highestRiskScore,
      } as never,
    });

    return { output, sensitivity, dataTypeIds: computed.dataTypeIds };
  }

  private static async readPages<T>(
    read: (skip: number, limit: number) => Promise<Array<T>>,
    max: number,
  ): Promise<Array<T>> {
    const all: Array<T> = [];

    for (let skip: number = 0; skip < max; skip += PAGE_SIZE) {
      const page: Array<T> = await read(skip, PAGE_SIZE);

      for (const row of page) {
        all.push(row);
      }

      if (page.length < PAGE_SIZE) {
        break;
      }
    }

    return all;
  }

  private static async readStores(
    projectId: ObjectID,
  ): Promise<Array<DataStore>> {
    const select: Select<DataStore> = {
      _id: true,
      name: true,
      storeKey: true,
      kind: true,
      provider: true,
      region: true,
      environment: true,
      sensitivity: true,
      sensitivityOverride: true,
      posture: true,
      isPublicByDesign: true,
      isAiData: true,
      lastActivityAt: true,
      estimatedRecords: true,
      contentScanState: true,
      serviceId: true,
      fingerprints: true,
      firstSeenAt: true,
      databaseServerId: true,
      cloudResourceId: true,
      dataTypeIds: true,
    };

    return this.readPages(
      (skip: number, limit: number): Promise<Array<DataStore>> => {
        return DataStoreService.findBy({
          query: { projectId, isArchived: false },
          select,
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION,
    );
  }

  private static async readCustomTypes(
    projectId: ObjectID,
  ): Promise<Map<string, CustomDataTypeFacts>> {
    const rows: Array<DataSecurityCustomDataType> =
      await DataSecurityCustomDataTypeService.findBy({
        query: { projectId },
        select: { _id: true, name: true, sensitivity: true, category: true },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });
    const custom: Map<string, CustomDataTypeFacts> = new Map();

    for (const row of rows) {
      if (row.id && row.sensitivity && row.category) {
        custom.set(customDataTypeId(row.id.toString()), {
          name: row.name || "",
          sensitivity: row.sensitivity,
          category: row.category,
        });
      }
    }

    return custom;
  }

  private static async readFindings(
    projectId: ObjectID,
    now: Date,
    facts: Map<string, StoreFacts>,
    custom: Map<string, CustomDataTypeFacts>,
  ): Promise<void> {
    const since: Date = OneUptimeDate.addRemoveDays(
      now,
      -FINDING_FRESHNESS_IN_DAYS,
    );
    const findings: Array<DataStoreFinding> = await this.readPages(
      (skip: number, limit: number): Promise<Array<DataStoreFinding>> => {
        return DataStoreFindingService.findBy({
          query: {
            projectId,
            isSuppressed: false,
            lastSeenAt: QueryHelper.greaterThanEqualTo(since),
          },
          select: {
            dataStoreId: true,
            dataTypeId: true,
            confidence: true,
            isScrubbed: true,
            matchCount: true,
            isConfirmed: true,
            isAiSuggested: true,
          },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION * 20,
    );

    for (const finding of findings) {
      const storeFacts: StoreFacts | undefined = facts.get(
        finding.dataStoreId?.toString() || "",
      );

      /*
       * A finding counts once a value matched it - or a person confirmed
       * it, as they do OneUptime AI's suggestions, which match no value.
       * A suggestion nobody confirmed counts toward nothing.
       */
      if (!storeFacts || !finding.dataTypeId || !isFindingCounted(finding)) {
        continue;
      }

      const customType: CustomDataTypeFacts | undefined = custom.get(
        finding.dataTypeId,
      );

      storeFacts.findings.push({
        dataTypeId: finding.dataTypeId,
        confidence: finding.confidence || DataConfidence.Low,
        customSensitivity: customType?.sensitivity,
        customCategory: customType?.category,
      });

      // Only a telemetry store's findings are scrubbed (evaluateStore).
      if (isUnscrubbedTelemetryFinding(finding)) {
        storeFacts.unscrubbedDataTypeIds.add(finding.dataTypeId);
      }
    }
  }

  private static async readOwners(
    projectId: ObjectID,
    facts: Map<string, StoreFacts>,
  ): Promise<void> {
    const users: Array<DataStoreOwnerUser> = await this.readPages(
      (skip: number, limit: number): Promise<Array<DataStoreOwnerUser>> => {
        return DataStoreOwnerUserService.findBy({
          query: { projectId },
          select: { dataStoreId: true },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION * 5,
    );
    const teams: Array<DataStoreOwnerTeam> = await this.readPages(
      (skip: number, limit: number): Promise<Array<DataStoreOwnerTeam>> => {
        return DataStoreOwnerTeamService.findBy({
          query: { projectId },
          select: { dataStoreId: true },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION * 5,
    );

    for (const owner of [...users, ...teams]) {
      const storeFacts: StoreFacts | undefined = facts.get(
        owner.dataStoreId?.toString() || "",
      );

      if (storeFacts) {
        storeFacts.hasOwner = true;
      }
    }
  }

  /*
   * Every store's grants: the identities that read it, and the ones of them
   * not used in 90 days, for its checks - and every grant of a store this
   * evaluation reads, for the identities.
   */
  private static async readAccess(
    projectId: ObjectID,
    facts: Map<string, StoreFacts>,
  ): Promise<Array<IdentityGrant>> {
    const entries: Array<DataStoreAccess> = await this.readPages(
      (skip: number, limit: number): Promise<Array<DataStoreAccess>> => {
        return DataStoreAccessService.findBy({
          query: { projectId },
          select: {
            dataStoreId: true,
            principal: true,
            principalName: true,
            principalType: true,
            accessLevel: true,
            isPublic: true,
            isExternal: true,
            isSeenInTraces: true,
            isUnused: true,
            lastUsedAt: true,
          },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION * 20,
    );
    const grants: Array<IdentityGrant> = [];

    for (const entry of entries) {
      const dataStoreId: string = entry.dataStoreId?.toString() || "";
      const storeFacts: StoreFacts | undefined = facts.get(dataStoreId);

      if (!storeFacts || !entry.principal) {
        continue;
      }

      if (!entry.isPublic) {
        storeFacts.readers.add(entry.principal);

        if (entry.isUnused) {
          storeFacts.unusedReaders.set(
            entry.principal,
            entry.principalName || entry.principal,
          );
        }
      }

      grants.push({
        dataStoreId,
        principal: entry.principal,
        principalName: entry.principalName,
        principalType: entry.principalType,
        accessLevel: entry.accessLevel,
        isExternal: Boolean(entry.isExternal),
        isPublic: Boolean(entry.isPublic),
        isSeenInTraces: Boolean(entry.isSeenInTraces),
        isUnused: Boolean(entry.isUnused),
        lastUsedAt: entry.lastUsedAt,
      });
    }

    return grants;
  }

  private static async readFlows(
    projectId: ObjectID,
    stores: Array<DataStore>,
    facts: Map<string, StoreFacts>,
  ): Promise<void> {
    // Only a production store's copies are evidence that production data was copied.
    const productionNames: Map<string, string> = new Map(
      stores
        .filter((store: DataStore) => {
          return store.environment === DataStoreEnvironment.Production;
        })
        .map((store: DataStore): [string, string] => {
          return [store.id!.toString(), store.name || ""];
        }),
    );
    const flows: Array<DataSecurityFlow> = await this.readPages(
      (skip: number, limit: number): Promise<Array<DataSecurityFlow>> => {
        return DataSecurityFlowService.findBy({
          query: { projectId },
          select: {
            kind: true,
            sourceDataStoreId: true,
            destinationDataStoreId: true,
            destination: true,
            isConfirmed: true,
          },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION * 10,
    );

    for (const flow of flows) {
      if (flow.kind === DataSecurityFlows.COPY) {
        const destination: StoreFacts | undefined = facts.get(
          flow.destinationDataStoreId?.toString() || "",
        );

        if (
          destination &&
          flow.sourceDataStoreId &&
          productionNames.has(flow.sourceDataStoreId.toString())
        ) {
          destination.copiedFromProductionStoreName =
            productionNames.get(flow.sourceDataStoreId.toString()) || null;
        }
      }

      if (flow.kind === DataSecurityFlows.AI_PROVIDER && flow.destination) {
        const source: StoreFacts | undefined = facts.get(
          flow.sourceDataStoreId?.toString() || "",
        );

        if (source) {
          source.aiProvidersReached.add(flow.destination);
        }
      }
    }
  }

  private static async readIssues(
    projectId: ObjectID,
    facts: Map<string, StoreFacts>,
  ): Promise<void> {
    const issues: Array<DataSecurityIssue> = await this.readPages(
      (skip: number, limit: number): Promise<Array<DataSecurityIssue>> => {
        return DataSecurityIssueService.findBy({
          query: { projectId },
          select: {
            _id: true,
            dataStoreId: true,
            checkId: true,
            status: true,
            severity: true,
            riskScore: true,
            evidence: true,
            acceptedUntil: true,
            lastDetectedAt: true,
            reopenCount: true,
          },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION * 40,
    );

    for (const issue of issues) {
      const storeFacts: StoreFacts | undefined = facts.get(
        issue.dataStoreId?.toString() || "",
      );

      if (storeFacts) {
        storeFacts.issues.push(issue);
      }
    }
  }

  /*
   * Whether Security Operations saw something happen to a store lately: a
   * detection rule, a threat intel feed or a connected product added risk
   * to its `data-store:` entity, and that risk has not expired. Risk from
   * Data Security's own cases is left out, or an issue would raise its own
   * score the next time round.
   */
  private static async readSecurityActivity(
    projectId: ObjectID,
    stores: Array<DataStore>,
    facts: Map<string, StoreFacts>,
    now: Date,
  ): Promise<void> {
    const byEntityKey: Map<string, StoreFacts> = new Map();

    for (const store of stores) {
      const storeFacts: StoreFacts | undefined = facts.get(
        store.id!.toString(),
      );

      if (storeFacts && store.storeKey) {
        byEntityKey.set(
          securityEntityKey({
            type: SecurityEntityType.DataStore,
            value: dataStoreEntityValue(store.storeKey),
          }),
          storeFacts,
        );
      }
    }

    if (byEntityKey.size === 0) {
      return;
    }

    const rows: Array<SecurityEntityRisk> = await this.readPages(
      (skip: number, limit: number): Promise<Array<SecurityEntityRisk>> => {
        return SecurityEntityRiskService.findBy({
          query: {
            projectId,
            entityType: SecurityEntityType.DataStore,
            riskExpiresAt: QueryHelper.greaterThan(now),
          },
          select: { entityKey: true, contributions: true },
          skip,
          limit,
          props: { isRoot: true },
        });
      },
      MAX_STORES_PER_EVALUATION,
    );

    for (const row of rows) {
      const storeFacts: StoreFacts | undefined = byEntityKey.get(
        row.entityKey || "",
      );

      if (!storeFacts || !Array.isArray(row.contributions)) {
        continue;
      }

      const contributions: Array<SecurityEntityRiskContribution> =
        row.contributions as unknown as Array<SecurityEntityRiskContribution>;

      if (
        contributions.some(
          (contribution: SecurityEntityRiskContribution): boolean => {
            return (
              Boolean(contribution) &&
              contribution.source !== SecurityDetectionSource.DataSecurity &&
              (contribution.points || 0) > 0
            );
          },
        )
      ) {
        storeFacts.hasRecentSecurityActivity = true;
      }
    }
  }

  private static async readCheckSettings(projectId: ObjectID): Promise<{
    disabled: Set<string>;
    overrides: Map<string, SecuritySeverity>;
  }> {
    const rows: Array<DataSecurityCheckSetting> =
      await DataSecurityCheckSettingService.findBy({
        query: { projectId },
        select: { checkId: true, isEnabled: true, severityOverride: true },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });
    const disabled: Set<string> = new Set();
    const overrides: Map<string, SecuritySeverity> = new Map();

    for (const row of rows) {
      if (!row.checkId) {
        continue;
      }

      if (row.isEnabled === false) {
        disabled.add(row.checkId);
      }

      if (row.severityOverride) {
        overrides.set(row.checkId, row.severityOverride);
      }
    }

    return { disabled, overrides };
  }

  private static async readResidencyRules(
    projectId: ObjectID,
  ): Promise<Array<ResidencyRuleInput>> {
    const rows: Array<DataSecurityResidencyRule> =
      await DataSecurityResidencyRuleService.findBy({
        query: { projectId, isEnabled: true },
        select: {
          name: true,
          dataCategories: true,
          subjectCountries: true,
          allowedRegions: true,
        },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });

    return rows.map((row: DataSecurityResidencyRule): ResidencyRuleInput => {
      return {
        name: row.name || "Residency rule",
        dataCategories: row.dataCategories || [],
        subjectCountries: row.subjectCountries || [],
        allowedRegions: row.allowedRegions || [],
      };
    });
  }
}
