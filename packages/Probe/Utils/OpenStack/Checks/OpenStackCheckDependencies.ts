import { OpenStackBackoffMemory } from "../OpenStackBackoff";
import {
  OPENSTACK_CONNECT_TIMEOUT_IN_MS,
  resolveOpenStackAddress,
} from "../OpenStackCollector";
import {
  OpenStackTransportHandle,
  createOpenStackTransport,
} from "../OpenStackHttp";
import {
  DEFAULT_OPENSTACK_CLOCK,
  OpenStackClock,
} from "../OpenStackServiceClient";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
import crypto from "crypto";
import ping from "ping";

/*
 * What a check needs from around it, so a test can hand it a recorded cloud, a clock that only
 * moves when told, and a ping that answers as it is told to. The real ones hold the rules no
 * request may get around: see OpenStackHttp.
 */

// An answer to one of the small things a check asks is never this long.
export const OPENSTACK_CHECK_MAX_RESPONSE_BYTES: number = 8 * 1024 * 1024;

export interface OpenStackCheckDependencies {
  resolve: (url: string) => Promise<Array<string>>;
  createTransport: (data: {
    trustedFingerprints: ReadonlyArray<string>;
    resolve: (url: string) => Promise<Array<string>>;
    onCertificate?:
      | ((certificate: OpenStackPresentedCertificate) => void)
      | undefined;
  }) => OpenStackTransportHandle;
  clock: OpenStackClock;
  // Whether this IP address answered one ping within the time.
  ping: (address: string, timeoutInMs: number) => Promise<boolean>;
  // This many random bytes, as hex: the random part of a run's name.
  randomHex: (bytes: number) => string;
  // A random UUID: a signed step's trace.
  randomUuid: () => string;
  // What was refused lately, so a refused credential is not repeated into a lockout.
  backoff: OpenStackBackoffMemory;
  userAgent: string;
}

/*
 * One ping. Never throws: a host that does not answer and a machine that cannot ping both read as
 * no answer, and the sentence around it says what was tried.
 */
export async function pingOpenStackAddress(
  address: string,
  timeoutInMs: number,
): Promise<boolean> {
  try {
    const result: ping.PingResponse = await ping.promise.probe(address, {
      timeout: Math.max(1, Math.round(timeoutInMs / 1000)),
      min_reply: 1,
    });

    return result.alive === true;
  } catch {
    return false;
  }
}

export const OPENSTACK_CHECK_BACKOFF: OpenStackBackoffMemory =
  new OpenStackBackoffMemory();

export const DEFAULT_OPENSTACK_CHECK_DEPENDENCIES: OpenStackCheckDependencies =
  {
    resolve: resolveOpenStackAddress,
    createTransport: (data: {
      trustedFingerprints: ReadonlyArray<string>;
      resolve: (url: string) => Promise<Array<string>>;
      onCertificate?:
        | ((certificate: OpenStackPresentedCertificate) => void)
        | undefined;
    }): OpenStackTransportHandle => {
      return createOpenStackTransport({
        trustedFingerprints: data.trustedFingerprints,
        resolve: data.resolve,
        connectTimeoutInMs: OPENSTACK_CONNECT_TIMEOUT_IN_MS,
        maxResponseBytes: OPENSTACK_CHECK_MAX_RESPONSE_BYTES,
        onCertificate: data.onCertificate,
      });
    },
    clock: DEFAULT_OPENSTACK_CLOCK,
    ping: pingOpenStackAddress,
    randomHex: (bytes: number): string => {
      return crypto.randomBytes(bytes).toString("hex");
    },
    randomUuid: (): string => {
      return crypto.randomUUID();
    },
    backoff: OPENSTACK_CHECK_BACKOFF,
    userAgent: `OneUptime-Probe/${AppVersion} (OpenStack checks)`,
  };
