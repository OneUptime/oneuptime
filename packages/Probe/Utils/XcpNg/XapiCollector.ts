import { OpenMetricsSample } from "./OpenMetricsText";
import XapiClient, {
  XAPI_NULL_REF,
  XapiError,
  XapiNotXapiError,
  XapiRecords,
  formatXapiDateTime,
  parseXapiDateTime,
} from "./XapiClient";
import {
  XapiHostRecord,
  XapiPoolRecord,
  XapiPoolSnapshot,
  buildXapiFormattedMetrics,
  toOpenMetricsSamples,
} from "./XapiOpenMetrics";
import {
  ClassifiedXcpNgError,
  XcpNgCollectionError,
  XcpNgErrorContext,
  classifyXcpNgError,
} from "./XcpNgCollectionErrors";
import {
  XCP_NG_RRD_TIMEOUT_IN_MS,
  XcpNgEndpoint,
  XcpNgTransportHandle,
  createXcpNgTransport,
  resolveXcpNgAddress,
} from "./XcpNgHttp";
import XcpNgOtlpBuilder, { XcpNgOtlpBuildResult } from "./XcpNgOtlpBuilder";
import {
  formatSize,
  getCollectionBudgetInMs,
  withDeadline,
} from "./XenOrchestraCollector";
import { VSphereCertificateError } from "../VMware/VSphereTls";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES,
  XCP_NG_MAX_MESSAGES_PER_COLLECTION,
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgCollectionSummary,
  XcpNgConnectionTestJob,
  XcpNgConnectionTestReport,
  XcpNgMessageWatermark,
  XcpNgPoolMessage,
  XcpNgPoolState,
  XcpNgXapiAccountSummary,
  XcpNgXapiPoolHost,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind, {
  XcpNgXapiAccountKindUtil,
} from "Common/Types/XcpNg/XcpNgXapiAccount";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";
import XcpNgConnectionAddress, {
  XcpNgAddress,
  XcpNgAddressResult,
} from "Common/Utils/XcpNg/XcpNgConnectionAddress";

/*
 * One read, or one connection test, of a pool through XAPI on its master
 * (#10999) - no Xen Orchestra in front of it:
 *
 *   1. LOG IN TO THE MASTER. The address a person entered is pinned to the
 *      certificate they trusted (or must chain to an authority this machine
 *      trusts). A pool member answers the login with HOST_IS_SLAVE and its
 *      master's address: the probe follows it only to a host the pool
 *      itself vouched for at the last read - its address and its
 *      certificate's fingerprint, from XAPI's own Certificate records - so a
 *      failover is followed and the password still goes nowhere unverified.
 *      When the master stops answering, the pool's other known hosts are
 *      tried, as Xen Orchestra does. A host that answers for another pool
 *      (one ejected from it is its own pool's master, and takes the same
 *      password) is never read in its place.
 *   2. SAY WHICH ACCOUNT IT IS. root, a read-only Active Directory user, or
 *      one with more - read from XAPI's own session and roles.
 *   3. READ WHAT XEN ORCHESTRA'S PLUGIN READS: the pool's records, and
 *      every running host's rrd_updates - the master over the connection
 *      just made, every other host pinned to the certificate the pool lists
 *      for it - and turn them into the same series (XapiOpenMetrics), sent
 *      as the XCP-ng Agent would send them (XcpNgOtlpBuilder).
 *   4. READ THE POOL'S MESSAGES since the watermark the server keeps
 *      (message.get_since), so a probe restart neither loses nor repeats
 *      one.
 *
 * Only reads are ever made: every call below is a get. The password never
 * leaves this module except to a pool master, and never appears in a
 * report or a log line.
 */

export const XAPI_ADDRESS_LABEL: string = "XAPI address";
export const XAPI_TEST_TIME_IN_MS: number = 120_000;
export const XAPI_RRD_CONCURRENCY: number = 5;
// How far back rrd_updates is read: two of its minutes, as the plugin reads.
export const XAPI_RRD_WINDOW_IN_SECONDS: number = 120;
const MAX_MESSAGE_BODY_LENGTH: number = 2000;

export interface XapiCollectorDependencies {
  // The addresses an address may be connected to (validated).
  resolve: (url: string) => Promise<Array<string>>;
  createTransport: (data: {
    endpoint: XcpNgEndpoint;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
    requestTimeoutInMs?: number | undefined;
  }) => XcpNgTransportHandle;
  now: () => Date;
  scopeVersion: string;
  // Overrides for tests.
  maxPayloadBytes?: number | undefined;
  collectionTimeoutInMs?: number | undefined;
  testTimeoutInMs?: number | undefined;
}

export const DEFAULT_XAPI_DEPENDENCIES: XapiCollectorDependencies = {
  resolve: (url: string): Promise<Array<string>> => {
    return resolveXcpNgAddress(url, XAPI_ADDRESS_LABEL);
  },
  createTransport: (data: {
    endpoint: XcpNgEndpoint;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
    requestTimeoutInMs?: number | undefined;
  }): XcpNgTransportHandle => {
    return createXcpNgTransport(data);
  },
  now: (): Date => {
    return new Date();
  },
  scopeVersion: AppVersion,
};

