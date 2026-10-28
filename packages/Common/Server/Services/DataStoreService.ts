import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataStore";
import DataStoreFeedService from "./DataStoreFeedService";
import { DataStoreFeedEventType } from "../../Models/DatabaseModels/DataStoreFeed";
import DataStoreLabelRuleEngineService from "./DataStoreLabelRuleEngineService";
import DataStoreOwnerRuleEngineService from "./DataStoreOwnerRuleEngineService";
import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import URL from "../../Types/API/URL";
import { Blue500 } from "../../Types/BrandColors";
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
 */

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

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
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

    return onUpdate;
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
