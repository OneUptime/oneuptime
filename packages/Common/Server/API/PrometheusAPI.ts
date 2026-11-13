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
import { getMetricReadPermissions } from "../Utils/Telemetry/MetricReadPermissions";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import PromQLMetricSeriesSource from "../Utils/PromQL/PromQLMetricSeriesSource";
import {
  PrometheusErrorAnswer,
  labelNamesOf,
  labelValuesOf,
  listPrometheusSeries,
  prometheusSuccess,
  readMatchSelectors,
  readMetadataLimit,
  readMetadataWindow,
  runPrometheusInstantQuery,
  runPrometheusRangeQuery,
  toPrometheusErrorAnswer,
} from "../Utils/PromQL/PrometheusHttpApi";
import {
  listPromQLLabelNames,
  listPromQLLabelValues,
  listPromQLMetricMetadata,
} from "../Utils/PromQL/PromQLMetricCatalog";
import Metric from "../../Models/AnalyticsModels/Metric";
import StatusCode from "../../Types/API/StatusCode";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import QueryTimeoutException from "../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import PromQLEngine from "../../Utils/PromQL/PromQLEngine";
import { PromQLVectorSelector } from "../../Utils/PromQL/PromQLAst";
import PromQLError, { PromQLErrorType } from "../../Utils/PromQL/PromQLError";
import { PromQLLabels } from "../../Utils/PromQL/PromQLLabels";

/*
 * The Prometheus HTTP API over a project's metrics (issue #6796).
 *
 * Served at /api/prometheus, so Grafana (or any tool with a Prometheus data
 * source) reads OneUptime's metrics with PromQL by pointing at
 * https://<host>/api/prometheus, and the Metrics page's PromQL tab asks the
 * same endpoints. The routes are the ones Prometheus clients call: query,
 * query_range, series, labels, label values and metadata, plus the ones
 * Grafana probes (buildinfo, exemplars, rules, alerts), answered empty where
 * OneUptime keeps nothing of the kind.
 *
 * Who may read: anyone who may read the project's metrics, with exactly the
 * services they may read (TelemetryReadAccess), as on the Metrics explorer.
 * A project API key is accepted in the `ApiKey` header, as everywhere in the
 * API, and also as a bearer token or a basic-auth password, because that is
 * what Prometheus clients know how to send.
 */

export const PROMETHEUS_API_PATH: string = "/prometheus/api/v1";

// What /status/buildinfo answers: a Prometheus 3 API.
export const PROMETHEUS_BUILD_INFO: JSONObject = {
  version: "3.0.0",
  revision: "oneuptime",
  branch: "",
  buildUser: "",
  buildDate: "",
  goVersion: "",
};

// How long evaluating a query may take, after its series are read.
const QUERY_EVALUATION_TIMEOUT_MS: number = 30000;

const UUID_LENGTH: number = 36;

/*
 * The project API key a Prometheus client sent in its Authorization header:
 * a bearer token, or a basic-auth password (or user name, for clients that
 * only fill that one). A value that is no API key, such as a signed-in
 * session's token, is left alone.
 */
export const readApiKeyFromAuthorization: (
  authorization: string | undefined,
) => string | undefined = (
  authorization: string | undefined,
): string | undefined => {
  if (!authorization) {
    return undefined;
  }

  const [scheme, ...rest] = authorization.trim().split(/\s+/);
  const credential: string = rest.join(" ");

  if (!scheme || !credential) {
    return undefined;
  }

  const isKey: (value: string | undefined) => value is string = (
    value: string | undefined,
  ): value is string => {
    return (
      value !== undefined &&
      value.length === UUID_LENGTH &&
      ObjectID.isValidUUID(value)
    );
  };

  if (scheme.toLowerCase() === "bearer") {
    return isKey(credential) ? credential : undefined;
  }

  if (scheme.toLowerCase() === "basic") {
    let decoded: string = "";

    try {
      decoded = Buffer.from(credential, "base64").toString("utf8");
    } catch {
      return undefined;
    }

    const separator: number = decoded.indexOf(":");
    const user: string =
      separator === -1 ? decoded : decoded.slice(0, separator);
    const password: string =
      separator === -1 ? "" : decoded.slice(separator + 1);

    if (isKey(password)) {
      return password;
    }

    return isKey(user) ? user : undefined;
  }

  return undefined;
};

