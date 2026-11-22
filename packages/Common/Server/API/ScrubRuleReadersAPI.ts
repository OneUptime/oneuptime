import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "../../Types/Telemetry/ScrubRule";
import {
  SCRUB_RULE_READERS_API_PATH,
  TelemetryFieldReaders,
  TelemetryFieldSignal,
} from "../../Types/Telemetry/TelemetryFieldReaders";
import LogScrubAction from "../../Types/Log/LogScrubAction";
import { ScrubRuleReading } from "../../Utils/Telemetry/ScrubRuleFieldReads";
import { findScrubRuleReaders } from "../Utils/DataSecurity/Telemetry/TelemetryScrubImpact";

const router: ExpressRouter = Express.getRouter();

/*
 * WHAT A SCRUB RULE BEING WRITTEN WOULD TAKE AWAY (#10433).
 *
 * The log and trace scrub rule forms ask before a rule is saved, and a
 * rule's Enable asks before it is turned on: the monitors, dashboards,
 * saved views, recording rules and SLOs that read what the rule would hide,
 * and what Security Events would lose (DataSecurity/Telemetry/
 * TelemetryScrubImpact.findScrubRuleReaders) - the same lookup Scrub It's
 * dialog asks. It never refuses a rule: it says, and the person decides.
 *
 * For whoever may write a log or trace scrub rule, and named as they may
 * read each record: the rest are counted. It reads; it changes nothing.
 */
export const SCRUB_RULE_READERS_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectLogScrubRule,
  Permission.EditProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
  Permission.EditProjectTraceScrubRule,
];

function readOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/*
 * The rule the request describes, held to what a saved rule may say: a
 * signal, one of its pattern types, its fields and an action of the known
 * words, and a service by its id. Refuses (BadDataException) anything else.
 */
export function readScrubRuleReadersRequest(body: unknown): ScrubRuleReading {
  const json: JSONObject = (
    body && typeof body === "object" && !Array.isArray(body) ? body : {}
  ) as JSONObject;
  const signal: unknown = json["signal"];

  if (signal !== "log" && signal !== "trace") {
    throw new BadDataException(
      'Say which scrub rule this is: signal "log" or "trace".',
    );
  }

  const patternType: string = readOptionalText(json["patternType"]) || "";
  const patternTypes: ReadonlyArray<string> =
    signal === "log" ? LOG_SCRUB_PATTERN_TYPES : TRACE_SCRUB_PATTERN_TYPES;

  if (!patternTypes.includes(patternType)) {
    throw new BadDataException(
      `Choose one of the pattern types: ${patternTypes.join(", ")}.`,
    );
  }

  const fieldsToScrub: string | undefined = readOptionalText(
    json["fieldsToScrub"],
  );
  const fields: ReadonlyArray<string> =
    signal === "log" ? LOG_SCRUB_FIELDS : TRACE_SCRUB_FIELDS;

  if (fieldsToScrub !== undefined && !fields.includes(fieldsToScrub)) {
    throw new BadDataException(
      `Choose the fields to scrub from: ${fields.join(", ")}.`,
    );
  }

  const scrubAction: string | undefined = readOptionalText(json["scrubAction"]);

  if (
    scrubAction !== undefined &&
    !(Object.values(LogScrubAction) as Array<string>).includes(scrubAction)
  ) {
    throw new BadDataException(
      `Choose the scrub action from: ${Object.values(LogScrubAction).join(", ")}.`,
    );
  }

  const serviceId: string | undefined = readOptionalText(json["serviceId"]);

  if (serviceId !== undefined && !ObjectID.isValidUUID(serviceId)) {
    throw new BadDataException(`"${serviceId}" is not a service's id.`);
  }

  const customRegex: unknown = json["customRegex"];

  return {
    signal: signal as TelemetryFieldSignal,
    patternType,
    ...(typeof customRegex === "string" ? { customRegex } : {}),
    ...(fieldsToScrub ? { fieldsToScrub } : {}),
    ...(scrubAction ? { scrubAction } : {}),
    ...(serviceId ? { serviceId: serviceId.toLowerCase() } : {}),
  };
}

router.post(
  SCRUB_RULE_READERS_API_PATH,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: SCRUB_RULE_READERS_PERMISSIONS,
        errorMessage:
          "You do not have permission to create or edit scrub rules, so OneUptime does not say what one would change.",
      });

      const readers: TelemetryFieldReaders = await findScrubRuleReaders({
        projectId,
        rule: readScrubRuleReadersRequest(req.body),
        props,
      });

      Response.sendJsonObjectResponse(
        req,
        res,
        readers as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
