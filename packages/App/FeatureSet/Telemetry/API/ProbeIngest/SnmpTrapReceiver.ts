import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import SnmpTrapReceiverReports from "Common/Server/Utils/Monitor/SnmpTrapReceiverReports";
import SnmpTrapReceiverUsers from "Common/Server/Utils/Monitor/SnmpTrapReceiverUsers";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
} from "Common/Types/Probe/SnmpTrapReceiver";
import ProbeConnectionRefusals from "Common/Types/Probe/ProbeConnectionRefusals";

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
 * it may take traps from, which replace the ones it had: those of the
 * devices assigned to it, and the default credential profiles of the sites
 * whose Default Probe it is (SnmpTrapReceiverUsers). The probe is the
 * AUTHENTICATED one, never one named in the body: a probe only ever hears
 * its own devices' and sites' users, and only ever writes its own report.
 *
 * A receiver that is off is handed no users. A project's own probe keeps
 * its report whole; a global probe keeps on itself only what belongs to no
 * project, and each project's refused traps are kept for that project alone
 * (SnmpTrapReceiverReports, #11173).
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
        // What every probe route says when its key check named no probe.
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(ProbeConnectionRefusals.unknownProbe),
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

      /*
       * The users first: a global probe's refusals are split by project
       * against the user names each project handed it (#11173).
       */
      const users: Array<SnmpTrapReceiverUser> = report.isEnabled
        ? await SnmpTrapReceiverUsers.getUsersForProbe(probeId)
        : [];

      const isReportKept: boolean = await SnmpTrapReceiverReports.record({
        probeId: probeId,
        report: report,
        users: users,
      });

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
