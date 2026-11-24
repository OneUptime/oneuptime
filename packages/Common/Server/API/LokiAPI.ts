import { apiKeyFromAuthorizationHeader } from "../Middleware/CompatibleQueryAuthorization";
import CompatibleQueryRateLimit, {
  CompatibleQueryApi,
} from "../Middleware/CompatibleQueryRateLimit";
import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import TelemetryAttributeService from "../Services/TelemetryAttributeService";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import LogQLClickhouseSource from "../Utils/LogQL/LogQLClickhouseSource";
import {
  LOKI_BUILD_INFO,
  LOKI_METADATA_LIMIT,
  LOKI_SERIES_LIMIT,
  LOKI_TIMEOUT_MESSAGE,
  LokiBounds,
  LokiCountingSource,
  LokiErrorAnswer,
  lokiLabelNamesOf,
  lokiLabelValuesOf,
  lokiSuccess,
  readLokiBounds,
  readMatchSelectors,
  readStreamSelector,
  runLokiInstantQuery,
  runLokiRangeQuery,
  toLokiErrorAnswer,
} from "../Utils/LogQL/LokiHttpApi";
import Log from "../../Models/AnalyticsModels/Log";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import QueryTimeoutException from "../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import LogQLEngine from "../../Utils/LogQL/LogQLEngine";
import {
  LOGQL_DETECTED_LEVEL_LABEL,
  labelNameOfAttribute,
} from "../../Utils/LogQL/LogQLLabels";
import { PromQLLabelMatcher } from "../../Utils/PromQL/PromQLAst";
import { PromQLLabels, promQLLabelsKey } from "../../Utils/PromQL/PromQLLabels";
import {
  comparePromQLText,
  sortPromQLLabelSets,
} from "../../Utils/PromQL/PromQLLabelOrder";
import { copyOwnValues } from "../../Utils/LookupTable";

/*
 * The Loki HTTP API over a project's logs (issue #7700).
 *
 * Served at /api/loki, so Grafana's Loki data source (or logcli, or any
 * Loki client) reads OneUptime's logs with LogQL by pointing at
 * https://<host>/api/loki: Loki clients add /loki/api/v1/... themselves.
 * The routes are the ones they call: query, query_range, labels, label
 * values and series, plus buildinfo.
 *
 * Who may read: anyone who may read the project's logs, with exactly the
 * services they may read (TelemetryReadAccess), as on the Logs explorer. A
 * project API key is accepted in the ApiKey header, as a bearer token or
 * as a basic-auth password (CompatibleQueryAuthorization), and each
 * project's queries are held to a rate (CompatibleQueryRateLimit).
 *
 * Errors are plain text, as Loki writes them, which is what its clients
 * show: Grafana shows the text under the panel.
 */

export const LOKI_API_PATH: string = "/loki/loki/api/v1";

// The most attribute keys whose values one label's values are read from.
const MAX_KEYS_PER_LABEL: number = 10;

// How long evaluating a query may take, after its logs are read.
const QUERY_EVALUATION_TIMEOUT_MS: number = 30000;

const NANOSECONDS_PER_MILLISECOND: bigint = BigInt(1000000);

const answerText: (
  req: ExpressRequest,
  res: ExpressResponse,
  answer: LokiErrorAnswer,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  answer: LokiErrorAnswer,
): void => {
  Response.sendCustomResponse(req, res, answer.statusCode, `${answer.text}\n`, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
};

/*
 * The log read access the Log model declares, so these routes let in
 * exactly who the Logs explorer lets read logs; then the project's rate.
 */
const requireLogReadAccess: Array<RequestHandler> = [
  apiKeyFromAuthorizationHeader,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: new Log().getReadPermissions(),
    wildcard: Permission.ReadAllOperationalResources,
  }),
  CompatibleQueryRateLimit.getMiddleware({
    api: CompatibleQueryApi.Loki,
    refuse: (data: {
      req: ExpressRequest;
      res: ExpressResponse;
      message: string;
    }): void => {
      answerText(data.req, data.res, { statusCode: 429, text: data.message });
    },
  }),
];

interface LokiRequestContext {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
  source: LogQLClickhouseSource;
  counted: LokiCountingSource;
  engine: LogQLEngine;
  params: Record<string, unknown>;
  nowNs: bigint;
}

// A request's parameters, from the query string and a form body.
const readParams: (req: ExpressRequest) => Record<string, unknown> = (
  req: ExpressRequest,
): Record<string, unknown> => {
  const body: unknown = req.body;
  const bodyParams: Record<string, unknown> =
    body && typeof body === "object" && !Buffer.isBuffer(body)
      ? (body as Record<string, unknown>)
      : {};

  return { ...(req.query as Record<string, unknown>), ...bodyParams };
};

type LokiRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const handle: (
  work: (context: LokiRequestContext) => Promise<JSONObject>,
) => LokiRouteHandler = (
  work: (context: LokiRequestContext) => Promise<JSONObject>,
): LokiRouteHandler => {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!props.tenantId) {
        throw new BadDataException(
          "This request names no project. Use a project API key, or send the project's ID in the ProjectID header.",
        );
      }

      const serviceFilter: TelemetryServiceFilter =
        await TelemetryReadAccess.getServiceFilter({
          modelType: Log,
          props,
        });
      const source: LogQLClickhouseSource = new LogQLClickhouseSource({
        projectId: props.tenantId,
        serviceFilter,
      });
      const counted: LokiCountingSource = new LokiCountingSource(source);

      const body: JSONObject = await work({
        props,
        projectId: props.tenantId,
        serviceFilter,
        source,
        counted,
        engine: new LogQLEngine(counted, {
          timeoutMs: QUERY_EVALUATION_TIMEOUT_MS,
        }),
        params: readParams(req),
        nowNs: BigInt(Date.now()) * NANOSECONDS_PER_MILLISECOND,
      });

      Response.sendJsonObjectResponse(req, res, body);
    } catch (error: unknown) {
      const answer: LokiErrorAnswer | undefined = toLokiErrorAnswer(error);

      if (answer) {
        return answerText(req, res, answer);
      }

      if (error instanceof QueryTimeoutException) {
        return answerText(req, res, {
          statusCode: 504,
          text: LOKI_TIMEOUT_MESSAGE,
        });
      }

      next(error);
    }
  };
};

/*
 * The label sets of the logs some stream selectors keep in the window, at
 * most LOKI_SERIES_LIMIT of them.
 */
const labelSetsOf: (
  context: LokiRequestContext,
  selectors: Array<Array<PromQLLabelMatcher>>,
) => Promise<Array<PromQLLabels>> = async (
  context: LokiRequestContext,
  selectors: Array<Array<PromQLLabelMatcher>>,
): Promise<Array<PromQLLabels>> => {
  const bounds: LokiBounds = readLokiBounds(context.params, context.nowNs);
  const sets: Map<string, PromQLLabels> = new Map();

  for (const matchers of selectors.length > 0 ? selectors : [[]]) {
    if (sets.size >= LOKI_SERIES_LIMIT) {
      break;
    }

    for (const labels of await context.source.readLabelSets({
      matchers,
      startNs: bounds.startNs,
      endNs: bounds.endNs,
      limit: LOKI_SERIES_LIMIT - sets.size,
    })) {
      sets.set(promQLLabelsKey(labels), labels);
    }
  }

  // Each set once, in order of its labels (labels.Compare).
  return sortPromQLLabelSets(
    Array.from(sets.values()).map(
      (labels: PromQLLabels): { labels: PromQLLabels } => {
        return { labels };
      },
    ),
  ).map((item: { labels: PromQLLabels }): PromQLLabels => {
    return copyOwnValues(item.labels);
  });
};

// The `query` parameter of /labels and label values, when sent.
const querySelector: (
  context: LokiRequestContext,
) => Array<PromQLLabelMatcher> | undefined = (
  context: LokiRequestContext,
): Array<PromQLLabelMatcher> | undefined => {
  const query: unknown = context.params["query"];

  return typeof query === "string" && query.trim().length > 0
    ? readStreamSelector(query, "query")
    : undefined;
};

/*
 * Every label the project's logs have: each attribute key the caller's
 * logs were seen with, as its label, and detected_level.
 */
const allLabelNames: (
  context: LokiRequestContext,
) => Promise<Array<string>> = async (
  context: LokiRequestContext,
): Promise<Array<string>> => {
  const keys: Array<string> = await TelemetryAttributeService.fetchAttributes({
    projectId: context.projectId,
    telemetryType: TelemetryType.Log,
    serviceFilter: context.serviceFilter,
  });
  const names: Set<string> = new Set<string>([LOGQL_DETECTED_LEVEL_LABEL]);

  for (const key of keys) {
    names.add(labelNameOfAttribute(key));
  }

  return Array.from(names).sort(comparePromQLText);
};

const labels: LokiRouteHandler = handle(
  async (context: LokiRequestContext): Promise<JSONObject> => {
    const matchers: Array<PromQLLabelMatcher> | undefined =
      querySelector(context);

    if (matchers) {
      return lokiSuccess(
        lokiLabelNamesOf(await labelSetsOf(context, [matchers])).slice(
          0,
          LOKI_METADATA_LIMIT,
        ),
      );
    }

    return lokiSuccess(
      (await allLabelNames(context)).slice(0, LOKI_METADATA_LIMIT),
    );
  },
);

