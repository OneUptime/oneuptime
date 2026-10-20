import logger from "../Logger";
import VMUtil from "../VM/VMAPI";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import DataToProcess from "./DataToProcess";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncidentGroupingConfig from "../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { MonitorEvaluationFilterResult } from "../../../Types/Monitor/MonitorEvaluationSummary";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Typeof from "../../../Types/Typeof";

import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
/**
 * One key extracted from an incoming webhook payload by an
 * {@link IncidentGroupingConfig}.
 */
export interface IncomingRequestGroupingItem {
  /** Stable dedupe key derived from the extracted value. */
  fingerprint: string;
  /** Label map exposed to incident title/description templates. */
  labels: JSONObject;
  /** The raw extracted value (e.g. the Grafana alert name). */
  keyValue: string;
  /** True when the payload classifies this key as resolved/recovered. */
  isResolved: boolean;
}

/**
 * Everything one request holds for one grouping config.
 */
export interface IncomingRequestGroupingScan {
  /** The distinct values at the grouping path, each firing or recovered. */
  items: Array<IncomingRequestGroupingItem>;
  /*
   * The parts of the request that hold no value at the grouping path, by
   * whether they report recovered. A part is the request itself, for a path
   * without `[*]` or one whose array is missing or empty, or one element of
   * the array, for a path with it.
   */
  firingWithoutValue: number;
  recoveredWithoutValue: number;
}

/**
 * What the monitor log says about how a grouped criteria handled a request.
 */
export interface IncomingRequestGroupingNote {
  title: string;
  message: string;
}

/**
 * How a criteria that matched a request acts on it, decided by that
 * criteria's own grouping and that request alone.
 */
export interface IncomingRequestGroupingDecision {
  /*
   * Undefined: the criteria acts once for the whole monitor - one incident
   * and one alert, deduplicated on the criteria - as a criteria without
   * grouping does. An array: once per value, exactly these; an empty one
   * opens nothing new.
   */
  perKeyMatches: Array<PerSeriesCriteriaMatch> | undefined;
  // What the monitor log says about it, when there is something to say.
  note?: IncomingRequestGroupingNote | undefined;
  /*
   * A line for the root cause, when a grouped criteria acts for the whole
   * monitor because it had no value to group by.
   */
  rootCauseNote?: MarkdownText | undefined;
}

// The monitor log's titles for what a grouped criteria did with a request.
export const GROUPING_NOTE_TITLES: {
  noValue: string;
  noRequest: string;
  nothingNew: string;
  someItemsWithoutValue: string;
} = {
  noValue: "No value to group by",
  noRequest: "No request to group by",
  nothingNew: "Nothing new to open",
  someItemsWithoutValue: "Some items have no value to group by",
};

const DEFAULT_MAX_KEYS_PER_PAYLOAD: number = 100;
const ARRAY_WILDCARD: string = "[*]";

/*
 * A bracketed part of a path, "[0]" or "['name']": a "[" and what follows
 * it up to the next "]". A "[" with no "]" after it is taken with the rest
 * of the path in the same match, and given back as written (no later "["
 * has a "]" after it either) - so a path holding many "[" is read once,
 * where looking for the "]" from every "[" read on to its end each time.
 */
const BRACKETED_PART: RegExp = /\[[^\]]*(\])?/g;

/**
 * Turns an incoming-request / webhook payload into per-key incident
 * matches, so a single monitor can hold multiple concurrent incidents —
 * one per distinct value (Grafana alert name, fingerprint, etc.). This
 * reuses the same `seriesFingerprint` mechanism metric monitors use for
 * per-series incidents; see {@link IncidentGroupingConfig}.
 *
 * Grouping is a criteria's own setting. Whether a criteria that matched
 * opens one incident and alert per value, one for the whole monitor or
 * nothing new is decided from that criteria's grouping and the request it
 * matched (decideForMatchedCriteria) - never from another criteria's. A
 * criteria without grouping opens one for the whole monitor, exactly as on a
 * monitor where no criteria groups.
 */
