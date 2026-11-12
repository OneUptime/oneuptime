import Monitor from "../../Models/DatabaseModels/Monitor";
import URL from "../../Types/API/URL";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import { Translator } from "../../Types/Translator";

/*
 * THE WEBSITE MONITOR A GUIDED SETUP MAKES, ONE COPY FOR EVERY WAY IN.
 *
 * "Know when my website or API is down" is set up two ways: the guided
 * setup's page in the Dashboard (#6804, Components/GuidedSetup/WebsiteDown)
 * and a sentence to Ask AI (#6829, Server/Utils/AI/Toolbox/SetupTools). Both
 * build the monitor here, so for the same answers they make the same record:
 *
 *   - the address: "example.com" is enough, and https is added;
 *   - the name: the host, and the path when there is one;
 *   - the type: Website, or API when the person says it is an API;
 *   - Create Monitor's defaults for everything else: the type's criteria
 *     (offline when it does not answer, or answers outside 200 to 399, which
 *     opens an incident), every five minutes, and the probes a new monitor
 *     starts with - left to the server, which adds them when the create
 *     names none.
 *
 * Pure: no database, no React. The Dashboard reads and writes through the
 * model API (WebsiteDownApi), the server through the services (SetupTools),
 * as the person either way, so every permission, plan limit and default the
 * server applies to Create Monitor applies to both.
 */

/*
 * How often a new monitor is checked: Create Monitor's default, every five
 * minutes. The Dashboard's own copy is DEFAULT_MONITORING_INTERVAL
 * (Utils/Form/Monitor/MonitoringIntervalDefault); a test holds the two equal.
 */
export const GUIDED_SETUP_MONITORING_INTERVAL: string = "*/5 * * * *";

// What a monitor is called at most: the host and path cut to this many characters.
export const MONITOR_NAME_MAX_LENGTH: number = 100;

/*
 * THE ADDRESS. A person types "example.com" as often as a whole URL:
 * without a scheme it is https. Only http and https are checked by a
 * Website or API monitor.
 */
export interface WebsiteAddress {
  url: string;
  host: string;
  // What the monitor is called: the host, and the path when there is one.
  monitorName: string;
}

const SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;
const WHITESPACE: RegExp = /\s/;

/*
 * A path without its trailing slashes, taken one at a time: what a person
 * typed is short, and no pattern runs on it (a run of slashes in the middle
 * made /\/+$/ try again at every one of them).
 */
const withoutTrailingSlashes: (path: string) => string = (
  path: string,
): string => {
  let end: number = path.length;

  while (end > 0 && path[end - 1] === "/") {
    end--;
  }

  return path.slice(0, end);
};

