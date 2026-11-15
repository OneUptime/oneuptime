import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import { isRequestSliType } from "./SloRequestSli";

/*
 * THE RELEASE CHECK: "is it safe to keep rolling this release out?", asked
 * by a progressive delivery tool or a pipeline while a release goes out -
 * Argo Rollouts' web analysis, a Flagger webhook, a CI step that waits after
 * a deploy - which rolls the release back itself on a no.
 *
 * The deploy gate (deploymentsAllowed) answers before a release, from the
 * error budget of the whole window. A release that breaks something has
 * spent almost none of a month's budget in its first ten minutes, so the
 * check reads what the release changes: how fast the SLO burned its budget
 * over the last few minutes - from its services' requests, optionally only
 * those of one service.version (the canary's), or from its monitors.
 *
 *   Pass           the window burned at or below maxBurnRate: safe.
 *   Fail           it burned faster, or the error budget policy freezes
 *                  deployments: roll back.
 *   NotEnoughData  too few requests to judge (or no monitor status): not
 *                  safe to call safe. A tool that should carry on without
 *                  traffic asks with minimumRequestCount=0.
 *
 * The default maxBurnRate is 1: the window met the SLO's own target. This
 * module is the decision and its words, React- and database-free; the
 * server measures (Server/Utils/Slo/SloReleaseCheckMeasurement).
 */

export const SLO_RELEASE_CHECK_ROUTE: string = "/release-check";

export const SLO_RELEASE_CHECK_DEFAULT_WINDOW_MINUTES: number = 10;
export const SLO_RELEASE_CHECK_MIN_WINDOW_MINUTES: number = 1;
// The most one count of spans reads (SLO_REQUEST_COUNT_CHUNK_MINUTES).
export const SLO_RELEASE_CHECK_MAX_WINDOW_MINUTES: number = 360;

export const SLO_RELEASE_CHECK_DEFAULT_MAX_BURN_RATE: number = 1;

export const SLO_RELEASE_CHECK_DEFAULT_MINIMUM_REQUEST_COUNT: number = 1;

// The resource attribute a release's version is read from on its spans.
export const SLO_RELEASE_CHECK_VERSION_ATTRIBUTE: string =
  "resource.service.version";

export const SLO_RELEASE_CHECK_MAX_VERSION_LENGTH: number = 200;

export enum SloReleaseCheckVerdict {
  Pass = "Pass",
  Fail = "Fail",
  NotEnoughData = "NotEnoughData",
}

export interface SloReleaseCheckOptions {
  windowInMinutes: number;
  maxBurnRate: number;
  // Request SLIs only.
  minimumRequestCount: number;
  // Request SLIs only: the release whose requests are judged.
  serviceVersion: string | null;
  // False to leave the error budget policy's freeze out of the answer.
  includeDeploymentGate: boolean;
  // True to answer a no with HTTP 412, for tools that read the status code.
  failWithStatusCode: boolean;
}

export const SLO_RELEASE_CHECK_ERRORS: {
  windowInMinutes: string;
  maxBurnRate: string;
  minimumRequestCount: string;
  serviceVersion: string;
  boolean: string;
} = {
  windowInMinutes: `windowInMinutes must be a whole number of minutes from ${SLO_RELEASE_CHECK_MIN_WINDOW_MINUTES} to ${SLO_RELEASE_CHECK_MAX_WINDOW_MINUTES}.`,
  maxBurnRate:
    "maxBurnRate must be a number greater than 0, such as 1 (the window met the SLO's target) or 2.",
  minimumRequestCount:
    "minimumRequestCount must be a whole number of requests from 0 up.",
  serviceVersion: `serviceVersion must be the service.version of the release, at most ${SLO_RELEASE_CHECK_MAX_VERSION_LENGTH} characters.`,
  boolean:
    "includeDeploymentGate and failWithStatusCode must be true or false.",
};

