import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataStore";
import DataStoreFeedService from "./DataStoreFeedService";
import { DataStoreFeedEventType } from "../../Models/DatabaseModels/DataStoreFeed";
import DataStoreLabelRuleEngineService from "./DataStoreLabelRuleEngineService";
import DataStoreOwnerRuleEngineService from "./DataStoreOwnerRuleEngineService";
import DataSecurityIssueService from "./DataSecurityIssueService";
import UserService from "./UserService";
import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import { describeDataStoreChanges } from "../Utils/DataSecurity/DataStoreChangeFeed";
import DataSecurityIssueAlerts, {
  ClosedDataSecurityIssue,
} from "../Utils/DataSecurity/DataSecurityIssueAlerts";
import DataSecurityIssue from "../../Models/DatabaseModels/DataSecurityIssue";
import URL from "../../Types/API/URL";
import Includes from "../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import DataSecurityIssueStatus from "../../Types/DataSecurity/DataSecurityIssueStatus";
import { Blue500, Gray500, Yellow500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isDataSensitivity } from "../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment, {
  ALL_DATA_STORE_ENVIRONMENTS,
} from "../../Types/DataSecurity/DataStoreEnvironment";
import {
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindInfo,
} from "../../Types/DataSecurity/DataStoreKind";
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * Data stores: most are discovered and written by OneUptime alone
 * (DataSecurityDiscovery), with root props. People add the ones no scan can
 * find - a database only a probe can reach - and change how a store is
 * treated: its environment, a sensitivity of their own, whether it is
 * public by design or used for AI, how it may be scanned. Any of those
 * changes what the checks say, so a change queues the project's
 * evaluation; a new store gets the project's owner and label rules.
 *
 * The store's Timeline (DataStoreFeed) says when it was found or added,
 * what a person changed on it and to what (DataStoreChangeFeed), and when
 * discovery stopped seeing it or found it again.
 *
 * A store deleted takes its issues with it; an alert an open one raised
 * ends with it (DataSecurityIssueAlerts), as when its check passes.
 */

// Why a deleted store's issues are no longer open, for their alerts.
export const DELETED_STORE_WHY: string = "its store was deleted";

interface DeletedStores {
  stores: Array<Model>;
  // Their open issues, read before the delete takes them.
  openIssues: Array<DataSecurityIssue>;
}

// The engines a worker can sample, by the scheme of their connection strings.
const SCANNABLE_CONNECTION_STRING: RegExp =
  /^(postgres|postgresql|mysql|mariadb|mssql|sqlserver):\/\//i;