// Where the probe may try to log in, and what it must present there.
interface XapiCandidate {
  address: XcpNgAddress;
  trustedFingerprint: string | null;
  // The address a person entered: its certificate is theirs to trust.
  isEntered: boolean;
}

interface OpenedSession {
  client: XapiClient;
  handle: XcpNgTransportHandle;
  candidate: XapiCandidate;
  session: string;
}

// The series served without a timestamp at the last read, per connection.
const untimedSeriesByConnection: Map<
  string,
  Map<string, OpenMetricsSample>
> = new Map();

// Exported for tests.
export function resetXapiCollectorState(): void {
  untimedSeriesByConnection.clear();
}

function keyOf(address: XcpNgAddress): string {
  return `${address.host}:${address.port}`;
}

function getErrorContext(address: XcpNgAddress): XcpNgErrorContext {
  return {
    host: address.host,
    port: address.port,
    what: "the pool master",
    addressLabel: XAPI_ADDRESS_LABEL,
  };
}

const HTTPS_URL: RegExp = /^https:\/\//i;

/*
 * An address XAPI or a past read gave for a host - bare, as host.address and
 * HOST_IS_SLAVE write it, or the https:// URL a report kept - as the address
 * the probe would connect to, or null when it is not one it may.
 */
export function toXapiAddress(
  raw: string | null | undefined,
): XcpNgAddress | null {
  const text: string = (raw || "").trim();

  if (!text) {
    return null;
  }

  const url: string | null = HTTPS_URL.test(text)
    ? text
    : XcpNgConnectionAddress.getXapiHostUrl(text);
  const normalized: XcpNgAddressResult | null = url
    ? XcpNgConnectionAddress.normalize(url, XcpNgConnectionType.Xapi)
    : null;

  return normalized?.address || null;
}

/*
 * A known host as somewhere to log in: the address a person entered, with
 * the certificate they trusted - or a host of the pool, with the
 * certificate the pool vouched for at the last read. Null for a host the
 * pool listed no certificate for: it is never tried.
 */
export function getKnownHostCandidate(data: {
  entered: XcpNgAddress;
  trustedFingerprint: string | null;
  poolHosts?: Array<XcpNgXapiPoolHost> | null | undefined;
  rawAddress: string | null | undefined;
}): XapiCandidate | null {
  const address: XcpNgAddress | null = toXapiAddress(data.rawAddress);

  if (!address) {
    return null;
  }

  if (keyOf(address) === keyOf(data.entered)) {
    return {
      address: data.entered,
      trustedFingerprint: data.trustedFingerprint,
      isEntered: true,
    };
  }

  const host: XcpNgXapiPoolHost | undefined = (data.poolHosts || []).find(
    (candidate: XcpNgXapiPoolHost): boolean => {
      const hostAddress: XcpNgAddress | null = toXapiAddress(candidate.address);
      return hostAddress !== null && keyOf(hostAddress) === keyOf(address);
    },
  );
  const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
    host?.certificateFingerprint,
  );

  if (!fingerprint) {
    return null;
  }

  return {
    address: address,
    trustedFingerprint: fingerprint,
    isEntered: false,
  };
}

/*
 * The hosts a collection may log in at, in the order it tries them: the
 * master the last read reached, the address a person entered, then the
 * pool's other known hosts - each with the certificate it must present.
 */
export function getXapiCandidates(data: {
  entered: XcpNgAddress;
  trustedFingerprint: string | null;
  masterAddress?: string | null | undefined;
  poolHosts?: Array<XcpNgXapiPoolHost> | null | undefined;
}): Array<XapiCandidate> {
  const candidates: Array<XapiCandidate> = [];
  const seen: Set<string> = new Set();

  const add: (candidate: XapiCandidate | null) => void = (
    candidate: XapiCandidate | null,
  ): void => {
    if (!candidate) {
      return;
    }

    const key: string = keyOf(candidate.address);

    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  };

  const known: (
    rawAddress: string | null | undefined,
  ) => XapiCandidate | null = (
    rawAddress: string | null | undefined,
  ): XapiCandidate | null => {
    return getKnownHostCandidate({
      entered: data.entered,
      trustedFingerprint: data.trustedFingerprint,
      poolHosts: data.poolHosts,
      rawAddress: rawAddress,
    });
  };

  add(known(data.masterAddress));

  add({
    address: data.entered,
    trustedFingerprint: data.trustedFingerprint,
    isEntered: true,
  });

  for (const host of data.poolHosts || []) {
    add(known(host.address));
  }

  return candidates;
}

function invalidLogin(username: string, where: string): XcpNgCollectionError {
  return new XcpNgCollectionError(
    XcpNgCollectionErrorCode.InvalidLogin,
    `XAPI at ${where} refused the login for ${username}: the user name or password is wrong. An Active Directory user is written with its domain, such as EXAMPLE\\oneuptime.`,
  );
}

/*
 * Logs in at the first candidate that is the pool master, following
 * HOST_IS_SLAVE to a master the pool vouched for.
 */
