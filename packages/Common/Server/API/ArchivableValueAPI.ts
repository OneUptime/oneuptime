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
import BadDataException from "../../Types/Exception/BadDataException";
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
 *   POST /api/<value>/:id/usage
 *
 * answers how many of the project's records use the value, by the way they
 * reach it, and what deleting it would do to each (ArchivableValueUsage):
 * `{ usage: [{ tableName, title, count, isCountCapped, effect, kind }] }`.
 *
 * Only someone who may archive or delete the value is answered - its editors
 * and deleters - and only about a value of the project they ask in that they
 * may read. The counts are read as OneUptime, and nothing but counts comes
 * back: no record is named.
 */
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

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/usage`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getUsage(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  @CaptureSpan()
  public async getUsage(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const idText: string = (req.params["id"] || "").toString().trim();

    if (!ObjectID.isValidUUID(idText)) {
      throw new BadDataException(
        `Invalid ID for ${new this.entityType().singularName || "this value"}.`,
      );
    }

    const projectId: ObjectID | null = this.getTenantId(req);

    if (!projectId) {
      throw new BadDataException(
        "Project ID is required. Send it in the projectid header.",
      );
    }

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
      id: new ObjectID(idText),
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
        valueId: new ObjectID(idText),
        projectId: projectId,
      });

    return Response.sendJsonObjectResponse(req, res, {
      usage: ArchivableValueUsageItems.toJSONArray(usage),
    });
  }
}
