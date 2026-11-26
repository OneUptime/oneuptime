import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import ProbeService from "Common/Server/Services/ProbeService";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import SnmpTrapReceiverUsers from "Common/Server/Utils/Monitor/SnmpTrapReceiverUsers";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
} from "Common/Types/Probe/SnmpTrapReceiver";

/*
 * A probe's SNMP trap receiver, every thirty seconds (OneUptime issue
 * #11005; Types/Probe/SnmpTrapReceiver):
 *
 *   POST /probe/snmp-trap/receiver
 *     { snmpTrapReceiver: SnmpTrapReceiverReport }
 *   -> { users: Array<SnmpTrapReceiverUser>, isReportKept: boolean }
 *
 * The probe says how its receiver is - its engine ID, how many SNMPv3 users
 * it has, the SNMPv3 traps it refused - and is handed back the SNMPv3 users
 * of the devices assigned to it, which replace the ones it had. The probe is
 * the AUTHENTICATED one, never one named in the body: a probe only ever
 * hears its own devices' users, and only ever writes its own report.
 *
 * A receiver that is off is handed no users. A report is kept for a
 * project's own probes only (ProbeService.recordSnmpTrapReceiverReport); a
 * global probe still gets the users of the devices assigned to it.
 */

const router: ExpressRouter = Express.getRouter();

export const INVALID_REPORT_MESSAGE: string =
  "snmpTrapReceiver must be an object with isEnabled true or false";

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

router.post(
  "/probe/snmp-trap/receiver",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = req.probe?.id || null;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const report: SnmpTrapReceiverReport | null =
        SnmpTrapReceiverUtil.sanitizeReport(readBody(req)["snmpTrapReceiver"]);

      if (!report) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(INVALID_REPORT_MESSAGE),
        );
      }

      const isReportKept: boolean =
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: probeId,
          report: report,
        });

      const users: Array<SnmpTrapReceiverUser> = report.isEnabled
        ? await SnmpTrapReceiverUsers.getUsersForProbe(probeId)
        : [];

      return Response.sendJsonObjectResponse(req, res, {
        users: users as unknown as JSONArray,
        isReportKept: isReportKept,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