export const parseWebsiteAddress: (input: string) => WebsiteAddress | null = (
  input: string,
): WebsiteAddress | null => {
  const text: string = (input || "").trim();

  if (!text || WHITESPACE.test(text)) {
    return null;
  }

  const withScheme: string = SCHEME.test(text) ? text : `https://${text}`;

  let parsed: globalThis.URL;

  try {
    parsed = new globalThis.URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  /*
   * No user or password in it: "mailto:ana@example.com" given https:// in
   * front reads as one, and a password must not become a monitor's name.
   */
  if (parsed.username || parsed.password) {
    return null;
  }

  const host: string = parsed.hostname.toLowerCase();

  // A host is a name with a dot in it, localhost, or an IP address.
  if (
    !host ||
    (!host.includes(".") && !host.includes(":") && host !== "localhost")
  ) {
    return null;
  }

  try {
    URL.fromString(withScheme);
  } catch {
    return null;
  }

  const path: string = withoutTrailingSlashes(parsed.pathname);
  const name: string = `${host.replace(/^www\./, "")}${parsed.port ? `:${parsed.port}` : ""}${path}`;

  return {
    url: withScheme,
    host: host,
    monitorName:
      name.length > MONITOR_NAME_MAX_LENGTH
        ? name.slice(0, MONITOR_NAME_MAX_LENGTH)
        : name,
  };
};

/*
 * ONE ADDRESS, HOWEVER IT WAS TYPED (#7059): the scheme, the host, the port,
 * the path and the query a check asks for. "acme.example" is
 * "https://acme.example/", and a host's capitals or a path's trailing slash
 * change nothing; http and https, www or not, another path or another query
 * are other checks. Null for text that is not a web address, or that names
 * a user or password: the setup never checks one (parseWebsiteAddress).
 */
export const getWebsiteAddressIdentity: (text: string) => string | null = (
  text: string,
): string | null => {
  const trimmed: string = (text || "").trim();

  if (!trimmed || WHITESPACE.test(trimmed)) {
    return null;
  }

  let parsed: globalThis.URL;

  try {
    parsed = new globalThis.URL(
      SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  return `${parsed.protocol}//${parsed.host.toLowerCase()}${withoutTrailingSlashes(parsed.pathname)}${parsed.search}`;
};

export const isSameWebsiteAddress: (left: string, right: string) => boolean = (
  left: string,
  right: string,
): boolean => {
  const leftIdentity: string | null = getWebsiteAddressIdentity(left);

  return (
    leftIdentity !== null && leftIdentity === getWebsiteAddressIdentity(right)
  );
};

// What a new monitor's default criteria are made with: the project's own.
export interface WebsiteMonitorSeeds {
  operationalStatusId: ObjectID;
  offlineStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

// One of the project's monitor statuses, as the seeds are picked from it.
export interface WebsiteMonitorSeedStatus {
  id?: ObjectID | null | undefined;
  isOperationalState?: boolean | undefined;
  isOfflineState?: boolean | undefined;
}

// One of the project's incident or alert severities, in the project's order.
export interface WebsiteMonitorSeedSeverity {
  id?: ObjectID | null | undefined;
  isArchived?: boolean | undefined;
}

/*
 * Why a monitor can't be made from the project's records: it has no
 * operational or offline status, or no live severity, which Create Monitor's
 * criteria name.
 */
export const WEBSITE_MONITOR_SEEDS_MISSING: string =
  "This project is missing its monitor statuses or severities, so a monitor can't be made here. Create one from Create Monitor instead.";

/*
 * The statuses and severities a new monitor's default criteria name, as
 * Create Monitor seeds them: the operational and offline statuses (statuses
 * in the project's priority order), and the most severe live incident and
 * alert severities (severities in the project's order). Null when the
 * project lacks one.
 */
export const pickWebsiteMonitorSeeds: (data: {
  statuses: ReadonlyArray<WebsiteMonitorSeedStatus>;
  incidentSeverities: ReadonlyArray<WebsiteMonitorSeedSeverity>;
  alertSeverities: ReadonlyArray<WebsiteMonitorSeedSeverity>;
}) => WebsiteMonitorSeeds | null = (data: {
  statuses: ReadonlyArray<WebsiteMonitorSeedStatus>;
  incidentSeverities: ReadonlyArray<WebsiteMonitorSeedSeverity>;
  alertSeverities: ReadonlyArray<WebsiteMonitorSeedSeverity>;
}): WebsiteMonitorSeeds | null => {
  const operational: WebsiteMonitorSeedStatus | undefined = data.statuses.find(
    (status: WebsiteMonitorSeedStatus): boolean => {
      return Boolean(status.isOperationalState);
    },
  );
  const offline: WebsiteMonitorSeedStatus | undefined = data.statuses.find(
    (status: WebsiteMonitorSeedStatus): boolean => {
      return Boolean(status.isOfflineState);
    },
  );
  const isLive: (severity: WebsiteMonitorSeedSeverity) => boolean = (
    severity: WebsiteMonitorSeedSeverity,
  ): boolean => {
    return !severity.isArchived;
  };
  const incidentSeverity: WebsiteMonitorSeedSeverity | undefined =
    data.incidentSeverities.find(isLive);
  const alertSeverity: WebsiteMonitorSeedSeverity | undefined =
    data.alertSeverities.find(isLive);

  if (
    !operational?.id ||
    !offline?.id ||
    !incidentSeverity?.id ||
    !alertSeverity?.id
  ) {
    return null;
  }

  return {
    operationalStatusId: operational.id,
    offlineStatusId: offline.id,
    incidentSeverityId: incidentSeverity.id,
    alertSeverityId: alertSeverity.id,
  };
};

/*
 * The monitor Create Monitor would make for this address with every
 * default kept: the type's criteria, named in the translator's language
 * (English without one), and checked every `monitoringInterval` - five
 * minutes unless the person asked for another of Create Monitor's
 * intervals. The probes are left to the server, which adds the ones a new
 * monitor starts with when the create names none.
 */
export const buildWebsiteMonitor: (data: {
  address: WebsiteAddress;
  isApi: boolean;
  seeds: WebsiteMonitorSeeds;
  monitoringInterval: string;
  translator?: Translator | undefined;
}) => Monitor = (data: {
  address: WebsiteAddress;
  isApi: boolean;
  seeds: WebsiteMonitorSeeds;
  monitoringInterval: string;
  translator?: Translator | undefined;
}): Monitor => {
  const monitorType: MonitorType = data.isApi
    ? MonitorType.API
    : MonitorType.Website;

  const monitorSteps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: data.seeds.operationalStatusId,
    monitorType: monitorType,
    monitorName: data.address.monitorName,
    onlineMonitorStatusId: data.seeds.operationalStatusId,
    offlineMonitorStatusId: data.seeds.offlineStatusId,
    defaultIncidentSeverityId: data.seeds.incidentSeverityId,
    defaultAlertSeverityId: data.seeds.alertSeverityId,
    translator: data.translator,
  });

  monitorSteps.data?.monitorStepsInstanceArray[0]?.setMonitorDestination(
    URL.fromString(data.address.url),
  );

  const monitor: Monitor = new Monitor();
  monitor.name = data.address.monitorName;
  monitor.monitorType = monitorType;
  monitor.monitorSteps = monitorSteps;
  monitor.monitoringInterval = data.monitoringInterval;

  return monitor;
};
