import { DataColumnSensitivity } from "Common/Types/DataObservability/DataColumnSensitivity";
import {
  DataAlertExplanation,
  DataAlertFeedback,
  DataObservabilityQuality,
} from "Common/Types/DataObservability/DataAlertFeedback";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityBiRefreshAlertResponse,
  DataObservabilityBiSyncResponse,
  DataObservabilityCheckAlertResponse,
  DataObservabilityCheckHealthRequest,
  DataObservabilityCheckHealthResponse,
  DataObservabilityCheckSuggestion,
  DataObservabilityConnectStoreRequest,
  DataObservabilityConnectStoreResponse,
  DataObservabilityDataProductBadgeResetResponse,
  DataObservabilityDataProductSyncResponse,
  DataObservabilityOverview,
  DataObservabilityReconciliationSyncResponse,
  DataObservabilityAiAppTable,
  DataObservabilitySourceSuggestion,
  DataObservabilitySpendSummary,
  DataObservabilityStoragePathStore,
  DataObservabilityTableErrors,
  DataObservabilityStoreSummary,
  DataObservabilityWatchedTables,
  DataObservabilityTableDashboard,
  MAX_CHECK_HEALTH_IDS,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { DataCheckHealthAnswer } from "Common/Types/DataObservability/DataObservabilityAttention";
import {
  DataAlertLineageAnswer,
  DataPipelineLineageRequest,
  DataTableLineage,
  DataTableLineageRequest,
} from "Common/Types/DataObservability/DataTableLineage";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
} from "Common/Types/DataObservability/DataLineageExpansion";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's side of Data Observability's own routes (Server/API/
 * DataObservabilityAPI.ts): the Overview, the watched stores, Collect Now,
 * Connect a Database, a data check's alert and Run Now, and a data
 * product's monitor and SLO and its badge. Every request goes through the
 * refresh-aware client with the project's headers, like every other page's.
 */

