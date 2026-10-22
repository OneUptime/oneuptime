import UserMiddleware from "../Middleware/UserAuthorization";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import DatabaseService from "../Services/DatabaseService";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
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
} from "../../Types/ArchivableValue/ArchivableValueUsage";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
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
 *                    effect, kind }] }
 *
 * how many of the project's records use the value, by the way they reach
 * it, and what deleting it would do to each (ArchivableValueUsage).
 *
 * It takes what archiving or deleting the value takes - its editors and
 * deleters - and only a value of the project asked about that the caller may
 * read. The counts are read as OneUptime, and nothing but counts comes back:
 * no record is named.
 */
export const ARCHIVABLE_VALUE_USAGE_ROUTE: string = "/usage";

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

    const route: string = `${new this.entityType()
      .getCrudApiPath()
      ?.toString()}/:id${ARCHIVABLE_VALUE_USAGE_ROUTE}`;

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
        await this.getUsage(req, res);
      } catch (error) {
        next(error);
      }
    };

    this.router.post(route, UserMiddleware.getUserMiddleware, handler);
    this.router.get(route, UserMiddleware.getUserMiddleware, handler);
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

    // Someone who may archive the value (an update), or delete it.
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

    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new ServerException("The database is not connected.");
    }

    const usage: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: dataSource,
        valueTable: new this.entityType().tableName || "",
        valueId: new ObjectID(idParam),
        projectId: projectId,
      });

    Response.setNoCacheHeaders(res);
    return Response.sendJsonObjectResponse(req, res, {
      usage: ArchivableValueUsageItems.toJSONArray(usage),
    });
  }
}