export async function openXapiSession(data: {
  candidates: Array<XapiCandidate>;
  username: string;
  password: string;
  poolHosts: Array<XcpNgXapiPoolHost>;
  dependencies: XapiCollectorDependencies;
}): Promise<OpenedSession> {
  const queue: Array<XapiCandidate> = [...data.candidates];
  const entered: XapiCandidate =
    data.candidates.find((candidate: XapiCandidate): boolean => {
      return candidate.isEntered;
    }) || data.candidates[0]!;
  const tried: Set<string> = new Set();
  let firstError: unknown = null;
  let unknownMaster: { from: XapiCandidate; master: string } | null = null;

  while (queue.length > 0) {
    const candidate: XapiCandidate = queue.shift()!;
    const key: string = keyOf(candidate.address);

    if (tried.has(key)) {
      continue;
    }

    tried.add(key);
    let handle: XcpNgTransportHandle | null = null;

    try {
      const pinned: Array<string> = await data.dependencies.resolve(
        candidate.address.url,
      );

      handle = data.dependencies.createTransport({
        endpoint: {
          host: candidate.address.host,
          port: candidate.address.port,
        },
        pinnedAddresses: pinned,
        trustedFingerprint: candidate.trustedFingerprint,
      });

      const client: XapiClient = new XapiClient(handle.transport);
      const session: string = await client.login(data.username, data.password);

      return { client, handle, candidate, session };
    } catch (error) {
      handle?.close();

      if (error instanceof XapiError) {
        if (error.code === "HOST_IS_SLAVE") {
          const master: string = error.params[0] || "";
          const masterCandidate: XapiCandidate | null = getKnownHostCandidate({
            entered: entered.address,
            trustedFingerprint: entered.trustedFingerprint,
            poolHosts: data.poolHosts,
            rawAddress: master,
          });

          if (masterCandidate && !tried.has(keyOf(masterCandidate.address))) {
            queue.unshift(masterCandidate);
          } else if (!unknownMaster) {
            unknownMaster = { from: candidate, master: master };
          }

          continue;
        }

        if (error.code === "SESSION_AUTHENTICATION_FAILED") {
          throw invalidLogin(
            data.username,
            `${candidate.address.host}:${candidate.address.port}`,
          );
        }

        throw error;
      }

      // The address a person entered says what is wrong with it.
      if (
        candidate.isEntered &&
        (error instanceof VSphereCertificateError ||
          error instanceof XapiNotXapiError)
      ) {
        throw error;
      }

      if (firstError === null) {
        firstError = error;
      }
    }
  }

  if (unknownMaster) {
    throw new XcpNgCollectionError(
      XcpNgCollectionErrorCode.NotPoolMaster,
      `${unknownMaster.from.address.host} is a member of the pool, not its master. The pool master is at ${
        unknownMaster.master || "an address XAPI did not give"
      }: enter that address and test again.`,
    );
  }

  throw firstError || new Error("No host of the pool answered.");
}

/*
 * Which account the session is: root, or an Active Directory user and its
 * roles. A pool that will not say leaves the account named, as root when it
 * is root, else as holding more than read-only - the warning that is never
 * wrong to show.
 */
async function readAccount(data: {
  client: XapiClient;
  session: string;
  username: string;
  warnings: Array<string>;
}): Promise<XcpNgXapiAccountSummary> {
  const { client, session, username } = data;

  try {
    const isLocalSuperuser: boolean = await client.call<boolean>(
      "session.get_is_local_superuser",
      [session, session],
    );

    if (isLocalSuperuser) {
      return {
        kind: XcpNgXapiAccountKind.Root,
        name: username,
        roles: [],
      };
    }

    const subject: string = await client.call<string>("session.get_subject", [
      session,
      session,
    ]);
    let name: string = username;

    try {
      const authUserName: string = await client.call<string>(
        "session.get_auth_user_name",
        [session, session],
      );

      if (authUserName) {
        name = authUserName;
      }
    } catch {
      // The name the login used stands.
    }

    const roleRefs: Array<string> =
      subject && subject !== XAPI_NULL_REF
        ? await client.call<Array<string>>("subject.get_roles", [
            session,
            subject,
          ])
        : [];
    const roles: Array<string> = [];

    for (const roleRef of roleRefs.slice(0, 20)) {
      roles.push(
        await client.call<string>("role.get_name_label", [session, roleRef]),
      );
    }

    return {
      kind: XcpNgXapiAccountKindUtil.fromSession({
        isLocalSuperuser: false,
        roleNames: roles,
      }),
      name: name,
      roles: roles,
    };
  } catch (error) {
    data.warnings.push(
      `XAPI did not say which roles ${username} holds (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );

    return {
      kind:
        username.trim().toLowerCase() === "root"
          ? XcpNgXapiAccountKind.Root
          : XcpNgXapiAccountKind.Elevated,
      name: username,
      roles: [],
    };
  }
}

interface PoolRecords {
  snapshot: Omit<XapiPoolSnapshot, "rrds" | "nowSeconds">;
  // host ref -> the SHA-256 fingerprint the pool lists for its API.
  fingerprints: Map<string, string>;
}

async function readPoolRecords(data: {
  client: XapiClient;
  session: string;
  warnings: Array<string>;
}): Promise<PoolRecords> {
  const read: <T>(xapiClass: string) => Promise<XapiRecords<T>> = <T>(
    xapiClass: string,
  ): Promise<XapiRecords<T>> => {
    return data.client.getAllRecords<T>(data.session, xapiClass);
  };

  const [
    pools,
    hosts,
    hostMetrics,
    vms,
    vmMetrics,
    srs,
    pbds,
    vdis,
    vbds,
    vifs,
    pifs,
    networks,
  ] = await Promise.all([
    read<XapiPoolSnapshot["pools"][string]>("pool"),
    read<XapiPoolSnapshot["hosts"][string]>("host"),
    read<XapiPoolSnapshot["hostMetrics"][string]>("host_metrics"),
    read<XapiPoolSnapshot["vms"][string]>("VM"),
    read<XapiPoolSnapshot["vmMetrics"][string]>("VM_metrics"),
    read<XapiPoolSnapshot["srs"][string]>("SR"),
    read<XapiPoolSnapshot["pbds"][string]>("PBD"),
    read<XapiPoolSnapshot["vdis"][string]>("VDI"),
    read<XapiPoolSnapshot["vbds"][string]>("VBD"),
    read<XapiPoolSnapshot["vifs"][string]>("VIF"),
    read<XapiPoolSnapshot["pifs"][string]>("PIF"),
    read<XapiPoolSnapshot["networks"][string]>("network"),
  ]);

  const fingerprints: Map<string, string> = new Map();

  try {
    const certificates: XapiRecords<{
      host?: string;
      type?: string;
      fingerprint?: string;
      fingerprint_sha256?: string;
    }> = await read("Certificate");

    for (const certificate of Object.values(certificates)) {
      if ((certificate.type || "host") !== "host" || !certificate.host) {
        continue;
      }

      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        certificate.fingerprint_sha256 || certificate.fingerprint,
      );

      if (fingerprint) {
        fingerprints.set(certificate.host, fingerprint);
      }
    }
  } catch (error) {
    data.warnings.push(
      `XAPI listed no host certificates (${
        error instanceof Error ? error.message : String(error)
      }): only the pool master's own metrics are read. XCP-ng 8.2 or later lists them.`,
    );
  }

  return {
    snapshot: {
      pools,
      hosts,
      hostMetrics,
      vms,
      vmMetrics,
      srs,
      pbds,
      vdis,
      vbds,
      vifs,
      pifs,
      networks,
    },
    fingerprints,
  };
}

