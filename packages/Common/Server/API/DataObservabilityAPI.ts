import DataAsset from "../../Models/DatabaseModels/DataAsset";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "../../Models/DatabaseModels/DataAssetFeed";
import DataStore from "../../Models/DatabaseModels/DataStore";
import Probe from "../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import {
  DataStoreKind,
  DataStoreKindInfo,
  getDataStoreKindInfo,
} from "../../Types/DataSecurity/DataStoreKind";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "../../Types/DataObservability/DataAssetFreshness";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityCollector,
  DataObservabilityConnectStoreResponse,
  DataObservabilityOverview,
  DataObservabilityOverviewAsset,
  DataObservabilityOverviewChange,
  DataObservabilityStoreSummary,
  SCHEMA_CHANGE_WINDOW_IN_DAYS,
} from "../../Types/DataObservability/DataObservabilityApiTypes";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import UserMiddleware from "../Middleware/UserAuthorization";
import DataAssetFeedService from "../Services/DataAssetFeedService";
import DataAssetService, {
  Service as DataAssetServiceType,
} from "../Services/DataAssetService";
import DataStoreService from "../Services/DataStoreService";
import ProbeService from "../Services/ProbeService";
import QueryHelper from "../Types/Database/QueryHelper";
import { queueTableHealthCollection } from "../Utils/DataObservability/DataObservabilityJobs";
import {
  isValidProbeConnectionVariable,
  PROBE_SCANNABLE_KINDS,
} from "../Utils/DataSecurity/DataSecurityProbeScan";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * DATA OBSERVABILITY'S OWN ROUTES, BESIDE THE DATA ASSET CRUD ROUTES.
 *
 *  - the Overview's figures and the watched stores with how their last
 *    collection went, for anyone who may read data assets;
 *  - Collect Now on a store, for anyone who may edit data assets;
 *  - Connect a database, for those who may create data assets.
 *
 * A data store is Data Security's record, readable by the Security tiers
 * only, so these read stores as OneUptime and hand back only what table
 * health needs - a name, a kind, how the last collection went - never a
 * store's findings or connection string. A store connected from here is
 * watched for table health and not content-scanned: Data Observability
 * promises to read the catalog and never a row, and turning content scans
 * on is Data Security's call.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadDataAsset,
];

const OPERATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.EditDataAsset,
];

const CONNECT_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.CreateDataAsset,
];

// The kinds Data Observability collects today.
export const COLLECTABLE_KINDS: ReadonlyArray<DataStoreKind> = [
  ...PROBE_SCANNABLE_KINDS,
];

const MAX_STORES: number = 500;
const MAX_ASSETS_READ: number = 50_000;
const OVERVIEW_LIST_LENGTH: number = 10;

const SCHEMA_CHANGE_EVENTS: Array<DataAssetFeedEventType> = [
  DataAssetFeedEventType.ColumnAdded,
  DataAssetFeedEventType.ColumnRemoved,
  DataAssetFeedEventType.ColumnRenamed,
  DataAssetFeedEventType.ColumnTypeChanged,
  DataAssetFeedEventType.ColumnNullabilityChanged,
];

export default class DataObservabilityAPI extends BaseAPI<
  DataAsset,
  DataAssetServiceType