type ReadOptionFunction = (input: JSONObject, key: string) => JSONValue;

// An option from the query string, or the JSON body a POST sends.
const readOption: ReadOptionFunction = (
  input: JSONObject,
  key: string,
): JSONValue => {
  const value: JSONValue = input[key];

  // A query string repeats a key as an array: the last one wins.
  if (Array.isArray(value)) {
    return value[value.length - 1] as JSONValue;
  }

  return value;
};

type IsMissingFunction = (value: JSONValue) => boolean;

const isMissing: IsMissingFunction = (value: JSONValue): boolean => {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
};

type ReadNumberFunction = (value: JSONValue) => number;

const readNumber: ReadNumberFunction = (value: JSONValue): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return Number(value.trim());
  }

  return Number.NaN;
};

type ReadBooleanFunction = (value: JSONValue, defaultValue: boolean) => boolean;

const readBoolean: ReadBooleanFunction = (
  value: JSONValue,
  defaultValue: boolean,
): boolean => {
  if (isMissing(value)) {
    return defaultValue;
  }

  if (value === true || value === "true" || value === "1") {
    return true;
  }

  if (value === false || value === "false" || value === "0") {
    return false;
  }

  throw new BadDataException(SLO_RELEASE_CHECK_ERRORS.boolean);
};

export type ParseSloReleaseCheckOptionsFunction = (
  input: JSONObject,
) => SloReleaseCheckOptions;

/*
 * The check's options, from the query string and the body together (the
 * body wins): a GET from a tool that only builds URLs, and a POST from one
 * that sends JSON - a Flagger webhook's own body has no such keys, so it
 * reads the defaults or its URL's query.
 */
export const parseSloReleaseCheckOptions: ParseSloReleaseCheckOptionsFunction =
  (input: JSONObject): SloReleaseCheckOptions => {
    const windowValue: JSONValue = readOption(input, "windowInMinutes");
    const windowInMinutes: number = isMissing(windowValue)
      ? SLO_RELEASE_CHECK_DEFAULT_WINDOW_MINUTES
      : readNumber(windowValue);

    if (
      !Number.isInteger(windowInMinutes) ||
      windowInMinutes < SLO_RELEASE_CHECK_MIN_WINDOW_MINUTES ||
      windowInMinutes > SLO_RELEASE_CHECK_MAX_WINDOW_MINUTES
    ) {
      throw new BadDataException(SLO_RELEASE_CHECK_ERRORS.windowInMinutes);
    }

    const burnValue: JSONValue = readOption(input, "maxBurnRate");
    const maxBurnRate: number = isMissing(burnValue)
      ? SLO_RELEASE_CHECK_DEFAULT_MAX_BURN_RATE
      : readNumber(burnValue);

    if (!Number.isFinite(maxBurnRate) || maxBurnRate <= 0) {
      throw new BadDataException(SLO_RELEASE_CHECK_ERRORS.maxBurnRate);
    }

    const minimumValue: JSONValue = readOption(input, "minimumRequestCount");
    const minimumRequestCount: number = isMissing(minimumValue)
      ? SLO_RELEASE_CHECK_DEFAULT_MINIMUM_REQUEST_COUNT
      : readNumber(minimumValue);

    if (!Number.isInteger(minimumRequestCount) || minimumRequestCount < 0) {
      throw new BadDataException(SLO_RELEASE_CHECK_ERRORS.minimumRequestCount);
    }

    const versionValue: JSONValue = readOption(input, "serviceVersion");
    let serviceVersion: string | null = null;

    if (!isMissing(versionValue)) {
      if (
        typeof versionValue !== "string" &&
        typeof versionValue !== "number"
      ) {
        throw new BadDataException(SLO_RELEASE_CHECK_ERRORS.serviceVersion);
      }

      serviceVersion = String(versionValue).trim();

      if (serviceVersion.length > SLO_RELEASE_CHECK_MAX_VERSION_LENGTH) {
        throw new BadDataException(SLO_RELEASE_CHECK_ERRORS.serviceVersion);
      }
    }

    return {
      windowInMinutes: windowInMinutes,
      maxBurnRate: maxBurnRate,
      minimumRequestCount: minimumRequestCount,
      serviceVersion: serviceVersion,
      includeDeploymentGate: readBoolean(
        readOption(input, "includeDeploymentGate"),
        true,
      ),
      failWithStatusCode: readBoolean(
        readOption(input, "failWithStatusCode"),
        false,
      ),
    };
  };