// A whole number XAPI wrote (as a string, before XAPI 23.31), or undefined.
function readWholeNumber(value: unknown): number | undefined {
  const number: number = Number(value);
  return value !== undefined &&
    value !== null &&
    value !== "" &&
    Number.isInteger(number) &&
    number >= 0
    ? number
    : undefined;
}

/*
 * The pool's high availability and master, from its record (#10997 reads
 * them): XAPI is the one path that has the HA plan itself.
 */
export function describePoolState(data: {
  pool: XapiPoolRecord;
  hosts: Record<string, XapiHostRecord>;
}): XcpNgPoolState {
  const state: XcpNgPoolState = {
    poolId: data.pool.uuid.toLowerCase(),
    haEnabled: data.pool.ha_enabled === true,
  };

  const toTolerate: number | undefined = readWholeNumber(
    data.pool.ha_host_failures_to_tolerate,
  );
  const planExistsFor: number | undefined = readWholeNumber(
    data.pool.ha_plan_exists_for,
  );

  if (toTolerate !== undefined) {
    state.haHostFailuresToTolerate = toTolerate;
  }

  if (planExistsFor !== undefined) {
    state.haPlanExistsFor = planExistsFor;
  }

  if (typeof data.pool.ha_overcommitted === "boolean") {
    state.haOvercommitted = data.pool.ha_overcommitted;
  }

  const master: XapiHostRecord | undefined = data.hosts[data.pool.master];

  if (master?.uuid) {
    state.masterHostUuid = master.uuid.toLowerCase();
  }

  return state;
}

// The pool's hosts as the next collection needs them.
function describePoolHosts(records: PoolRecords): Array<XcpNgXapiPoolHost> {
  const pool: XapiPoolRecord | undefined = Object.values(
    records.snapshot.pools,
  )[0];

  return Object.entries(records.snapshot.hosts)
    .map(([ref, host]: [string, XapiHostRecord]): XcpNgXapiPoolHost => {
      return {
        uuid: host.uuid,
        name: host.name_label || "",
        address: host.address || "",
        certificateFingerprint: records.fingerprints.get(ref) || "",
        isMaster: pool?.master === ref,
      };
    })
    .sort((left: XcpNgXapiPoolHost, right: XcpNgXapiPoolHost): number => {
      return left.uuid < right.uuid ? -1 : left.uuid > right.uuid ? 1 : 0;
    });
}

// Runs `work` over `items`, at most `concurrency` at a time.
async function forEachLimited<T>(
  items: Array<T>,
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next: number = 0;
  const workers: Array<Promise<void>> = [];

  // Each worker takes the next item until none is left.
  const runWorker: () => Promise<void> = async (): Promise<void> => {
    while (next < items.length) {
      const item: T = items[next++]!;
      await work(item);
    }
  };

  for (
    let index: number = 0;
    index < Math.min(concurrency, items.length);
    index++
  ) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
}

/*
 * Every running host's rrd_updates: the master over the session's own
 * connection, every other host at its address, pinned to the certificate
 * the pool lists for it. A host that does not answer is left out with a
 * warning, as Xen Orchestra's plugin leaves it out.
 */
