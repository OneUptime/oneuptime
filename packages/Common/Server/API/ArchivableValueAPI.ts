import UserMiddleware from "../Middleware/UserAuthorization";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import DatabaseService from "../Services/DatabaseService";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import QueryHelper from "../Types/Database/QueryHelper";
import ModelPermission from "../Types/Database/Permissions/Index";
import ArchivableValueUsage from "../Utils/Database/ArchivableValueUsage";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ArchivableValueUsageItems, {
  ArchivableValueUsageItem,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "../../Types/ArchivableValue/ArchivableValueUsage";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isArchivableValueTable } from "../../Utils/ArchivableValues";
import { DataSource } from "typeorm";

/*
 * The API of a value records pick from - a state, a severity, a monitor
 * status, a label, an incident role (Common/Utils/ArchivableValues): every
 * request BaseAPI answers, and one more, asked by the dashboard's Archive
 * and Delete dialogs before they open:
 *
 *   POST (or GET) /<route>/:id/usage
 *     -> { usage: [{ tableName, title, singularTitle, count, isCountCapped,
 *                    totalCount?, isTotalCountCapped?, effect, kind }] }
 *
 * how many of the project's records use the value, by the way they reach
 * it, and what deleting it would do to each (ArchivableValueUsage) - and,
 * for a bulk Archive or Delete of several values at once:
 *
 *   POST /<route>/usage   { ids: [...], purpose: "Archive" | "Delete" }
 *     -> { usage, refusedValueIds, refusedUsage }
 *
 * every use of any of them (Archive), or which of them records still have
 * - with what has them - and what deleting the rest changes (Delete), each
 * record or person counted once however many of the values it has.
 *
 * It takes what archiving or deleting the value takes - its editors and
 * deleters - and only values of the project asked about that the caller may
 * read. The counts are read as OneUptime, and nothing but counts comes back:
 * no record is named.
 */
export const ARCHIVABLE_VALUE_USAGE_ROUTE: string = "/usage";

/*
 * The most values one bulk read asks about: as many as a table's bulk
 * selection holds (BaseModelTable's select-all stops at LIMIT_PER_PROJECT).
 */
export const ARCHIVABLE_VALUES_USAGE_MAX_IDS: number = LIMIT_PER_PROJECT;

export default class ArchivableValueAPI<
  TBaseModel extends BaseModel,
  TBaseService extends DatabaseService<BaseModel>,
> extends BaseAPI<TBaseModel, TBaseService> {
  public constructor(type: { new (): TBaseModel }, service: TBaseService) {
    super(type, service);

    if (!isArchivableValueTable(new this.entityType().tableName)) {
      throw new ServerException(
        `${new this.entityType().tableName} is not a value that can be archived.`,
      );
    }

    const apiPath: string = `${new this.entityType()
      .getCrudApiPath()
      ?.toString()}`;
    const route: string = `${apiPath}/:id${ARCHIVABLE_VALUE_USAGE_ROUTE}`;
    const bulkRoute: string = `${apiPath}${ARCHIVABLE_VALUE_USAGE_ROUTE}`;

    const handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        if (req.params["id"]) {
          await this.getUsage(req, res);
        } else {
          await this.getValuesUsage(req, res);
        }
      } catch (error) {
        next(error);
      }
    };

    this.router.post(route, UserMiddleware.getUserMiddleware, handler);
    this.router.get(route, UserMiddleware.getUserMiddleware, handler);
    // Several values at once: the body names them. The same handler.
    this.router.post(bulkRoute, UserMiddleware.getUserMiddleware, handler);
  }

  // Someone who may archive the value (an update), or delete it.
  private checkMayManage(props: DatabaseCommonInteractionProps): void {
    try {
      ModelPermission.checkTableWritePermission(
        this.entityType,
        props,
        DatabaseRequestType.Update,
        { isArchived: true },
      );
    } catch (updateRefusal) {
      try {
        ModelPermission.checkTableWritePermission(
          this.entityType,
          props,
          DatabaseRequestType.Delete,
        );
      } catch {
        throw updateRefusal;
      }
    }
  }

  private getDataSource(): DataSource {
    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new ServerException("The database is not connected.");
    }

    return dataSource;
  }

  @CaptureSpan()
  public async getUsage(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    this.checkMayManage(props);

    // A value of this project the caller may read.
    const value: BaseModel | null = await this.service.findOneById({
      id: new ObjectID(idParam),
      select: {
        _id: true,
      },
      props: props,
    });

    if (!value) {
      throw new NotFoundException(
        `${new this.entityType().singularName || "Value"} not found.`,
      );
    }

    const usage: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: this.getDataSource(),
        valueTable: new this.entityType().tableName || "",
        valueId: new ObjectID(idParam),
        projectId: projectId,
      });

    Response.setNoCacheHeaders(res);
    return Response.sendJsonObjectResponse(req, res, {
      usage: ArchivableValueUsageItems.toJSONArray(usage),
    });
  }

  /*
   * Several values at once, for a bulk Archive's or Delete's dialog: the
   * ids in the body, and what the dialog is for.
   */
  @CaptureSpan()
  public async getValuesUsage(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const body: JSONObject = (req.body || {}) as JSONObject;
    const purpose: ArchivableValuesUsagePurpose =
      body["purpose"] === ArchivableValuesUsagePurpose.Delete
        ? ArchivableValuesUsagePurpose.Delete
        : ArchivableValuesUsagePurpose.Archive;

    if (!Array.isArray(body["ids"]) || body["ids"].length === 0) {
      throw new BadDataException("ids should be a list of value ids.");
    }

    if (body["ids"].length > ARCHIVABLE_VALUES_USAGE_MAX_IDS) {
      throw new BadDataException(
        `Ask about at most ${ARCHIVABLE_VALUES_USAGE_MAX_IDS} values at once.`,
      );
    }

    const askedIds: Array<string> = [];

    for (const id of body["ids"]) {
      if (typeof id !== "string") {
        throw new BadDataException("ids should be a list of value ids.");
      }

      ObjectID.validateUUID(id);
      askedIds.push(id);
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    this.checkMayManage(props);

    const ids: Array<string> =
      ArchivableValueUsage.normalizeValueIds(askedIds);

    // The values of this project the caller may read, among those asked.
    const values: Array<BaseModel> = await this.service.findBy({
      query: {
        _id: QueryHelper.any(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: ids.length,
      props: props,
    });

    if (values.length === 0) {
      throw new NotFoundException(
        `${new this.entityType().pluralName || "Values"} not found.`,
      );
    }

    const usage: ArchivableValuesUsage =
      await ArchivableValueUsage.countValuesUsage({
        dataSource: this.getDataSource(),
        valueTable: new this.entityType().tableName || "",
        valueIds: values.map((value: BaseModel): string => {
          return (value._id || value.id || "").toString();
        }),
        projectId: projectId,
        purpose: purpose,
      });

    Response.setNoCacheHeaders(res);
    return Response.sendJsonObjectResponse(
      req,
      res,
      ArchivableValueUsageItems.valuesUsageToJSON(usage),
    );
  }
}
