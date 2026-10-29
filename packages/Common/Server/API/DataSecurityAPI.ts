import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import DataStore from "../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../Models/DatabaseModels/DataStoreFinding";
import DataSecurityIssue from "../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../Models/DatabaseModels/DataSecurityIssueFeed";
import User from "../../Models/DatabaseModels/User";
import AIRun from "../../Models/DatabaseModels/AIRun";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { Purple500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import SecuritySeverity from "../../Types/SecuritySeverity";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceIssueInput,
  ComplianceStoreInput,
  scoreComplianceFramework,
} from "../../Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  isPersonalDataCategory,
} from "../../Types/DataSecurity/DataCategory";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "../../Types/DataSecurity/DataSensitivity";
import DataSecurityIssueStatus from "../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityComplianceResponse,
  DataSecurityOverview,
  DataSecurityOverviewIssue,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
} from "../../Types/DataSecurity/DataSecurityApiTypes";
import { getBuiltInDataType } from "../../Types/DataSecurity/DataTypeCatalog";
import {
  DataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../Types/DataSecurity/DataStorePosture";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudConnectionService from "../Services/CloudConnectionService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import DataStoreFindingService from "../Services/DataStoreFindingService";
import DataStoreService, {
  Service as DataStoreServiceType,
} from "../Services/DataStoreService";
import DataSecurityIssueFeedService from "../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../Services/DataSecurityIssueService";
import AIService from "../Services/AIService";
import CodeTaskRuns from "../Utils/AI/CodeTask/CodeTaskRuns";
import {
  DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT,
  buildDataSecurityFixRequest,
  describeDataSecurityIssueForAi,
} from "../Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import FeedMarkdown from "../../Utils/Markdown/FeedMarkdown";
import DataSecurityIntegrations from "../Utils/DataSecurity/DataSecurityIntegrations";
import {
  queueDataSecurityConnectionRead,
  queueDataSecurityEvaluation,
  queueDataStoreScan,
} from "../Utils/DataSecurity/DataSecurityJobs";
import { getConnectionDataSecurityLevel } from "../Utils/DataSecurity/DataSecurityRunner";
import { createScrubRuleForFinding } from "../Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * DATA SECURITY'S OWN ROUTES, BESIDE THE DATA STORE CRUD ROUTES.
 *
 * Everything stored has its CRUD route from BaseAPI; these answer what is
 * worked out on request (Types/DataSecurity/DataSecurityApiTypes):
 *
 *  - the Overview's figures, the compliance scores and the GDPR record of
 *    processing, for anyone who may read data stores;
 *  - Scan Now and Check Now on a store, for anyone who may edit it;
 *  - Scrub It on a telemetry finding, for anyone who may create scrub
 *    rules - the rule is theirs, made under their own permissions;
 *  - Explain and Fix With AI on an issue, under the project's OneUptime AI
 *    switches and limits, sending the issue, its evidence and how to fix
 *    it - never a finding's samples.
 *
 * Every route reads only the caller's project and answers 404-like errors
 * for another project's records.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];

const OPERATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];

/*
 * Who may make a scrub rule of either signal; the rule itself is made with
 * the person's own permissions, so a log rule still needs the log
 * permission and a trace rule the trace one.
 */
const SCRUB_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
];

const ISSUE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];

const TREND_DAYS: number = 30;

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default class DataSecurityAPI extends BaseAPI<
  DataStore,
  DataStoreServiceType
