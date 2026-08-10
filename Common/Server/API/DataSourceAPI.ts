import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DataSourceService, {
  Service as DataSourceServiceType,
} from "../Services/DataSourceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import DataSource from "../../Models/DatabaseModels/DataSource";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import DataSourceTableResult from "../../Types/DataSource/DataSourceTableResult";
import { DataSourceResultKind } from "../../Types/DataSource/DataSourceQueryConfig";
import {
  DataSourceConnectionSettings,
  DataSourceConnector,
} from "../Utils/DataSource/Types";
import ConnectorRegistry from "../Utils/DataSource/ConnectorRegistry";
import logger from "../Utils/Logger";

/*
 * Upper bound on stored/ad-hoc query text. Real PromQL/SQL/DSL queries are
 * a few KB; anything beyond this is abuse or a mistake.
 */
const MAX_QUERY_LENGTH: number = 100_000;

export default class DataSourceAPI extends BaseAPI<
  DataSource,
  DataSourceServiceType
> {
  public constructor() {
    super(DataSource, DataSourceService);

    /*
     * Test a data source's connectivity + credentials. Authenticated
     * users only; access is checked by reading the record with the
     * caller's own permissions before any root read of credentials.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = req.body;

          const dataSource: DataSource = await this.getAccessibleDataSource({
            req,
            dataSourceId: body["dataSourceId"] as string,
          });

          const settings: DataSourceConnectionSettings =
            await this.getConnectionSettings(dataSource);

          const connector: DataSourceConnector = ConnectorRegistry.getConnector(
            settings.dataSourceType,
          );

          try {
            await connector.testConnection(settings);
          } catch (err) {
            logger.error(err);
            return Response.sendJsonObjectResponse(req, res, {
              ok: false,
              message: this.toFriendlyErrorMessage(err),
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            ok: true,
            message: "Connection successful.",
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Execute a query against a data source and return normalized time
     * series (for chart/value/gauge widgets) or rows (for the table
     * widget).
     *
     * SECURITY: authenticated project users only — this route must NEVER
     * be reachable from the anonymous public-dashboard surface, because
     * it executes caller-supplied query text. Public dashboards render a
     * placeholder for data-source widgets instead.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/query`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = req.body;

          const query: string = (body["query"] as string) || "";
          if (!query || query.trim().length === 0) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("query is required"),
            );
          }
          if (query.length > MAX_QUERY_LENGTH) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("query is too long"),
            );
          }

          const resultKind: DataSourceResultKind =
            body["resultKind"] === DataSourceResultKind.Table
              ? DataSourceResultKind.Table
              : DataSourceResultKind.TimeSeries;

          const startDate: Date = new Date(body["startDate"] as string);
          const endDate: Date = new Date(body["endDate"] as string);
          if (
            isNaN(startDate.getTime()) ||
            isNaN(endDate.getTime()) ||
            startDate.getTime() >= endDate.getTime()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "A valid startDate and endDate are required (startDate must be before endDate).",
              ),
            );
          }

          let stepInSeconds: number | undefined = undefined;
          if (body["stepInSeconds"] !== undefined) {
            const parsedStep: number = Number(body["stepInSeconds"]);
            if (Number.isFinite(parsedStep) && parsedStep > 0) {
              // Floor, but never to 0 — Loki/Prometheus reject step=0.
              stepInSeconds = Math.max(1, Math.floor(parsedStep));
            }
          }

          const dataSource: DataSource = await this.getAccessibleDataSource({
            req,
            dataSourceId: body["dataSourceId"] as string,
          });

          const settings: DataSourceConnectionSettings =
            await this.getConnectionSettings(dataSource);

          const connector: DataSourceConnector = ConnectorRegistry.getConnector(
            settings.dataSourceType,
          );

          try {
            if (resultKind === DataSourceResultKind.Table) {
              const tableResult: DataSourceTableResult =
                await connector.queryTable(settings, query, {
                  startDate,
                  endDate,
                  stepInSeconds,
                });
              return Response.sendJsonObjectResponse(req, res, {
                resultKind: DataSourceResultKind.Table,
                result: tableResult as unknown as JSONObject,
              });
            }

            const timeSeriesResult: AggregatedResult =
              await connector.queryTimeSeries(settings, query, {
                startDate,
                endDate,
                stepInSeconds,
              });

            return Response.sendJsonObjectResponse(req, res, {
              resultKind: DataSourceResultKind.TimeSeries,
              result: timeSeriesResult as unknown as JSONObject,
            });
          } catch (err) {
            logger.error(err);
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Data source query failed: ${this.toFriendlyErrorMessage(err)}`,
              ),
            );
          }
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Two-phase access pattern (same as LlmProviderAPI /test): first read
   * the record with the CALLER'S permissions — wrong project or missing
   * ReadDataSource yields null — and only then may callers proceed to a
   * root read of credentials.
   */
  private async getAccessibleDataSource(data: {
    req: ExpressRequest;
    dataSourceId: string;
  }): Promise<DataSource> {
    if (!data.dataSourceId) {
      throw new BadDataException("dataSourceId is required");
    }

    if (!ObjectID.isValidUUID(data.dataSourceId)) {
      throw new BadDataException(
        "Data source not found, or you do not have access to it.",
      );
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(data.req);

    const accessibleDataSource: DataSource | null =
      await DataSourceService.findOneById({
        id: new ObjectID(data.dataSourceId),
        select: {
          _id: true,
          projectId: true,
          dataSourceType: true,
        },
        props: props,
      });

    if (!accessibleDataSource) {
      throw new BadDataException(
        "Data source not found, or you do not have access to it.",
      );
    }

    return accessibleDataSource;
  }

  private async getConnectionSettings(
    dataSource: DataSource,
  ): Promise<DataSourceConnectionSettings> {
    const settings: DataSourceConnectionSettings | null =
      await DataSourceService.getConnectionSettingsById(dataSource.id!);

    if (!settings) {
      throw new BadDataException("Data source configuration is incomplete.");
    }

    return settings;
  }

  private toFriendlyErrorMessage(err: unknown): string {
    const message: string =
      err instanceof Exception
        ? err.message
        : "Could not reach the data source. Please verify the connection details.";
    return message.substring(0, 1000);
  }
}