> {
  public constructor() {
    super(DataAsset, DataAssetService);

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.overview,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return (await DataObservabilityAPI.getOverview(
          projectId,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.stores,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return {
          stores: (await DataObservabilityAPI.getStoreSummaries(
            projectId,
            OneUptimeDate.getCurrentDate(),
          )) as unknown as Array<JSONObject>,
        };
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.collectNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const store: DataStore = await DataObservabilityAPI.readStore(
          projectId,
          req,
        );

        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id!,
          data: {
            nextTableHealthCollectionAt: OneUptimeDate.getCurrentDate(),
          } as never,
        });

        // A probe's store is picked up at its probe's next poll.
        if (!store.scanProbeId) {
          await queueTableHealthCollection({
            projectId,
            dataStoreId: store.id!,
          });
        }

        return {};
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.connectStore,
      CONNECT_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        return (await DataObservabilityAPI.connectStore(
          projectId,
          (req.body || {}) as JSONObject,
        )) as unknown as JSONObject;
      },
    );
  }

  public static async getStoreSummaries(
    projectId: ObjectID,
    now: Date,
  ): Promise<Array<DataObservabilityStoreSummary>> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        isArchived: false,
        kind: new Includes([...COLLECTABLE_KINDS]),
      },
      select: {
        _id: true,
        name: true,
        kind: true,
        isTableHealthEnabled: true,
        scanProbeId: true,
        scanProbe: { name: true },
        tableHealthStatus: true,
        tableHealthMessage: true,
        tableHealthCollectedAt: true,
        tableHealthAssetCount: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: MAX_STORES,
      props: { isRoot: true },
    });

    const lateByStore: Map<string, number> = new Map();

    for (const asset of await this.readAssets(projectId)) {
      if (asset.isDropped || !asset.dataStoreId) {
        continue;
      }

      const result: DataAssetFreshnessResult = getDataAssetFreshness({
        kind: asset.assetKind,
        lastChangedAt: asset.lastChangedAt,
        updateIntervalInSeconds: asset.updateIntervalInSeconds,
        now,
      });

      if (result.freshness === DataAssetFreshness.Late) {
        const key: string = asset.dataStoreId.toString();
        lateByStore.set(key, (lateByStore.get(key) || 0) + 1);
      }
    }

    return stores
      .filter((store: DataStore) => {
        return Boolean(store.id);
      })
      .map((store: DataStore): DataObservabilityStoreSummary => {
        return {
          dataStoreId: store.id!.toString(),
          name: store.name || "",
          kind: store.kind || "",
          isTableHealthEnabled: store.isTableHealthEnabled !== false,
          collector: store.scanProbeId
            ? DataObservabilityCollector.Probe
            : DataObservabilityCollector.OneUptime,
          probeName: store.scanProbe?.name || null,
          status: store.tableHealthStatus || null,
          message: store.tableHealthMessage || null,
          collectedAt: store.tableHealthCollectedAt
            ? OneUptimeDate.fromString(
                store.tableHealthCollectedAt,
              ).toISOString()
            : null,
          assetCount: store.tableHealthAssetCount || 0,
          lateAssetCount: lateByStore.get(store.id!.toString()) || 0,
        };
      });
  }

  public static async getOverview(
    projectId: ObjectID,
  ): Promise<DataObservabilityOverview> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const stores: Array<DataObservabilityStoreSummary> =
      await this.getStoreSummaries(projectId, now);
    const assets: Array<DataAsset> = await this.readAssets(projectId);
    const lateAssets: Array<DataObservabilityOverviewAsset> = [];
    let assetCount: number = 0;
    let droppedAssetCount: number = 0;

    for (const asset of assets) {
      if (asset.isDropped) {
        droppedAssetCount++;
        continue;
      }

      assetCount++;

      const result: DataAssetFreshnessResult = getDataAssetFreshness({
        kind: asset.assetKind,
        lastChangedAt: asset.lastChangedAt,
        updateIntervalInSeconds: asset.updateIntervalInSeconds,
        now,
      });

      if (result.freshness === DataAssetFreshness.Late && asset.id) {
        lateAssets.push({
          dataAssetId: asset.id.toString(),
          assetKey: asset.assetKey || "",
          dataStoreName: asset.dataStoreName || "",
          lastChangedAt: asset.lastChangedAt
            ? OneUptimeDate.fromString(asset.lastChangedAt).toISOString()
            : null,
          updateIntervalInSeconds: asset.updateIntervalInSeconds ?? null,
          overdueBySeconds: result.overdueBySeconds,
        });
      }
    }

    lateAssets.sort(
      (
        a: DataObservabilityOverviewAsset,
        b: DataObservabilityOverviewAsset,
      ) => {
        return b.overdueBySeconds - a.overdueBySeconds;
      },
    );

    const since: Date = OneUptimeDate.addRemoveDays(
      now,
      -SCHEMA_CHANGE_WINDOW_IN_DAYS,
    );

    const schemaChangeCount: number = (
      await DataAssetFeedService.countBy({
        query: {
          projectId,
          dataAssetFeedEventType: new Includes(SCHEMA_CHANGE_EVENTS),
          postedAt: QueryHelper.greaterThanEqualTo(since),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    const recentFeed: Array<DataAssetFeed> = await DataAssetFeedService.findBy({
      query: {
        projectId,
        dataAssetFeedEventType: new Includes(SCHEMA_CHANGE_EVENTS),
      },
      select: {
        _id: true,
        dataAssetId: true,
        dataAssetFeedEventType: true,
        feedInfoInMarkdown: true,
        postedAt: true,
        dataAsset: { assetKey: true, dataStoreName: true },
      },
      sort: { postedAt: SortOrder.Descending },
      skip: 0,
      limit: OVERVIEW_LIST_LENGTH,
      props: { isRoot: true },
    });

    const recentChanges: Array<DataObservabilityOverviewChange> = recentFeed
      .filter((item: DataAssetFeed) => {
        return Boolean(item.dataAssetId);
      })
      .map((item: DataAssetFeed): DataObservabilityOverviewChange => {
        return {
          dataAssetId: item.dataAssetId!.toString(),
          assetKey: item.dataAsset?.assetKey || "",
          dataStoreName: item.dataAsset?.dataStoreName || "",
          eventType: item.dataAssetFeedEventType || "",
          feedInfoInMarkdown: item.feedInfoInMarkdown || "",
          postedAt: item.postedAt
            ? OneUptimeDate.fromString(item.postedAt).toISOString()
            : null,
        };
      });

    return {
      storeCount: stores.length,
      assetCount,
      lateAssetCount: lateAssets.length,
      droppedAssetCount,
      schemaChangeCount,
      failingStoreCount: stores.filter(
        (store: DataObservabilityStoreSummary) => {
          return store.isTableHealthEnabled && store.status === "Failed";
        },
      ).length,
      lateAssets: lateAssets.slice(0, OVERVIEW_LIST_LENGTH),
      recentChanges,
      stores,
    };
  }

  public static async connectStore(
    projectId: ObjectID,
    body: JSONObject,
  ): Promise<DataObservabilityConnectStoreResponse> {
    const name: string =
      typeof body["name"] === "string" ? body["name"].trim() : "";
    const kind: unknown = body["kind"];
    const info: DataStoreKindInfo | undefined =
      typeof kind === "string" ? getDataStoreKindInfo(kind) : undefined;

    if (!name) {
      throw new BadDataException("Give the database a name.");
    }

    if (!info || !COLLECTABLE_KINDS.includes(info.kind)) {
      throw new BadDataException(
        `Choose one of: ${COLLECTABLE_KINDS.join(", ")}.`,
      );
    }

    const connectionString: string =
      typeof body["connectionString"] === "string"
        ? body["connectionString"].trim()
        : "";
    const probeIdValue: unknown = body["probeId"];
    const probeConnectionVariable: unknown = body["probeConnectionVariable"];
    let probe: Probe | null = null;

    if (typeof probeIdValue === "string" && probeIdValue) {
      if (!ObjectID.isValidUUID(probeIdValue)) {
        throw new BadDataException("Probe not found.");
      }

      probe = await ProbeService.findOneBy({
        query: { _id: new ObjectID(probeIdValue), projectId },
        select: { _id: true, isGlobalProbe: true },
        props: { isRoot: true },
      });

      if (!probe?.id || probe.isGlobalProbe) {
        throw new BadDataException(
          "Choose one of this project's own probes: a global probe never reads a customer's database.",
        );
      }

      if (!isValidProbeConnectionVariable(probeConnectionVariable)) {
        throw new BadDataException(
          "Name the probe's environment variable that holds the connection string: upper-case letters, digits and underscores, not one of the probe's own settings.",
        );
      }
    } else if (!connectionString) {
      throw new BadDataException(
        "Give a connection string, or choose a probe that holds one in an environment variable.",
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const store: DataStore = new DataStore();

    store.projectId = projectId;
    store.name = name;
    store.kind = info.kind;
    store.provider = info.provider;
    store.family = info.family;
    store.discoveredFrom = "Manual";
    store.storeKey = `manual:${ObjectID.generate().toString()}`;
    store.firstSeenAt = now;
    store.lastSeenAt = now;
    store.isTableHealthEnabled = true;
    // Data Observability reads the catalog, never a row; content scans are Data Security's to turn on.
    store.isContentScanEnabled = false;

    if (probe?.id) {
      store.scanProbeId = probe.id;
      store.probeConnectionVariable = probeConnectionVariable as string;
    } else {
      store.connectionString = connectionString;
    }

    const created: DataStore = await DataStoreService.create({
      data: store,
      props: { isRoot: true },
    });

    if (!probe?.id) {
      await queueTableHealthCollection({
        projectId,
        dataStoreId: created.id!,
      });
    }

    return { dataStoreId: created.id!.toString() };
  }

  private static async readAssets(
    projectId: ObjectID,
  ): Promise<Array<DataAsset>> {
    return await DataAssetService.findBy({
      query: { projectId },
      select: {
        _id: true,
        assetKey: true,
        assetKind: true,
        dataStoreId: true,
        dataStoreName: true,
        lastChangedAt: true,
        updateIntervalInSeconds: true,
        isDropped: true,
      },
      skip: 0,
      limit: MAX_ASSETS_READ,
      props: { isRoot: true },
    });
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
            errorMessage:
              "You do not have permission to do this in Data Observability.",
          });

          const answer: JSONObject = await handler(projectId, req, props);

          return Response.sendJsonObjectResponse(req, res, answer);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private static async readStore(
    projectId: ObjectID,
    req: ExpressRequest,
  ): Promise<DataStore> {
    const id: string = String(req.params["id"] || "");

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("Data store not found.");
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: {
        _id: new ObjectID(id),
        projectId,
        kind: new Includes([...COLLECTABLE_KINDS]),
      },
      select: { _id: true, scanProbeId: true },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    return store;
  }
}