async function readRrds(data: {
  opened: OpenedSession;
  records: PoolRecords;
  startSeconds: number;
  dependencies: XapiCollectorDependencies;
  warnings: Array<string>;
}): Promise<Array<{ hostUuid: string; text: string }>> {
  const { opened, records } = data;
  const pool: XapiPoolRecord | undefined = Object.values(
    records.snapshot.pools,
  )[0];
  const rrds: Array<{ hostUuid: string; text: string }> = [];

  const hosts: Array<[string, XapiHostRecord]> = Object.entries(
    records.snapshot.hosts,
  ).filter(([, host]: [string, XapiHostRecord]): boolean => {
    return Boolean(records.snapshot.hostMetrics[host.metrics]?.live);
  });

  await forEachLimited(
    hosts,
    XAPI_RRD_CONCURRENCY,
    async ([ref, host]: [string, XapiHostRecord]): Promise<void> => {
      const isMaster: boolean = pool?.master === ref;
      let handle: XcpNgTransportHandle | null = null;

      try {
        let client: XapiClient = opened.client;

        if (!isMaster) {
          const url: string | null = XcpNgConnectionAddress.getXapiHostUrl(
            host.address,
          );
          const fingerprint: string | undefined = records.fingerprints.get(ref);

          if (!url) {
            data.warnings.push(
              `${host.name_label || host.uuid} has no address the probe may connect to (${host.address || "none"}): its metrics and its VMs' are left out.`,
            );
            return;
          }

          if (!fingerprint) {
            data.warnings.push(
              `The pool lists no certificate for ${host.name_label || host.uuid}: its metrics and its VMs' are left out.`,
            );
            return;
          }

          const normalized: XcpNgAddressResult =
            XcpNgConnectionAddress.normalize(url, XcpNgConnectionType.Xapi);

          if (!normalized.address) {
            return;
          }

          handle = data.dependencies.createTransport({
            endpoint: {
              host: normalized.address.host,
              port: normalized.address.port,
            },
            pinnedAddresses: await data.dependencies.resolve(
              normalized.address.url,
            ),
            trustedFingerprint: fingerprint,
            requestTimeoutInMs: XCP_NG_RRD_TIMEOUT_IN_MS,
          });
          client = new XapiClient(handle.transport);
        }

        rrds.push({
          hostUuid: host.uuid,
          text: await client.getRrdUpdates({
            session: opened.session,
            startSeconds: data.startSeconds,
          }),
        });
      } catch (error) {
        data.warnings.push(
          `${host.name_label || host.uuid} did not answer for its metrics (${
            error instanceof Error ? error.message : String(error)
          }): its metrics and its VMs' are left out this time.`,
        );
      } finally {
        handle?.close();
      }
    },
  );

  // In the pool's own order, so a read is the same whatever answered first.
  return rrds.sort(
    (
      left: { hostUuid: string; text: string },
      right: { hostUuid: string; text: string },
    ): number => {
      return left.hostUuid < right.hostUuid
        ? -1
        : left.hostUuid > right.hostUuid
          ? 1
          : 0;
    },
  );
}

/*
 * The pool's messages since the watermark, at most
 * XCP_NG_MAX_MESSAGES_PER_COLLECTION, oldest first - and the watermark the
 * next read starts from. The first read starts the watermark at the
 * master's clock: OneUptime reads messages from the moment a pool is
 * connected, not its history.
 */
export function selectNewMessages(data: {
  watermark: XcpNgMessageWatermark;
  received: Array<XcpNgPoolMessage>;
  max?: number | undefined;
}): { messages: Array<XcpNgPoolMessage>; watermark: XcpNgMessageWatermark } {
  const readUntil: number = new Date(data.watermark.readUntil).getTime();
  const seenAtReadUntil: Set<string> = new Set(data.watermark.uuidsAtReadUntil);
  const max: number = data.max ?? XCP_NG_MAX_MESSAGES_PER_COLLECTION;

  const fresh: Array<XcpNgPoolMessage> = data.received
    .filter((message: XcpNgPoolMessage): boolean => {
      const time: number = new Date(message.timestamp).getTime();

      if (Number.isNaN(time)) {
        return false;
      }

      return (
        time > readUntil ||
        (time === readUntil && !seenAtReadUntil.has(message.uuid))
      );
    })
    .sort((left: XcpNgPoolMessage, right: XcpNgPoolMessage): number => {
      const byTime: number =
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime();
      return byTime !== 0
        ? byTime
        : left.uuid < right.uuid
          ? -1
          : left.uuid > right.uuid
            ? 1
            : 0;
    })
    .slice(0, max);

  if (fresh.length === 0) {
    return { messages: [], watermark: data.watermark };
  }

  const newest: number = new Date(fresh[fresh.length - 1]!.timestamp).getTime();
  const atNewest: Array<string> = fresh
    .filter((message: XcpNgPoolMessage): boolean => {
      return new Date(message.timestamp).getTime() === newest;
    })
    .map((message: XcpNgPoolMessage): string => {
      return message.uuid;
    });

  return {
    messages: fresh,
    watermark: {
      readUntil: new Date(newest).toISOString(),
      uuidsAtReadUntil:
        newest === readUntil
          ? Array.from(
              new Set([...data.watermark.uuidsAtReadUntil, ...atNewest]),
            )
          : atNewest,
    },
  };
}

