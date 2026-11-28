import { createVSphereTransport } from "../VMware/VSphereHttp";
import { VSphereVerifyingAgent } from "../VMware/VSphereTls";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import SSRFProtection, {
  ValidatedWebhookTarget,
  ValidatedWebhookTargetAddress,
} from "Common/Server/Utils/SSRFProtection";
import { StorageArrayAddress } from "Common/Utils/StorageArray/StorageArrayConnectionAddress";

/*
 * How the probe reaches a storage management server (#11004), with exactly
 * VMware's agentless collection's guarantees, because it is VMware's code:
 *
 *   - the address and every address it resolves to are checked against
 *     the addresses a probe never connects to (loopback, link-local, cloud
 *     metadata: SSRFProtection), and the socket is pinned to those very
 *     addresses, so DNS cannot change between the check and the connection;
 *   - every connection completes a TLS handshake verified before a byte is
 *     written - against the machine's authorities, or against the one
 *     certificate a person trusted (VSphereTls) - so no request, and no
 *     password, ever reaches an unverified peer;
 *   - every request has a deadline, and an answer larger than a server
 *     ever sends is cut off rather than read into memory (VSphereHttp).
 */

export const STORAGE_ARRAY_CONNECT_TIMEOUT_IN_MS: number = 15_000;
export const STORAGE_ARRAY_REQUEST_TIMEOUT_IN_MS: number = 120_000;
export const STORAGE_ARRAY_MAX_RESPONSE_BYTES: number = 96 * 1024 * 1024;

export const STORAGE_ARRAY_USER_AGENT: string = `OneUptime-Probe/${AppVersion} (storage array collection)`;

export interface StorageArrayHttpRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export interface StorageArrayHttpResponse {
  status: number;
  headers: Record<string, string | Array<string> | undefined>;
  body: string;
}

export type StorageArrayTransport = (
  request: StorageArrayHttpRequest,
) => Promise<StorageArrayHttpResponse>;

export interface StorageArrayTransportHandle {
  transport: StorageArrayTransport;
  close: () => void;
}

// What a poller needs of the world; replaced in tests.
export interface StorageArrayPollerDependencies {
  // The addresses a server's address may be connected to (validated).
  resolve: (url: string) => Promise<Array<string>>;
  createTransport: (data: {
    address: StorageArrayAddress;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
  }) => StorageArrayTransportHandle;
  now: () => Date;
  // How long a poller waits between calls a server limits (1 per second).
  sleep: (ms: number) => Promise<void>;
  scopeVersion: string;
}

export async function resolveStorageArrayAddress(
  url: string,
): Promise<Array<string>> {
  const target: ValidatedWebhookTarget =
    await SSRFProtection.validateAndResolveWebhookTarget(url, {
      // A probe sits in the network it watches: the server is usually private.
      allowPrivateNetworkTargets: true,
      privateNetworkAccessIsAllowed: true,
      targetLabel: "storage server address",
      includeResolutionDetailInError: true,
    });

  return target.addresses.map(
    (address: ValidatedWebhookTargetAddress): string => {
      return address.address;
    },
  );
}

export const DEFAULT_STORAGE_ARRAY_POLLER_DEPENDENCIES: StorageArrayPollerDependencies =
  {
    resolve: resolveStorageArrayAddress,
    createTransport: (data: {
      address: StorageArrayAddress;
      pinnedAddresses: Array<string>;
      trustedFingerprint: string | null;
    }): StorageArrayTransportHandle => {
      const agent: VSphereVerifyingAgent = new VSphereVerifyingAgent({
        host: data.address.host,
        port: data.address.port,
        pinnedAddresses: data.pinnedAddresses,
        trustedFingerprint: data.trustedFingerprint,
        connectTimeoutInMs: STORAGE_ARRAY_CONNECT_TIMEOUT_IN_MS,
      });

      const transport: StorageArrayTransport = createVSphereTransport({
        host: data.address.host,
        port: data.address.port,
        agent: agent,
        requestTimeoutInMs: STORAGE_ARRAY_REQUEST_TIMEOUT_IN_MS,
        maxResponseBytes: STORAGE_ARRAY_MAX_RESPONSE_BYTES,
      }) as unknown as StorageArrayTransport;

      return {
        transport: transport,
        close: (): void => {
          agent.destroy();
        },
      };
    },
    now: (): Date => {
      return new Date();
    },
    sleep: (ms: number): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, ms);
      });
    },
    scopeVersion: AppVersion,
  };
