import {
  MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS,
  OpenStackBackoffEntry,
  REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS,
} from "../OpenStackBackoff";
import {
  OPENSTACK_CATALOG_TYPES,
  OpenStackCatalogEndpoint,
  OpenStackCatalogService,
  getOpenStackCatalogRegions,
  toOpenStackServiceBaseUrl,
} from "../OpenStackCatalog";
import {
  ClassifiedOpenStackError,
  classifyOpenStackError,
  readErrorMessage,
} from "../OpenStackCollectionErrors";
import { getOpenStackCredentialKey } from "../OpenStackCollectorMemory";
import {
  OpenStackEndpointRefusedError,
  OpenStackHttpResponse,
  OpenStackTransportHandle,
} from "../OpenStackHttp";
import { OpenStackCertificateError } from "../OpenStackTls";
import { OpenStackToken, keystoneLogin } from "../OpenStackKeystone";
import { mapWithLimit } from "../OpenStackServiceClient";
import {
  DEFAULT_OPENSTACK_CHECK_DEPENDENCIES,
  OpenStackCheckDependencies,
} from "./OpenStackCheckDependencies";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackApiCheckJob,
  OpenStackApiCheckOutcome,
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
  OpenStackCertificateResult,
} from "Common/Types/OpenStack/OpenStackCheck";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import OpenStackAuthUrl, {
  OpenStackAddress,
  OpenStackAddressResult,
} from "Common/Utils/OpenStack/OpenStackAuthUrl";

/*
 * THE API CHECKS: WHETHER A USER COULD GET THROUGH TO THIS CLOUD RIGHT NOW.
 *
 * Read-only, and over in seconds. Keystone is asked for a token, each service the catalog names is
 * asked one small authenticated read, and each endpoint's certificate is read off the connection
 * that asked. There is no list of services to keep: whatever the catalog names is what gets asked,
 * so a service someone adds next month is checked next month without anyone doing anything.
 *
 * Exactly one request each, with no retry. A collection retries because it wants the data; this
 * wants to know what a user would have met. The alert templates look for it failing several times
 * running, so a blip costs nothing, and a retry here would only hide a service failing half the
 * time.
 *
 * The token is not revoked afterwards. Fernet tokens are not stored, so an unused one costs nothing,
 * and each revocation is an event Keystone checks every later token against.
 *
 * A credential Keystone refuses is asked again later and not every minute, because repeating one
 * is what locks an account (lockout_failure_attempts). A Keystone that is failing is asked every
 * time: one login a minute is nothing to it, and how soon it comes back is what this is for.
 *
 * The secret goes to Keystone and nowhere else.
 */

const REQUEST_TIMEOUT_IN_MS: number = 15_000;
const LOGIN_TIMEOUT_IN_MS: number = 15_000;
const READS_AT_A_TIME: number = 8;

// A check is over well before the next is due, and sooner than a minute's worth of trouble.
const CHECK_TIME_IN_MS: number = 50_000;

/*
 * The small read to ask of each kind of service.
 *
 * What is under the six services OneUptime collects has been recorded: Tests/Ops/openstack-e2e. The
 * rest are from each API's reference and have not met a real cloud here. A wrong one costs little,
 * because it is answered with a 404, which for these counts as the API having answered.
 */
export interface OpenStackCheckRead {
  path: string;
  query?: string | undefined;
}

const READS_OF_SERVICES_COLLECTED: Readonly<
  Record<OpenStackServiceType, OpenStackCheckRead>
> = {
  // What any token may ask, because policy keeps the lists from a project's member.
  [OpenStackServiceType.Identity]: { path: "/auth/projects" },
  [OpenStackServiceType.Compute]: { path: "/servers", query: "limit=1" },
  [OpenStackServiceType.Network]: { path: "/networks", query: "limit=1" },
  [OpenStackServiceType.Volume]: { path: "/volumes", query: "limit=1" },
  [OpenStackServiceType.Image]: { path: "/images", query: "limit=1" },
  /*
   * Placement pages nothing and refuses a parameter it does not know, and its short lists are as
   * good. A project's member is refused by policy, which still shows the token was checked.
   */
  [OpenStackServiceType.Placement]: { path: "/resource_classes" },
};