const apiKeyFromAuthorizationHeader: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  if (!req.headers["apikey"]) {
    const authorization: string | undefined = req.headers["authorization"];
    const key: string | undefined = readApiKeyFromAuthorization(authorization);

    if (key) {
      req.headers["apikey"] = key;
      // The key is not also a signed-in session's token.
      delete req.headers["authorization"];
    }
  }

  next();
};

/*
 * The metric read access the Metric model declares, so these routes let in
 * exactly who the Metrics explorer lets read metrics.
 */
const requireMetricReadAccess: Array<RequestHandler> = [
  apiKeyFromAuthorizationHeader,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: getMetricReadPermissions(),
    wildcard: Permission.ReadAllOperationalResources,
  }),
];

interface PrometheusRequestContext {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
  source: PromQLMetricSeriesSource;
  engine: PromQLEngine;
  params: Record<string, unknown>;
  nowMs: number;
}

// A request's parameters, from the query string and a form or JSON body.
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

const answerError: (
  req: ExpressRequest,
  res: ExpressResponse,
  answer: PrometheusErrorAnswer,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  answer: PrometheusErrorAnswer,
): void => {
  Response.sendJsonObjectResponse(req, res, answer.body, {
    statusCode: new StatusCode(answer.statusCode),
  });
};

/*
 * A route's handler, as a promise that settles once it has answered, so a
 * route that wraps one can hand that promise on.
 */
type PrometheusRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const handle: (
  work: (context: PrometheusRequestContext) => Promise<JSONObject>,
) => PrometheusRouteHandler = (
  work: (context: PrometheusRequestContext) => Promise<JSONObject>,
): PrometheusRouteHandler => {
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
          modelType: Metric,
          props,
        });
      const source: PromQLMetricSeriesSource = new PromQLMetricSeriesSource({
        projectId: props.tenantId,
        serviceFilter,
      });

      const body: JSONObject = await work({
        props,
        projectId: props.tenantId,
        serviceFilter,
        source,
        engine: new PromQLEngine(source, {
          timeoutMs: QUERY_EVALUATION_TIMEOUT_MS,
        }),
        params: readParams(req),
        nowMs: Date.now(),
      });

      Response.sendJsonObjectResponse(req, res, body);
    } catch (error: unknown) {
      const answer: PrometheusErrorAnswer | undefined =
        toPrometheusErrorAnswer(error);

      if (answer) {
        return answerError(req, res, answer);
      }

      if (error instanceof QueryTimeoutException) {
        return answerError(
          req,
          res,
          toPrometheusErrorAnswer(
            new PromQLError(
              "Reading the metrics took longer than 30 seconds. Shorten the time range or add label matchers.",
              PromQLErrorType.Timeout,
            ),
          )!,
        );
      }

      next(error);
    }
  };
};

const router: ExpressRouter = Express.getRouter();

const instantQuery: RequestHandler = handle(
  (context: PrometheusRequestContext): Promise<JSONObject> => {
    return runPrometheusInstantQuery({
      engine: context.engine,
      params: context.params,
      nowMs: context.nowMs,
    });
  },
);

const rangeQuery: RequestHandler = handle(
  (context: PrometheusRequestContext): Promise<JSONObject> => {
    return runPrometheusRangeQuery({
      engine: context.engine,
      params: context.params,
    });
  },
);

// The label sets of the series match[] selects, in the window.
const seriesOf: (
  context: PrometheusRequestContext,
  selectors: Array<PromQLVectorSelector>,
) => Promise<Array<PromQLLabels>> = async (
  context: PrometheusRequestContext,
  selectors: Array<PromQLVectorSelector>,
): Promise<Array<PromQLLabels>> => {
  const window: { startTimeMs: number; endTimeMs: number } = readMetadataWindow(
    context.params,
    context.nowMs,
  );

  return listPrometheusSeries({
    source: context.source,
    selectors,
    startTimeMs: window.startTimeMs,
    endTimeMs: window.endTimeMs,
    limit: readMetadataLimit(context.params),
  });
};