export class DataObservabilityApiError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function post(route: string, data: JSONObject = {}): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new DataObservabilityApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class DataObservabilityApi {
  public static async getOverview(): Promise<DataObservabilityOverview> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.overview,
    )) as unknown as DataObservabilityOverview;
  }

  public static async getStores(): Promise<
    Array<DataObservabilityStoreSummary>
  > {
    const body: JSONObject = await post(DATA_OBSERVABILITY_API_ROUTES.stores);

    return Array.isArray(body["stores"])
      ? (body["stores"] as unknown as Array<DataObservabilityStoreSummary>)
      : [];
  }

  // How many tables the project watches, and what they cost it.
  public static async getWatchedTables(): Promise<DataObservabilityWatchedTables> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.watchedTables,
    )) as unknown as DataObservabilityWatchedTables;
  }

  // Starts or stops reading a database.
  public static async setStoreWatched(
    dataStoreId: ObjectID,
    isWatched: boolean,
  ): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.storeWatch(dataStoreId.toString()),
      { isWatched },
    );
  }

  public static async collectNow(dataStoreId: ObjectID): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.collectNow(dataStoreId.toString()),
    );
  }

  // Makes a check's monitor match its alert condition: made, changed or removed.
  public static async syncCheckAlert(
    dataCheckId: ObjectID,
  ): Promise<DataObservabilityCheckAlertResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.checkAlert(dataCheckId.toString()),
    )) as unknown as DataObservabilityCheckAlertResponse;
  }

  // Makes the data product's monitor and SLO match it, as the person who saved it.
  public static async syncDataProduct(
    dataProductId: ObjectID,
  ): Promise<DataObservabilityDataProductSyncResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.dataProductSync(dataProductId.toString()),
    )) as unknown as DataObservabilityDataProductSyncResponse;
  }

  // A new secret for the product's badge: badges embedded with the old one stop working.
  public static async resetDataProductBadge(
    dataProductId: ObjectID,
  ): Promise<DataObservabilityDataProductBadgeResetResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.dataProductBadgeReset(
        dataProductId.toString(),
      ),
    )) as unknown as DataObservabilityDataProductBadgeResetResponse;
  }

  // The badge's address, to embed where nobody signs in: its token is its secret.
  public static getDataProductBadgeUrl(
    dataProductId: ObjectID,
    badgeToken: string,
  ): string {
    return URL.fromString(APP_API_URL.toString())
      .addRoute(
        DATA_OBSERVABILITY_API_ROUTES.dataProductBadge(
          dataProductId.toString(),
        ),
      )
      .addQueryParam("token", badgeToken)
      .toString();
  }

  // Makes the reconciliation's two checks and its monitor match it, as the person who saved it.
  public static async syncReconciliation(
    reconciliationId: ObjectID,
  ): Promise<DataObservabilityReconciliationSyncResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.reconciliationSync(
        reconciliationId.toString(),
      ),
    )) as unknown as DataObservabilityReconciliationSyncResponse;
  }

  // Reads both sides at their stores' very next collections, together.
  public static async runReconciliationNow(
    reconciliationId: ObjectID,
  ): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.reconciliationRunNow(
        reconciliationId.toString(),
      ),
    );
  }

  /*
   * OneUptime AI writes a Custom SQL check from a rule in a sentence, for
   * the person to review: its name and explanation in the language they
   * read OneUptime in (#7220).
   */
  public static async suggestCheck(
    dataAssetId: ObjectID,
    sentence: string,
    language: string,
  ): Promise<DataObservabilityCheckSuggestion> {
    return (await post(DATA_OBSERVABILITY_API_ROUTES.checkSuggest, {
      dataAssetId: dataAssetId.toString(),
      sentence,
      language,
    })) as unknown as DataObservabilityCheckSuggestion;
  }

  // Makes the BI tool's monitor on failed refreshes match it, as the person who saved it.
  public static async syncBiRefreshAlert(
    dataBiConnectionId: ObjectID,
  ): Promise<DataObservabilityBiRefreshAlertResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.biRefreshAlert(
        dataBiConnectionId.toString(),
      ),
    )) as unknown as DataObservabilityBiRefreshAlertResponse;
  }

  // Reads a BI tool's dashboards now, and says how it went.
  public static async syncBiConnection(
    dataBiConnectionId: ObjectID,
  ): Promise<DataObservabilityBiSyncResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.biSync(dataBiConnectionId.toString()),
    )) as unknown as DataObservabilityBiSyncResponse;
  }

  public static async getAlertExplanation(
    alertId: ObjectID,
  ): Promise<DataAlertExplanation | null> {
    const response: JSONObject = await post(
      DATA_OBSERVABILITY_API_ROUTES.alertExplanation(alertId.toString()),
    );

    return (response["explanation"] ||
      null) as unknown as DataAlertExplanation | null;
  }

  public static async sendAlertFeedback(
    alertId: ObjectID,
    data: { feedback?: DataAlertFeedback; isCauseConfirmed?: boolean },
  ): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.alertFeedback(alertId.toString()),
      data as unknown as JSONObject,
    );
  }

  // How well Data Observability is working for the project.
  public static async getQuality(): Promise<DataObservabilityQuality> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.quality,
    )) as unknown as DataObservabilityQuality;
  }

  // What the project's warehouses spent over the last day.
  public static async getSpendSummary(): Promise<DataObservabilitySpendSummary> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.spendSummary,
    )) as unknown as DataObservabilitySpendSummary;
  }

  // The dashboards built on a table, and on the tables built from it.
  public static async getTableDashboards(
    dataAssetId: ObjectID,
  ): Promise<Array<DataObservabilityTableDashboard>> {
    const response: JSONObject = (await post(
      DATA_OBSERVABILITY_API_ROUTES.tableDashboards,
      { dataAssetId: dataAssetId.toString() },
    )) as JSONObject;

    return (Array.isArray(response["dashboards"])
      ? response["dashboards"]
      : []) as unknown as Array<DataObservabilityTableDashboard>;
  }

  /*
   * A table's lineage several steps each way, with how each table on it is
   * now - and, asked for, the columns each arrow between two tables carries.
   */
  public static async getTableLineage(
    dataAssetId: ObjectID,
    depth: number,
    withColumns: boolean = false,
  ): Promise<DataTableLineage> {
    const request: DataTableLineageRequest = {
      dataAssetId: dataAssetId.toString(),
      depth,
      ...(withColumns ? { withColumns: true } : {}),
    };

    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.tableLineage,
      request as unknown as JSONObject,
    )) as unknown as DataTableLineage;
  }

  // A pipeline's lineage: the tables it reads and writes, and the steps beyond them.
  public static async getPipelineLineage(
    dataPipelineId: ObjectID,
    depth: number,
  ): Promise<DataTableLineage> {
    const request: DataPipelineLineageRequest = {
      dataPipelineId: dataPipelineId.toString(),
      depth,
    };

    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.pipelineLineage,
      request as unknown as JSONObject,
    )) as unknown as DataTableLineage;
  }

  // The next tables a card of a lineage diagram does not draw: what pressing its count asks.
  public static async expandLineage(
    request: DataLineageExpandRequest,
  ): Promise<DataLineageExpansion> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.lineageExpand,
      request as unknown as JSONObject,
    )) as unknown as DataLineageExpansion;
  }

  // A data alert's lineage, with the ways to its cause and to the alerts it caused.
  public static async getAlertLineage(
    alertId: ObjectID,
  ): Promise<DataAlertLineageAnswer> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.alertLineage(alertId.toString()),
    )) as unknown as DataAlertLineageAnswer;
  }

  // The databases the project knows of that nobody has connected.
  public static async getSourceSuggestions(): Promise<
    Array<DataObservabilitySourceSuggestion>
  > {
    const response: JSONObject = (await post(
      DATA_OBSERVABILITY_API_ROUTES.sourceSuggestions,
    )) as JSONObject;

    return (Array.isArray(response["suggestions"])
      ? response["suggestions"]
      : []) as unknown as Array<DataObservabilitySourceSuggestion>;
  }

  public static async getTableErrors(
    dataAssetId: ObjectID,
  ): Promise<DataObservabilityTableErrors> {
    return (await post(DATA_OBSERVABILITY_API_ROUTES.tableErrors, {
      dataAssetId: dataAssetId.toString(),
    })) as unknown as DataObservabilityTableErrors;
  }

  public static async getAiAppTables(): Promise<
    Array<DataObservabilityAiAppTable>
  > {
    const response: JSONObject = (await post(
      DATA_OBSERVABILITY_API_ROUTES.aiAppTables,
    )) as JSONObject;

    return (Array.isArray(response["tables"])
      ? response["tables"]
      : []) as unknown as Array<DataObservabilityAiAppTable>;
  }

  public static async getStoresOfDatabaseServer(
    databaseServerId: ObjectID,
  ): Promise<Array<DataObservabilityStoreSummary>> {
    const response: JSONObject = (await post(
      DATA_OBSERVABILITY_API_ROUTES.databaseServerStores,
      { databaseServerId: databaseServerId.toString() },
    )) as JSONObject;

    return (Array.isArray(response["stores"])
      ? response["stores"]
      : []) as unknown as Array<DataObservabilityStoreSummary>;
  }

  public static async getStoragePaths(): Promise<
    Array<DataObservabilityStoragePathStore>
  > {
    const response: JSONObject = (await post(
      DATA_OBSERVABILITY_API_ROUTES.storagePaths,
    )) as JSONObject;

    return (Array.isArray(response["stores"])
      ? response["stores"]
      : []) as unknown as Array<DataObservabilityStoragePathStore>;
  }

  public static async saveStoragePaths(
    dataStoreId: ObjectID,
    watchedPaths: string,
  ): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.storagePathsSave(dataStoreId.toString()),
      { watchedPaths },
    );
  }

  // What Data Security knows each of a table's columns holds.
  public static async getTableSensitivity(
    dataAssetId: ObjectID,
  ): Promise<Array<DataColumnSensitivity>> {
    const response: JSONObject = (await post(
      DATA_OBSERVABILITY_API_ROUTES.tableSensitivity,
      { dataAssetId: dataAssetId.toString() },
    )) as JSONObject;

    return (Array.isArray(response["columns"])
      ? response["columns"]
      : []) as unknown as Array<DataColumnSensitivity>;
  }

  // How each of some checks stands now: by check id, the ones found.
  public static async getCheckHealth(
    dataCheckIds: Array<string>,
  ): Promise<Map<string, DataCheckHealthAnswer>> {
    const answers: Map<string, DataCheckHealthAnswer> = new Map();

    for (
      let start: number = 0;
      start < dataCheckIds.length;
      start += MAX_CHECK_HEALTH_IDS
    ) {
      const request: DataObservabilityCheckHealthRequest = {
        dataCheckIds: dataCheckIds.slice(start, start + MAX_CHECK_HEALTH_IDS),
      };
      const body: JSONObject = await post(
        DATA_OBSERVABILITY_API_ROUTES.checkHealth,
        request as unknown as JSONObject,
      );
      const checks: unknown = body["checks"];

      if (checks && typeof checks === "object" && !Array.isArray(checks)) {
        for (const [id, answer] of Object.entries(
          checks as DataObservabilityCheckHealthResponse["checks"],
        )) {
          answers.set(id, answer);
        }
      }
    }

    return answers;
  }

  public static async runCheckNow(dataCheckId: ObjectID): Promise<void> {
    await post(
      DATA_OBSERVABILITY_API_ROUTES.checkRunNow(dataCheckId.toString()),
    );
  }

  public static async connectStore(
    request: DataObservabilityConnectStoreRequest,
  ): Promise<DataObservabilityConnectStoreResponse> {
    return (await post(
      DATA_OBSERVABILITY_API_ROUTES.connectStore,
      request as unknown as JSONObject,
    )) as unknown as DataObservabilityConnectStoreResponse;
  }
}