> {
  public constructor() {
    super(DataStore, DataStoreService);

    this.post(DATA_SECURITY_API_ROUTES.overview, READ_PERMISSIONS, async (projectId: ObjectID) => {
      return (await DataSecurityAPI.getOverview(projectId)) as unknown as JSONObject;
    });

    this.post(DATA_SECURITY_API_ROUTES.compliance, READ_PERMISSIONS, async (projectId: ObjectID) => {
      return (await DataSecurityAPI.getCompliance(projectId)) as unknown as JSONObject;
    });

    this.post(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return (await DataSecurityAPI.getRecordOfProcessing(
          projectId,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const store: DataStore = await DataSecurityAPI.readStore(projectId, req);

        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id!,
          data: { nextContentScanAt: OneUptimeDate.getCurrentDate() },
        });
        await queueDataStoreScan({ projectId, dataStoreId: store.id! });

        return {};
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const store: DataStore = await DataSecurityAPI.readStore(projectId, req);

        if (store.cloudConnectionId) {
          await queueDataSecurityConnectionRead({
            projectId,
            cloudConnectionId: store.cloudConnectionId,
          });
        }

        await queueDataSecurityEvaluation(projectId);

        return {};
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      SCRUB_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const finding: DataStoreFinding | null =
          await DataStoreFindingService.findOneBy({
            query: { _id: DataSecurityAPI.readId(req), projectId },
            select: {
              _id: true,
              dataTypeId: true,
              location: true,
              dataStoreId: true,
              dataStore: { kind: true },
            },
            props: { isRoot: true },
          });

        if (!finding?.dataTypeId || !finding.location || !finding.dataStore?.kind) {
          throw new BadDataException("Finding not found.");
        }

        if (
          !TELEMETRY_DATA_STORE_KINDS.includes(
            finding.dataStore.kind as DataStoreKind,
          )
        ) {
          throw new BadDataException(
            "Scrub It masks telemetry at ingest; this finding is in a data store.",
          );
        }

        const created: { signal: "log" | "trace"; scrubRuleId: string; scrubRuleName: string } =
          await createScrubRuleForFinding({
            projectId,
            userId: props.userId || undefined,
            kind: finding.dataStore.kind as DataStoreKind,
            dataTypeId: finding.dataTypeId,
            location: finding.location,
          });

        await DataStoreFindingService.updateColumnsByIdWithoutHooks({
          id: finding.id!,
          data: { isScrubbed: true },
        });
        await queueDataSecurityEvaluation(projectId);

        return created as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const issue: DataSecurityIssue = await DataSecurityAPI.readIssue(
          projectId,
          req,
        );
        const response: { content: string } = await AIService.executeWithLogging({
          projectId,
          userId: props.userId || undefined,
          feature: "DataSecurityIssueExplanation",
          messages: [
            {
              role: "system",
              content: DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT,
            },
            { role: "user", content: DataSecurityAPI.describeIssue(issue) },
          ],
          maxTokens: 900,
        });

        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId,
          dataSecurityIssueId: issue.id!,
          eventType: DataSecurityIssueFeedEventType.AiExplanation,
          displayColor: Purple500,
          feedInfoInMarkdown: "OneUptime AI explained this issue.",
          // OneUptime AI's Markdown, with nothing in it that acts on its own.
          moreInformationInMarkdown: FeedMarkdown.aiWritten(
            response.content.slice(0, 20000),
          ).toString(),
          userId: props.userId || undefined,
        });

        return { markdown: response.content };
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      ISSUE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const issue: DataSecurityIssue = await DataSecurityAPI.readIssue(
          projectId,
          req,
        );

        if (!props.userId) {
          throw new BadDataException("Sign in to ask OneUptime AI for a fix.");
        }

        const body: JSONObject = (req.body || {}) as JSONObject;
        const requestedId: string = String(body["codeRepositoryId"] || "");
        // An id that is not one chooses no repository: never the first one found.
        const repositoryId: string = ObjectID.isValidUUID(requestedId)
          ? requestedId
          : "";
        const repositories: Array<CodeRepository> =
          await CodeRepositoryService.findBy({
            query: repositoryId && ObjectID.isValidUUID(repositoryId)
              ? { projectId, _id: new ObjectID(repositoryId) }
              : { projectId },
            select: { _id: true, name: true },
            skip: 0,
            limit: 2,
            props: { isRoot: true },
          });

        if (repositories.length === 0) {
          return {
            message:
              "Connect the repository that holds this store's infrastructure code under Code, then ask again.",
          };
        }

        if (repositories.length > 1 && !repositoryId) {
          return {
            message:
              "This project has several repositories: choose the one that holds this store's infrastructure code.",
          };
        }

        const run: AIRun = await CodeTaskRuns.start({
          projectId,
          userId: props.userId,
          repository: repositories[0]!,
          message: buildDataSecurityFixRequest(issue),
          context: [],
        });

        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId,
          dataSecurityIssueId: issue.id!,
          eventType: DataSecurityIssueFeedEventType.AiFixRequested,
          displayColor: Purple500,
          feedInfoInMarkdown: "OneUptime AI was asked to open a fix as a pull request.",
          userId: props.userId,
        });

        return {
          message: "OneUptime AI is working on a fix. Its pull request will appear under Code.",
          aiRunId: run.id?.toString(),
        };
      },
    );
  }

  private post(
    route: string,
    permissions: Array<Permission>,
    handler: (
      projectId: ObjectID,
      req: ExpressRequest,
      props: DatabaseCommonInteractionProps,
    ) => Promise<JSONObject>,
  ): void {
    this.router.post(
      route,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: permissions,
            errorMessage: "You do not have permission to do this in Data Security.",
          });

          const answer: JSONObject = await handler(projectId, req, props);

          return Response.sendJsonObjectResponse(req, res, answer);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private static readId(req: ExpressRequest): ObjectID {
    const id: string = String(req.params["id"] || "");

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("Not found.");
    }

    return new ObjectID(id);
  }

  private static async readStore(
    projectId: ObjectID,
    req: ExpressRequest,
  ): Promise<DataStore> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: this.readId(req), projectId },
      select: { _id: true, cloudConnectionId: true },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    return store;
  }

  private static async readIssue(
    projectId: ObjectID,
    req: ExpressRequest,
  ): Promise<DataSecurityIssue> {
    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: this.readId(req), projectId },
        select: {
          _id: true,
          checkId: true,
          title: true,
          evidence: true,
          severity: true,
          dataTypeIds: true,
          dataStore: {
            name: true,
            kind: true,
            region: true,
            sensitivity: true,
            providerResourceId: true,
          },
        },
        props: { isRoot: true },
      });

    if (!issue?.id) {
      throw new BadDataException("Issue not found.");
    }

    return issue;
  }

  // The issue in words for OneUptime AI: no samples, only what a check saw.
  public static describeIssue(issue: DataSecurityIssue): string {
    return describeDataSecurityIssueForAi(issue);
  }

  public static async getOverview(
    projectId: ObjectID,
  ): Promise<DataSecurityOverview> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        kind: true,
        sensitivity: true,
        sensitivityOverride: true,
        dataCategories: true,
        exposure: true,
        configurationReadAt: true,
        contentScannedAt: true,
      },
      skip: 0,
      limit: 10000,
      props: { isRoot: true },
    });
    const storesBySensitivity: Record<DataSensitivity, number> = {
      [DataSensitivity.Restricted]: 0,
      [DataSensitivity.Confidential]: 0,
      [DataSensitivity.Internal]: 0,
      [DataSensitivity.Public]: 0,
    };
    const byCategory: Map<DataCategory, number> = new Map();
    let exposedSensitive: number = 0;
    let evaluated: number = 0;
    let contentScanned: number = 0;

    for (const store of stores) {
      const sensitivity: DataSensitivity =
        (store.sensitivityOverride as DataSensitivity | undefined) ||
        (store.sensitivity as DataSensitivity | undefined) ||
        DataSensitivity.Public;

      storesBySensitivity[sensitivity]++;

      for (const category of store.dataCategories || []) {
        byCategory.set(category, (byCategory.get(category) || 0) + 1);
      }

      if (
        DATA_SENSITIVITY_RANK[sensitivity] >=
          DATA_SENSITIVITY_RANK[DataSensitivity.Confidential] &&
        (store.exposure === DataStoreExposure.Public ||
          store.exposure === DataStoreExposure.OtherAccounts)
      ) {
        exposedSensitive++;
      }

      if (store.configurationReadAt || store.contentScannedAt) {
        evaluated++;
      }

      if (store.contentScannedAt) {
        contentScanned++;
      }
    }

    const since: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -TREND_DAYS,
    );
    const issues: Array<DataSecurityIssue> = await DataSecurityIssueService.findBy({
      query: { projectId },
      select: {
        _id: true,
        title: true,
        severity: true,
        riskScore: true,
        status: true,
        checkId: true,
        firstDetectedAt: true,
        resolvedAt: true,
        dataStoreId: true,
        dataStore: { name: true },
      },
      skip: 0,
      limit: 20000,
      props: { isRoot: true },
    });
    const openIssuesBySeverity: Record<SecuritySeverity, number> = {
      [SecuritySeverity.Critical]: 0,
      [SecuritySeverity.High]: 0,
      [SecuritySeverity.Medium]: 0,
      [SecuritySeverity.Low]: 0,
    };
    const trend: Map<string, { opened: number; resolved: number }> = new Map();

    for (let day: number = TREND_DAYS - 1; day >= 0; day--) {
      trend.set(
        dayOf(OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -day)),
        { opened: 0, resolved: 0 },
      );
    }

    const open: Array<DataSecurityIssue> = [];

    for (const issue of issues) {
      if (issue.status === DataSecurityIssueStatus.Open && issue.severity) {
        openIssuesBySeverity[issue.severity]++;
        open.push(issue);
      }

      if (issue.firstDetectedAt && issue.firstDetectedAt >= since) {
        const entry: { opened: number; resolved: number } | undefined =
          trend.get(dayOf(issue.firstDetectedAt));

        if (entry) {
          entry.opened++;
        }
      }

      if (issue.resolvedAt && issue.resolvedAt >= since) {
        const entry: { opened: number; resolved: number } | undefined =
          trend.get(dayOf(issue.resolvedAt));

        if (entry) {
          entry.resolved++;
        }
      }
    }

    const topIssues: Array<DataSecurityOverviewIssue> = open
      .sort((a: DataSecurityIssue, b: DataSecurityIssue) => {
        return (b.riskScore || 0) - (a.riskScore || 0);
      })
      .slice(0, 5)
      .map((issue: DataSecurityIssue): DataSecurityOverviewIssue => {
        return {
          issueId: issue.id!.toString(),
          title: issue.title || "",
          severity: issue.severity || SecuritySeverity.Low,
          riskScore: issue.riskScore || 0,
          checkId: issue.checkId || "",
          dataStoreId: issue.dataStoreId?.toString() || "",
          dataStoreName: issue.dataStore?.name || "",
        };
      });

    const telemetryStoreIds: Set<string> = new Set(
      stores
        .filter((store: DataStore) => {
          return TELEMETRY_DATA_STORE_KINDS.includes(store.kind as DataStoreKind);
        })
        .map((store: DataStore) => {
          return store.id!.toString();
        }),
    );
    let telemetryFindings: number = 0;
    let unscrubbed: number = 0;

    if (telemetryStoreIds.size > 0) {
      const findings: Array<DataStoreFinding> =
        await DataStoreFindingService.findBy({
          query: { projectId, isSuppressed: false },
          select: { dataStoreId: true, isScrubbed: true, matchCount: true },
          skip: 0,
          limit: 50000,
          props: { isRoot: true },
        });

      for (const finding of findings) {
        if (
          telemetryStoreIds.has(finding.dataStoreId?.toString() || "") &&
          finding.matchCount
        ) {
          telemetryFindings++;

          if (!finding.isScrubbed) {
            unscrubbed++;
          }
        }
      }
    }

    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: { projectId },
        select: { _id: true, config: true },
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });

    return {
      storeCount: stores.length,
      evaluatedStoreCount: evaluated,
      contentScannedStoreCount: contentScanned,
      storesBySensitivity,
      storesByCategory: ALL_DATA_CATEGORIES.map((category: DataCategory) => {
        return { category, storeCount: byCategory.get(category) || 0 };
      }).filter((entry: { category: DataCategory; storeCount: number }) => {
        return entry.storeCount > 0;
      }),
      exposedSensitiveStoreCount: exposedSensitive,
      openIssuesBySeverity,
      topIssues,
      issueTrend: [...trend.entries()].map(
        ([day, counts]: [string, { opened: number; resolved: number }]) => {
          return { day, opened: counts.opened, resolved: counts.resolved };
        },
      ),
      telemetryFindingCount: telemetryFindings,
      unscrubbedTelemetryFindingCount: unscrubbed,
      connectionsWithoutContentAccess: connections.filter(
        (connection: CloudConnection) => {
          return getConnectionDataSecurityLevel(connection.config) !== "content";
        },
      ).length,
      hasCloudConnection: connections.length > 0,
    };
  }

  public static async getCompliance(
    projectId: ObjectID,
  ): Promise<DataSecurityComplianceResponse> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        dataTypeIds: true,
        subjectCountries: true,
        configurationReadAt: true,
        contentScannedAt: true,
      },
      skip: 0,
      limit: 10000,
      props: { isRoot: true },
    });
    const issues: Array<DataSecurityIssue> = await DataSecurityIssueService.findBy({
      query: { projectId, status: DataSecurityIssueStatus.Open },
      select: { dataStoreId: true, checkId: true },
      skip: 0,
      limit: 20000,
      props: { isRoot: true },
    });
    const storeInputs: Array<ComplianceStoreInput> = stores.map(
      (store: DataStore): ComplianceStoreInput => {
        return {
          id: store.id!.toString(),
          dataTypeIds: store.dataTypeIds || [],
          subjectCountries: store.subjectCountries || [],
          isEvaluated: Boolean(store.configurationReadAt || store.contentScannedAt),
        };
      },
    );
    const issueInputs: Array<ComplianceIssueInput> = issues.map(
      (issue: DataSecurityIssue): ComplianceIssueInput => {
        return {
          storeId: issue.dataStoreId?.toString() || "",
          checkId: issue.checkId || "",
        };
      },
    );

    return {
      frameworks: ALL_COMPLIANCE_FRAMEWORKS.map((framework: ComplianceFramework) => {
        return {
          ...scoreComplianceFramework(framework, storeInputs, issueInputs),
          fullName: COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
          scope: COMPLIANCE_FRAMEWORK_INFO[framework].scope,
        };
      }),
    };
  }

  public static async getRecordOfProcessing(
    projectId: ObjectID,
  ): Promise<DataSecurityRecordOfProcessingResponse> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        name: true,
        kind: true,
        provider: true,
        region: true,
        environment: true,
        sensitivity: true,
        sensitivityOverride: true,
        dataCategories: true,
        dataTypeIds: true,
        purpose: true,
        retention: true,
      },
      skip: 0,
      limit: 10000,
      props: { isRoot: true },
    });
    const rows: Array<DataSecurityRecordOfProcessingRow> = [];

    for (const store of stores) {
      const categories: Array<DataCategory> = store.dataCategories || [];

      if (!categories.some(isPersonalDataCategory)) {
        continue;
      }

      const owners: Array<User> = await DataSecurityIntegrations.getOwnerUsers(
        store.id!,
      );
      const frameworks: Set<ComplianceFramework> = new Set();
      const typeNames: Array<string> = [];

      for (const dataTypeId of store.dataTypeIds || []) {
        const info: ReturnType<typeof getBuiltInDataType> =
          getBuiltInDataType(dataTypeId);

        typeNames.push(info?.name || dataTypeId);

        for (const framework of info?.frameworks || []) {
          frameworks.add(framework);
        }
      }

      rows.push({
        dataStoreId: store.id!.toString(),
        name: store.name || "",
        kind: store.kind || "",
        provider: store.provider || "",
        region: store.region || "",
        environment: store.environment || "",
        sensitivity:
          (store.sensitivityOverride as DataSensitivity | undefined) ||
          (store.sensitivity as DataSensitivity | undefined) ||
          DataSensitivity.Public,
        dataCategories: categories,
        dataTypeNames: typeNames,
        owners: owners.map((owner: User) => {
          return owner.name?.toString() || owner.email?.toString() || "";
        }),
        purpose: store.purpose || "",
        retention: store.retention || "",
        frameworks: [...frameworks],
      });
    }

    return { rows };
  }
}
