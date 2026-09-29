import { JSONObject } from "../../Types/JSON";
import { MonitorStepType } from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";

/*
 * The one-line "what does this monitor watch" under the hero headline:
 * "GET https://api.example.com/health", "db.internal:5432", "A example.com".
 *
 * Monitor steps are user-written and carry secrets in more places than one
 * would like - userinfo and tokens in URLs, database credentials. The hero is
 * visible to every role that can open the monitor, so this only ever shows
 * the parts that identify the resource: URLs lose userinfo, query and
 * fragment; hosts lose anything before an "@"; SQL targets never read the
 * username or password fields at all.
 */

export interface MonitorOverviewTarget {
  value: string;
  // True for URLs, hosts and names that read better in a fixed-width font.
  isMono: boolean;
  // How many more steps the monitor has beyond the one shown.
  extraStepCount: number;
}

// scheme://userinfo@ at the start of a URL.
const URL_USERINFO_WITH_SCHEME: RegExp = /^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i;

/*
 * userinfo@ on a value typed without a scheme ("user:pass@host/path"). Only
 * matches an "@" that comes before the first "/", so a path segment that
 * happens to contain one is left alone.
 */
const URL_USERINFO_WITHOUT_SCHEME: RegExp = /^[^/@]*@/;

// Text of a step value that may be a string, a typed class or a JSON envelope.
const toText: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "object") {
    const envelope: JSONObject = value as JSONObject;

    if (envelope["_type"] && typeof envelope["value"] === "string") {
      return (envelope["value"] as string).trim();
    }

    const text: string = String(value);

    return text === "[object Object]" ? "" : text.trim();
  }

  return "";
};

export default class MonitorOverviewTargetUtil {
  public static getTarget(data: {
    monitorType: MonitorType;
    monitorSteps: MonitorSteps | undefined;
    serverHostname?: string | undefined;
  }): MonitorOverviewTarget | null {
    try {
      const steps: Array<unknown> = MonitorOverviewTargetUtil.getSteps(
        data.monitorSteps,
      );
      const extraStepCount: number = Math.max(0, steps.length - 1);
      const firstStep: unknown = steps[0];
      const step: Partial<MonitorStepType> | undefined =
        firstStep && typeof firstStep === "object"
          ? (firstStep as { data?: Partial<MonitorStepType> | undefined })
              .data ?? undefined
          : undefined;

      const target: { value: string; isMono: boolean } | null =
        MonitorOverviewTargetUtil.getTargetValue({
          monitorType: data.monitorType,
          step: step,
          serverHostname: data.serverHostname,
        });

      if (!target || !target.value) {
        return null;
      }

      return {
        value: target.value,
        isMono: target.isMono,
        extraStepCount: extraStepCount,
      };
    } catch {
      // A malformed step must not take the hero down with it.
      return null;
    }
  }

  /*
   * "https://user:pass@host/p?token=x#f" becomes "https://host/p". Query
   * strings are dropped wholesale rather than filtered: there is no reliable
   * list of which parameter names carry secrets.
   */
  public static redactUrl(value: string): string {
    let text: string = toText(value);

    const hashIndex: number = text.indexOf("#");

    if (hashIndex >= 0) {
      text = text.substring(0, hashIndex);
    }

    const queryIndex: number = text.indexOf("?");

    if (queryIndex >= 0) {
      text = text.substring(0, queryIndex);
    }

    if (URL_USERINFO_WITH_SCHEME.test(text)) {
      return text.replace(URL_USERINFO_WITH_SCHEME, "$1").trim();
    }

    return text.replace(URL_USERINFO_WITHOUT_SCHEME, "").trim();
  }

  // "user@db.internal" becomes "db.internal".
  public static redactHost(value: string): string {
    const text: string = toText(value);
    const atIndex: number = text.lastIndexOf("@");

    return (atIndex >= 0 ? text.substring(atIndex + 1) : text).trim();
  }

  private static getSteps(
    monitorSteps: MonitorSteps | undefined,
  ): Array<unknown> {
    const steps: unknown = monitorSteps?.data?.monitorStepsInstanceArray;

    return Array.isArray(steps) ? steps : [];
  }