async function readMessages(data: {
  client: XapiClient;
  session: string;
  poolId: string;
  masterRef: string;
  watermark: XcpNgMessageWatermark | undefined;
  now: Date;
  warnings: Array<string>;
}): Promise<{
  messages: Array<XcpNgPoolMessage>;
  watermark: XcpNgMessageWatermark;
}> {
  if (!data.watermark) {
    let start: Date = data.now;

    try {
      const serverTime: Date | null = parseXapiDateTime(
        await data.client.call<string>("host.get_servertime", [
          data.session,
          data.masterRef,
        ]),
      );

      if (serverTime) {
        start = serverTime;
      }
    } catch {
      // The probe's clock, then.
    }

    return {
      messages: [],
      watermark: { readUntil: start.toISOString(), uuidsAtReadUntil: [] },
    };
  }

  try {
    // A second early: XAPI's times are whole seconds; the watermark dedupes.
    const since: Date = new Date(
      new Date(data.watermark.readUntil).getTime() - 1000,
    );
    const records: XapiRecords<{
      uuid?: string;
      name?: string;
      priority?: number | string;
      cls?: string;
      obj_uuid?: string;
      timestamp?: string;
      body?: string;
    }> = await data.client.call("message.get_since", [
      data.session,
      formatXapiDateTime(since),
    ]);

    const received: Array<XcpNgPoolMessage> = [];

    for (const record of Object.values(records || {})) {
      const timestamp: Date | null = parseXapiDateTime(record.timestamp);

      if (!record.uuid || !record.name || !timestamp) {
        continue;
      }

      const body: string = String(record.body || "");

      received.push({
        uuid: String(record.uuid),
        poolId: data.poolId,
        name: String(record.name),
        priority: Number(record.priority) || 5,
        objectClass: String(record.cls || ""),
        objectUuid: String(record.obj_uuid || ""),
        timestamp: timestamp.toISOString(),
        body:
          body.length > MAX_MESSAGE_BODY_LENGTH
            ? `${body.substring(0, MAX_MESSAGE_BODY_LENGTH - 1)}…`
            : body,
      });
    }

    return selectNewMessages({ watermark: data.watermark, received });
  } catch (error) {
    data.warnings.push(
      `The pool's messages could not be read (${
        error instanceof Error ? error.message : String(error)
      }); they are read again next time.`,
    );

    return { messages: [], watermark: data.watermark };
  }
}