// What the server measured over the check's window.
export interface SloReleaseCheckMeasurement {
  burnRate: number;
  // UNROUNDED; null when nothing was measured.
  sliPercentage: number | null;
  // Request SLIs.
  goodRequestCount?: number | undefined;
  totalRequestCount?: number | undefined;
  // Monitor Uptime: the seconds measured in the window.
  measuredSeconds?: number | undefined;
}

export interface SloReleaseCheckDecision {
  verdict: SloReleaseCheckVerdict;
  isSafeToContinue: boolean;
  reason: string;
}

type FormatFigureFunction = (value: number, decimals: number) => string;

// "0.4", "12", "99.95": at most `decimals` decimals, no trailing zeros.
const formatFigure: FormatFigureFunction = (
  value: number,
  decimals: number,
): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const factor: number = Math.pow(10, decimals);

  return String(Math.round(value * factor) / factor);
};

type PluralFunction = (count: number, noun: string) => string;

const plural: PluralFunction = (count: number, noun: string): string => {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
};

export type DecideSloReleaseCheckFunction = (data: {
  sliType: SliType | string | undefined | null;
  targetPercentage: number;
  options: SloReleaseCheckOptions;
  measurement: SloReleaseCheckMeasurement;
  deploymentsAllowed: boolean | undefined | null;
  errorBudgetPolicyTierName?: string | undefined | null;
}) => SloReleaseCheckDecision;

/*
 * The verdict, in order: a freeze first (the team agreed not to ship), then
 * whether there is enough to judge, then the burn. The reason is one
 * sentence a person reads in a pipeline's log or a rollout's events.
 */
export const decideSloReleaseCheck: DecideSloReleaseCheckFunction = (data: {
  sliType: SliType | string | undefined | null;
  targetPercentage: number;
  options: SloReleaseCheckOptions;
  measurement: SloReleaseCheckMeasurement;
  deploymentsAllowed: boolean | undefined | null;
  errorBudgetPolicyTierName?: string | undefined | null;
}): SloReleaseCheckDecision => {
  const window: string = plural(data.options.windowInMinutes, "minute");

  if (data.options.includeDeploymentGate && data.deploymentsAllowed === false) {
    const tier: string = data.errorBudgetPolicyTierName?.trim() || "";

    return {
      verdict: SloReleaseCheckVerdict.Fail,
      isSafeToContinue: false,
      reason: tier
        ? `Deployments are frozen: this SLO is in the "${tier}" tier of its error budget policy, which freezes deployments.`
        : "Deployments are frozen by this SLO's error budget policy.",
    };
  }

  if (isRequestSliType(data.sliType)) {
    const total: number = data.measurement.totalRequestCount || 0;
    const version: string = data.options.serviceVersion
      ? ` of version ${data.options.serviceVersion}`
      : "";

    if (total < data.options.minimumRequestCount) {
      return {
        verdict: SloReleaseCheckVerdict.NotEnoughData,
        isSafeToContinue: false,
        reason: `Only ${plural(total, "request")}${version} in the last ${window}, and this check needs at least ${plural(data.options.minimumRequestCount, "request")} to judge.`,
      };
    }

    // Asked with minimumRequestCount=0: no traffic burned nothing.
    if (total === 0) {
      return {
        verdict: SloReleaseCheckVerdict.Pass,
        isSafeToContinue: true,
        reason: `No requests${version} in the last ${window}, so nothing burned the error budget.`,
      };
    }
  } else if (!data.measurement.measuredSeconds) {
    return {
      verdict: SloReleaseCheckVerdict.NotEnoughData,
      isSafeToContinue: false,
      reason: `This SLO's monitors recorded no status in the last ${window}, so there is nothing to judge.`,
    };
  }

  const burnRate: string = formatFigure(data.measurement.burnRate, 2);
  const maxBurnRate: string = formatFigure(data.options.maxBurnRate, 2);
  const sli: string =
    data.measurement.sliPercentage === null
      ? ""
      : ` (SLI ${formatFigure(data.measurement.sliPercentage, 3)}% against the ${formatFigure(data.targetPercentage, 3)}% target)`;

  if (data.measurement.burnRate > data.options.maxBurnRate) {
    return {
      verdict: SloReleaseCheckVerdict.Fail,
      isSafeToContinue: false,
      reason: `The last ${window} burned the error budget at ${burnRate}x, faster than the ${maxBurnRate}x this check allows${sli}.`,
    };
  }

  return {
    verdict: SloReleaseCheckVerdict.Pass,
    isSafeToContinue: true,
    reason: `The last ${window} burned the error budget at ${burnRate}x, within the ${maxBurnRate}x this check allows${sli}.`,
  };
};

