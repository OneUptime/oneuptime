import logger from "../Logger";
import VMUtil from "../VM/VMAPI";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import DataToProcess from "./DataToProcess";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncidentGroupingConfig from "../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Typeof from "../../../Types/Typeof";

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

const DEFAULT_MAX_KEYS_PER_PAYLOAD: number = 100;
const ARRAY_WILDCARD: string = "[*]";

/**
 * Turns an incoming-request / webhook payload into per-key incident
 * matches, so a single monitor can hold multiple concurrent incidents —
 * one per distinct value (Grafana alert name, fingerprint, etc.). This
 * reuses the same `seriesFingerprint` mechanism metric monitors use for
 * per-series incidents; see {@link IncidentGroupingConfig}.
 */
export default class IncomingRequestIncidentGrouping {
  /**
   * Parse the request body into a JSON object. Bodies arrive either
   * pre-parsed (JSONObject) or as a raw JSON string depending on the
   * ingestion path; both are handled. Non-JSON / non-object bodies
   * (e.g. a bare string heartbeat) return null — grouping is a no-op.
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
   * Firing matches for one criteria — used by the criteria evaluator to
   * fan a matched incoming-request criteria into one incident per key.
   * Returns an empty array when grouping is not configured (preserving
   * the legacy single-incident behaviour) or when there is no usable
   * payload (e.g. the heartbeat-timeout re-evaluation cron, which carries
   * no fresh body).
   */
  public static collectFiringMatches(input: {
    dataToProcess: DataToProcess;
    criteriaInstance: MonitorCriteriaInstance;
    rootCause?: string | undefined;
  }): Array<PerSeriesCriteriaMatch> {
    const grouping: IncidentGroupingConfig | undefined =
      input.criteriaInstance.data?.incidentGrouping;

    if (!grouping?.groupByJSONPath) {
      return [];
    }

    if (
      (input.dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      return [];
    }

    const criteriaId: string | undefined = input.criteriaInstance.data?.id;
    if (!criteriaId) {
      return [];
    }

    const body: JSONObject | null = this.getRequestBodyObject(
      input.dataToProcess,
    );
    if (!body) {
      return [];
    }

    const matches: Array<PerSeriesCriteriaMatch> = [];

    for (const item of this.extractItems({ requestBody: body, grouping })) {
      if (item.isResolved) {
        // A resolved event never opens an incident.
        continue;
      }

      matches.push({
        criteriaMetId: criteriaId,
        fingerprint: item.fingerprint,
        labels: item.labels,
        rootCause:
          input.rootCause ||
          `Incoming request matched grouping key \`${item.keyValue}\`.`,
        metricContext: undefined,
      });
    }

    return matches;
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
   * Whether any criteria on the step has grouping configured. Used to
   * force per-series mode so a grouped criteria never falls back to a
   * single whole-monitor incident on a payload that yields no firing key.
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
    const { requestBody, grouping } = input;

    const groupByPath: string = grouping.groupByJSONPath;
    if (!groupByPath) {
      return [];
    }

    const labelKey: string = this.labelKeyFromPath(groupByPath);
    const maxKeys: number =
      grouping.maxKeysPerPayload && grouping.maxKeysPerPayload > 0
        ? grouping.maxKeysPerPayload
        : DEFAULT_MAX_KEYS_PER_PAYLOAD;

    const items: Array<IncomingRequestGroupingItem> = [];
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
      items.push({ fingerprint, labels, keyValue, isResolved });
    };

    const wildcardIndex: number = groupByPath.indexOf(ARRAY_WILDCARD);

    // Simple (non-array) path: a single key for the whole payload.
    if (wildcardIndex === -1) {
      const keyValue: string | null = this.toScalarString(
        VMUtil.deepFind(requestBody, groupByPath),
      );

      if (keyValue === null) {
        return [];
      }

      addItem(
        keyValue,
        this.isResolvedForScope(requestBody, requestBody, grouping),
      );
      return items;
    }

    // Array fan-out: one key per element of the array at the `[*]` prefix.
    const prefixPath: string = groupByPath
      .slice(0, wildcardIndex)
      .replace(/\.$/, "");
    const elementSuffix: string = this.stripLeadingDot(
      groupByPath.slice(wildcardIndex + ARRAY_WILDCARD.length),
    );

    const arrayValue: JSONValue | undefined = prefixPath
      ? VMUtil.deepFind(requestBody, prefixPath)
      : (requestBody as unknown as JSONValue);

    if (!Array.isArray(arrayValue)) {
      return [];
    }

    for (const element of arrayValue) {
      if (items.length >= maxKeys) {
        logger.warn(
          `IncomingRequestIncidentGrouping: payload produced more than ${maxKeys} keys for path "${groupByPath}"; remaining keys ignored.`,
        );
        break;
      }

      if (!element || typeof element !== Typeof.Object) {
        continue;
      }

      const elementObject: JSONObject = element as JSONObject;

      const keyValue: string | null = this.toScalarString(
        elementSuffix
          ? VMUtil.deepFind(elementObject, elementSuffix)
          : (elementObject as unknown as JSONValue),
      );

      if (keyValue === null) {
        continue;
      }

      addItem(
        keyValue,
        this.isResolvedForScope(elementObject, requestBody, grouping),
      );
    }

    return items;
  }

  /**
   * Classify whether the configured resolve condition holds. When the
   * resolve path itself uses `[*]`, it is evaluated relative to the array
   * element (`elementScope`); otherwise it is evaluated against the whole
   * payload (`rootScope`).
   */
  private static isResolvedForScope(
    elementScope: JSONObject,
    rootScope: JSONObject,
    grouping: IncidentGroupingConfig,
  ): boolean {
    if (
      !grouping.resolvedWhenJSONPath ||
      grouping.resolvedWhenValue === undefined
    ) {
      return false;
    }

    const wildcardIndex: number =
      grouping.resolvedWhenJSONPath.indexOf(ARRAY_WILDCARD);

    let scope: JSONObject = rootScope;
    let path: string = grouping.resolvedWhenJSONPath;

    if (wildcardIndex !== -1) {
      scope = elementScope;
      path = this.stripLeadingDot(
        grouping.resolvedWhenJSONPath.slice(
          wildcardIndex + ARRAY_WILDCARD.length,
        ),
      );
    }

    if (!path) {
      return false;
    }

    const value: string | null = this.toScalarString(
      VMUtil.deepFind(scope, path),
    );

    return value !== null && value === grouping.resolvedWhenValue;
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
      .replace(/\[[^\]]*\]/g, "");
    const parts: Array<string> = cleaned.split(".").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1]! : "key";
  }

  private static stripLeadingDot(path: string): string {
    return path.startsWith(".") ? path.slice(1) : path;
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