export default class XapiCollector {
  public static async collect(
    job: XcpNgCollectionJob,
    dependencies: XapiCollectorDependencies = DEFAULT_XAPI_DEPENDENCIES,
  ): Promise<XcpNgCollectionReport> {
    const startedAt: Date = dependencies.now();
    const report: XcpNgCollectionReport = {
      xcpNgConnectionId: job.xcpNgConnectionId,
      settingsVersion: job.settingsVersion,
      collectedAt: startedAt.toISOString(),
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      job.address,
      XcpNgConnectionType.Xapi,
    );

    if (!normalized.address) {
      report.errorCode = XcpNgCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return XapiCollector.finish(report, startedAt, dependencies);
    }

    const entered: XcpNgAddress = normalized.address;

    if (!job.username || !job.password) {
      report.errorCode = XcpNgCollectionErrorCode.InvalidLogin;
      report.errorMessage =
        "No XAPI account is saved for this pool. Enter it on the connection's page.";
      return XapiCollector.finish(report, startedAt, dependencies);
    }

    const budgetInMs: number =
      dependencies.collectionTimeoutInMs ??
      getCollectionBudgetInMs(job.collectionIntervalInMinutes);
    const maxPayloadBytes: number =
      dependencies.maxPayloadBytes ?? XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES;
    let opened: OpenedSession | null = null;
    let reachedAddress: XcpNgAddress = entered;

    try {
      await withDeadline(
        (async (): Promise<void> => {
          opened = await openXapiSession({
            candidates: getXapiCandidates({
              entered: entered,
              trustedFingerprint: job.trustedCertificateFingerprint || null,
              masterAddress: job.xapiMasterAddress,
              poolHosts: job.xapiPoolHosts,
            }),
            username: job.username!,
            password: job.password!,
            poolHosts: job.xapiPoolHosts || [],
            dependencies: dependencies,
          });

          const session: OpenedSession = opened;
          reachedAddress = session.candidate.address;
          const warnings: Array<string> = [];

          try {
            const account: XcpNgXapiAccountSummary = await readAccount({
              client: session.client,
              session: session.session,
              username: job.username!,
              warnings: warnings,
            });

            const records: PoolRecords = await readPoolRecords({
              client: session.client,
              session: session.session,
              warnings: warnings,
            });

            const pool: XapiPoolRecord | undefined = Object.values(
              records.snapshot.pools,
            )[0];

            if (!pool) {
              throw new XcpNgCollectionError(
                XcpNgCollectionErrorCode.NoPools,
                `XAPI at ${keyOf(reachedAddress)} reports no pool.`,
              );
            }

            if (
              job.xapiPoolId &&
              pool.uuid.toLowerCase() !== job.xapiPoolId.toLowerCase()
            ) {
              throw new XcpNgCollectionError(
                XcpNgCollectionErrorCode.NotPoolMaster,
                `${reachedAddress.host} now answers for another pool (${pool.uuid}), not the one this connection reads (${job.xapiPoolId}): it may have been ejected from it. Enter the address of the pool's master.`,
              );
            }

            const scrapeTimeMs: number = dependencies.now().getTime();
            const nowSeconds: number = Math.floor(scrapeTimeMs / 1000);

            const rrds: Array<{ hostUuid: string; text: string }> =
              await readRrds({
                opened: session,
                records: records,
                startSeconds: nowSeconds - XAPI_RRD_WINDOW_IN_SECONDS,
                dependencies: dependencies,
                warnings: warnings,
              });

            const messages: {
              messages: Array<XcpNgPoolMessage>;
              watermark: XcpNgMessageWatermark;
            } = await readMessages({
              client: session.client,
              session: session.session,
              poolId: pool.uuid.toLowerCase(),
              masterRef: pool.master,
              watermark: job.messageWatermark,
              now: dependencies.now(),
              warnings: warnings,
            });

            const samples: Array<OpenMetricsSample> = toOpenMetricsSamples(
              buildXapiFormattedMetrics({
                ...records.snapshot,
                rrds: rrds,
                nowSeconds: nowSeconds,
              }),
            );

            const built: XcpNgOtlpBuildResult = XcpNgOtlpBuilder.build({
              samples: samples,
              scrapeTimeMs: scrapeTimeMs,
              target: { host: reachedAddress.host, port: reachedAddress.port },
              scopeVersion: dependencies.scopeVersion,
              previousUntimedSeries: untimedSeriesByConnection.get(
                job.xcpNgConnectionId,
              ),
            });

            const payloadBytes: number = Buffer.byteLength(
              JSON.stringify(built.resourceMetrics),
            );

            if (payloadBytes > maxPayloadBytes) {
              throw new XcpNgCollectionError(
                XcpNgCollectionErrorCode.PayloadTooLarge,
                `This pool's read is ${formatSize(
                  payloadBytes,
                )} of metrics, more than the ${formatSize(
                  maxPayloadBytes,
                )} one probe upload takes.`,
              );
            }

            untimedSeriesByConnection.set(
              job.xcpNgConnectionId,
              built.untimedSeries,
            );

            const master: XapiHostRecord | undefined =
              records.snapshot.hosts[pool.master];

            const summary: XcpNgCollectionSummary = {
              connectionType: XcpNgConnectionType.Xapi,
              pools: XcpNgOtlpBuilder.summarizePools(samples),
              masterAddress: reachedAddress.host,
              account: account,
              resourceCount: built.resourceCount,
              datapointCount: built.datapointCount,
              warnings: warnings.slice(0, 20),
            };

            XapiCollector.describeMaster(summary, master);

            report.status = "Succeeded";
            report.resourceMetrics = built.resourceMetrics;
            report.summary = summary;
            report.xapiPoolId = pool.uuid.toLowerCase();
            // The URL it was reached at, port included: tried first next time.
            report.xapiMasterAddress = reachedAddress.url;
            report.xapiPoolHosts = describePoolHosts(records);
            report.messages = messages.messages;
            report.messageWatermark = messages.watermark;
            report.poolStates = [
              describePoolState({
                pool: pool,
                hosts: records.snapshot.hosts,
              }),
            ];
          } finally {
            try {
              await session.client.logout(session.session);
            } catch {
              // An unclosed session is closed by XAPI when it times out.
            }
          }
        })(),
        budgetInMs,
        `Reading the pool at ${keyOf(entered)} took longer than ${Math.round(
          budgetInMs / 1000,
        )} seconds. Collect it less often, or check the pool master's load.`,
      );
    } catch (error) {
      XapiCollector.fail(
        report,
        error,
        reachedAddress,
        job.trustedCertificateFingerprint,
      );
    } finally {
      (opened as OpenedSession | null)?.handle.close();
    }

    return XapiCollector.finish(report, startedAt, dependencies);
  }

  private static describeMaster(
    summary: XcpNgCollectionSummary,
    master: XapiHostRecord | undefined,
  ): void {
    if (!master) {
      return;
    }

    if (master.name_label) {
      summary.masterHostName = master.name_label;
    }

    const version: Record<string, string> = master.software_version || {};

    if (version["product_brand"]) {
      summary.productName = version["product_brand"];
    }

    if (version["product_version"]) {
      summary.productVersion = version["product_version"];
    }

    if (version["xapi"]) {
      summary.xapiVersion = version["xapi"];
    }
  }

  private static fail(
    report: XcpNgCollectionReport | XcpNgConnectionTestReport,
    error: unknown,
    address: XcpNgAddress,
    trustedFingerprint: string | null | undefined,
  ): void {
    let classified: ClassifiedXcpNgError;

    if (error instanceof XapiError) {
      classified =
        error.code === "RBAC_PERMISSION_DENIED"
          ? {
              code: XcpNgCollectionErrorCode.NoPermission,
              message: `The account may not read the pool (RBAC_PERMISSION_DENIED for ${error.method}). Give the Active Directory user the read-only role on the pool.`,
            }
          : {
              code: XcpNgCollectionErrorCode.ApiError,
              message: `XAPI at ${keyOf(address)} answered ${error.method} with ${error.message}.`,
            };
    } else if (error instanceof XapiNotXapiError) {
      classified = {
        code: XcpNgCollectionErrorCode.NotXapi,
        message: `${keyOf(address)} is not an XCP-ng host's XAPI: it ${error.message}. Enter the pool master's address.`,
      };
    } else {
      classified = classifyXcpNgError(
        error,
        getErrorContext(address),
        trustedFingerprint,
      );
    }

    report.status = "Failed";
    report.errorCode = classified.code;
    report.errorMessage = classified.message;

    if (classified.presentedCertificate) {
      report.presentedCertificate = classified.presentedCertificate;
    }
  }