  private static getTargetValue(data: {
    monitorType: MonitorType;
    step: Partial<MonitorStepType> | undefined;
    serverHostname: string | undefined;
  }): { value: string; isMono: boolean } | null {
    const step: Partial<MonitorStepType> | undefined = data.step;

    switch (data.monitorType) {
      case MonitorType.Website:
      case MonitorType.SSLCertificate:
      case MonitorType.ExternalStatusPage: {
        const raw: string =
          data.monitorType === MonitorType.ExternalStatusPage
            ? toText(step?.externalStatusPageMonitor?.statusPageUrl) ||
              toText(step?.monitorDestination)
            : toText(step?.monitorDestination) ||
              toText(step?.externalStatusPageMonitor?.statusPageUrl);

        return {
          value: MonitorOverviewTargetUtil.redactUrl(raw),
          isMono: true,
        };
      }

      case MonitorType.API: {
        const url: string = MonitorOverviewTargetUtil.redactUrl(
          toText(step?.monitorDestination),
        );

        if (!url) {
          return null;
        }

        const method: string = toText(step?.requestType);

        return { value: method ? `${method} ${url}` : url, isMono: true };
      }

      case MonitorType.Ping:
      case MonitorType.IP:
        return {
          value: MonitorOverviewTargetUtil.redactHost(
            toText(step?.monitorDestination),
          ),
          isMono: true,
        };

      case MonitorType.Port: {
        const host: string = MonitorOverviewTargetUtil.redactHost(
          toText(step?.monitorDestination),
        );

        if (!host) {
          return null;
        }

        const port: string = toText(step?.monitorDestinationPort);

        return { value: port ? `${host}:${port}` : host, isMono: true };
      }

      case MonitorType.DNS: {
        const queryName: string = toText(step?.dnsMonitor?.queryName);

        if (!queryName) {
          return null;
        }

        const recordType: string = toText(step?.dnsMonitor?.recordType);
        const resolver: string = toText(step?.dnsMonitor?.hostname);

        let value: string = recordType
          ? `${recordType} ${queryName}`
          : queryName;

        if (resolver) {
          value += ` via ${resolver}`;
        }

        return { value: value, isMono: true };
      }

      case MonitorType.Domain:
        return {
          value: toText(step?.domainMonitor?.domainName),
          isMono: true,
        };

      case MonitorType.DNSSEC:
        return {
          value: toText(step?.dnssecMonitor?.domainName),
          isMono: true,
        };

      case MonitorType.SQLQuery:
      case MonitorType.Database: {
        /*
         * Only these four fields are read. The username and password live
         * right next to them and must never reach the page.
         */
        const connection:
          | {
              databaseType?: unknown;
              host?: unknown;
              port?: unknown;
              databaseName?: unknown;
            }
          | undefined =
          data.monitorType === MonitorType.SQLQuery
            ? step?.sqlMonitor
            : step?.databaseMonitor;

        const databaseType: string = toText(connection?.databaseType);
        const host: string = MonitorOverviewTargetUtil.redactHost(
          toText(connection?.host),
        );
        const port: string = toText(connection?.port);
        const databaseName: string = toText(connection?.databaseName);

        let location: string = host ? (port ? `${host}:${port}` : host) : "";

        if (databaseName) {
          location = location ? `${location}/${databaseName}` : databaseName;
        }

        const value: string = [databaseType, location]
          .filter((part: string) => {
            return Boolean(part);
          })
          .join(" · ");

        return { value: value, isMono: true };
      }

      case MonitorType.Server:
        return { value: toText(data.serverHostname), isMono: true };

      case MonitorType.SyntheticMonitor:
        return { value: "Browser script", isMono: false };

      case MonitorType.CustomJavaScriptCode:
        return { value: "Custom script", isMono: false };

      default:
        /*
         * Network devices link to the device instead; heartbeats, telemetry,
         * infrastructure and manual monitors have no single target.
         */
        return null;
    }
  }
}