/*
 * One label's values in the window: from the attribute keys that read as
 * that label (a log's own and its resource's), or the levels present.
 */
const labelValues: (
  label: string,
) => (context: LokiRequestContext) => Promise<JSONObject> = (
  label: string,
): ((context: LokiRequestContext) => Promise<JSONObject>) => {
  return async (context: LokiRequestContext): Promise<JSONObject> => {
    const matchers: Array<PromQLLabelMatcher> | undefined =
      querySelector(context);

    if (matchers) {
      return lokiSuccess(
        lokiLabelValuesOf(await labelSetsOf(context, [matchers]), label).slice(
          0,
          LOKI_METADATA_LIMIT,
        ),
      );
    }

    const bounds: LokiBounds = readLokiBounds(context.params, context.nowNs);
    const values: Set<string> = new Set<string>();

    if (label === LOGQL_DETECTED_LEVEL_LABEL) {
      for (const level of await context.source.readDetectedLevels(bounds)) {
        values.add(level);
      }
    }

    const keys: Array<string> = (
      await TelemetryAttributeService.fetchAttributes({
        projectId: context.projectId,
        telemetryType: TelemetryType.Log,
        serviceFilter: context.serviceFilter,
      })
    )
      .filter((key: string): boolean => {
        return labelNameOfAttribute(key) === label;
      })
      .slice(0, MAX_KEYS_PER_LABEL);

    for (const key of keys) {
      const found: Array<string> =
        await TelemetryAttributeService.fetchAttributeValues({
          projectId: context.projectId,
          telemetryType: TelemetryType.Log,
          attributeKey: key,
          serviceFilter: context.serviceFilter,
          startTime: new Date(
            Number(bounds.startNs / NANOSECONDS_PER_MILLISECOND),
          ),
          endTime: new Date(Number(bounds.endNs / NANOSECONDS_PER_MILLISECOND)),
        });

      for (const value of found) {
        values.add(value);
      }
    }

    return lokiSuccess(
      Array.from(values).sort(comparePromQLText).slice(0, LOKI_METADATA_LIMIT),
    );
  };
};

const router: ExpressRouter = Express.getRouter();

const instantQuery: LokiRouteHandler = handle(
  (context: LokiRequestContext): Promise<JSONObject> => {
    return runLokiInstantQuery({
      engine: context.engine,
      source: context.counted,
      params: context.params,
      nowNs: context.nowNs,
    });
  },
);

const rangeQuery: LokiRouteHandler = handle(
  (context: LokiRequestContext): Promise<JSONObject> => {
    return runLokiRangeQuery({
      engine: context.engine,
      source: context.counted,
      params: context.params,
      nowNs: context.nowNs,
    });
  },
);

const series: LokiRouteHandler = handle(
  async (context: LokiRequestContext): Promise<JSONObject> => {
    return lokiSuccess(
      await labelSetsOf(context, readMatchSelectors(context.params)),
    );
  },
);

const labelValuesOfRequest: LokiRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  const labelName: string = String(req.params["labelName"] || "");
  return handle(labelValues(labelName))(req, res, next);
};

router.get(`${LOKI_API_PATH}/query`, ...requireLogReadAccess, instantQuery);
router.post(`${LOKI_API_PATH}/query`, ...requireLogReadAccess, instantQuery);

router.get(`${LOKI_API_PATH}/query_range`, ...requireLogReadAccess, rangeQuery);
router.post(
  `${LOKI_API_PATH}/query_range`,
  ...requireLogReadAccess,
  rangeQuery,
);

router.get(`${LOKI_API_PATH}/labels`, ...requireLogReadAccess, labels);
router.post(`${LOKI_API_PATH}/labels`, ...requireLogReadAccess, labels);

// /label is what Loki answered /labels at first, and still does.
router.get(`${LOKI_API_PATH}/label`, ...requireLogReadAccess, labels);

router.get(
  `${LOKI_API_PATH}/label/:labelName/values`,
  ...requireLogReadAccess,
  labelValuesOfRequest,
);

router.get(`${LOKI_API_PATH}/series`, ...requireLogReadAccess, series);
router.post(`${LOKI_API_PATH}/series`, ...requireLogReadAccess, series);

router.get(
  `${LOKI_API_PATH}/status/buildinfo`,
  ...requireLogReadAccess,
  (req: ExpressRequest, res: ExpressResponse): void => {
    Response.sendJsonObjectResponse(req, res, LOKI_BUILD_INFO);
  },
);

export default router;