const READS_OF_OTHER_SERVICES: Readonly<Record<string, OpenStackCheckRead>> = {
  orchestration: { path: "/stacks", query: "limit=1" },
  "load-balancer": { path: "/v2/lbaas/loadbalancers", query: "limit=1" },
  "key-manager": { path: "/v1/secrets", query: "limit=1" },
  dns: { path: "/v2/zones", query: "limit=1" },
  "object-store": { path: "", query: "limit=1&format=json" },
  "shared-file-system": { path: "/shares", query: "limit=1" },
  sharev2: { path: "/shares", query: "limit=1" },
  baremetal: { path: "/v1/nodes", query: "limit=1" },
  "container-infra": { path: "/v1/clusters", query: "limit=1" },
  database: { path: "/instances", query: "limit=1" },
  metric: { path: "/v1/metric", query: "limit=1" },
  alarming: { path: "/v2/alarms", query: "limit=1" },
};

// A catalog type as the service OneUptime knows it by, or null for one it does not collect.
export function getOpenStackServiceOfCatalogType(
  type: string,
): OpenStackServiceType | null {
  for (const service of Object.keys(
    OPENSTACK_CATALOG_TYPES,
  ) as Array<OpenStackServiceType>) {
    if (OPENSTACK_CATALOG_TYPES[service].includes(type)) {
      return service;
    }
  }

  return null;
}

interface PlannedRead {
  serviceType: string;
  serviceName: string;
  regionNames: Array<string>;
  url: string;
  // How a person would say it: GET /servers?limit=1.
  read: string;
  isKnownRead: boolean;
}

function planRead(data: {
  service: OpenStackCatalogService;
  catalogUrl: string;
  regionName: string;
}): PlannedRead {
  const collected: OpenStackServiceType | null =
    getOpenStackServiceOfCatalogType(data.service.type);
  const read: OpenStackCheckRead | undefined = collected
    ? READS_OF_SERVICES_COLLECTED[collected]
    : READS_OF_OTHER_SERVICES[data.service.type];

  const base: string = collected
    ? toOpenStackServiceBaseUrl(collected, data.catalogUrl)
    : data.catalogUrl.replace(/\/$/, "");

  const path: string = read?.path || "";
  const query: string = read?.query ? `?${read.query}` : "";

  return {
    serviceType: data.service.type,
    serviceName: data.service.name,
    regionNames: [data.regionName],
    url: `${base}${path}${query}`,
    read: read ? `GET ${path || "/"}${query}` : "GET /",
    /*
     * For the six recorded, a 404 means the catalog's URL is wrong, or a proxy has lost the service.
     * For the rest it can only mean a path here is out of date.
     */
    isKnownRead: collected !== null,
  };
}

/*
 * What to ask this time: each service in the catalog, once in each region, on the interface this
 * cloud is set to use. A catalog can name one URL under two types (Cinder as block-storage and
 * volumev3), and asking it twice would tell nothing and count double.
 */
export function planOpenStackApiCheckReads(data: {
  catalog: ReadonlyArray<OpenStackCatalogService>;
  regions: ReadonlyArray<string>;
  endpointInterface: string;
  identityUrl: string;
}): Array<PlannedRead> {
  const planned: Map<string, PlannedRead> = new Map();

  for (const service of data.catalog) {
    // Keystone is one for the whole cloud: see below.
    if (
      getOpenStackServiceOfCatalogType(service.type) ===
      OpenStackServiceType.Identity
    ) {
      continue;
    }

    for (const endpoint of service.endpoints as Array<OpenStackCatalogEndpoint>) {
      if (
        endpoint.interfaceName !== data.endpointInterface ||
        !data.regions.includes(endpoint.regionName)
      ) {
        continue;
      }

      const key: string = `${endpoint.regionName} ${endpoint.url}`;

      if (!planned.has(key)) {
        planned.set(
          key,
          planRead({
            service: service,
            catalogUrl: endpoint.url,
            regionName: endpoint.regionName,
          }),
        );
      }
    }
  }

  /*
   * Asked once, at the address this credential logs in to, and each region says the same of it, as
   * the collector's series do, so a monitor narrowed to a region finds it.
   */
  const identityService: OpenStackCatalogService | undefined =
    data.catalog.find((service: OpenStackCatalogService): boolean => {
      return (
        getOpenStackServiceOfCatalogType(service.type) ===
        OpenStackServiceType.Identity
      );
    });

  const identity: OpenStackCheckRead =
    READS_OF_SERVICES_COLLECTED[OpenStackServiceType.Identity];

  return [
    {
      serviceType: identityService?.type || "identity",
      serviceName: identityService?.name || "keystone",
      regionNames: [...data.regions],
      url: `${data.identityUrl}${identity.path}`,
      read: `GET ${identity.path}`,
      isKnownRead: true,
    },
    ...planned.values(),
  ];
}