const series: RequestHandler = handle(
  async (context: PrometheusRequestContext): Promise<JSONObject> => {
    const selectors: Array<PromQLVectorSelector> = readMatchSelectors(
      context.params,
    );

    if (selectors.length === 0) {
      throw new PromQLError(
        'Send at least one match[] selector, such as match[]=up{job="api"}.',
      );
    }

    return prometheusSuccess(await seriesOf(context, selectors));
  },
);

const labels: RequestHandler = handle(
  async (context: PrometheusRequestContext): Promise<JSONObject> => {
    const selectors: Array<PromQLVectorSelector> = readMatchSelectors(
      context.params,
    );
    const limit: number = readMetadataLimit(context.params);

    if (selectors.length > 0) {
      return prometheusSuccess(
        labelNamesOf(await seriesOf(context, selectors)).slice(0, limit),
      );
    }

    const names: Array<string> = await listPromQLLabelNames({
      projectId: context.projectId,
      serviceFilter: context.serviceFilter,
    });

    return prometheusSuccess(names.slice(0, limit));
  },
);

const labelValues: (
  label: string,
) => (context: PrometheusRequestContext) => Promise<JSONObject> = (
  label: string,
): ((context: PrometheusRequestContext) => Promise<JSONObject>) => {
  return async (context: PrometheusRequestContext): Promise<JSONObject> => {
    const selectors: Array<PromQLVectorSelector> = readMatchSelectors(
      context.params,
    );
    const limit: number = readMetadataLimit(context.params);

    if (selectors.length > 0) {
      return prometheusSuccess(
        labelValuesOf(await seriesOf(context, selectors), label).slice(
          0,
          limit,
        ),
      );
    }

    const window: { startTimeMs: number; endTimeMs: number } =
      readMetadataWindow(context.params, context.nowMs);
    const values: Array<string> = await listPromQLLabelValues({
      projectId: context.projectId,
      props: context.props,
      serviceFilter: context.serviceFilter,
      label,
      startTimeMs: window.startTimeMs,
      endTimeMs: window.endTimeMs,
    });

    return prometheusSuccess(values.slice(0, limit));
  };
};

const metadata: RequestHandler = handle(
  async (context: PrometheusRequestContext): Promise<JSONObject> => {
    const metric: unknown = context.params["metric"];

    return prometheusSuccess(
      await listPromQLMetricMetadata({
        projectId: context.projectId,
        props: context.props,
        metric: typeof metric === "string" && metric ? metric : undefined,
        limit: readMetadataLimit(context.params),
      }),
    );
  },
);

const answering: (data: JSONObject | Array<never>) => RequestHandler = (
  data: JSONObject | Array<never>,
): RequestHandler => {
  return handle(async (): Promise<JSONObject> => {
    return prometheusSuccess(data);
  });
};

for (const method of ["get", "post"] as const) {
  router[method](
    `${PROMETHEUS_API_PATH}/query`,
    ...requireMetricReadAccess,
    instantQuery,
  );
  router[method](
    `${PROMETHEUS_API_PATH}/query_range`,
    ...requireMetricReadAccess,
    rangeQuery,
  );
  router[method](
    `${PROMETHEUS_API_PATH}/series`,
    ...requireMetricReadAccess,
    series,
  );
  router[method](
    `${PROMETHEUS_API_PATH}/labels`,
    ...requireMetricReadAccess,
    labels,
  );
  router[method](
    `${PROMETHEUS_API_PATH}/query_exemplars`,
    ...requireMetricReadAccess,
    answering([]),
  );
}

router.get(
  `${PROMETHEUS_API_PATH}/label/:labelName/values`,
  ...requireMetricReadAccess,
  (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    const labelName: string = String(req.params["labelName"] || "");
    return handle(labelValues(labelName))(req, res, next);
  },
);

router.get(
  `${PROMETHEUS_API_PATH}/metadata`,
  ...requireMetricReadAccess,
  metadata,
);

router.get(
  `${PROMETHEUS_API_PATH}/status/buildinfo`,
  ...requireMetricReadAccess,
  answering(PROMETHEUS_BUILD_INFO),
);

// OneUptime alerts with monitors, not Prometheus rules: there are none.
router.get(
  `${PROMETHEUS_API_PATH}/rules`,
  ...requireMetricReadAccess,
  answering({ groups: [] }),
);

router.get(
  `${PROMETHEUS_API_PATH}/alerts`,
  ...requireMetricReadAccess,
  answering({ alerts: [] }),
);

export default router;
