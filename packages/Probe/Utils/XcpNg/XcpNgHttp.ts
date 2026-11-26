import { createVSphereTransport } from "../VMware/VSphereHttp";
import {
  VSphereHttpRequest,
  VSphereHttpResponse,
  VSphereTransport,
} from "../VMware/VSphereSoapClient";
import { VSphereVerifyingAgent } from "../VMware/VSphereTls";
import SSRFProtection, {
  ValidatedWebhookTarget,
  ValidatedWebhookTargetAddress,
} from "Common/Server/Utils/SSRFProtection";
import { AppVersion } from "Common/Server/EnvironmentConfig";

/*
 * How a probe speaks HTTPS to Xen Orchestra and to XCP-ng hosts: the
 * vCenter collection's verified transport, unchanged. Every request goes
 * over a socket whose certificate passed before the request was written
 * (VSphereTls: chained to an authority this machine trusts and naming the
 * host - or exactly the one certificate a person trusted, by its SHA-256
 * fingerprint; never skipped), to the addresses the host name was validated
 * to (SSRFProtection, pinned so DNS cannot change between the check and the
 * connection), with a deadline, and with an answer larger than either ever
 * sends cut off rather than read into memory.
 *
 * Pinning by fingerprint is what lets a probe trust Xen Orchestra's own
 * self-signed certificate, which names no address: the fingerprint is
 * compared by the probe itself, so no host name has to be vouched for.
 */

export type XcpNgHttpRequest = VSphereHttpRequest;
export type XcpNgHttpResponse = VSphereHttpResponse;
export type XcpNgTransport = VSphereTransport;

export interface XcpNgTransportHandle {
  transport: XcpNgTransport;
  close: () => void;
}

export interface XcpNgEndpoint {
  host: string;
  port: number;
}

export const XCP_NG_CONNECT_TIMEOUT_IN_MS: number = 15_000;

// A scrape of a large Xen Orchestra: the agent's own scrape_timeout.
export const XCP_NG_REQUEST_TIMEOUT_IN_MS: number = 50_000;

// One host's rrd_updates, as Xen Orchestra's plugin waits for it.
export const XCP_NG_RRD_TIMEOUT_IN_MS: number = 10_000;

export const XCP_NG_MAX_RESPONSE_BYTES: number = 64 * 1024 * 1024;

export const XCP_NG_USER_AGENT: string = `OneUptime-Probe/${AppVersion} (XCP-ng collection)`;

// The addresses a host may be connected to, validated.
export async function resolveXcpNgAddress(
  url: string,
  label: string,
): Promise<Array<string>> {
  const target: ValidatedWebhookTarget =
    await SSRFProtection.validateAndResolveWebhookTarget(url, {
      // A probe sits in the network it watches: XCP-ng is usually private.
      allowPrivateNetworkTargets: true,
      privateNetworkAccessIsAllowed: true,
      targetLabel: label,
      includeResolutionDetailInError: true,
    });

  return target.addresses.map(
    (address: ValidatedWebhookTargetAddress): string => {
      return address.address;
    },
  );
}

export function createXcpNgTransport(data: {
  endpoint: XcpNgEndpoint;
  pinnedAddresses: Array<string>;
  trustedFingerprint: string | null;
  requestTimeoutInMs?: number | undefined;
  maxResponseBytes?: number | undefined;
}): XcpNgTransportHandle {
  const agent: VSphereVerifyingAgent = new VSphereVerifyingAgent({
    host: data.endpoint.host,
    port: data.endpoint.port,
    pinnedAddresses: data.pinnedAddresses,
    trustedFingerprint: data.trustedFingerprint,
    connectTimeoutInMs: XCP_NG_CONNECT_TIMEOUT_IN_MS,
  });

  return {
    transport: createVSphereTransport({
      host: data.endpoint.host,
      port: data.endpoint.port,
      agent: agent,
      requestTimeoutInMs:
        data.requestTimeoutInMs ?? XCP_NG_REQUEST_TIMEOUT_IN_MS,
      maxResponseBytes: data.maxResponseBytes ?? XCP_NG_MAX_RESPONSE_BYTES,
    }),
    close: (): void => {
      agent.destroy();
    },
  };
}

// A response header, as one string (the first of several).
export function readHeader(
  response: XcpNgHttpResponse,
  name: string,
): string {
  const value: string | Array<string> | undefined =
    response.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

// A JSON body, or null when it is not one.
export function readJsonBody(response: XcpNgHttpResponse): unknown | null {
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    return null;
  }
}