/*
 * What a status says about the API that answered with it.
 *
 * A token Keystone issued a moment ago meeting a 401 means the service cannot check it, which no
 * user could get past either: unless this credential has access rules, which refuse a path they do
 * not list in the same words.
 */
export function judgeOpenStackApiAnswer(data: {
  status: number;
  isKnownRead: boolean;
  hasAccessRules: boolean;
}): OpenStackApiCheckOutcome {
  const { status } = data;

  if (status >= 500 || status === 429) {
    return "Failing";
  }

  if (status === 401) {
    return data.hasAccessRules ? "Refused" : "Failing";
  }

  // As a collection's reads: a 409 is Neutron on a project with no quota for security groups.
  if (status === 403 || status === 409) {
    return "Refused";
  }

  if (status === 404) {
    return data.isKnownRead ? "Failing" : "Answered";
  }

  return "Answered";
}

function hostPortOf(url: string): { host: string; port: number } | null {
  try {
    const parsed: globalThis.URL = new globalThis.URL(url);
    let host: string = parsed.hostname.toLowerCase();

    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }

    return {
      host: host,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 443,
    };
  } catch {
    return null;
  }
}

async function runRead(data: {
  planned: PlannedRead;
  token: OpenStackToken;
  handle: OpenStackTransportHandle;
  deps: OpenStackCheckDependencies;
  deadlineAt: number;
  certificateErrors: Array<OpenStackPresentedCertificate>;
}): Promise<Array<OpenStackApiServiceResult>> {
  const { planned, deps } = data;
  const startedAt: number = deps.clock.now();

  const results: (
    outcome: OpenStackApiCheckOutcome,
    status: number | undefined,
    message: string | undefined,
  ) => Array<OpenStackApiServiceResult> = (
    outcome: OpenStackApiCheckOutcome,
    status: number | undefined,
    message: string | undefined,
  ): Array<OpenStackApiServiceResult> => {
    return planned.regionNames.map(
      (regionName: string): OpenStackApiServiceResult => {
        return {
          regionName: regionName,
          serviceType: planned.serviceType,
          serviceName: planned.serviceName,
          read: planned.read,
          outcome: outcome,
          ...(status !== undefined ? { status: status } : {}),
          durationInMs: Math.max(0, deps.clock.now() - startedAt),
          ...(message ? { message: message } : {}),
        };
      },
    );
  };

  const remaining: number = data.deadlineAt - deps.clock.now();

  if (remaining <= 0) {
    return results(
      "Failing",
      undefined,
      "The check ran out of time before this service could be asked.",
    );
  }

  try {
    const response: OpenStackHttpResponse = await data.handle.transport({
      method: "GET",
      url: planned.url,
      headers: {
        Accept: "application/json",
        "User-Agent": deps.userAgent,
        "X-Auth-Token": data.token.id,
      },
      timeoutInMs: Math.min(REQUEST_TIMEOUT_IN_MS, remaining),
    });

    const outcome: OpenStackApiCheckOutcome = judgeOpenStackApiAnswer({
      status: response.status,
      isKnownRead: planned.isKnownRead,
      hasAccessRules: data.token.hasAccessRules,
    });

    return results(
      outcome,
      response.status,
      outcome === "Answered"
        ? undefined
        : readErrorMessage(response.body) || `HTTP ${response.status}`,
    );
  } catch (error) {
    if (error instanceof OpenStackCertificateError) {
      data.certificateErrors.push(error.presentedCertificate);
    }

    // The probe will not send a token there, so what that service would have said is not known.
    if (error instanceof OpenStackEndpointRefusedError) {
      return results("NotChecked", undefined, error.message);
    }

    const where: { host: string; port: number } = hostPortOf(planned.url) || {
      host: planned.url,
      port: 443,
    };

    return results(
      "Failing",
      undefined,
      classifyOpenStackError(error, where).message,
    );
  }
}

