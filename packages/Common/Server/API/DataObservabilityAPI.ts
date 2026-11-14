import {
  normalizeWatchedPaths,
  OBJECT_STORE_KINDS,
} from "../../Types/DataObservability/StoragePaths";
import Select from "../Types/Database/Select";
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
import { isDataAssetUnused } from "../../Types/DataObservability/DataAssetReads";
import {
  DataCheckHealthAnswer,
  MAX_DATA_ATTENTION_ITEMS,
} from "../../Types/DataObservability/DataObservabilityAttention";
import DataObservabilityAttentionReader, {
  DataObservabilityAttention,
} from "../Utils/DataObservability/DataObservabilityAttentionReader";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityCheckHealthResponse,
  DataObservabilityCollector,
  DataObservabilityConnectStoreResponse,
  DataObservabilityOverview,
  DataObservabilityOverviewAsset,
  DataObservabilityOverviewChange,
  DataObservabilityStoragePathStore,
  DataObservabilityStoreSummary,
  MAX_CHECK_HEALTH_IDS,
  SCHEMA_CHANGE_WINDOW_IN_DAYS,
} from "../../Types/DataObservability/DataObservabilityApiTypes";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { isReaderLanguage } from "../../Types/ReaderLanguage";
import UserMiddleware from "../Middleware/UserAuthorization";
import DataAssetFeedService from "../Services/DataAssetFeedService";
import DataAssetService, {
  Service as DataAssetServiceType,
} from "../Services/DataAssetService";
import DataStoreService from "../Services/DataStoreService";
import AuditLogService from "../Services/AuditLogService";
import ProbeService from "../Services/ProbeService";
import QueryHelper from "../Types/Database/QueryHelper";
import { queueTableHealthCollection } from "../Utils/DataObservability/DataObservabilityJobs";
import DataAlertExplanationReader from "../Utils/DataObservability/DataAlertExplanation";
import DataAlertFeedbackRecorder from "../Utils/DataObservability/DataAlertFeedbackRecorder";
import DataObservabilityQualityReader from "../Utils/DataObservability/DataObservabilityQualityReader";
import WatchedTableLimit from "../Utils/DataObservability/WatchedTableLimit";
import DataCheckAlerts from "../Utils/DataObservability/DataCheckAlerts";
import DataProductSync from "../Utils/DataObservability/DataProductSync";
import DataReconciliationSync from "../Utils/DataObservability/DataReconciliationSync";
import DataCheckFromSentence from "../Utils/DataObservability/DataCheckFromSentence";
import DataTableAnswerer, {
  DataTableAnswer,
  formatDataTableAnswer,
} from "../Utils/DataObservability/DataTableAnswer";
import DataReconciliation from "../../Models/DatabaseModels/DataReconciliation";
import DataReconciliationService from "../Services/DataReconciliationService";
import DataProduct from "../../Models/DatabaseModels/DataProduct";
import DataProductService from "../Services/DataProductService";
import { DataProductStatus } from "../../Types/DataObservability/DataProductFreshness";
import { renderDataProductBadge } from "../../Types/DataObservability/DataProductBadge";
import logger from "../Utils/Logger";
import crypto from "crypto";
import DataCheck from "../../Models/DatabaseModels/DataCheck";
import DataCheckService from "../Services/DataCheckService";
import { isValidProbeConnectionVariable } from "../Utils/DataSecurity/DataSecurityProbeScan";
import { DATA_OBSERVABILITY_KINDS } from "../Utils/DataObservability/DataObservabilityEngines";
import DataBiSync from "../Utils/DataObservability/Bi/DataBiSync";
import DataBiRefreshAlerts from "../Utils/DataObservability/Bi/DataBiRefreshAlerts";
import DataWarehouseSpendSummary from "../Utils/DataObservability/DataWarehouseSpendSummary";
import DataTableDashboards from "../Utils/DataObservability/Bi/DataTableDashboards";
import DataTableSensitivity from "../Utils/DataObservability/DataTableSensitivity";
import DataTableLineageReader from "../Utils/DataObservability/DataTableLineage";
import DataTableLineageAnswerer, {
  DataTableLineageAnswer,
  formatDataTableLineageAnswer,
} from "../Utils/DataObservability/DataTableLineageAnswer";
import DataAlertLineageReader from "../Utils/DataObservability/DataAlertLineage";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
  readDataLineageExpandRequest,
} from "../../Types/DataObservability/DataLineageExpansion";
import {
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataAlertLineageAnswer,
  DataTableLineage,
  readDataLineageDepth,
} from "../../Types/DataObservability/DataTableLineage";
import TableHealthIngest from "../Utils/DataObservability/TableHealthIngest";
import DataTableErrors from "../Utils/DataObservability/DataTableErrors";
import DataAiAppTables from "../Utils/DataObservability/DataAiAppTables";
import DataCheckApply from "../Utils/DataObservability/DataCheckApply";
import DataSourceSuggestions, {
  isStoreConnected,
} from "../Utils/DataObservability/DataSourceSuggestions";
import DataBiConnection from "../../Models/DatabaseModels/DataBiConnection";
import DataBiConnectionService from "../Services/DataBiConnectionService";
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
 *    collection went, for anyone who may read data assets - with what
 *    needs someone now, worst first (DataObservabilityAttentionReader),
 *    naming only the alerts its reader may see;
 *  - how each of a page of checks stands now - passing, failing or could
 *    not run - for the same people, by the same alerts;
 *  - Collect Now on a store, for anyone who may edit data assets;
 *  - a data check's alert monitor kept in step with it, and Run Now on a
 *    check, for the same people - the monitor made with their own
 *    permissions;
 *  - a data product's monitor and SLO kept in step with it, and a new
 *    secret for its badge, for the same people;
 *  - a reconciliation's two checks and its monitor kept in step with it,
 *    and Run Now on it, for the same people;
 *  - a check written by OneUptime AI from a rule in a sentence, to review,
 *    for the same people;
 *  - whether a table is fresh, as one answer (DataTableAnswer), for anyone
 *    who may read data assets and their API keys - what the MCP server's
 *    get_data_table_freshness tool asks;
 *  - a table's lineage several steps each way, with how each table on it
 *    is now (DataTableLineage), for the same people and their API keys -
 *    what a table's Lineage tab draws - and the same told in words,
 *    problems first, for a table named as for its freshness
 *    (DataTableLineageAnswer): what the MCP server's get_data_table_lineage
 *    tool asks;
 *  - a data product's "data as of" badge, for anyone with its secret, so it
 *    can be embedded where nobody signs in to OneUptime;
 *  - Connect a database, for those who may create data assets.
 *
 * A data store is Data Security's record, readable by the Security tiers
 * only, so these read stores as OneUptime and hand back only what table
 * health needs - a name, a kind, how the last collection went - never a
 * store's findings or connection string. A store connected from here is
 * watched for table health and not content-scanned: Data Observability
 * reads the catalog, so that no value leaves the database, and turning content scans
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
  ...DATA_OBSERVABILITY_KINDS,
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
      async (
        projectId: ObjectID,
        _req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        // The alerts it names are the ones its reader may see.
        return (await DataObservabilityAPI.getOverview(
          projectId,
          props,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataObservabilityAPI.getCheckHealth(
          projectId,
          (req.body || {}) as JSONObject,
          props,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.quality,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return (await DataObservabilityQualityReader.read(
          projectId,
          OneUptimeDate.getCurrentDate(),
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.watchedTables,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return (await WatchedTableLimit.read(
          projectId,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.storeWatch(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const store: DataStore = await DataObservabilityAPI.readStore(
          projectId,
          req,
        );
        const isWatched: boolean =
          ((req.body || {}) as JSONObject)["isWatched"] === true;

        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id!,
          data: {
            isTableHealthEnabled: isWatched,
            ...(isWatched
              ? { nextTableHealthCollectionAt: OneUptimeDate.getCurrentDate() }
              : {}),
          } as never,
        });

        /*
         * Written round the hooks, so recorded here: who started or stopped
         * watching the store's tables. When it is collected next is
         * OneUptime's own.
         */
        await AuditLogService.recordUpdate({
          model: new DataStore(),
          before: store,
          updatedFields: { isTableHealthEnabled: isWatched },
          itemId: store.id!,
          props,
        });

        return {};
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.alertExplanation(":id"),
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        return {
          explanation: (await DataAlertExplanationReader.read({
            projectId,
            alertId: DataObservabilityAPI.readId(req),
          })) as unknown as JSONObject,
        };
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.alertFeedback(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        await DataAlertFeedbackRecorder.record({
          projectId,
          alertId: DataObservabilityAPI.readId(req),
          userId: props.userId || null,
          // The alert it resolves is theirs in the audit log.
          props: props,
          ...(typeof body["feedback"] === "string"
            ? { feedback: body["feedback"] }
            : {}),
          ...(typeof body["isCauseConfirmed"] === "boolean"
            ? { isCauseConfirmed: body["isCauseConfirmed"] }
            : {}),
        });

        return {};
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
      DATA_OBSERVABILITY_API_ROUTES.checkApply,
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await DataCheckApply.apply({
          projectId,
          manifest: body["manifest"],
          isDryRun: body["isDryRun"] === true,
          shouldPrune: body["shouldPrune"] === true,
          props,
        })) as unknown as JSONObject;
      },
      { allowsApiKey: true },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.checkAlert(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataCheckAlerts.sync({
          projectId,
          checkId: DataObservabilityAPI.readId(req),
          props,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.dataProductSync(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataProductSync.sync({
          projectId,
          dataProductId: DataObservabilityAPI.readId(req),
          props,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.checkSuggest,
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const dataAssetId: string = String(body["dataAssetId"] || "");

        if (!ObjectID.isValidUUID(dataAssetId)) {
          throw new BadDataException("Choose the table the check reads.");
        }

        return (await DataCheckFromSentence.draft({
          projectId,
          userId: props.userId,
          dataAssetId: new ObjectID(dataAssetId),
          sentence:
            typeof body["sentence"] === "string" ? body["sentence"] : "",
          /*
           * The language the person reads OneUptime in (#7220): kept only
           * when it is a code the Dashboard is read in, so nothing else
           * sent here ever reaches the prompt. Anything else is English.
           */
          language: isReaderLanguage(body["language"])
            ? (body["language"] as string)
            : undefined,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.tableFreshness,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const reference: string =
          typeof body["table"] === "string" ? body["table"].trim() : "";

        if (!reference) {
          throw new BadDataException(
            "Name the table: its schema.table key, its name, or its ID.",
          );
        }

        const now: Date = OneUptimeDate.getCurrentDate();
        const answers: Array<JSONObject> = [];

        for (const table of await DataTableAnswerer.findTables(
          projectId,
          reference,
        )) {
          // Its alerts as the person who asked may see them (DataTableAnswer).
          const answer: DataTableAnswer | null = await DataTableAnswerer.answer(
            projectId,
            table.id!,
            now,
            props,
          );

          if (answer) {
            answers.push({
              ...(answer as unknown as JSONObject),
              answer: formatDataTableAnswer(answer, now),
            });
          }
        }

        return { tables: answers } as unknown as JSONObject;
      },
      /*
       * Read-only, so the MCP server's tool answers an agent signed in with
       * a project API key too: its alerts as the key may see them.
       */
      { allowsApiKey: true },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.biSync(":id"),
      CONNECT_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const connection: DataBiConnection | null =
          await DataBiConnectionService.findOneBy({
            query: { _id: DataObservabilityAPI.readId(req), projectId },
            select: { _id: true },
            props: { isRoot: true },
          });

        if (!connection?.id) {
          throw new BadDataException("No such BI tool in this project.");
        }

        return (await DataBiSync.syncConnection(
          connection.id,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.biRefreshAlert(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataBiRefreshAlerts.sync({
          projectId,
          dataBiConnectionId: DataObservabilityAPI.readId(req),
          props,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.spendSummary,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return (await DataWarehouseSpendSummary.read(
          projectId,
          OneUptimeDate.getCurrentDate(),
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.tableDashboards,
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const dataAssetId: string =
          typeof body["dataAssetId"] === "string" ? body["dataAssetId"] : "";

        if (!ObjectID.isValidUUID(dataAssetId)) {
          throw new BadDataException("Name the table by its ID.");
        }

        return {
          dashboards: await DataTableDashboards.find({
            projectId,
            dataAssetId: new ObjectID(dataAssetId),
          }),
        } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.tableLineage,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const dataAssetId: string =
          typeof body["dataAssetId"] === "string" ? body["dataAssetId"] : "";

        if (!ObjectID.isValidUUID(dataAssetId)) {
          throw new BadDataException("Name the table by its ID.");
        }

        // Its tables' open alerts as the person who asked may see them.
        const lineage: DataTableLineage | null =
          await DataTableLineageReader.read({
            projectId,
            dataAssetId: new ObjectID(dataAssetId),
            depth: readDataLineageDepth(body["depth"]),
            now: OneUptimeDate.getCurrentDate(),
            reader: props,
            // The columns each arrow carries only when asked: the Lineage tab's column picker.
            withColumns: body["withColumns"] === true,
          });

        if (!lineage) {
          throw new BadDataException("Table not found.");
        }

        return lineage as unknown as JSONObject;
      },
      // Read-only, so a build in CI can ask what a change reaches.
      { allowsApiKey: true },
    );

    /*
     * The next tables a card of a lineage diagram does not draw - a table's
     * card, or a pipeline's own on its drawing - with the arrows between
     * them and what is drawn: what pressing a card's count asks, so the
     * diagram grows where it is. Their open alerts are counted as the
     * person who asked may see them, as the drawing's own were.
     */
    this.post(
      DATA_OBSERVABILITY_API_ROUTES.lineageExpand,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const request: DataLineageExpandRequest | string =
          readDataLineageExpandRequest(req.body);

        if (typeof request === "string") {
          throw new BadDataException(request);
        }

        const expansion: DataLineageExpansion | null =
          await DataTableLineageReader.expand({
            projectId,
            request,
            now: OneUptimeDate.getCurrentDate(),
            reader: props,
          });

        if (!expansion) {
          throw new BadDataException(
            request.nodeId.startsWith("pipeline:")
              ? "Pipeline not found."
              : "Table not found.",
          );
        }

        return expansion as unknown as JSONObject;
      },
      { allowsApiKey: true },
    );

    /*
     * A table's lineage told in words, problems first - what the MCP
     * server's get_data_table_lineage asks. The table is named as for its
     * freshness: schema.table, its name alone, or its ID; a name several
     * databases share answers with each.
     */
    this.post(
      DATA_OBSERVABILITY_API_ROUTES.tableLineageAnswer,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const reference: string =
          typeof body["table"] === "string" ? body["table"].trim() : "";

        if (!reference) {
          throw new BadDataException(
            "Name the table: its schema.table key, its name, or its ID.",
          );
        }

        const depth: number = readDataLineageDepth(body["depth"]);
        const now: Date = OneUptimeDate.getCurrentDate();
        // Its tables' open alerts as the person, or API key, who asked may see them.
        const answers: Array<DataTableLineageAnswer> =
          await DataTableLineageAnswerer.answer({
            projectId,
            reference,
            depth,
            now,
            reader: props,
          });

        return {
          depth,
          tables: answers.map((answer: DataTableLineageAnswer): JSONObject => {
            return {
              ...(answer as unknown as JSONObject),
              answer: formatDataTableLineageAnswer(answer, now),
            };
          }),
        } as unknown as JSONObject;
      },
      { allowsApiKey: true },
    );

    // A pipeline's lineage: the tables it reads and writes, a step each way unless asked for more.
    this.post(
      DATA_OBSERVABILITY_API_ROUTES.pipelineLineage,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const dataPipelineId: string =
          typeof body["dataPipelineId"] === "string"
            ? body["dataPipelineId"]
            : "";

        if (!ObjectID.isValidUUID(dataPipelineId)) {
          throw new BadDataException("Name the pipeline by its ID.");
        }

        // Its tables' open alerts as the person who asked may see them.
        const lineage: DataTableLineage | null =
          await DataTableLineageReader.readPipeline({
            projectId,
            dataPipelineId: new ObjectID(dataPipelineId),
            depth: readDataLineageDepth(
              body["depth"],
              DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
            ),
            now: OneUptimeDate.getCurrentDate(),
            reader: props,
          });

        if (!lineage) {
          throw new BadDataException("Pipeline not found.");
        }

        return lineage as unknown as JSONObject;
      },
      { allowsApiKey: true },
    );

    /*
     * A data alert's lineage, with the ways to its cause and to the alerts
     * it caused: every alert as the person who asked may see it, so an
     * alert, or a cause, they may not see is not found.
     */
    this.post(
      DATA_OBSERVABILITY_API_ROUTES.alertLineage(":id"),
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const answer: DataAlertLineageAnswer | null =
          await DataAlertLineageReader.read({
            projectId,
            alertId: DataObservabilityAPI.readId(req),
            now: OneUptimeDate.getCurrentDate(),
            reader: props,
          });

        if (!answer) {
          throw new BadDataException("Alert not found.");
        }

        return answer as unknown as JSONObject;
      },
      { allowsApiKey: true },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.tableSensitivity,
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const dataAssetId: string =
          typeof body["dataAssetId"] === "string" ? body["dataAssetId"] : "";

        if (!ObjectID.isValidUUID(dataAssetId)) {
          throw new BadDataException("Name the table by its ID.");
        }

        return {
          columns: await DataTableSensitivity.read({
            projectId,
            dataAssetId: new ObjectID(dataAssetId),
          }),
        } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.reconciliationSync(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataReconciliationSync.sync({
          projectId,
          reconciliationId: DataObservabilityAPI.readId(req),
          props,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.reconciliationRunNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const reconciliation: DataReconciliation | null =
          await DataReconciliationService.findOneBy({
            query: { _id: DataObservabilityAPI.readId(req), projectId },
            select: {
              _id: true,
              sourceDataCheckId: true,
              targetDataCheckId: true,
            },
            props: { isRoot: true },
          });

        if (!reconciliation?.id) {
          throw new BadDataException("Reconciliation not found.");
        }

        const checkIds: Array<ObjectID> = [
          reconciliation.sourceDataCheckId,
          reconciliation.targetDataCheckId,
        ].filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

        if (checkIds.length < 2) {
          throw new BadDataException(
            "This reconciliation's checks are not set up yet: save it again to make them.",
          );
        }

        const now: Date = OneUptimeDate.getCurrentDate();
        const checks: Array<DataCheck> = await DataCheckService.findBy({
          query: { _id: QueryHelper.any(checkIds), projectId },
          select: { _id: true, dataStoreId: true },
          limit: checkIds.length,
          skip: 0,
          props: { isRoot: true },
        });

        for (const check of checks) {
          await DataCheckService.updateColumnsByIdWithoutHooks({
            id: check.id!,
            data: { nextRunAt: now } as never,
          });
        }

        // Each side's store collects right away, unless a probe does on its next poll.
        for (const dataStoreId of new Set(
          checks.map((check: DataCheck): string => {
            return check.dataStoreId!.toString();
          }),
        )) {
          const store: DataStore | null = await DataStoreService.findOneBy({
            query: { _id: new ObjectID(dataStoreId), projectId },
            select: { _id: true, scanProbeId: true },
            props: { isRoot: true },
          });

          if (store?.id) {
            await DataStoreService.updateColumnsByIdWithoutHooks({
              id: store.id,
              data: { nextTableHealthCollectionAt: now } as never,
            });

            if (!store.scanProbeId) {
              await queueTableHealthCollection({
                projectId,
                dataStoreId: store.id,
              });
            }
          }
        }

        return {};
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.dataProductBadgeReset(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const product: DataProduct | null = await DataProductService.findOneBy({
          query: { _id: DataObservabilityAPI.readId(req), projectId },
          select: { _id: true, projectId: true, name: true, badgeToken: true },
          props: { isRoot: true },
        });

        if (!product?.id) {
          throw new BadDataException("Data product not found.");
        }

        const badgeToken: string = ObjectID.generate().toString();

        await DataProductService.updateColumnsByIdWithoutHooks({
          id: product.id,
          data: { badgeToken } as never,
        });

        /*
         * Who reset the badge's link, and when: the old link stops showing
         * the badge. The token is OneUptime's to write and a secret, so the
         * entry says it changed, never what it is.
         */
        await AuditLogService.recordUpdate({
          model: new DataProduct(),
          before: product,
          updatedFields: { badgeToken },
          itemId: product.id,
          props,
          includeColumns: ["badgeToken"],
        });

        return { badgeToken };
      },
    );

    /*
     * The badge needs no sign-in - it is embedded where nobody has one - so
     * its secret is the token in its URL. An unknown product and a wrong
     * token answer alike. It is only ever loaded through <img>, and the
     * headers keep it inert when opened as a page.
     */
    this.router.get(
      DATA_OBSERVABILITY_API_ROUTES.dataProductBadge(":id"),
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const id: string = String(req.params["id"] || "");
          const token: string =
            typeof req.query["token"] === "string" ? req.query["token"] : "";
          const product: DataProduct | null =
            ObjectID.isValidUUID(id) && token
              ? await DataProductService.findOneBy({
                  query: { _id: new ObjectID(id) },
                  select: { badgeToken: true, status: true, dataAsOf: true },
                  props: { isRoot: true },
                })
              : null;

          if (
            !product?.badgeToken ||
            !DataObservabilityAPI.isSameSecret(product.badgeToken, token)
          ) {
            res.status(404).send("Not Found");
            return;
          }

          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; script-src 'none'; object-src 'none'",
          );
          res.send(
            renderDataProductBadge({
              status:
                (product.status as DataProductStatus) ||
                DataProductStatus.Unknown,
              dataAsOf: product.dataAsOf ? new Date(product.dataAsOf) : null,
            }),
          );
        } catch (error) {
          logger.error(error);
          res.status(500).send("Internal Server Error");
        }
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.checkRunNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const check: DataCheck | null = await DataCheckService.findOneBy({
          query: { _id: DataObservabilityAPI.readId(req), projectId },
          select: { _id: true, dataStoreId: true },
          props: { isRoot: true },
        });

        if (!check?.id || !check.dataStoreId) {
          throw new BadDataException("Data check not found.");
        }

        const now: Date = OneUptimeDate.getCurrentDate();

        await DataCheckService.updateColumnsByIdWithoutHooks({
          id: check.id,
          data: { nextRunAt: now } as never,
        });

        const store: DataStore | null = await DataStoreService.findOneBy({
          query: { _id: check.dataStoreId, projectId },
          select: { _id: true, scanProbeId: true },
          props: { isRoot: true },
        });

        if (store?.id) {
          await DataStoreService.updateColumnsByIdWithoutHooks({
            id: store.id,
            data: { nextTableHealthCollectionAt: now } as never,
          });

          // A probe's store is collected at its probe's next poll.
          if (!store.scanProbeId) {
            await queueTableHealthCollection({
              projectId,
              dataStoreId: store.id,
            });
          }
        }

        return {};
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.tableErrors,
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const dataAssetId: string =
          typeof body["dataAssetId"] === "string" ? body["dataAssetId"] : "";

        if (!ObjectID.isValidUUID(dataAssetId)) {
          throw new BadDataException("Name the table by its ID.");
        }

        return (await DataTableErrors.read({
          projectId,
          dataAssetId: new ObjectID(dataAssetId),
          now: OneUptimeDate.getCurrentDate(),
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.aiAppTables,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return {
          tables: await DataAiAppTables.readLate(
            projectId,
            OneUptimeDate.getCurrentDate(),
          ),
        } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.databaseServerStores,
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const databaseServerId: string =
          typeof body["databaseServerId"] === "string"
            ? body["databaseServerId"]
            : "";

        if (!ObjectID.isValidUUID(databaseServerId)) {
          throw new BadDataException("Name the database server by its ID.");
        }

        const linked: Array<DataStore> = await DataStoreService.findBy({
          query: {
            projectId,
            databaseServerId: new ObjectID(databaseServerId),
            isArchived: false,
          },
          select: { _id: true },
          skip: 0,
          limit: MAX_STORES,
          props: { isRoot: true },
        });
        const ids: Set<string> = new Set(
          linked.map((store: DataStore): string => {
            return store.id?.toString() || "";
          }),
        );

        return {
          stores: (
            await DataObservabilityAPI.getStoreSummaries(
              projectId,
              OneUptimeDate.getCurrentDate(),
            )
          ).filter((store: DataObservabilityStoreSummary) => {
            return ids.has(store.dataStoreId);
          }),
        } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.storagePaths,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        const stores: Array<DataStore> = await DataStoreService.findBy({
          query: {
            projectId,
            isArchived: false,
            kind: new Includes([...OBJECT_STORE_KINDS]),
          },
          select: {
            _id: true,
            name: true,
            kind: true,
            watchedPaths: true,
            tableHealthStatus: true,
            tableHealthMessage: true,
            tableHealthCollectedAt: true,
          },
          sort: { name: SortOrder.Ascending },
          skip: 0,
          limit: MAX_STORES,
          props: { isRoot: true },
        });

        return {
          stores: stores.map(
            (store: DataStore): DataObservabilityStoragePathStore => {
              return {
                dataStoreId: store.id!.toString(),
                name: store.name || "",
                kind: store.kind || "",
                watchedPaths: store.watchedPaths || "",
                status: store.tableHealthStatus || null,
                message: store.tableHealthMessage || null,
                collectedAt: store.tableHealthCollectedAt
                  ? OneUptimeDate.fromString(
                      store.tableHealthCollectedAt,
                    ).toISOString()
                  : null,
              };
            },
          ),
        } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.storagePathsSave(":id"),
      CONNECT_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const dataStoreId: ObjectID = DataObservabilityAPI.readId(req);
        const store: DataStore | null = await DataStoreService.findOneBy({
          query: {
            _id: dataStoreId,
            projectId,
            isArchived: false,
            kind: new Includes([...OBJECT_STORE_KINDS]),
          },
          select: {
            _id: true,
            projectId: true,
            name: true,
            kind: true,
            watchedPaths: true,
            isTableHealthEnabled: true,
          },
          props: { isRoot: true },
        });

        if (!store?.id) {
          throw new BadDataException("Bucket not found.");
        }

        const watchedPaths: string | null = normalizeWatchedPaths(
          ((req.body || {}) as JSONObject)["watchedPaths"],
        );

        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id,
          data: {
            watchedPaths,
            ...(watchedPaths
              ? {
                  isTableHealthEnabled: true,
                  nextTableHealthCollectionAt: null,
                }
              : {}),
          } as never,
        });

        // Written round the hooks, so recorded here: who set which paths to watch.
        await AuditLogService.recordUpdate({
          model: new DataStore(),
          before: store,
          updatedFields: {
            watchedPaths,
            ...(watchedPaths ? { isTableHealthEnabled: true } : {}),
          },
          itemId: store.id,
          props,
        });

        /*
         * With no paths left, nothing collects this bucket again: its tables are
         * called dropped now, as they would be at a collection, not left to go late.
         */
        if (!watchedPaths) {
          await TableHealthIngest.recordSnapshot({
            store: {
              id: store.id,
              projectId,
              name: store.name || "",
              kind: store.kind || "",
            },
            snapshot: {
              engine: "storage",
              collectedAt: OneUptimeDate.getCurrentDate().toISOString(),
              tables: [],
              isComplete: true,
              warnings: [],
            },
          });
        }

        return { watchedPaths } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_OBSERVABILITY_API_ROUTES.sourceSuggestions,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return {
          suggestions: await DataSourceSuggestions.read(projectId),
        } as unknown as JSONObject;
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
    const select: Select<DataStore> = {
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
      connectionString: true,
      cloudConnectionId: true,
      watchedPaths: true,
    };
    const stores: Array<DataStore> = [
      ...(await DataStoreService.findBy({
        query: {
          projectId,
          isArchived: false,
          kind: new Includes([...COLLECTABLE_KINDS]),
        },
        select,
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: MAX_STORES,
        props: { isRoot: true },
      })),
      // Buckets count once someone named paths of them, and a project can have thousands that don't.
      ...(await DataStoreService.findBy({
        query: {
          projectId,
          isArchived: false,
          kind: new Includes([...OBJECT_STORE_KINDS]),
          watchedPaths: QueryHelper.notNull(),
        },
        select,
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: MAX_STORES,
        props: { isRoot: true },
      })),
    ];

    const lateByStore: Map<string, number> = new Map();
    const alertsByStore: Map<string, number> =
      await DataObservabilityAttentionReader.getAlertMonitorCountByStore(
        projectId,
      );

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

    /*
     * A store with no way in is watched by nobody: it is one of the suggestions
     * (DataSourceSuggestions), not a database waiting for its first collection.
     */
    return stores
      .filter((store: DataStore) => {
        return Boolean(store.id) && isStoreConnected(store);
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
          alertMonitorCount: alertsByStore.get(store.id!.toString()) || 0,
        };
      });
  }

  // How each of some checks stands now, for a list of them: the Checks page's Status.
  public static async getCheckHealth(
    projectId: ObjectID,
    body: JSONObject,
    reader: DatabaseCommonInteractionProps,
  ): Promise<DataObservabilityCheckHealthResponse> {
    const given: unknown = body["dataCheckIds"];

    if (!Array.isArray(given)) {
      throw new BadDataException("Name the checks: dataCheckIds.");
    }

    const ids: Array<string> = Array.from(
      new Set(
        given.filter((id: unknown): id is string => {
          return typeof id === "string" && ObjectID.isValidUUID(id);
        }),
      ),
    );

    if (ids.length > MAX_CHECK_HEALTH_IDS) {
      throw new BadDataException(
        `Ask for at most ${MAX_CHECK_HEALTH_IDS} checks at a time.`,
      );
    }

    if (ids.length === 0) {
      return { checks: {} };
    }

    const checks: Array<DataCheck> = await DataCheckService.findBy({
      query: { projectId, _id: QueryHelper.any(ids) },
      select: {
        _id: true,
        checkType: true,
        isEnabled: true,
        lastRunAt: true,
        lastRunStatus: true,
        monitorId: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });
    const answers: Map<string, DataCheckHealthAnswer> =
      await DataObservabilityAttentionReader.getCheckHealth({
        projectId,
        reader,
        checks,
      });
    const response: DataObservabilityCheckHealthResponse = { checks: {} };

    for (const [id, answer] of answers) {
      response.checks[id] = answer;
    }

    return response;
  }

  public static async getOverview(
    projectId: ObjectID,
    // Whoever asked: the alerts named are the ones they may see. Read as nobody, none private.
    reader: DatabaseCommonInteractionProps = {},
  ): Promise<DataObservabilityOverview> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const stores: Array<DataObservabilityStoreSummary> =
      await this.getStoreSummaries(projectId, now);
    const assets: Array<DataAsset> = await this.readAssets(projectId);
    const lateAssets: Array<DataObservabilityOverviewAsset> = [];
    let assetCount: number = 0;
    let droppedAssetCount: number = 0;
    let unusedAssetCount: number = 0;
    let unusedSizeInBytes: number = 0;

    for (const asset of assets) {
      if (asset.isDropped) {
        droppedAssetCount++;
        continue;
      }

      assetCount++;

      if (isDataAssetUnused({ unreadSince: asset.unreadSince, now })) {
        unusedAssetCount++;
        unusedSizeInBytes += asset.sizeInBytes || 0;
      }

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
          dataStoreId: asset.dataStoreId?.toString() || null,
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

    const [attention, owners]: [
      DataObservabilityAttention,
      { tableOwnerCount: number; ownerRuleCount: number },
    ] = await Promise.all([
      DataObservabilityAttentionReader.read({
        projectId,
        now,
        reader,
        stores,
        lateAssets,
      }),
      DataObservabilityAttentionReader.getOwnerCounts(projectId),
    ]);
    // A database nobody watches needs no alerts: the ones watched do.
    const watchedStores: Array<DataObservabilityStoreSummary> = stores.filter(
      (store: DataObservabilityStoreSummary) => {
        return store.isTableHealthEnabled;
      },
    );
    const storesWithoutAlerts: Array<DataObservabilityStoreSummary> =
      watchedStores.filter((store: DataObservabilityStoreSummary) => {
        return store.alertMonitorCount === 0;
      });

    return {
      storeCount: stores.length,
      assetCount,
      lateAssetCount: lateAssets.length,
      droppedAssetCount,
      unusedAssetCount,
      unusedSizeInBytes,
      schemaChangeCount,
      failingStoreCount: stores.filter(
        (store: DataObservabilityStoreSummary) => {
          return store.isTableHealthEnabled && store.status === "Failed";
        },
      ).length,
      lateAssets: lateAssets.slice(0, OVERVIEW_LIST_LENGTH),
      recentChanges,
      stores,
      attention: attention.items.slice(0, MAX_DATA_ATTENTION_ITEMS),
      attentionCount: attention.items.length,
      failingCheckCount: attention.failingCheckCount,
      setup: {
        storeCount: watchedStores.length,
        storesWithAlertsCount:
          watchedStores.length - storesWithoutAlerts.length,
        firstStoreWithoutAlertsId: storesWithoutAlerts[0]?.dataStoreId || null,
        checkCount: attention.checkCount,
        pipelineCount: attention.pipelineCount,
        tableOwnerCount: owners.tableOwnerCount,
        ownerRuleCount: owners.ownerRuleCount,
      },
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

    const existingStoreId: unknown = body["dataStoreId"];

    // A store the project already knows of takes the connection, rather than a second row.
    if (typeof existingStoreId === "string" && existingStoreId) {
      return await DataObservabilityAPI.connectKnownStore({
        projectId,
        dataStoreId: existingStoreId,
        connectionString,
        probe,
        probeConnectionVariable: probeConnectionVariable as string | undefined,
      });
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
    // Data Observability reads the catalog; content scans are Data Security's to turn on.
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

  private static async connectKnownStore(data: {
    projectId: ObjectID;
    dataStoreId: string;
    connectionString: string;
    probe: Probe | null;
    probeConnectionVariable: string | undefined;
  }): Promise<DataObservabilityConnectStoreResponse> {
    if (!ObjectID.isValidUUID(data.dataStoreId)) {
      throw new BadDataException("Database not found.");
    }

    const known: DataStore | null = await DataStoreService.findOneBy({
      query: {
        _id: new ObjectID(data.dataStoreId),
        projectId: data.projectId,
        isArchived: false,
        kind: new Includes([...COLLECTABLE_KINDS]),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!known?.id) {
      throw new BadDataException("Database not found.");
    }

    await DataStoreService.updateOneById({
      id: known.id,
      data: {
        isTableHealthEnabled: true,
        ...(data.probe?.id
          ? {
              scanProbeId: data.probe.id,
              probeConnectionVariable: data.probeConnectionVariable,
            }
          : { connectionString: data.connectionString }),
      } as never,
      props: { isRoot: true },
    });

    if (!data.probe?.id) {
      await queueTableHealthCollection({
        projectId: data.projectId,
        dataStoreId: known.id,
      });
    }

    return { dataStoreId: known.id.toString() };
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
        unreadSince: true,
        sizeInBytes: true,
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
    // Whether a project API key may call it too: what a build in CI signs in with.
    options: { allowsApiKey: boolean } = { allowsApiKey: false },
  ): void {
    this.router.post(
      route,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID = options.allowsApiKey
            ? CommonAPI.assertAuthenticatedProjectPrincipal(props)
            : CommonAPI.assertAuthenticatedProjectMember(props);

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

  // Whether a secret given matches the one kept, compared in constant time.
  private static isSameSecret(kept: string, given: string): boolean {
    const a: Buffer = Buffer.from(kept);
    const b: Buffer = Buffer.from(given);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
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
    const id: string = String(req.params["id"] || "");

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("Data store not found.");
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: {
        _id: new ObjectID(id),
        projectId,
        kind: new Includes([...COLLECTABLE_KINDS, ...OBJECT_STORE_KINDS]),
      },
      /*
       * Its name, and whether its tables are watched, for the audit log's
       * entry when that is what the request changes.
       */
      select: {
        _id: true,
        projectId: true,
        name: true,
        scanProbeId: true,
        isTableHealthEnabled: true,
      },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    return store;
  }
}
