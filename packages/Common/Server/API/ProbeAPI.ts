import UserMiddleware from "../Middleware/UserAuthorization";
import ProbeService, {
  Service as ProbeServiceType,
} from "../Services/ProbeService";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import Sort from "../Types/Database/Sort";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import MultiSearch from "../../Types/BaseDatabase/MultiSearch";
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import BadRequestException from "../../Types/Exception/BadRequestException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import PositiveNumber from "../../Types/PositiveNumber";
import Probe from "../../Models/DatabaseModels/Probe";

// What a caller that asks for no fields in particular gets back.
const DEFAULT_GLOBAL_PROBE_SELECT: Select<Probe> = {
  name: true,
  description: true,
  lastAlive: true,
  iconFileId: true,
  connectionStatus: true,
  // The monitor create form pre-selects the auto-enabled probes.
  shouldAutoEnableProbeOnNewMonitors: true,
};

/*
 * Global probes are not project rows, so this endpoint has to read them as
 * root - which means none of the usual per-column permission checks run.
 * Every field a caller may select, filter or sort on is therefore listed
 * here, and nothing else is reachable: `key` in particular is a probe's
 * shared secret, and a root-privileged query on it would be an oracle for
 * reading it back one character at a time.
 */
const GLOBAL_PROBE_FIELDS: Array<string> = [
  ...Object.keys(DEFAULT_GLOBAL_PROBE_SELECT),
  "_id",
  /*
   * Readable, but not something a caller can steer: the query below pins it
   * to true whatever the caller sent.
   */
  "isGlobalProbe",
];

export default class ProbeAPI extends BaseAPI<Probe, ProbeServiceType> {
  public constructor() {
    super(Probe, ProbeService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-probes`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = (req.body as JSONObject) || {};

          const skip: PositiveNumber = new PositiveNumber(
            ProbeAPI.getPaginationValue(req, "skip", 0),
          );

          const limit: PositiveNumber = new PositiveNumber(
            ProbeAPI.getPaginationValue(req, "limit", DEFAULT_LIMIT),
          );

          if (limit.toNumber() > LIMIT_PER_PROJECT) {
            throw new BadRequestException(
              "Limit should be less than " + LIMIT_PER_PROJECT,
            );
          }

          if (skip.toNumber() < 0) {
            throw new BadRequestException(
              "Skip should be greater than or equal to 0",
            );
          }

          if (limit.toNumber() <= 0) {
            throw new BadRequestException("Limit should be greater than 0");
          }

          const query: Query<Probe> = {
            ...ProbeAPI.getQuery(body["query"] as JSONObject),
            /*
             * Last, so a caller cannot widen the read past the global probes
             * by sending isGlobalProbe themselves.
             */
            isGlobalProbe: true,
          };

          const select: Select<Probe> = ProbeAPI.getSelect(
            body["select"] as JSONObject,
          );

          const sort: Sort<Probe> = ProbeAPI.getSort(
            body["sort"] as JSONObject,
          );

          const probes: Array<Probe> = await ProbeService.findBy({
            query,
            select,
            sort,
            props: {
              isRoot: true,
            },
            skip,
            limit,
          });

          const count: PositiveNumber = await ProbeService.countBy({
            query,
            props: {
              isRoot: true,
            },
          });

          return Response.sendEntityArrayResponse(
            req,
            res,
            probes,
            count,
            Probe,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * skip/limit arrive as query params from ModelAPI.getList and in the body
   * from anything hand-rolled, so both are read - same precedence as
   * BaseAPI.getList.
   */
  private static getPaginationValue(
    req: ExpressRequest,
    key: "skip" | "limit",
    defaultValue: number,
  ): number {
    if (req.query && req.query[key]) {
      return parseInt(req.query[key] as string, 10) || defaultValue;
    }

    if (req.body && (req.body as JSONObject)[key] !== undefined) {
      return (
        parseInt((req.body as JSONObject)[key] as string, 10) || defaultValue
      );
    }

    return defaultValue;
  }

  private static getQuery(query: JSONObject | undefined): Query<Probe> {
    const deserialized: JSONObject = JSONFunctions.deserialize(
      query as JSONObject,
    );

    for (const key in deserialized) {
      const value: JSONValue = deserialized[key] as JSONValue;

      /*
       * MultiSearch is the free-text search operator. Its key is synthetic -
       * the columns it reads are the ones it carries - so those are what get
       * checked against the allow-list.
       */
      if (value instanceof MultiSearch) {
        for (const field of value.fields) {
          if (!GLOBAL_PROBE_FIELDS.includes(field)) {
            throw new BadDataException(
              `Global probes cannot be searched on ${field}.`,
            );
          }
        }

        continue;
      }

      if (!GLOBAL_PROBE_FIELDS.includes(key)) {
        throw new BadDataException(
          `Global probes cannot be filtered on ${key}.`,
        );
      }
    }

    return deserialized as Query<Probe>;
  }

  private static getSelect(select: JSONObject | undefined): Select<Probe> {
    const requested: Dictionary<boolean> = {};

    for (const key in select) {
      if (!GLOBAL_PROBE_FIELDS.includes(key) || !select[key]) {
        continue;
      }

      /*
       * Coerced rather than copied: every selectable field here is a scalar,
       * so a nested (relation) select on one of them is not something the
       * caller gets to ask for.
       */
      requested[key] = true;
    }

    /*
     * A caller that asks for nothing gets what this endpoint returned before
     * it honoured select at all.
     */
    if (Object.keys(requested).length === 0) {
      return { ...DEFAULT_GLOBAL_PROBE_SELECT };
    }

    return requested as Select<Probe>;
  }

  private static getSort(sort: JSONObject | undefined): Sort<Probe> {
    const deserialized: JSONObject = JSONFunctions.deserialize(
      sort as JSONObject,
    );

    for (const key in deserialized) {
      if (!GLOBAL_PROBE_FIELDS.includes(key)) {
        throw new BadDataException(`Global probes cannot be sorted on ${key}.`);
      }
    }

    return deserialized as Sort<Probe>;
  }
}