/*
 * Which regions and services each host holds, so a certificate that is running out can say what
 * goes with it.
 */
function getCertificateResults(data: {
  planned: ReadonlyArray<PlannedRead>;
  seen: ReadonlyArray<OpenStackPresentedCertificate>;
}): Array<OpenStackCertificateResult> {
  const byHost: Map<string, OpenStackCertificateResult> = new Map();

  for (const certificate of data.seen) {
    if (!certificate.host || !certificate.port || !certificate.validTo) {
      continue;
    }

    byHost.set(`${certificate.host}:${certificate.port}`, {
      host: certificate.host,
      port: certificate.port,
      validTo: certificate.validTo,
      ...(certificate.subject ? { subject: certificate.subject } : {}),
      ...(certificate.issuer ? { issuer: certificate.issuer } : {}),
      ...(certificate.fingerprint256
        ? { fingerprint256: certificate.fingerprint256 }
        : {}),
      regionNames: [],
      serviceTypes: [],
    });
  }

  for (const planned of data.planned) {
    const where: { host: string; port: number } | null = hostPortOf(
      planned.url,
    );
    const result: OpenStackCertificateResult | undefined = where
      ? byHost.get(`${where.host}:${where.port}`)
      : undefined;

    if (!result) {
      continue;
    }

    for (const regionName of planned.regionNames) {
      if (!result.regionNames.includes(regionName)) {
        result.regionNames.push(regionName);
      }
    }

    if (!result.serviceTypes.includes(planned.serviceType)) {
      result.serviceTypes.push(planned.serviceType);
    }
  }

  return Array.from(byHost.values()).sort(
    (a: OpenStackCertificateResult, b: OpenStackCertificateResult): number => {
      return `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`);
    },
  );
}

