import AuditLog from "../../Models/AnalyticsModels/AuditLog";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  AuditLogRelatedRecords,
  toAuditLogRelatedRecordsJSON,
} from "../../Utils/AuditLog/AuditLogRelatedRecords";
import UserMiddleware from "../Middleware/UserAuthorization";
import AuditLogServiceInstance, {
  AuditLogService,
} from "../Services/AuditLogService";
import AuditLogRelatedNames from "../Utils/AuditLog/AuditLogRelatedNames";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAnalyticsAPI from "./BaseAnalyticsAPI";
import CommonAPI from "./CommonAPI";

/*
 * The audit log's API: its CRUD and aggregate reads (BaseAnalyticsAPI, each
 * held to its reader, #10642), and one read of its own.
 *
 *   GET /audit-log/:id/related-record-names
 *
 * The names of the records an entry's changes name - a monitor's status, an
 * incident's labels - read now, with the caller's own permissions
 * (AuditLogRelatedNames, #10470), for the changes dialog. It reads the
 * entry with the caller's read first: an entry they may not read is not
 * found, and a value of it they may not read names nothing.
 */
export default class AuditLogAPI extends BaseAnalyticsAPI<
  AuditLog,
  AuditLogService
> {
  public constructor(service: AuditLogService = AuditLogServiceInstance) {
    super(AuditLog, service);

    this.router.get(
      `${new AuditLog().crudApiPath?.toString()}/:id/related-record-names`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const id: string = String(req.params["id"] || "");

          if (!ObjectID.isValidUUID(id)) {
            throw new BadDataException("Audit Log ID is not valid.");
          }

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const records: AuditLogRelatedRecords =
            await AuditLogRelatedNames.readForEntry({
              auditLogId: new ObjectID(id),
              props,
              service: this.service,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            toAuditLogRelatedRecordsJSON(records),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
