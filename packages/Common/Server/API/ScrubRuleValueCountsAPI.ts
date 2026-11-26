import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import LogScrubRule from "../../Models/DatabaseModels/LogScrubRule";
import Service from "../../Models/DatabaseModels/Service";
import TraceScrubRule from "../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  foldScrubRuleValueCounts,
  readScrubRuleValueCountsRequest,
  SCRUB_RULE_VALUE_COUNT_DAYS,
  SCRUB_RULE_VALUE_COUNTS_API_PATH,
  ScrubRuleValueCountSignal,
  ScrubRuleValueCountsAnswer,
  ScrubRuleValueCountsRequest,
} from "../../Types/Telemetry/ScrubRuleValueCounts";
import ScrubRuleValueCountService, {
  ScrubRuleValueCountRow,
} from "../Services/ScrubRuleValueCountService";
import ServiceService from "../Services/ServiceService";
import logger from "../Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * HOW MANY VALUES A PROJECT'S SCRUB RULES CHANGED, BY SERVICE AND VERSION
 * (#10366).
 *
 * The log and trace scrub rule lists ask for the rules on their page: how
 * many values each changed in the last week - and, opened, which services
 * and versions they came from (Types/Telemetry/ScrubRuleValueCounts). For
 * whoever may read that kind of scrub rule. The counts are read as the
 * server, for the project's own rules only (the table is the project's,
 * and every read names it); a service is named only where the person may
 * read it.
 */

export const SCRUB_RULE_READ_PERMISSIONS: Readonly<
  Record<ScrubRuleValueCountSignal, Array<Permission>>
> = {
  log: new LogScrubRule().readRecordPermissions,
  trace: new TraceScrubRule().readRecordPermissions,
};

const READ_REFUSALS: Readonly<Record<ScrubRuleValueCountSignal, string>> = {
  log: "You do not have permission to read log scrub rules, so OneUptime does not say how many values they changed.",
  trace:
    "You do not have permission to read trace scrub rules, so OneUptime does not say how many values they changed.",
};

// The names of the services the person may read, by id in lower case.
async function readServiceNames(data: {
  projectId: ObjectID;
  serviceIds: ReadonlyArray<string>;
  props: DatabaseCommonInteractionProps;
}): Promise<Map<string, string>> {
  const names: Map<string, string> = new Map<string, string>();
  const ids: Array<ObjectID> = data.serviceIds
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    })
    .map((id: string): ObjectID => {
      return new ObjectID(id);
    });

  if (ids.length === 0) {
    return names;
  }

  try {
    const services: Array<Service> = await ServiceService.findBy({
      query: { projectId: data.projectId, _id: new Includes(ids) },
      select: { _id: true, name: true },
      skip: 0,
      limit: ids.length,
      props: data.props,
    });

    for (const service of services) {
      if (service.id && service.name) {
        names.set(service.id.toString().toLowerCase(), service.name);
      }
    }
  } catch (error) {
    // A person who may not read services sees their counts, unnamed.
    logger.debug(
      `Scrub rule counts: services of project ${data.projectId.toString()} are not named for this person: ${error}`,
    );
  }

  return names;
}

export async function readScrubRuleValueCounts(data: {
  projectId: ObjectID;
  request: ScrubRuleValueCountsRequest;
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
}): Promise<ScrubRuleValueCountsAnswer> {
  // A length of time, the same on every server (issue #7623).
  const since: Date = OneUptimeDate.addRemoveDurationInDays(
    data.now || OneUptimeDate.getCurrentDate(),
    -SCRUB_RULE_VALUE_COUNT_DAYS,
  );
  const answer: ScrubRuleValueCountsAnswer = {
    since: since.toISOString(),
    days: SCRUB_RULE_VALUE_COUNT_DAYS,
    isChecked: true,
    rules: [],
  };

  if (data.request.scrubRuleIds.length === 0) {
    return answer;
  }

  let rows: Array<ScrubRuleValueCountRow>;

  try {
    rows = await ScrubRuleValueCountService.readValueCounts({
      projectId: data.projectId,
      scrubRuleIds: data.request.scrubRuleIds,
      since,
    });
  } catch (error) {
    logger.warn(
      `Scrub rule counts: could not read the counts of project ${data.projectId.toString()}:`,
    );
    logger.warn(error);
    return { ...answer, isChecked: false };
  }

  const serviceNames: Map<string, string> = await readServiceNames({
    projectId: data.projectId,
    serviceIds: Array.from(
      new Set(
        rows.map((row: ScrubRuleValueCountRow): string => {
          return row.serviceId;
        }),
      ),
    ),
    props: data.props,
  });

  return {
    ...answer,
    rules: foldScrubRuleValueCounts(rows, serviceNames),
  };
}

router.post(
  SCRUB_RULE_VALUE_COUNTS_API_PATH,
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
      const request: ScrubRuleValueCountsRequest | null =
        readScrubRuleValueCountsRequest(req.body);

      if (!request) {
        throw new BadDataException(
          'Say which scrub rules to count: signal "log" or "trace", and their ids.',
        );
      }

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: SCRUB_RULE_READ_PERMISSIONS[request.signal],
        errorMessage: READ_REFUSALS[request.signal],
      });

      const answer: ScrubRuleValueCountsAnswer = await readScrubRuleValueCounts(
        { projectId, request, props },
      );

      Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