// What a person may set about a store that changes what its checks say.
const PEOPLE_SET_COLUMNS_THAT_DECIDE_CHECKS: ReadonlyArray<string> = [
  "environment",
  "sensitivityOverride",
  "isPublicByDesign",
  "isAiData",
  "isContentScanEnabled",
  "scanExclusions",
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readEnvironment(value: unknown): string {
    if (
      typeof value !== "string" ||
      !(ALL_DATA_STORE_ENVIRONMENTS as ReadonlyArray<string>).includes(value)
    ) {
      throw new BadDataException(
        "Choose the store's environment: Production, Staging, Development, Test or Unknown.",
      );
    }

    return value;
  }

  public static readSensitivityOverride(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (!isDataSensitivity(value)) {
      throw new BadDataException(
        "Choose a sensitivity: Restricted, Confidential, Internal or Public.",
      );
    }

    return value;
  }

  /*
   * A database a person adds is scanned with a read-only connection string
   * for one of the engines the scanners read; anything else is refused now
   * rather than failing every scan later.
   */
  public static readConnectionString(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException("The connection string must be text.");
    }

    const trimmed: string = value.trim();

    if (!SCANNABLE_CONNECTION_STRING.test(trimmed)) {
      throw new BadDataException(
        "Enter a PostgreSQL, MySQL or SQL Server connection string, such as postgresql://reader:password@db.internal:5432/app.",
      );
    }

    return trimmed;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (createBy.props.isRoot) {
      return { createBy: createBy, carryForward: undefined };
    }

    // A store a person adds: what they may say, and what follows from it.
    const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(
      createBy.data.kind,
    );

    if (!info) {
      throw new BadDataException("Choose what kind of store it is.");
    }

    if (!createBy.data.name?.trim()) {
      throw new BadDataException("Give the store a name.");
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    createBy.data.name = createBy.data.name.trim();
    createBy.data.provider = info.provider;
    createBy.data.family = info.family;
    createBy.data.discoveredFrom = "Manual";
    createBy.data.storeKey = `manual:${ObjectID.generate().toString()}`;
    createBy.data.firstSeenAt = now;
    createBy.data.lastSeenAt = now;

    if (createBy.data.environment !== undefined) {
      createBy.data.environment = Service.readEnvironment(
        createBy.data.environment,
      ) as DataStoreEnvironment;
    }

    (createBy.data as unknown as JSONObject)["sensitivityOverride"] =
      Service.readSensitivityOverride(createBy.data.sensitivityOverride);

    const connectionString: string | null = Service.readConnectionString(
      createBy.data.connectionString,
    );

    if (connectionString) {
      createBy.data.connectionString = connectionString;
    }

    if (
      info.provider !== DataStoreProvider.SelfManaged &&
      (connectionString || createBy.data.probeConnectionVariable)
    ) {
      throw new BadDataException(
        "Only a self-managed database is scanned with a connection string.",
      );
    }

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await DataStoreLabelRuleEngineService.applyRulesToDataStore(
            createdItem,
          );
        })
        .then(async () => {
          await DataStoreOwnerRuleEngineService.applyRulesToDataStore(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying data store rules in DataStoreService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              dataStoreId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });

      this.writeCreatedFeed(createdItem, onCreate).catch((error: Error) => {
        logger.error(error);
      });

      await queueDataSecurityEvaluation(createdItem.projectId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["environment"] !== undefined) {
      data["environment"] = Service.readEnvironment(data["environment"]);
    }

    if (data["sensitivityOverride"] !== undefined) {
      data["sensitivityOverride"] = Service.readSensitivityOverride(
        data["sensitivityOverride"],
      );
    }

    if (data["connectionString"] !== undefined) {
      data["connectionString"] = Service.readConnectionString(
        data["connectionString"],
      );
    }

    if (data["name"] !== undefined) {
      const name: string =
        typeof data["name"] === "string" ? data["name"].trim() : "";

      if (!name) {
        throw new BadDataException("Give the store a name.");
      }

      data["name"] = name;
    }

    const decidesChecks: boolean = PEOPLE_SET_COLUMNS_THAT_DECIDE_CHECKS.some(
      (column: string) => {
        return data[column] !== undefined;
      },
    );

    if (!decidesChecks || updateBy.props.isRoot) {
      return { updateBy, carryForward: [] };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true },
    );

    return {
      updateBy,
      carryForward: rows
        .map((row: Model): ObjectID | undefined => {
          return row.projectId;
        })
        .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
          return Boolean(projectId);
        }),
    };
  }

  /*
   * The stores a delete removes, and the delete held to them, with their
   * open issues: the issues go with the store, so they are read first.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const stores: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
      },
    );
    const carryForward: DeletedStores = {
      stores: stores,
      openIssues: await this.findOpenIssuesOf(stores),
    };

    return {
      deleteBy,
      carryForward: carryForward,
    };
  }

  // The deleted stores' open issues' alerts end with them.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carried: DeletedStores | undefined = onDelete.carryForward as
      | DeletedStores
      | undefined;

    if (!carried || carried.openIssues.length === 0) {
      return onDelete;
    }

    const deletedStoreIds: Set<string> = new Set(
      Service.getRowsDeleted<Model>({
        rows: carried.stores,
        deletedIds: deletedIds,
      }).map((store: Model): string => {
        return store.id!.toString().toLowerCase();
      }),
    );
    const byProject: Map<
      string,
      { projectId: ObjectID; issues: Array<ClosedDataSecurityIssue> }
    > = new Map();

    for (const issue of carried.openIssues) {
      if (
        !issue.id ||
        !issue.projectId ||
        !issue.dataStoreId ||
        !deletedStoreIds.has(issue.dataStoreId.toString().toLowerCase())
      ) {
        continue;
      }

      const key: string = issue.projectId.toString();
      const group: {
        projectId: ObjectID;
        issues: Array<ClosedDataSecurityIssue>;
      } = byProject.get(key) || { projectId: issue.projectId, issues: [] };

      group.issues.push({ issueId: issue.id, why: DELETED_STORE_WHY });
      byProject.set(key, group);
    }

    for (const group of byProject.values()) {
      // Best effort, and the issues are gone with their Timeline.
      await DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: group.projectId,
        issues: group.issues,
        noteOnIssue: false,
      });
    }

    return onDelete;
  }

  /*
   * The open issues of these stores, as OneUptime reads them. Best effort:
   * a read that fails is logged, and the delete goes on.
   */
  private async findOpenIssuesOf(
    stores: Array<Model>,
  ): Promise<Array<DataSecurityIssue>> {
    const storeIds: Array<ObjectID> = stores
      .map((store: Model): ObjectID | undefined => {
        return store.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (storeIds.length === 0) {
      return [];
    }

    try {
      return await DataSecurityIssueService.findBy({
        query: {
          dataStoreId: new Includes(storeIds),
          status: DataSecurityIssueStatus.Open,
        },
        select: {
          _id: true,
          projectId: true,
          dataStoreId: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        "DataSecurity: could not read the open issues of the stores being deleted:",
      );
      logger.error(error);
      return [];
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const projectIds: Array<ObjectID> =
      (onUpdate.carryForward as Array<ObjectID> | undefined) || [];
    const seen: Set<string> = new Set();

    for (const projectId of projectIds) {
      if (seen.has(projectId.toString())) {
        continue;
      }

      seen.add(projectId.toString());
      await queueDataSecurityEvaluation(projectId);
    }

    // What a person changed; OneUptime's own writes are root and not recorded.
    if (!onUpdate.updateBy.props.isRoot) {
      await this.writeUpdatedFeed(onUpdate, updatedItemIds).catch(
        (error: Error) => {
          logger.error(error);
        },
      );
    }

    return onUpdate;
  }

  private async writeUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const changes: Array<MarkdownText> = describeDataStoreChanges(
      onUpdate.updateBy.data as unknown as JSONObject,
    );

    if (changes.length === 0) {
      return;
    }

    const userId: ObjectID | undefined =
      onUpdate.updateBy.props.userId || undefined;

    for (const dataStoreId of updatedItemIds) {
      const store: Model | null = await this.findOneById({
        id: dataStoreId,
        select: { projectId: true },
        props: { isRoot: true },
      });

      if (!store?.projectId) {
        continue;
      }

      const link: MarkdownText = await this.getDataStoreMarkdownLink(
        store.projectId,
        dataStoreId,
      );
      const byWhom: MarkdownText | null = userId
        ? await UserService.getUserMarkdownString({
            userId: userId,
            projectId: store.projectId,
          })
        : null;

      await DataStoreFeedService.createDataStoreFeedItem({
        dataStoreId: dataStoreId,
        projectId: store.projectId,
        dataStoreFeedEventType: DataStoreFeedEventType.DataStoreUpdated,
        displayColor: Gray500,
        feedInfoInMarkdown: (byWhom
          ? mdText`📝 ${link} was updated by **${byWhom}**.`
          : mdText`📝 ${link} was updated.`
        ).toString(),
        moreInformationInMarkdown: changes
          .map((line: MarkdownText): string => {
            return line.toString();
          })
          .join("\n\n"),
        userId: userId,
      });
    }
  }

  /*
   * Discovery no longer finds the store where it found it (its cloud
   * account, its database product, the service map), so it is archived:
   * kept, with its history, out of everyday lists.
   */
  @CaptureSpan()
  public async writeArchivedFeed(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    discoveredFrom?: string | undefined;
  }): Promise<void> {
    const link: MarkdownText = await this.getDataStoreMarkdownLink(
      data.projectId,
      data.dataStoreId,
    );

    let gone: MarkdownText;

    switch (data.discoveredFrom) {
      case "Cloud inventory":
        gone = mdText`🗄️ ${link} is gone from its cloud account's inventory, so it was archived.`;
        break;
      case "Database product":
        gone = mdText`🗄️ ${link} is no longer a database server in Databases, so it was archived.`;
        break;
      case "Service map":
        gone = mdText`🗄️ ${link} is no longer seen in any service's traces, so it was archived.`;
        break;
      default:
        gone = mdText`🗄️ ${link} is no longer listed by its source, so it was archived.`;
    }

    await DataStoreFeedService.createDataStoreFeedItem({
      dataStoreId: data.dataStoreId,
      projectId: data.projectId,
      dataStoreFeedEventType: DataStoreFeedEventType.DataStoreArchived,
      displayColor: Yellow500,
      feedInfoInMarkdown:
        mdText`${gone} Its history is kept, and it comes back on its own once it is found again.`.toString(),
    });
  }

  // Discovery found an archived store again: it is back among the data stores.
  @CaptureSpan()
  public async writeRestoredFeed(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<void> {
    const link: MarkdownText = await this.getDataStoreMarkdownLink(
      data.projectId,
      data.dataStoreId,
    );

    await DataStoreFeedService.createDataStoreFeedItem({
      dataStoreId: data.dataStoreId,
      projectId: data.projectId,
      dataStoreFeedEventType: DataStoreFeedEventType.DataStoreRestored,
      displayColor: Blue500,
      feedInfoInMarkdown:
        mdText`♻️ ${link} was found again, so it is back among the data stores.`.toString(),
    });
  }

  @CaptureSpan()
  public async getDataStoreName(data: {
    dataStoreId: ObjectID;
  }): Promise<string> {
    const dataStore: Model | null = await this.findOneById({
      id: data.dataStoreId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return dataStore?.name || "";
  }

  @CaptureSpan()
  public async getDataStoreLinkInDashboard(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/data-security/stores/${dataStoreId.toString()}`,
    );
  }

  /**
   * "[Data Store customers-prod](https://…)" - the form every feed item uses
   * to name the store it is about.
   */
  @CaptureSpan()
  public async getDataStoreMarkdownLink(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<MarkdownText> {
    const name: string = await this.getDataStoreName({ dataStoreId });
    const link: URL = await this.getDataStoreLinkInDashboard(
      projectId,
      dataStoreId,
    );

    return mdText`[Data Store ${name}](${link.toString()})`;
  }

  private async writeCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    if (!createdItem.projectId || !createdItem.id) {
      return;
    }

    const link: MarkdownText = await this.getDataStoreMarkdownLink(
      createdItem.projectId,
      createdItem.id,
    );
    const createdByUserId: ObjectID | undefined =
      onCreate.createBy.props.userId || undefined;

    await DataStoreFeedService.createDataStoreFeedItem({
      dataStoreId: createdItem.id,
      projectId: createdItem.projectId,
      dataStoreFeedEventType: DataStoreFeedEventType.DataStoreCreated,
      displayColor: Blue500,
      feedInfoInMarkdown: (createdByUserId
        ? mdText`${link} was added by hand.`
        : mdText`${link} was discovered by Data Security.`
      ).toString(),
      userId: createdByUserId,
    });
  }
}

export default new Service();
