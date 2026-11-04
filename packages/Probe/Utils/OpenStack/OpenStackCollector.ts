import {
  OpenStackAccessCheckResult,
  getOpenStackAccessLevel,
  runOpenStackAccessCheck,
} from "./OpenStackAccessCheck";
import {
  BACKOFF_BASE_IN_MS,
  MAX_BACKOFF_IN_MS,
  MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS,
  OpenStackBackoffEntry,
  REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS,
} from "./OpenStackBackoff";
import {
  OpenStackCatalogService,
  findOpenStackEndpoint,
  getOpenStackCatalogRegions,
  getOpenStackComputeRootUrl,
  toOpenStackServiceBaseUrl,
} from "./OpenStackCatalog";
import {
  ClassifiedOpenStackError,
  OpenStackCollectionError,
  classifyOpenStackError,
  isNoAnswer,
} from "./OpenStackCollectionErrors";
import OpenStackCollectorMemory, {
  OpenStackCachedSession,
  getOpenStackCredentialKey,
} from "./OpenStackCollectorMemory";
import {
  OpenStackTransport,
  OpenStackTransportHandle,
  createOpenStackTransport,
} from "./OpenStackHttp";
import {
  OpenStackInventoryByService,
  OpenStackComputeInventory,
  OpenStackIdentityInventory,
  OpenStackImageInventory,
  OpenStackNetworkInventory,
  OpenStackPlacementInventory,
  OpenStackVolumeInventory,
} from "./OpenStackInventory";
import {
  KEYSTONE_LOGIN_TIMEOUT_IN_MS,
  OpenStackKeystoneSession,
  OpenStackToken,
  diagnosePasswordScope,
  keystoneLogin,
  revokeKeystoneToken,
} from "./OpenStackKeystone";
import OpenStackOtlpBuilder, {
  OpenStackOtlpBuildResult,
  OpenStackServiceReading,
} from "./OpenStackOtlpBuilder";
import OpenStackServiceClient, {
  DEFAULT_OPENSTACK_CLOCK,
  OPENSTACK_REQUEST_TIMEOUT_IN_MS,
  OpenStackClock,
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "./OpenStackServiceClient";
import OpenStackServiceRun from "./OpenStackServiceRun";
import collectCompute, {
  chooseComputeMicroversion,
  computeMicroversionHeaders,
} from "./Collectors/ComputeCollector";
import collectIdentity from "./Collectors/IdentityCollector";
import collectImage from "./Collectors/ImageCollector";
import collectNetwork from "./Collectors/NetworkCollector";
import collectPlacement from "./Collectors/PlacementCollector";
import collectVolume, {
  CINDER_MICROVERSION,
} from "./Collectors/VolumeCollector";
import {
  OpenStackCollectorContext,
  OpenStackProjectRef,
} from "./Collectors/OpenStackCollectorContext";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import SSRFProtection, {
  ValidatedWebhookTarget,
  ValidatedWebhookTargetAddress,
} from "Common/Server/Utils/SSRFProtection";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OpenStackAccessRead,
  OpenStackCollectionJob,
  OpenStackCollectionOptions,
  OpenStackCollectionReport,
  OpenStackCollectionSummary,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
  OpenStackConnectionTestSummary,
  OpenStackCredential,
  OpenStackInstanceReadMode,
  OpenStackServiceOutcome,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import OpenStackAuthUrl, {
  OpenStackAddress,
  OpenStackAddressResult,
} from "Common/Utils/OpenStack/OpenStackAuthUrl";

/*
 * One collection, or one connection test, from the address to the report:
 *
 *   1. the address is read as the server reads it, and every address it or the catalog
 *      resolves to is checked against the addresses a probe never connects to
 *      (loopback, link-local, cloud metadata: SSRFProtection, the same guard as every
 *      other address a person types into OneUptime). Each socket is pinned to those
 *      very addresses;
 *   2. Keystone is logged in to, once, over a connection verified before the first
 *      byte, unless a token from an earlier collection is still good, or Keystone is
 *      being given time to recover;
 *   3. each service of each region is read on its own, at the same time as the others,
 *      so a slow or failing one takes nothing from the rest;
 *   4. what was read becomes the agent's series, and whatever went wrong becomes a code
 *      and an exact sentence. A report is always sent.
 *
 * The secret never leaves this module except to Keystone, and never appears in a report
 * or a log line.
 */

export const OPENSTACK_CONNECT_TIMEOUT_IN_MS: number = 15_000;
export const OPENSTACK_MAX_RESPONSE_BYTES: number = 64 * 1024 * 1024;
export const MAX_COLLECTION_TIME_IN_MS: number = 10 * 60_000;
export const TEST_TIME_IN_MS: number = 150_000;

/*
 * What reads wait for each other's end by, beyond the budget, if a transport never
 * answers at all. Each request has its own timeout, so this is only a backstop.
 */
export const HARD_STOP_GRACE_IN_MS: number = 5000;

/*
 * Identity and image are read about every five minutes, as the agent's scrape jobs read
 * them, however often the rest are. A project or an image changes less than a worker's
 * state, and their lists cost as much.
 *
 * The most whole collections that fit in five minutes, so an alert reading fifteen
 * still has its three: a cloud collected every two minutes reads these every four, and
 * not every six. Half a minute under, so a collection that started a moment early does
 * not miss its turn.
 */
export function getSlowServiceIntervalInMs(
  collectionIntervalInMinutes: number,
): number {
  const minutes: number = Math.max(collectionIntervalInMinutes, 1);
  const every: number = Math.max(Math.floor(5 / minutes), 1) * minutes;

  return every * 60_000 - 30_000;
}

const SLOW_SERVICES: ReadonlySet<OpenStackServiceType> = new Set([
  OpenStackServiceType.Identity,
  OpenStackServiceType.Image,
]);

const SERVICES_IN_ORDER: ReadonlyArray<OpenStackServiceType> = [
  OpenStackServiceType.Identity,
  OpenStackServiceType.Compute,
  OpenStackServiceType.Placement,
  OpenStackServiceType.Network,
  OpenStackServiceType.Volume,
  OpenStackServiceType.Image,
];

const MAX_SUMMARY_WARNINGS: number = 20;
const KNOWN_REGIONS_REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;

export interface OpenStackCollectorDependencies {
  // The addresses a host may be connected to (validated).
  resolve: (url: string) => Promise<Array<string>>;
  createTransport: (data: {
    trustedFingerprints: ReadonlyArray<string>;
    resolve: (url: string) => Promise<Array<string>>;
  }) => OpenStackTransportHandle;
  clock: OpenStackClock;
  memory: OpenStackCollectorMemory;
  scopeVersion: string;
  // Overrides for tests: the upload ceiling, the time budgets and the page size.
  maxPayloadBytes?: number | undefined;
  collectionTimeoutInMs?: number | undefined;
  testTimeoutInMs?: number | undefined;
  requestTimeoutInMs?: number | undefined;
  pageSize?: number | undefined;
}

export async function resolveOpenStackAddress(
  url: string,
): Promise<Array<string>> {
  const target: ValidatedWebhookTarget =
    await SSRFProtection.validateAndResolveWebhookTarget(url, {
      // A probe sits in the network it watches: a cloud's APIs are usually private.
      allowPrivateNetworkTargets: true,
      privateNetworkAccessIsAllowed: true,
      targetLabel: "OpenStack address",
      includeResolutionDetailInError: true,
    });

  return target.addresses.map(
    (address: ValidatedWebhookTargetAddress): string => {
      return address.address;
    },
  );
}

export const OPENSTACK_COLLECTOR_MEMORY: OpenStackCollectorMemory =
  new OpenStackCollectorMemory();

export const DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES: OpenStackCollectorDependencies =
  {
    resolve: resolveOpenStackAddress,
    createTransport: (data: {
      trustedFingerprints: ReadonlyArray<string>;
      resolve: (url: string) => Promise<Array<string>>;
    }): OpenStackTransportHandle => {
      return createOpenStackTransport({
        trustedFingerprints: data.trustedFingerprints,
        resolve: data.resolve,
        connectTimeoutInMs: OPENSTACK_CONNECT_TIMEOUT_IN_MS,
        maxResponseBytes: OPENSTACK_MAX_RESPONSE_BYTES,
      });
    },
    clock: DEFAULT_OPENSTACK_CLOCK,
    memory: OPENSTACK_COLLECTOR_MEMORY,
    scopeVersion: AppVersion,
  };

const USER_AGENT: string = `OneUptime-Probe/${AppVersion} (OpenStack collection)`;

/*
 * How long one collection may take. Nine-tenths of its interval, as the agent's own
 * scrape timeouts sit under their intervals, so a slow one is over and reported before
 * the next is due, and never more than ten minutes.
 */
export function getCollectionBudgetInMs(
  collectionIntervalInMinutes: number,
): number {
  const minutes: number = Number.isFinite(collectionIntervalInMinutes)
    ? Math.max(collectionIntervalInMinutes, 1)
    : 1;

  return Math.min(minutes * 60_000 * 0.9, MAX_COLLECTION_TIME_IN_MS);
}

// "48 MiB", "2.5 MiB", "300 KiB": for the sentences a person reads.
export function formatSize(bytes: number): string {
  const mebibytes: number = bytes / (1024 * 1024);

  if (mebibytes >= 10) {
    return `${Math.round(mebibytes)} MiB`;
  }

  if (mebibytes >= 1) {
    return `${mebibytes.toFixed(1)} MiB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function hostAndPort(address: OpenStackAddress): {
  host: string;
  port: number;
} {
  return { host: address.host, port: address.port };
}

/*
 * Whether a failed login says Keystone is unwell, rather than that it answered and
 * this credential or address is wrong. Only then does its series say so: the agent's
 * series go away either way, and a Keystone that refused a credential is working.
 */
function isKeystoneUnavailable(code: OpenStackCollectionErrorCode): boolean {
  return (
    code === OpenStackCollectionErrorCode.KeystoneFailing ||
    code === OpenStackCollectionErrorCode.ConnectionRefused ||
    code === OpenStackCollectionErrorCode.ConnectionTimedOut ||
    code === OpenStackCollectionErrorCode.ConnectionFailed ||
    code === OpenStackCollectionErrorCode.TimedOut
  );
}

// What a collection found out about a login it could not make.
function loginFailureReadings(data: {
  regions: ReadonlyArray<string>;
  code: OpenStackCollectionErrorCode;
  now: number;
}): Array<OpenStackServiceReading> {
  const readings: Array<OpenStackServiceReading> = [];

  for (const regionName of data.regions) {
    for (const service of SERVICES_IN_ORDER) {
      readings.push({
        service: service,
        regionName: regionName,
        /*
         * Every collection comes back empty, as the agent's do when its exporter cannot
         * log in. What a native collector can add is saying so of Keystone itself when
         * it is Keystone that is down.
         */
        apiUp:
          service === OpenStackServiceType.Identity &&
          isKeystoneUnavailable(data.code)
            ? false
            : null,
        answered: true,
        observedAt: data.now,
        durationInMs: 0,
      });
    }
  }

  return readings;
}

function runWithHardStop(
  work: Promise<void>,
  timeoutInMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop: Promise<void> = new Promise<void>((resolve: () => void) => {
    timer = setTimeout(resolve, timeoutInMs);
  });

  return Promise.race([work, stop]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function summarizeRun(run: OpenStackServiceRun): OpenStackServiceSummary {
  return {
    service: run.service,
    regionName: run.regionName,
    outcome: run.getOutcome(),
    errorCode: run.firstFailure?.code,
    errorMessage: run.firstFailure?.message,
    durationInMs: run.getDurationInMs(),
    requestCount: run.client.requestCount,
  };
}

function hasWorked(outcome: OpenStackServiceOutcome): boolean {
  return (
    outcome === "Succeeded" || outcome === "Partial" || outcome === "Refused"
  );
}

function hasFailed(outcome: OpenStackServiceOutcome): boolean {
  return (
    outcome === "Partial" || outcome === "Failed" || outcome === "BackingOff"
  );
}

interface PlannedRun {
  run: OpenStackServiceRun;
  work: Promise<unknown>;
}

interface CollectionState {
  job: OpenStackCollectionJob;
  options: OpenStackCollectionOptions;
  address: OpenStackAddress;
  transport: OpenStackTransport;
  session: OpenStackKeystoneSession;
  dependencies: OpenStackCollectorDependencies;
  credentialKey: string;
  deadlineAt: number;
  getProjects: () => Promise<Array<OpenStackProjectRef> | null>;
}

export default class OpenStackCollector {
  public static async collect(
    job: OpenStackCollectionJob,
    dependencies: OpenStackCollectorDependencies = DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES,
  ): Promise<OpenStackCollectionReport> {
    const { clock, memory } = dependencies;
    const startedAt: number = clock.now();

    const report: OpenStackCollectionReport = {
      openStackCloudId: job.openStackCloudId,
      settingsVersion: job.settingsVersion,
      collectedAt: new Date(startedAt).toISOString(),
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: OpenStackAddressResult = OpenStackAuthUrl.normalize(
      job.authUrl,
    );

    if (!normalized.address) {
      report.errorCode = OpenStackCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return report;
    }

    const address: OpenStackAddress = normalized.address;

    const credentialKey: string = getOpenStackCredentialKey({
      openStackCloudId: job.openStackCloudId,
      authUrl: address.url,
      credential: job.credential,
      trustedFingerprints: job.trustedCertificateFingerprints,
    });
    const keystoneKey: string = `${credentialKey}/keystone`;
    const regionsKey: string = `${credentialKey}/regions`;

    /*
     * The regions to speak for when nothing could be read. A cloud set to read whatever
     * the catalog names goes by the last catalog it saw.
     */
    const knownRegions: () => Array<string> = (): Array<string> => {
      return job.regions.length > 0
        ? job.regions
        : memory.recall<Array<string>>(
            regionsKey,
            KNOWN_REGIONS_REMEMBERED_FOR_IN_MS,
            clock.now(),
          ) || [];
    };

    const budgetInMs: number =
      dependencies.collectionTimeoutInMs ??
      getCollectionBudgetInMs(job.collectionIntervalInMinutes);
    const deadlineAt: number = startedAt + budgetInMs;

    /*
     * Keystone is being given time to recover. Nothing is asked of it or of anyone
     * else: without a login there is nothing to ask with, and the series say what they
     * said after the last try, so an incident neither closes nor flaps.
     */
    const heldBack: OpenStackBackoffEntry | null = memory.backoff.check(
      keystoneKey,
      startedAt,
    );

    if (heldBack) {
      report.errorCode = heldBack.code;
      report.errorMessage = `${heldBack.message} The probe asks again at ${new Date(
        heldBack.nextTryAt,
      ).toISOString()}.`;
      report.presentedCertificate = heldBack.presentedCertificate;
      report.resourceMetrics = OpenStackOtlpBuilder.build(
        loginFailureReadings({
          regions: knownRegions(),
          code: heldBack.code,
          now: startedAt,
        }),
        dependencies.scopeVersion,
      ).resourceMetrics;
      report.durationInMs = Math.max(0, clock.now() - startedAt);
      return report;
    }

    const handle: OpenStackTransportHandle = dependencies.createTransport({
      trustedFingerprints: job.trustedCertificateFingerprints,
      resolve: dependencies.resolve,
    });

    try {
      const login: () => Promise<OpenStackToken> = () => {
        return keystoneLogin({
          authUrl: address.url,
          credential: job.credential,
          transport: handle.transport,
          userAgent: USER_AGENT,
          timeoutInMs: Math.min(
            KEYSTONE_LOGIN_TIMEOUT_IN_MS,
            Math.max(1, deadlineAt - clock.now()),
          ),
        });
      };

      let session: OpenStackKeystoneSession;

      const cached: OpenStackCachedSession | null = memory.getSession(
        credentialKey,
        startedAt,
      );

      if (cached) {
        session = new OpenStackKeystoneSession({
          token: cached.token,
          isFresh: false,
          login: login,
          refusedReads: cached.refusedReads,
        });
      } else {
        session = new OpenStackKeystoneSession({
          token: await login(),
          isFresh: true,
          login: login,
        });
      }

      memory.backoff.recordSuccess(keystoneKey);

      /*
       * Kept as soon as it is bought: what goes wrong from here is no reason to log in
       * again next time.
       */
      memory.setSession({
        key: credentialKey,
        token: session.getToken(),
        refusedReads: session.getRefusedReads(),
        now: clock.now(),
      });

      const token: OpenStackToken = session.getToken();
      const regionsInCatalog: Array<string> = getOpenStackCatalogRegions(
        token.catalog,
      );

      if (regionsInCatalog.length === 0) {
        throw new OpenStackCollectionError(
          OpenStackCollectionErrorCode.NoCatalog,
          `Keystone gave this credential a token with no endpoints in it, so the probe cannot tell where any service answers. Scope the credential to a project.`,
        );
      }

      const wanted: Array<string> =
        job.regions.length > 0 ? job.regions : regionsInCatalog;
      const regions: Array<string> = wanted.filter(
        (region: string): boolean => {
          return regionsInCatalog.includes(region);
        },
      );
      const missing: Array<string> = wanted.filter(
        (region: string): boolean => {
          return !regionsInCatalog.includes(region);
        },
      );

      if (regions.length === 0) {
        throw new OpenStackCollectionError(
          OpenStackCollectionErrorCode.RegionNotFound,
          `The catalog has no region named ${missing.join(", ")}. It names ${regionsInCatalog.join(", ")}.`,
        );
      }

      memory.remember(regionsKey, regions, startedAt);

      const options: OpenStackCollectionOptions = job.options || {};

      const state: CollectionState = {
        job: job,
        options: options,
        address: address,
        transport: handle.transport,
        session: session,
        dependencies: dependencies,
        credentialKey: credentialKey,
        deadlineAt: deadlineAt,
        getProjects: OpenStackCollector.createProjectReader({
          address: address,
          transport: handle.transport,
          session: session,
          dependencies: dependencies,
          deadlineAt: deadlineAt,
          regionName: regions[0] as string,
        }),
      };

      const result: {
        readings: Array<OpenStackServiceReading>;
        summaries: Array<OpenStackServiceSummary>;
        inventories: Array<OpenStackInventoryByService>;
        warnings: Array<string>;
        requestCount: number;
        firstFailure: ClassifiedOpenStackError | null;
        computeMicroversions: Record<string, string>;
        instanceReadModes: Record<string, OpenStackInstanceReadMode>;
      } = await OpenStackCollector.collectRegions(state, regions, budgetInMs);

      /*
       * Every service met a 401, and logging in again failed too. That is a Keystone or
       * credential problem wearing each service's name, so it is answered as one.
       */
      if (session.getRenewalFailure()) {
        throw session.getRenewalFailure();
      }

      const warnings: Array<string> = [...result.warnings];

      if (missing.length > 0) {
        warnings.unshift(
          `The catalog has no region named ${missing.join(", ")}, so it was left out.`,
        );
      }

      const built: OpenStackOtlpBuildResult = OpenStackOtlpBuilder.build(
        result.readings,
        dependencies.scopeVersion,
      );

      report.resourceMetrics = built.resourceMetrics;

      const payloadBytes: number = Buffer.byteLength(
        JSON.stringify(built.resourceMetrics),
      );
      const maxPayloadBytes: number =
        dependencies.maxPayloadBytes ?? OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES;

      report.summary = OpenStackCollector.summarize({
        job: job,
        token: token,
        regions: regions,
        services: result.summaries,
        inventories: result.inventories,
        built: built,
        requestCount: result.requestCount,
        warnings: warnings,
        computeMicroversions: result.computeMicroversions,
        instanceReadModes: result.instanceReadModes,
      });

      // A token renewed along the way is the one to keep.
      memory.setSession({
        key: credentialKey,
        token: session.getToken(),
        refusedReads: session.getRefusedReads(),
        now: clock.now(),
      });

      if (payloadBytes > maxPayloadBytes) {
        report.resourceMetrics = OpenStackOtlpBuilder.toAvailabilityOnly(
          built.resourceMetrics,
        );
        report.status = "Failed";
        report.errorCode = OpenStackCollectionErrorCode.PayloadTooLarge;
        report.errorMessage = `This cloud's collection is ${formatSize(
          payloadBytes,
        )} of metrics, more than the ${formatSize(
          maxPayloadBytes,
        )} one probe upload takes. Use the OpenStack agent for this cloud.`;
      } else {
        OpenStackCollector.applyOutcome(report, result);
      }
    } catch (error) {
      const classified: ClassifiedOpenStackError = classifyOpenStackError(
        error,
        hostAndPort(address),
      );

      report.status = "Failed";
      report.errorCode = classified.code;
      report.errorMessage = classified.message;

      if (classified.presentedCertificate) {
        report.presentedCertificate = classified.presentedCertificate;
      }

      const isRefused: boolean =
        classified.code === OpenStackCollectionErrorCode.InvalidCredential ||
        classified.code === OpenStackCollectionErrorCode.WrongProjectScope;

      if (
        isRefused ||
        classified.code === OpenStackCollectionErrorCode.CertificateChanged ||
        classified.code === OpenStackCollectionErrorCode.UntrustedCertificate
      ) {
        memory.forgetSession(credentialKey);
      }

      /*
       * A failed login is left alone for a while, a refused credential longest, because
       * repeating one is what locks an account. A catalog that lacks a region is not a
       * failed login: the token is kept, so it costs Keystone nothing to find out again.
       */
      if (
        classified.code !== OpenStackCollectionErrorCode.RegionNotFound &&
        classified.code !== OpenStackCollectionErrorCode.NoCatalog
      ) {
        memory.backoff.recordFailure(keystoneKey, {
          now: clock.now(),
          random: clock.random(),
          baseInMs: isRefused
            ? REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS
            : BACKOFF_BASE_IN_MS,
          maxInMs: isRefused
            ? MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS
            : MAX_BACKOFF_IN_MS,
          code: classified.code,
          message: classified.message,
          presentedCertificate: classified.presentedCertificate,
        });
      }

      report.resourceMetrics = OpenStackOtlpBuilder.build(
        loginFailureReadings({
          regions: knownRegions(),
          code: classified.code,
          now: clock.now(),
        }),
        dependencies.scopeVersion,
      ).resourceMetrics;
    } finally {
      handle.close();
    }

    report.durationInMs = Math.max(0, clock.now() - startedAt);

    return report;
  }

  /*
   * The projects read once per collection, whichever service asks first, for what is
   * read per project. A credential that may not list them has its own one to go by.
   */
  private static createProjectReader(data: {
    address: OpenStackAddress;
    transport: OpenStackTransport;
    session: OpenStackKeystoneSession;
    dependencies: OpenStackCollectorDependencies;
    deadlineAt: number;
    regionName: string;
  }): () => Promise<Array<OpenStackProjectRef> | null> {
    let projects: Promise<Array<OpenStackProjectRef> | null> | null = null;

    return (): Promise<Array<OpenStackProjectRef> | null> => {
      if (projects) {
        return projects;
      }

      const client: OpenStackServiceClient = new OpenStackServiceClient({
        service: OpenStackServiceType.Identity,
        regionName: data.regionName,
        baseUrl: `${data.address.url}/v3`,
        transport: data.transport,
        clock: data.dependencies.clock,
        deadlineAt: data.deadlineAt,
        session: data.session,
        userAgent: USER_AGENT,
        requestTimeoutInMs: data.dependencies.requestTimeoutInMs,
      });

      const own: () => Array<OpenStackProjectRef> | null = () => {
        const token: OpenStackToken = data.session.getToken();

        return token.projectId
          ? [{ id: token.projectId, name: token.projectName }]
          : null;
      };

      projects = client
        .list({
          read: "projects",
          path: "/projects",
          key: "projects",
          paging: "none",
        })
        .then((answer: OpenStackListAnswer): Array<OpenStackProjectRef> => {
          const refs: Array<OpenStackProjectRef> = [];

          for (const item of answer.items) {
            // A domain is also a project to Keystone, and has no quotas as one.
            if (typeof item["id"] === "string" && item["is_domain"] !== true) {
              refs.push({
                id: item["id"] as string,
                name:
                  typeof item["name"] === "string"
                    ? (item["name"] as string)
                    : null,
              });
            }
          }

          return refs;
        })
        .catch(own);

      return projects;
    };
  }

  private static async collectRegions(
    state: CollectionState,
    regions: ReadonlyArray<string>,
    budgetInMs: number,
  ): Promise<{
    readings: Array<OpenStackServiceReading>;
    summaries: Array<OpenStackServiceSummary>;
    inventories: Array<OpenStackInventoryByService>;
    warnings: Array<string>;
    requestCount: number;
    firstFailure: ClassifiedOpenStackError | null;
    computeMicroversions: Record<string, string>;
    instanceReadModes: Record<string, OpenStackInstanceReadMode>;
  }> {
    const { dependencies, credentialKey } = state;
    const { clock, memory } = dependencies;
    const now: number = clock.now();

    const readings: Array<OpenStackServiceReading> = [];
    const summaries: Array<OpenStackServiceSummary> = [];
    const inventories: Array<OpenStackInventoryByService> = [];
    const planned: Array<PlannedRun> = [];
    const computeMicroversions: Record<string, string> = {};
    const instanceReadModes: Record<string, OpenStackInstanceReadMode> = {};

    /*
     * Keystone is one for the whole cloud, so it is read once and every region says the
     * same of it, as every clouds.yaml entry of the agent's does.
     */
    let identity: {
      run: OpenStackServiceRun;
      inventory: OpenStackIdentityInventory;
    } | null = null;
    let identityWasPlanned: boolean = false;

    for (const regionName of regions) {
      const byService: OpenStackInventoryByService = {};
      inventories.push(byService);

      for (const service of SERVICES_IN_ORDER) {
        if (service === OpenStackServiceType.Identity && identityWasPlanned) {
          continue;
        }

        const cadenceKey: string =
          service === OpenStackServiceType.Identity
            ? `${credentialKey}/identity/cadence`
            : `${credentialKey}/${regionName}/${service}/cadence`;

        // Read less often than the collection runs, and not due this time.
        if (
          SLOW_SERVICES.has(service) &&
          memory.recall<boolean>(
            cadenceKey,
            getSlowServiceIntervalInMs(state.job.collectionIntervalInMinutes),
            now,
          )
        ) {
          summaries.push({
            service: service,
            regionName: regionName,
            outcome: "NotDue",
            durationInMs: 0,
            requestCount: 0,
          });

          if (service === OpenStackServiceType.Identity) {
            identityWasPlanned = true;
          }

          continue;
        }

        const catalogUrl: string | null =
          service === OpenStackServiceType.Identity
            ? `${state.address.url}/v3`
            : findOpenStackEndpoint({
                catalog: state.session.getToken().catalog,
                service: service,
                regionName: regionName,
                endpointInterface: state.job.endpointInterface,
              });

        /*
         * Not in this region's catalog, which is what a cloud without Cinder is. Its
         * collection answers with nothing, as the agent's job for it does for ever.
         */
        if (!catalogUrl) {
          summaries.push({
            service: service,
            regionName: regionName,
            outcome: "NotDeployed",
            durationInMs: 0,
            requestCount: 0,
          });
          readings.push({
            service: service,
            regionName: regionName,
            apiUp: null,
            answered: true,
            observedAt: now,
            durationInMs: 0,
          });
          continue;
        }

        const refusal: ReturnType<
          typeof OpenStackAuthUrl.getCatalogUrlRefusal
        > = OpenStackAuthUrl.getCatalogUrlRefusal(catalogUrl);

        // A URL the catalog names and the probe will not speak to. Nothing is sent.
        if (refusal) {
          summaries.push({
            service: service,
            regionName: regionName,
            outcome: "Failed",
            errorCode:
              refusal.code === "insecure"
                ? OpenStackCollectionErrorCode.InsecureEndpoint
                : refusal.code === "forbidden"
                  ? OpenStackCollectionErrorCode.AddressNotAllowed
                  : OpenStackCollectionErrorCode.InvalidAddress,
            errorMessage: `${OPENSTACK_SERVICE_TITLES[service]} in ${regionName}: ${refusal.message}`,
            durationInMs: 0,
            requestCount: 0,
          });
          readings.push({
            service: service,
            regionName: regionName,
            apiUp: null,
            answered: false,
            observedAt: now,
            durationInMs: 0,
          });
          continue;
        }

        const backoffKey: string =
          service === OpenStackServiceType.Identity
            ? `${credentialKey}/identity`
            : `${credentialKey}/${regionName}/${service}`;

        const heldBack: OpenStackBackoffEntry | null = memory.backoff.check(
          backoffKey,
          now,
        );

        /*
         * It failed lately, so it is left alone. Its series keep saying so: a series
         * that goes away reads as recovered, and it has not.
         */
        if (heldBack) {
          summaries.push({
            service: service,
            regionName: regionName,
            outcome: "BackingOff",
            errorCode: heldBack.code,
            errorMessage: heldBack.message,
            backingOffUntil: new Date(heldBack.nextTryAt).toISOString(),
            durationInMs: 0,
            requestCount: 0,
          });
          readings.push({
            service: service,
            regionName: regionName,
            apiUp: false,
            answered: false,
            observedAt: now,
            durationInMs: 0,
          });
          continue;
        }

        const client: OpenStackServiceClient = new OpenStackServiceClient({
          service: service,
          regionName: regionName,
          baseUrl:
            service === OpenStackServiceType.Identity
              ? catalogUrl
              : toOpenStackServiceBaseUrl(service, catalogUrl),
          transport: state.transport,
          clock: clock,
          deadlineAt: state.deadlineAt,
          session: state.session,
          userAgent: USER_AGENT,
          requestTimeoutInMs:
            dependencies.requestTimeoutInMs ?? OPENSTACK_REQUEST_TIMEOUT_IN_MS,
          pageSize: dependencies.pageSize,
        });

        const run: OpenStackServiceRun = new OpenStackServiceRun({
          service: service,
          regionName: regionName,
          client: client,
        });

        const context: <T>(inventory: T) => OpenStackCollectorContext<T> = <T>(
          inventory: T,
        ): OpenStackCollectorContext<T> => {
          return {
            run: run,
            inventory: inventory,
            options: state.options,
            memory: memory,
            memoryKey: credentialKey,
            session: state.session,
            getProjects: state.getProjects,
          };
        };

        let work: Promise<unknown>;

        switch (service) {
          case OpenStackServiceType.Identity: {
            const inventory: OpenStackIdentityInventory = {};
            byService.identity = inventory;
            identity = { run: run, inventory: inventory };
            identityWasPlanned = true;
            work = collectIdentity(context(inventory));
            break;
          }
          case OpenStackServiceType.Compute: {
            const inventory: OpenStackComputeInventory = {};
            byService.compute = inventory;
            work = collectCompute(context(inventory)).then(
              (result: {
                instanceReadMode: OpenStackInstanceReadMode | null;
              }): void => {
                if (inventory.microversion) {
                  computeMicroversions[regionName] = inventory.microversion;
                }

                if (result.instanceReadMode) {
                  instanceReadModes[regionName] = result.instanceReadMode;
                }
              },
            );
            break;
          }
          case OpenStackServiceType.Placement: {
            const inventory: OpenStackPlacementInventory = {};
            byService.placement = inventory;
            work = collectPlacement(context(inventory));
            break;
          }
          case OpenStackServiceType.Network: {
            const inventory: OpenStackNetworkInventory = {};
            byService.network = inventory;
            work = collectNetwork(context(inventory));
            break;
          }
          case OpenStackServiceType.Volume: {
            const inventory: OpenStackVolumeInventory = {};
            byService.volume = inventory;
            work = collectVolume(context(inventory));
            break;
          }
          default: {
            const inventory: OpenStackImageInventory = {};
            byService.image = inventory;
            work = collectImage(context(inventory));
            break;
          }
        }

        planned.push({ run: run, work: work });
      }
    }

    /*
     * All at the same time, one request at a time within each. So a Neutron that hangs
     * costs the time of Neutron's own reads and nothing of Nova's.
     */
    await Promise.all(
      planned.map(async (entry: PlannedRun): Promise<void> => {
        let isOver: boolean = false;

        await runWithHardStop(
          entry.work.then(
            () => {
              isOver = true;
            },
            (error: unknown) => {
              isOver = true;

              // A collector's own bug is that service's alone.
              entry.run.firstFailure =
                entry.run.firstFailure ||
                classifyOpenStackError(error, hostAndPort(state.address));
              entry.run.gotAnAnswer =
                entry.run.gotAnAnswer || !isNoAnswer(error);
            },
          ),
          budgetInMs + HARD_STOP_GRACE_IN_MS,
        );

        if (!isOver) {
          entry.run.markOutOfTime(
            `The collection ran out of time before ${entry.run.client.describe()} answered.`,
          );
        }

        entry.run.finish();
      }),
    );

    const warnings: Array<string> = [];
    let requestCount: number = 0;
    let firstFailure: ClassifiedOpenStackError | null = null;

    for (const entry of planned) {
      const { run } = entry;
      const summary: OpenStackServiceSummary = summarizeRun(run);
      requestCount += run.client.requestCount;

      for (const warning of run.warnings) {
        warnings.push(warning);
      }

      if (run.firstFailure && !firstFailure) {
        firstFailure = run.firstFailure;
      }

      const backoffKey: string =
        run.service === OpenStackServiceType.Identity
          ? `${credentialKey}/identity`
          : `${credentialKey}/${run.regionName}/${run.service}`;

      if (state.session.getRenewalFailure()) {
        // Not this service's doing: see collect.
      } else if (run.mustBackOff()) {
        const entryNow: number = clock.now();
        const held: OpenStackBackoffEntry = memory.backoff.recordFailure(
          backoffKey,
          {
            now: entryNow,
            random: clock.random(),
            baseInMs: BACKOFF_BASE_IN_MS,
            maxInMs: MAX_BACKOFF_IN_MS,
            code:
              run.firstFailure?.code || OpenStackCollectionErrorCode.ApiError,
            message:
              run.firstFailure?.message ||
              `${run.client.describe()} answered nothing the probe could use.`,
            presentedCertificate: run.firstFailure?.presentedCertificate,
          },
        );

        summary.backingOffUntil = new Date(held.nextTryAt).toISOString();
      } else {
        memory.backoff.recordSuccess(backoffKey);
      }

      if (
        SLOW_SERVICES.has(run.service) &&
        !run.mustBackOff() &&
        run.isApiUp()
      ) {
        memory.remember(
          run.service === OpenStackServiceType.Identity
            ? `${credentialKey}/identity/cadence`
            : `${credentialKey}/${run.regionName}/${run.service}/cadence`,
          true,
          clock.now(),
        );
      }

      summaries.push(summary);

      if (run.service === OpenStackServiceType.Identity) {
        continue;
      }

      const byService: OpenStackInventoryByService | undefined =
        inventories[regions.indexOf(run.regionName)];

      readings.push({
        service: run.service,
        regionName: run.regionName,
        inventory:
          byService?.[run.service as keyof OpenStackInventoryByService],
        apiUp: run.isApiUp(),
        answered: run.isAnswered(),
        observedAt: run.finishedAt ?? clock.now(),
        durationInMs: run.getDurationInMs(),
      });
    }

    /*
     * Each region says the same of Keystone, from the one read of it, so a monitor
     * filtered to a region finds it. An identity collection not due sends nothing here,
     * as a scrape that has not come round yet sends nothing.
     */
    if (identity) {
      for (const regionName of regions) {
        readings.push({
          service: OpenStackServiceType.Identity,
          regionName: regionName,
          inventory: identity.inventory,
          apiUp: identity.run.isApiUp(),
          answered: identity.run.isAnswered(),
          observedAt: identity.run.finishedAt ?? clock.now(),
          durationInMs: identity.run.getDurationInMs(),
        });
      }
    }

    return {
      readings: readings,
      summaries: summaries,
      inventories: inventories,
      warnings: warnings,
      requestCount: requestCount,
      firstFailure: firstFailure,
      computeMicroversions: computeMicroversions,
      instanceReadModes: instanceReadModes,
    };
  }

  // The report's status and sentence, from what became of each service.
  private static applyOutcome(
    report: OpenStackCollectionReport,
    result: {
      summaries: Array<OpenStackServiceSummary>;
      firstFailure: ClassifiedOpenStackError | null;
    },
  ): void {
    const asked: Array<OpenStackServiceSummary> = result.summaries.filter(
      (summary: OpenStackServiceSummary): boolean => {
        return (
          summary.outcome !== "NotDeployed" && summary.outcome !== "NotDue"
        );
      },
    );

    // Nothing was due: nothing failed, and the last collection's word stands.
    if (asked.length === 0) {
      report.status = "Succeeded";
      return;
    }

    const anyWorked: boolean = asked.some(
      (summary: OpenStackServiceSummary): boolean => {
        return hasWorked(summary.outcome);
      },
    );
    const anyFailed: boolean = asked.some(
      (summary: OpenStackServiceSummary): boolean => {
        return hasFailed(summary.outcome);
      },
    );
    const anyAnswered: boolean = asked.some(
      (summary: OpenStackServiceSummary): boolean => {
        return summary.outcome === "Succeeded" || summary.outcome === "Partial";
      },
    );

    const failure: OpenStackServiceSummary | undefined = asked.find(
      (summary: OpenStackServiceSummary): boolean => {
        return hasFailed(summary.outcome) && Boolean(summary.errorCode);
      },
    );

    if (!anyWorked) {
      report.status = "Failed";
      report.errorCode =
        failure?.errorCode ||
        result.firstFailure?.code ||
        OpenStackCollectionErrorCode.ApiError;
      report.errorMessage =
        failure?.errorMessage ||
        result.firstFailure?.message ||
        "No service in the catalog could be read.";
    } else if (!anyAnswered) {
      // It answered, and refused every read there was.
      report.status = "Failed";
      report.errorCode = OpenStackCollectionErrorCode.NoPermission;
      report.errorMessage =
        "The credential logged in, and every service refused every read. The connection test lists what each one would need.";
    } else if (anyFailed) {
      report.status = "PartiallySucceeded";
      report.errorCode =
        failure?.errorCode || result.firstFailure?.code || undefined;
      report.errorMessage =
        failure?.errorMessage || result.firstFailure?.message || undefined;
    } else {
      report.status = "Succeeded";
    }

    if (
      report.status !== "Succeeded" &&
      result.firstFailure?.presentedCertificate
    ) {
      report.presentedCertificate = result.firstFailure.presentedCertificate;
    }
  }

  private static summarize(data: {
    job: OpenStackCollectionJob;
    token: OpenStackToken;
    regions: Array<string>;
    services: Array<OpenStackServiceSummary>;
    inventories: Array<OpenStackInventoryByService>;
    built: OpenStackOtlpBuildResult;
    requestCount: number;
    warnings: Array<string>;
    computeMicroversions: Record<string, string>;
    instanceReadModes: Record<string, OpenStackInstanceReadMode>;
  }): OpenStackCollectionSummary {
    let hypervisorCount: number = 0;
    let instanceCount: number = 0;
    let networkCount: number = 0;
    let volumeCount: number = 0;
    let projectCount: number = 0;

    for (const inventory of data.inventories) {
      hypervisorCount += inventory.compute?.hypervisors?.length || 0;
      instanceCount += inventory.compute?.servers?.length || 0;
      networkCount += inventory.network?.networks?.length || 0;
      volumeCount += inventory.volume?.volumes?.length || 0;
      projectCount = Math.max(
        projectCount,
        inventory.identity?.projects?.length || 0,
      );
    }

    return {
      credentialKind: data.job.credential.kind,
      projectName: data.token.projectName || undefined,
      roleNames: data.token.roleNames,
      computeMicroversions: data.computeMicroversions,
      instanceReadModes: data.instanceReadModes,
      regionNames: data.regions,
      services: data.services,
      hypervisorCount: hypervisorCount,
      instanceCount: instanceCount,
      networkCount: networkCount,
      volumeCount: volumeCount,
      projectCount: projectCount,
      resourceCount: data.built.resourceCount,
      datapointCount: data.built.datapointCount,
      requestCount: data.requestCount,
      warnings: data.warnings.slice(0, MAX_SUMMARY_WARNINGS),
    };
  }

  /*
   * A connection test: log in, see what this credential can read in each region, log
   * out. Nothing is collected and nothing is kept, and a person is waiting, so nothing
   * here waits on any back-off.
   */
  public static async test(
    job: OpenStackConnectionTestJob,
    dependencies: OpenStackCollectorDependencies = DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES,
  ): Promise<OpenStackConnectionTestReport> {
    const { clock } = dependencies;
    const startedAt: number = clock.now();

    const report: OpenStackConnectionTestReport = {
      openStackCloudConnectionTestId: job.openStackCloudConnectionTestId,
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: OpenStackAddressResult = OpenStackAuthUrl.normalize(
      job.authUrl,
    );

    if (!normalized.address) {
      report.errorCode = OpenStackCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return report;
    }

    const address: OpenStackAddress = normalized.address;
    const handle: OpenStackTransportHandle = dependencies.createTransport({
      trustedFingerprints: job.trustedCertificateFingerprints,
      resolve: dependencies.resolve,
    });

    try {
      await OpenStackCollector.testWithTransport({
        job: job,
        address: address,
        transport: handle.transport,
        dependencies: dependencies,
        report: report,
        deadlineAt:
          startedAt + (dependencies.testTimeoutInMs ?? TEST_TIME_IN_MS),
      });
    } catch (error) {
      const classified: ClassifiedOpenStackError = classifyOpenStackError(
        error,
        hostAndPort(address),
      );

      report.status = "Failed";
      report.errorCode = classified.code;
      report.errorMessage = classified.message;

      if (classified.presentedCertificate) {
        report.presentedCertificate = classified.presentedCertificate;
      }
    } finally {
      handle.close();
    }

    report.durationInMs = Math.max(0, clock.now() - startedAt);

    return report;
  }

  private static async testWithTransport(data: {
    job: OpenStackConnectionTestJob;
    address: OpenStackAddress;
    transport: OpenStackTransport;
    dependencies: OpenStackCollectorDependencies;
    report: OpenStackConnectionTestReport;
    deadlineAt: number;
  }): Promise<void> {
    const { job, address, transport, dependencies, report } = data;
    const credential: OpenStackCredential = job.credential;

    let token: OpenStackToken;

    try {
      token = await keystoneLogin({
        authUrl: address.url,
        credential: credential,
        transport: transport,
        userAgent: USER_AGENT,
      });
    } catch (error) {
      if (
        error instanceof OpenStackCollectionError &&
        error.code === OpenStackCollectionErrorCode.InvalidCredential
      ) {
        const scopeError: OpenStackCollectionError | null =
          await diagnosePasswordScope({
            authUrl: address.url,
            credential: credential,
            transport: transport,
            userAgent: USER_AGENT,
          });

        if (scopeError) {
          throw scopeError;
        }
      }

      throw error;
    }

    try {
      const catalog: Array<OpenStackCatalogService> = token.catalog;
      const regionsInCatalog: Array<string> =
        getOpenStackCatalogRegions(catalog);

      if (regionsInCatalog.length === 0) {
        throw new OpenStackCollectionError(
          OpenStackCollectionErrorCode.NoCatalog,
          "Keystone gave this credential a token with no endpoints in it, so the probe cannot tell where any service answers. Scope the credential to a project.",
        );
      }

      const missing: Array<string> = job.regions.filter(
        (region: string): boolean => {
          return !regionsInCatalog.includes(region);
        },
      );

      if (missing.length > 0) {
        throw new OpenStackCollectionError(
          OpenStackCollectionErrorCode.RegionNotFound,
          `The catalog has no region named ${missing.join(", ")}. It names ${regionsInCatalog.join(", ")}.`,
        );
      }

      const regions: Array<string> =
        job.regions.length > 0 ? job.regions : regionsInCatalog;

      const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
        token: token,
        isFresh: true,
        login: () => {
          return Promise.resolve(token);
        },
      });

      const hasAdminRole: boolean = token.roleNames.includes("admin");

      const check: OpenStackAccessCheckResult = await runOpenStackAccessCheck({
        authUrl: address.url,
        catalog: catalog,
        regions: regions,
        endpointInterface: job.endpointInterface,
        ownProjectId: token.projectId,
        hasAdminRole: hasAdminRole,
        hasAccessRules: token.hasAccessRules,
        createClient: (clientData: {
          service: OpenStackServiceType;
          regionName: string;
          baseUrl: string;
        }): OpenStackServiceClient => {
          return new OpenStackServiceClient({
            service: clientData.service,
            regionName: clientData.regionName,
            baseUrl: clientData.baseUrl,
            transport: transport,
            clock: dependencies.clock,
            deadlineAt: data.deadlineAt,
            session: session,
            userAgent: USER_AGENT,
            requestTimeoutInMs: dependencies.requestTimeoutInMs,
          });
        },
        headersFor: async (
          client: OpenStackServiceClient,
        ): Promise<Record<string, string>> => {
          if (client.service === OpenStackServiceType.Volume) {
            return { "OpenStack-API-Version": `volume ${CINDER_MICROVERSION}` };
          }

          if (client.service !== OpenStackServiceType.Compute) {
            return {};
          }

          const answer: OpenStackJsonAnswer = await client.get({
            read: "its versions",
            url: getOpenStackComputeRootUrl(client.baseUrl),
            withoutToken: true,
            acceptsMultipleChoices: true,
          });

          return computeMicroversionHeaders(
            chooseComputeMicroversion(answer.body),
          );
        },
      });

      const warnings: Array<string> = OpenStackCollector.getTestWarnings({
        job: job,
        token: token,
        reads: check.reads,
        hasAdminRole: hasAdminRole,
        projectHoldings: check.projectHoldings,
      });

      const holdsAnything: boolean =
        Object.keys(check.projectHoldings).length > 0;

      const summary: OpenStackConnectionTestSummary = {
        credentialKind: credential.kind,
        projectName: token.projectName || undefined,
        roleNames: token.roleNames,
        hasAccessRules: token.hasAccessRules,
        isUnrestricted: token.isUnrestricted,
        /*
         * Access rules are what stop an admin. Short of those, an admin can, and on many
         * clouds any role can write to a project that holds things.
         */
        canProbablyWrite:
          !token.hasAccessRules && (hasAdminRole || holdsAnything),
        regionsInCatalog: regionsInCatalog,
        servicesByRegion: check.servicesByRegion,
        accessLevel: getOpenStackAccessLevel(check.reads),
        reads: check.reads,
        warnings: warnings,
      };

      report.summary = summary;

      if (check.certificateError) {
        const classified: ClassifiedOpenStackError = classifyOpenStackError(
          check.certificateError,
          hostAndPort(address),
        );

        report.status = "Failed";
        report.errorCode = classified.code;
        report.errorMessage = classified.message;
        report.presentedCertificate = classified.presentedCertificate;
        return;
      }

      const isRead: (read: OpenStackAccessRead) => boolean = (
        read: OpenStackAccessRead,
      ): boolean => {
        return (
          read.access === "ReadsEverything" || read.access === "OwnProjectOnly"
        );
      };

      if (!check.reads.some(isRead)) {
        report.status = "Failed";
        report.errorCode = OpenStackCollectionErrorCode.NoPermission;
        report.errorMessage =
          "The credential logged in, and every read was refused or failed. The list below says what each one would need.";
        return;
      }

      report.status = "Succeeded";
    } finally {
      await revokeKeystoneToken({
        authUrl: address.url,
        tokenId: token.id,
        transport: transport,
        userAgent: USER_AGENT,
      });
    }
  }

  private static getTestWarnings(data: {
    job: OpenStackConnectionTestJob;
    token: OpenStackToken;
    reads: Array<OpenStackAccessRead>;
    hasAdminRole: boolean;
    projectHoldings: Record<string, Array<string>>;
  }): Array<string> {
    const warnings: Array<string> = [];

    if (data.job.credential.kind === "password") {
      warnings.push(
        "This is a username and password. It can do whatever its account can, and an application credential is better: it can be limited to reading, and can expire.",
      );
    } else if (data.token.isUnrestricted) {
      warnings.push(
        "This application credential was created --unrestricted: it can make more credentials. Replace it with one that is not.",
      );
    } else if (data.hasAdminRole && !data.token.hasAccessRules) {
      warnings.push(
        "A plain admin application credential: it has no access rules, so it can write. Add them where you can.",
      );
    }

    for (const regionName of Object.keys(data.projectHoldings)) {
      warnings.push(
        `This credential's project holds things in region ${regionName}: ${(
          data.projectHoldings[regionName] as Array<string>
        ).join(
          ", ",
        )}. Where Cinder has enforce_new_defaults off, which is Cinder's own default, any role on a project can create that project's volumes. Unless this is the project you mean to watch, give this credential a project of its own that holds nothing and has zero quota.`,
      );
    }

    const gaps: number = data.reads.filter(
      (read: OpenStackAccessRead): boolean => {
        return read.access === "OwnProjectOnly" || read.access === "Refused";
      },
    ).length;

    if (gaps > 0) {
      warnings.push(
        `This credential cannot read everything: ${gaps} of its reads are refused or may be its own project only. The list says what goes without each. That is fine if it is the level of access you chose.`,
      );
    }

    return warnings.slice(0, MAX_SUMMARY_WARNINGS);
  }
}