  /*
   * A connection test: log in at the address entered (a pool member says
   * where its master is), say which account it is, and how much of the pool
   * it sees - its hosts, VMs and storage repositories. Nothing is collected
   * and nothing is kept.
   */
  public static async test(
    job: XcpNgConnectionTestJob,
    dependencies: XapiCollectorDependencies = DEFAULT_XAPI_DEPENDENCIES,
  ): Promise<XcpNgConnectionTestReport> {
    const startedAt: Date = dependencies.now();
    const report: XcpNgConnectionTestReport = {
      xcpNgConnectionTestId: job.xcpNgConnectionTestId,
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      job.address,
      XcpNgConnectionType.Xapi,
    );

    if (!normalized.address) {
      report.errorCode = XcpNgCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return XapiCollector.finishTest(report, startedAt, dependencies);
    }

    const entered: XcpNgAddress = normalized.address;

    if (!job.username || !job.password) {
      report.errorCode = XcpNgCollectionErrorCode.InvalidLogin;
      report.errorMessage = "Enter the XAPI user name and password.";
      return XapiCollector.finishTest(report, startedAt, dependencies);
    }

    let opened: OpenedSession | null = null;
    const testTimeoutInMs: number =
      dependencies.testTimeoutInMs ?? XAPI_TEST_TIME_IN_MS;

    try {
      await withDeadline(
        (async (): Promise<void> => {
          opened = await openXapiSession({
            candidates: [
              {
                address: entered,
                trustedFingerprint: job.trustedCertificateFingerprint || null,
                isEntered: true,
              },
            ],
            username: job.username!,
            password: job.password!,
            poolHosts: [],
            dependencies: dependencies,
          });

          const session: OpenedSession = opened;
          const warnings: Array<string> = [];

          try {
            const account: XcpNgXapiAccountSummary = await readAccount({
              client: session.client,
              session: session.session,
              username: job.username!,
              warnings: warnings,
            });
            const records: PoolRecords = await readPoolRecords({
              client: session.client,
              session: session.session,
              warnings: warnings,
            });
            const pool: XapiPoolRecord | undefined = Object.values(
              records.snapshot.pools,
            )[0];

            if (!pool) {
              throw new XcpNgCollectionError(
                XcpNgCollectionErrorCode.NoPools,
                `XAPI at ${keyOf(entered)} reports no pool.`,
              );
            }

            const samples: Array<OpenMetricsSample> = toOpenMetricsSamples(
              buildXapiFormattedMetrics({
                ...records.snapshot,
                rrds: [],
                nowSeconds: Math.floor(dependencies.now().getTime() / 1000),
              }),
            );

            const unvouched: Array<string> = describePoolHosts(records)
              .filter((host: XcpNgXapiPoolHost): boolean => {
                return !host.isMaster && !host.certificateFingerprint;
              })
              .map((host: XcpNgXapiPoolHost): string => {
                return host.name || host.uuid;
              });

            if (unvouched.length > 0) {
              warnings.push(
                `The pool lists no certificate for ${unvouched.join(", ")}: their metrics will be left out.`,
              );
            }

            const summary: XcpNgCollectionSummary = {
              connectionType: XcpNgConnectionType.Xapi,
              pools: XcpNgOtlpBuilder.summarizePools(samples),
              masterAddress: entered.host,
              account: account,
              warnings: warnings,
            };

            XapiCollector.describeMaster(
              summary,
              records.snapshot.hosts[pool.master],
            );

            report.status = "Succeeded";
            report.summary = summary;
          } finally {
            try {
              await session.client.logout(session.session);
            } catch {
              // An unclosed session is closed by XAPI when it times out.
            }
          }
        })(),
        testTimeoutInMs,
        `The pool at ${keyOf(entered)} did not finish the test within ${Math.round(
          testTimeoutInMs / 1000,
        )} seconds.`,
      );
    } catch (error) {
      XapiCollector.fail(
        report,
        error,
        entered,
        job.trustedCertificateFingerprint,
      );
    } finally {
      (opened as OpenedSession | null)?.handle.close();
    }

    return XapiCollector.finishTest(report, startedAt, dependencies);
  }

  private static finish(
    report: XcpNgCollectionReport,
    startedAt: Date,
    dependencies: XapiCollectorDependencies,
  ): XcpNgCollectionReport {
    report.durationInMs = Math.max(
      0,
      dependencies.now().getTime() - startedAt.getTime(),
    );
    return report;
  }

  private static finishTest(
    report: XcpNgConnectionTestReport,
    startedAt: Date,
    dependencies: XapiCollectorDependencies,
  ): XcpNgConnectionTestReport {
    report.durationInMs = Math.max(
      0,
      dependencies.now().getTime() - startedAt.getTime(),
    );
    return report;
  }
}