export default class IncomingRequestIncidentGrouping {
  /**
   * Parse the request body into a JSON object. Bodies arrive either
   * pre-parsed (JSONObject) or as a raw JSON string depending on the
   * ingestion path; both are handled. Non-JSON / non-object bodies
   * (e.g. a bare string heartbeat) return null: they hold no value to
   * group by.
   */
  public static getRequestBodyObject(
    dataToProcess: DataToProcess,
  ): JSONObject | null {
    const body: string | JSONObject | undefined = (
      dataToProcess as IncomingMonitorRequest
    ).requestBody;

    if (!body) {
      return null;
    }

    if (typeof body === Typeof.String) {
      try {
        const parsed: unknown = JSON.parse(body as string);
        return parsed &&
          typeof parsed === Typeof.Object &&
          !Array.isArray(parsed)
          ? (parsed as JSONObject)
          : null;
      } catch {
        return null;
      }
    }

    if (typeof body === Typeof.Object && !Array.isArray(body)) {
      return body as JSONObject;
    }

    return null;
  }

  /**
   * How a criteria that matched this request acts on it - read from that
   * criteria's own grouping, never from another criteria of the monitor:
   *
   *   - Not grouped: once for the whole monitor, as on a monitor where no
   *     criteria groups (perKeyMatches undefined).
   *   - Grouped, and the request names values: one per value that is
   *     firing. When every value it names reported recovered, nothing new
   *     opens (an empty array) - the resolve pass closes those values.
   *   - Grouped, and the request names no value at all - the field is
   *     missing, empty or not a single value, or the body is not a JSON
   *     object: once for the whole monitor, as without grouping, rather
   *     than not at all. Unless the request itself reports recovered: then
   *     nothing new opens.
   *   - Grouped, on the background check that re-reads the last request
   *     every 30 seconds: there is no request to read values from. A
   *     criteria that matched because requests stopped arriving acts once
   *     for the whole monitor; one that matched by re-reading the last
   *     request opens nothing new - its values were handled when it
   *     arrived.
   */
  public static decideForMatchedCriteria(input: {
    dataToProcess: DataToProcess;
    criteriaInstance: MonitorCriteriaInstance;
    /*
     * The criteria's filters as this evaluation judged them. On the
     * background check they say whether it matched because requests
     * stopped arriving.
     */
    filterResults: Array<MonitorEvaluationFilterResult>;
  }): IncomingRequestGroupingDecision {
    const grouping: IncidentGroupingConfig | undefined =
      input.criteriaInstance.data?.incidentGrouping;
    const criteriaId: string | undefined = input.criteriaInstance.data?.id;

    if (!grouping?.groupByJSONPath || !criteriaId) {
      return { perKeyMatches: undefined };
    }

    const criteriaName: string =
      input.criteriaInstance.data?.name || "Unnamed criteria";

    // The path as the project wrote it, which is how the monitor log names it.
    const groupByPath: string = grouping.groupByJSONPath.trim();

    if (
      (input.dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      const matchedOnSilence: boolean = input.filterResults.some(
        (filterResult: MonitorEvaluationFilterResult): boolean => {
          return (
            filterResult.met &&
            filterResult.checkOn === CheckOn.IncomingRequest &&
            filterResult.filterType === FilterType.NotRecievedInMinutes
          );
        },
      );

      if (matchedOnSilence) {
        return {
          perKeyMatches: undefined,
          note: {
            title: GROUPING_NOTE_TITLES.noRequest,
            message: `Criteria "${criteriaName}" matched because requests stopped arriving. It handles that for the whole monitor, as it would without grouping.`,
          },
          rootCauseNote: mdText`**Grouping**: Requests stopped arriving, so there was no value to group by. It counts for the whole monitor rather than for one value.`,
        };
      }

      return {
        perKeyMatches: [],
        note: {
          title: GROUPING_NOTE_TITLES.nothingNew,
          message: `The background check re-read the last request. Criteria "${criteriaName}" opens one per value as a request arrives, not when it is re-read.`,
        },
      };
    }

    const scan: IncomingRequestGroupingScan = this.scanRequestBody({
      requestBody: this.getRequestBodyObject(input.dataToProcess),
      grouping: grouping,
    });

    const firingItems: Array<IncomingRequestGroupingItem> = scan.items.filter(
      (item: IncomingRequestGroupingItem): boolean => {
        return !item.isResolved;
      },
    );

    if (firingItems.length > 0) {
      const withoutValue: number = scan.firingWithoutValue;

      return {
        perKeyMatches: firingItems.map(
          (item: IncomingRequestGroupingItem): PerSeriesCriteriaMatch => {
            return this.toFiringMatch({ criteriaId: criteriaId, item: item });
          },
        ),
        note:
          withoutValue > 0
            ? {
                title: GROUPING_NOTE_TITLES.someItemsWithoutValue,
                message:
                  withoutValue === 1
                    ? `1 item in this request has no value at ${groupByPath}, so it opens nothing of its own.`
                    : `${withoutValue} items in this request have no value at ${groupByPath}, so they open nothing of their own.`,
              }
            : undefined,
      };
    }

    if (scan.firingWithoutValue > 0) {
      return {
        perKeyMatches: undefined,
        note: {
          title: GROUPING_NOTE_TITLES.noValue,
          message: `This request has no value at ${groupByPath}. Criteria "${criteriaName}" handles it for the whole monitor, as it would without grouping.`,
        },
        /*
         * The path is what the project wrote: shown as code (mdText writes
         * the span around it), so nothing in it is read as Markdown.
         */
        rootCauseNote: mdText`**Grouping**: The request had no value at \`${groupByPath}\`, so it counts for the whole monitor rather than for one value.`,
      };
    }

    if (scan.items.length > 0) {
      return {
        perKeyMatches: [],
        note: {
          title: GROUPING_NOTE_TITLES.nothingNew,
          message: `Every value this request has at ${groupByPath} reported recovered, so criteria "${criteriaName}" opens nothing new.`,
        },
      };
    }

    return {
      perKeyMatches: [],
      note: {
        title: GROUPING_NOTE_TITLES.nothingNew,
        message: `This request has no value at ${groupByPath} and reports recovered, so criteria "${criteriaName}" opens nothing new.`,
      },
    };
  }

  /**
   * Fingerprints the payload explicitly classifies as resolved, across
   * every grouping-enabled criteria on the monitor's step. The caller
   * resolves the matching open incidents (event-driven resolution: only
   * keys the payload says recovered are closed — never by absence).
   */
  public static collectResolvedFingerprints(input: {
    dataToProcess: DataToProcess;
    criteriaInstances: Array<MonitorCriteriaInstance>;
  }): Array<string> {
    if (
      (input.dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      return [];
    }

    const body: JSONObject | null = this.getRequestBodyObject(
      input.dataToProcess,
    );
    if (!body) {
      return [];
    }

    const fingerprints: Set<string> = new Set<string>();

    for (const criteriaInstance of input.criteriaInstances) {
      const grouping: IncidentGroupingConfig | undefined =
        criteriaInstance.data?.incidentGrouping;

      if (!grouping?.groupByJSONPath) {
        continue;
      }

      for (const item of this.extractItems({ requestBody: body, grouping })) {
        if (item.isResolved) {
          fingerprints.add(item.fingerprint);
        }
      }
    }

    return Array.from(fingerprints);
  }

  /**
   * Whether this criteria groups by a payload field. A monitor's grouped
   * criteria are why its requests are read for recoveries (MonitorResource);
   * what each criteria opens is its own grouping's to decide
   * (decideForMatchedCriteria).
   */
  public static isGroupingConfigured(
    criteriaInstance: MonitorCriteriaInstance | undefined,
  ): boolean {
    return Boolean(criteriaInstance?.data?.incidentGrouping?.groupByJSONPath);
  }

  /**
   * Extract all distinct keys from a payload for one grouping config,
   * classifying each as firing or resolved. Deduplicates by fingerprint
   * and caps the count at `maxKeysPerPayload` to bound cardinality.
   */
  public static extractItems(input: {
    requestBody: JSONObject;
    grouping: IncidentGroupingConfig;
  }): Array<IncomingRequestGroupingItem> {
    return this.scanRequestBody(input).items;
  }

  /**
   * Read one request for one grouping config: the distinct values at its
   * path, each firing or recovered (extractItems), and the parts of the
   * request with no value there, so a criteria can tell "every value
   * recovered" from "nothing to group by". Elements past
   * `maxKeysPerPayload` values are not read at all.
   */
  public static scanRequestBody(input: {
    // Null: the body is not a JSON object.
    requestBody: JSONObject | null;
    grouping: IncidentGroupingConfig;
  }): IncomingRequestGroupingScan {
    const { grouping } = input;

    const scan: IncomingRequestGroupingScan = {
      items: [],
      firingWithoutValue: 0,
      recoveredWithoutValue: 0,
    };

    const countWithoutValue: (isRecovered: boolean) => void = (
      isRecovered: boolean,
    ): void => {
      if (isRecovered) {
        scan.recoveredWithoutValue++;
      } else {
        scan.firingWithoutValue++;
      }
    };

    // A body that is not a JSON object names no value, and cannot recover.
    if (!input.requestBody) {
      countWithoutValue(false);
      return scan;
    }

    const requestBody: JSONObject = input.requestBody;

    /*
     * Whether the request itself reports recovered, read once: every part
     * judged at the request's level gets the same answer, and reading the
     * request again per element would cost time in the square of its size.
     */
    let requestRecovered: boolean | null = null;

    const isRequestRecovered: () => boolean = (): boolean => {
      if (requestRecovered === null) {
        requestRecovered = this.isRequestRecovered({
          requestBody: requestBody,
          grouping: grouping,
        });
      }

      return requestRecovered;
    };

    const groupByPath: string = this.normalizePath(grouping.groupByJSONPath);

    // A path that is not rooted at requestBody names nothing.
    if (!groupByPath) {
      countWithoutValue(isRequestRecovered());
      return scan;
    }

    const labelKey: string = this.labelKeyFromPath(groupByPath);
    const maxKeys: number =
      grouping.maxKeysPerPayload && grouping.maxKeysPerPayload > 0
        ? grouping.maxKeysPerPayload
        : DEFAULT_MAX_KEYS_PER_PAYLOAD;

    const seenFingerprints: Set<string> = new Set<string>();

    const addItem: (keyValue: string, isResolved: boolean) => void = (
      keyValue: string,
      isResolved: boolean,
    ): void => {
      const labels: JSONObject = { [labelKey]: keyValue };
      const fingerprint: string =
        MetricSeriesFingerprint.computeFingerprint(labels);

      if (seenFingerprints.has(fingerprint)) {
        // Same key twice in one payload — keep the first occurrence.
        return;
      }

      seenFingerprints.add(fingerprint);
      scan.items.push({ fingerprint, labels, keyValue, isResolved });
    };

    const wildcardIndex: number = groupByPath.indexOf(ARRAY_WILDCARD);

    // Simple (non-array) path: a single key for the whole payload.
    if (wildcardIndex === -1) {
      const keyValue: string | null = this.toScalarString(
        VMUtil.deepFind(requestBody, groupByPath),
      );

      if (keyValue === null) {
        countWithoutValue(isRequestRecovered());
        return scan;
      }

      addItem(keyValue, isRequestRecovered());
      return scan;
    }

    // Array fan-out: one key per element of the array at the `[*]` prefix.
    const { prefix: prefixPath, suffix: elementSuffix } = this.splitAtWildcard(
      groupByPath,
      wildcardIndex,
    );

    const arrayValue: JSONValue | undefined = prefixPath
      ? VMUtil.deepFind(requestBody, prefixPath)
      : (requestBody as unknown as JSONValue);

    // No array to read, or an empty one: the request names no value.
    if (!Array.isArray(arrayValue) || arrayValue.length === 0) {
      countWithoutValue(isRequestRecovered());
      return scan;
    }

    for (const element of arrayValue) {
      if (scan.items.length >= maxKeys) {
        logger.warn(
          `IncomingRequestIncidentGrouping: payload produced more than ${maxKeys} keys for path "${groupByPath}"; remaining keys ignored.`,
        );
        break;
      }

      const isObjectElement: boolean =
        Boolean(element) && typeof element === Typeof.Object;

      let keyValue: string | null = null;

      if (elementSuffix) {
        // `prefix[*].sub.path` — only an object element can be dug into.
        if (isObjectElement) {
          keyValue = this.toScalarString(
            VMUtil.deepFind(element as JSONObject, elementSuffix),
          );
        }
      } else {
        // `prefix[*]` — the array element itself is the key (array of scalars).
        keyValue = this.toScalarString(element as JSONValue);
      }

      /*
       * Per-element resolve classification only applies when the element
       * is an object (so `[*].status` can be read off it). For scalar
       * elements there is no per-element field, so fall back to the
       * request's own answer.
       */
      const isRecovered: boolean = this.isPartRecovered({
        element: isObjectElement ? (element as JSONObject) : null,
        grouping: grouping,
        isRequestRecovered: isRequestRecovered,
      });

      if (keyValue === null) {
        countWithoutValue(isRecovered);
        continue;
      }

      addItem(keyValue, isRecovered);
    }

    return scan;
  }

  private static toFiringMatch(input: {
    criteriaId: string;
    item: IncomingRequestGroupingItem;
  }): PerSeriesCriteriaMatch {
    return {
      criteriaMetId: input.criteriaId,
      fingerprint: input.item.fingerprint,
      labels: input.item.labels,
      /*
       * The key is whatever the request carried at the grouping path:
       * shown as code (mdText writes the span around it), so a backtick
       * in it cannot close the span and nothing in it is read as
       * Markdown or as a chat mention.
       */
      rootCause:
        mdText`Incoming request matched grouping key \`${input.item.keyValue}\`.`.toString(),
      metricContext: undefined,
    };
  }

  /*
   * Whether one part of a request reports recovered. A recovery path with
   * `[*]` is read off the part's own object element of the grouping array;
   * a recovery path without it, or a part that is no object element, takes
   * the request's own answer.
   */
  private static isPartRecovered(input: {
    element: JSONObject | null;
    grouping: IncidentGroupingConfig;
    isRequestRecovered: () => boolean;
  }): boolean {
    const recoveryPath: string | null = this.getRecoveryPath(input.grouping);

    if (!recoveryPath) {
      return false;
    }

    const wildcardIndex: number = recoveryPath.indexOf(ARRAY_WILDCARD);

    if (wildcardIndex === -1 || !input.element) {
      return input.isRequestRecovered();
    }

    const path: string = this.splitAtWildcard(
      recoveryPath,
      wildcardIndex,
    ).suffix;

    if (!path) {
      return false;
    }

    return this.isRecoveredValue({
      value: VMUtil.deepFind(input.element, path),
      grouping: input.grouping,
    });
  }

  /*
   * Whether the request as a whole reports recovered. A recovery path
   * without `[*]` is read against the whole payload. One with `[*]` - when
   * the grouping path names one value for the whole request, so there is
   * no element of its own to read - holds when every element of that
   * array reports recovered, and there is at least one: a request whose
   * alerts all resolved has recovered, one with a single alert still
   * firing has not.
   */
  private static isRequestRecovered(input: {
    requestBody: JSONObject;
    grouping: IncidentGroupingConfig;
  }): boolean {
    const recoveryPath: string | null = this.getRecoveryPath(input.grouping);

    if (!recoveryPath) {
      return false;
    }

    const wildcardIndex: number = recoveryPath.indexOf(ARRAY_WILDCARD);

    if (wildcardIndex === -1) {
      return this.isRecoveredValue({
        value: VMUtil.deepFind(input.requestBody, recoveryPath),
        grouping: input.grouping,
      });
    }

    const { prefix, suffix } = this.splitAtWildcard(
      recoveryPath,
      wildcardIndex,
    );

    const arrayValue: JSONValue | undefined = prefix
      ? VMUtil.deepFind(input.requestBody, prefix)
      : (input.requestBody as unknown as JSONValue);

    if (!Array.isArray(arrayValue) || arrayValue.length === 0) {
      return false;
    }

    return arrayValue.every((element: JSONValue): boolean => {
      if (!suffix) {
        return this.isRecoveredValue({
          value: element,
          grouping: input.grouping,
        });
      }

      if (!element || typeof element !== Typeof.Object) {
        return false;
      }

      return this.isRecoveredValue({
        value: VMUtil.deepFind(element as JSONObject, suffix),
        grouping: input.grouping,
      });
    });
  }

  /*
   * The recovery path, relative to the body - or null when the criteria
   * names no recovery field and value, so nothing it groups ever reports
   * recovered.
   */
  private static getRecoveryPath(
    grouping: IncidentGroupingConfig,
  ): string | null {
    if (
      !grouping.resolvedWhenJSONPath ||
      grouping.resolvedWhenValue === undefined
    ) {
      return null;
    }

    return this.normalizePath(grouping.resolvedWhenJSONPath) || null;
  }

  private static isRecoveredValue(input: {
    value: JSONValue | undefined;
    grouping: IncidentGroupingConfig;
  }): boolean {
    const value: string | null = this.toScalarString(input.value);

    return value !== null && value === input.grouping.resolvedWhenValue;
  }

  /*
   * A path with a `[*]` at `wildcardIndex`, split into the array's path
   * before it and the path into each element after it.
   */
  private static splitAtWildcard(
    path: string,
    wildcardIndex: number,
  ): { prefix: string; suffix: string } {
    const prefix: string = path.slice(0, wildcardIndex);

    return {
      prefix: prefix.endsWith(".") ? prefix.slice(0, -1) : prefix,
      suffix: this.stripLeadingDot(
        path.slice(wildcardIndex + ARRAY_WILDCARD.length),
      ),
    };
  }

  /**
   * Derive a human-friendly label key from a JSON path — the last named
   * segment, with array/wildcard syntax stripped. `alerts[*].labels.alertname`
   * → `alertname`. Used as the template variable name (so titles can say
   * `{{alertname}}`) and as the fingerprint label key.
   */
  private static labelKeyFromPath(path: string): string {
    const cleaned: string = path
      .replace(/\[\*\]/g, "")
      .replace(
        BRACKETED_PART,
        (part: string, closing: string | undefined): string => {
          return closing === undefined ? part : "";
        },
      );
    const parts: Array<string> = cleaned.split(".").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1]! : "key";
  }

  private static stripLeadingDot(path: string): string {
    return path.startsWith(".") ? path.slice(1) : path;
  }

  /**
   * Resolve the `requestBody`-rooted path users write — the same convention
   * incident templates and JavaScript-expression filters use — into a path
   * relative to the body (the actual scope `deepFind` resolves against).
   * Both of these forms are accepted and resolve identically:
   *
   *   `{{requestBody.alerts[*].labels.alertname}}`   (template wrapper)
   *   `requestBody.alerts[*].labels.alertname`
   *
   * The `requestBody` root is REQUIRED — a path not rooted there resolves
   * to nothing, so the field has exactly one convention.
   */
  private static normalizePath(rawPath: string): string {
    let path: string = rawPath.trim();

    if (path.startsWith("{{") && path.endsWith("}}")) {
      path = path.slice(2, -2).trim();
    }

    if (path.startsWith("requestBody.")) {
      return path.slice("requestBody.".length);
    }

    return "";
  }

  /**
   * Coerce an extracted value to a non-empty scalar string. Objects and
   * arrays cannot be a grouping key and return null (the item is skipped).
   */
  private static toScalarString(value: JSONValue | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === Typeof.Object) {
      return null;
    }

    const stringValue: string = String(value);
    return stringValue.length > 0 ? stringValue : null;
  }
}