export default class OpenStackApiCheck {
  // Never throws: whatever went wrong is what it reports.
  public static async run(
    job: OpenStackApiCheckJob,
    deps: OpenStackCheckDependencies = DEFAULT_OPENSTACK_CHECK_DEPENDENCIES,
  ): Promise<OpenStackApiCheckResult> {
    const { clock } = deps;
    const startedAt: number = clock.now();

    const result: OpenStackApiCheckResult = {
      startedAt: new Date(startedAt).toISOString(),
      durationInMs: 0,
      regionNames: [...job.regions],
      token: { status: "Failed", durationInMs: 0 },
      services: [],
      certificates: [],
      warnings: [],
    };

    const finish: () => OpenStackApiCheckResult =
      (): OpenStackApiCheckResult => {
        result.durationInMs = Math.max(0, clock.now() - startedAt);
        return result;
      };

    const normalized: OpenStackAddressResult = OpenStackAuthUrl.normalize(
      job.authUrl,
    );

    if (!normalized.address) {
      result.token.errorCode = OpenStackCollectionErrorCode.InvalidAddress;
      result.token.message = normalized.error;
      return finish();
    }

    const address: OpenStackAddress = normalized.address;
    const backoffKey: string = getOpenStackCredentialKey({
      openStackCloudId: job.openStackCloudCheckId,
      authUrl: address.url,
      credential: job.credential,
      trustedFingerprints: job.trustedCertificateFingerprints,
    });

    const heldBack: OpenStackBackoffEntry | null = deps.backoff.check(
      backoffKey,
      startedAt,
    );

    if (heldBack) {
      result.token.status = "BackingOff";
      result.token.errorCode = heldBack.code;
      result.token.message = `${heldBack.message} Repeating a refused credential is what locks an account, so the probe asks again at ${new Date(
        heldBack.nextTryAt,
      ).toISOString()}.`;
      return finish();
    }

    const seen: Array<OpenStackPresentedCertificate> = [];

    const handle: OpenStackTransportHandle = deps.createTransport({
      trustedFingerprints: job.trustedCertificateFingerprints,
      resolve: deps.resolve,
      onCertificate: (certificate: OpenStackPresentedCertificate): void => {
        seen.push(certificate);
      },
    });

    try {
      let token: OpenStackToken;

      try {
        token = await keystoneLogin({
          authUrl: address.url,
          credential: job.credential,
          transport: handle.transport,
          userAgent: deps.userAgent,
          timeoutInMs: LOGIN_TIMEOUT_IN_MS,
        });
      } catch (error) {
        const classified: ClassifiedOpenStackError = classifyOpenStackError(
          error,
          { host: address.host, port: address.port },
        );

        result.token.durationInMs = Math.max(0, clock.now() - startedAt);
        result.token.errorCode = classified.code;
        result.token.message = classified.message;

        if (classified.presentedCertificate) {
          seen.push(classified.presentedCertificate);
        }

        if (
          classified.code === OpenStackCollectionErrorCode.InvalidCredential ||
          classified.code === OpenStackCollectionErrorCode.WrongProjectScope
        ) {
          deps.backoff.recordFailure(backoffKey, {
            now: clock.now(),
            random: clock.random(),
            baseInMs: REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS,
            maxInMs: MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS,
            code: classified.code,
            message: classified.message,
          });
        }

        // Keystone's own certificate is worth reporting even when nothing else could be asked.
        result.certificates = getCertificateResults({
          planned: [],
          seen: seen,
        });

        return finish();
      }

      deps.backoff.recordSuccess(backoffKey);

      result.token.status = "Passed";
      result.token.durationInMs = Math.max(0, clock.now() - startedAt);

      const inCatalog: Array<string> = getOpenStackCatalogRegions(
        token.catalog,
      );
      const regions: Array<string> =
        job.regions.length > 0
          ? job.regions.filter((region: string): boolean => {
              return inCatalog.includes(region);
            })
          : inCatalog;

      for (const region of job.regions) {
        if (!inCatalog.includes(region)) {
          result.warnings.push(
            `The catalog has no region named ${region}, so it was left out. It names ${inCatalog.join(", ")}.`,
          );
        }
      }

      result.regionNames = regions;

      const planned: Array<PlannedRead> = planOpenStackApiCheckReads({
        catalog: token.catalog,
        regions: regions,
        endpointInterface: job.endpointInterface,
        identityUrl: `${address.url}/v3`,
      });

      const deadlineAt: number = startedAt + CHECK_TIME_IN_MS;
      const certificateErrors: Array<OpenStackPresentedCertificate> = [];

      await mapWithLimit(
        planned,
        READS_AT_A_TIME,
        async (read: PlannedRead): Promise<void> => {
          const answers: Array<OpenStackApiServiceResult> = await runRead({
            planned: read,
            token: token,
            handle: handle,
            deps: deps,
            deadlineAt: deadlineAt,
            certificateErrors: certificateErrors,
          });

          for (const answer of answers) {
            result.services.push(answer);
          }
        },
      );

      for (const answer of result.services) {
        if (answer.outcome === "NotChecked" && answer.message) {
          if (!result.warnings.includes(answer.message)) {
            result.warnings.push(answer.message);
          }
        }
      }

      result.services.sort(
        (
          a: OpenStackApiServiceResult,
          b: OpenStackApiServiceResult,
        ): number => {
          return (
            a.regionName.localeCompare(b.regionName) ||
            a.serviceType.localeCompare(b.serviceType)
          );
        },
      );

      result.certificates = getCertificateResults({
        planned: planned,
        seen: [...seen, ...certificateErrors],
      });

      return finish();
    } finally {
      handle.close();
    }
  }
}