export type BuildSloReleaseCheckResponseFunction = (data: {
  sloId: string;
  sloName: string | undefined | null;
  sliType: SliType | string | undefined | null;
  targetPercentage: number;
  sloStatus: SloStatus | string | undefined | null;
  deploymentsAllowed: boolean | undefined | null;
  errorBudgetPolicyTierName: string | undefined | null;
  options: SloReleaseCheckOptions;
  measurement: SloReleaseCheckMeasurement;
  decision: SloReleaseCheckDecision;
  checkedAt: Date;
}) => JSONObject;

/*
 * The answer's JSON: the verdict first, then what it was read from. Field
 * names are an API: a rollout's success condition reads
 * `result.isSafeToContinue`, so they never change.
 */
export const buildSloReleaseCheckResponse: BuildSloReleaseCheckResponseFunction =
  (data: {
    sloId: string;
    sloName: string | undefined | null;
    sliType: SliType | string | undefined | null;
    targetPercentage: number;
    sloStatus: SloStatus | string | undefined | null;
    deploymentsAllowed: boolean | undefined | null;
    errorBudgetPolicyTierName: string | undefined | null;
    options: SloReleaseCheckOptions;
    measurement: SloReleaseCheckMeasurement;
    decision: SloReleaseCheckDecision;
    checkedAt: Date;
  }): JSONObject => {
    const response: JSONObject = {
      isSafeToContinue: data.decision.isSafeToContinue,
      verdict: data.decision.verdict,
      reason: data.decision.reason,
      sloId: data.sloId,
      sloName: data.sloName || null,
      sliType: data.sliType || null,
      targetPercentage: data.targetPercentage,
      windowInMinutes: data.options.windowInMinutes,
      maxBurnRate: data.options.maxBurnRate,
      burnRate: Number.isFinite(data.measurement.burnRate)
        ? data.measurement.burnRate
        : null,
      sliPercentage: data.measurement.sliPercentage,
      deploymentsAllowed: data.deploymentsAllowed !== false,
      errorBudgetPolicyTier: data.errorBudgetPolicyTierName || null,
      sloStatus: data.sloStatus || null,
      checkedAt: data.checkedAt.toISOString(),
    };

    if (isRequestSliType(data.sliType)) {
      response["goodRequestCount"] = data.measurement.goodRequestCount || 0;
      response["totalRequestCount"] = data.measurement.totalRequestCount || 0;
      response["minimumRequestCount"] = data.options.minimumRequestCount;
      response["serviceVersion"] = data.options.serviceVersion;
    }

    return response;
  };
