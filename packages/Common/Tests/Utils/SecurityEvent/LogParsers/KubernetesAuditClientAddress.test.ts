import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ClientAddressTrust,
  TrustedProxies,
  canNameResolvedClientAddress,
  readClaimedClientAddress,
  toTrustedProxies,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import KubernetesAuditLogParser, {
  readKubernetesClientAddress,
} from "../../../../Utils/SecurityEvent/LogParsers/KubernetesAuditLogParser";
import {
  ScrubbedAddressKind,
  readHiddenClientAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import { auditEvent, logLine } from "./LogParserFixtures";
import { tokenOf } from "./ScrubbedAddressFormats";

/*
 * A KUBERNETES AUDIT EVENT IS BLAMED ON THE ADDRESS THE API SERVER SAW
 * (#10416, #10419).
 *
 * Kubernetes lists in sourceIPs the hops of the X-Forwarded-For a request
 * carried, then its X-Real-Ip, then the connection's own address when it is
 * not the last of them: "all but the last IP can be arbitrarily set by the
 * client". The parser took the first, so a client that sent
 * "X-Forwarded-For: 198.51.100.9" had its refused request blamed on
 * 198.51.100.9 - and once a Hash rule hid that claim, the address vault
 * would have named it. Now the last entry is the peer and the rest are read
 * as an X-Forwarded-For through ClientAddressTrust: a proxy the project
 * trusts is walked past, and what the client wrote is only its claim.
 */

const CLIENT: string = "203.0.113.7";
const CLAIM: string = "198.51.100.9";
const LOAD_BALANCER: string = "10.0.0.5";

function refused(sourceIPs: Array<string>): JSONObject {
  return auditEvent({
    sourceIPs,
    verb: "get",
    objectRef: {
      resource: "secrets",
      namespace: "default",
      name: "db-password",
      apiVersion: "v1",
    },
    responseStatus: { metadata: {}, code: 403 },
  });
}

function parse(
  sourceIPs: Array<string>,
  trustedProxies?: TrustedProxies | undefined,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = KubernetesAuditLogParser.parse(
    {
      ...logLine(JSON.stringify(refused(sourceIPs))),
      trustedProxies,
    },
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

describe("the address a Kubernetes audit event names", () => {
  test("is the connection's, when the request forwarded nothing", () => {
    const event: NormalizedSecurityEvent = parse([CLIENT]);

    expect(event.principalIp).toBe(CLIENT);
    expect(event.observables).toContain(CLIENT);
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)).toBeNull();
  });

  test("is never the X-Forwarded-For its client wrote: that is only a claim", () => {
    const event: NormalizedSecurityEvent = parse([CLAIM, CLIENT]);

    expect(event.principalIp).toBe(CLIENT);
    expect(event.observables).not.toContain(CLAIM);
    expect(readClaimedClientAddress(event)).toEqual(
      expect.objectContaining({
        address: CLAIM,
        from: "x-forwarded-for",
        isOnlyAddress: false,
      }),
    );
  });

  test("behind a private load balancer, is the address the balancer forwarded", () => {
    const event: NormalizedSecurityEvent = parse([CLIENT, LOAD_BALANCER]);

    expect(event.principalIp).toBe(CLIENT);
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("behind it, a claim the client wrote ahead of the balancer's hop stays a claim", () => {
    const event: NormalizedSecurityEvent = parse([
      CLAIM,
      CLIENT,
      LOAD_BALANCER,
    ]);

    expect(event.principalIp).toBe(CLIENT);
    expect(readClaimedClientAddress(event)?.address).toBe(CLAIM);
  });

  test("walks past the proxies the project trusts, public ones listed too", () => {
    const edge: string = "172.70.38.12";
    const event: NormalizedSecurityEvent = parse(
      [CLAIM, CLIENT, edge],
      toTrustedProxies("172.64.0.0/13"),
    );

    expect(event.principalIp).toBe(CLIENT);

    // Untrusted, the edge is the client: whoever connected.
    expect(parse([CLAIM, CLIENT, edge]).principalIp).toBe(edge);
  });

  test("an audit record with no sourceIPs names no address, and says nothing of one", () => {
    const record: JSONObject = refused([]);
    delete record["sourceIPs"];

    const events: Array<NormalizedSecurityEvent> =
      KubernetesAuditLogParser.parse(logLine(JSON.stringify(record)));

    expect(events[0]!.principalIp).toBe("");
    expect(readHiddenClientAddress(events[0]!)).toBeNull();
    expect(readKubernetesClientAddress(record).trust).toBeNull();
  });
});

describe("a Kubernetes audit event's address a scrub rule hid", () => {
  test("the connection's address, hashed: the event says so, for the vault to name", () => {
    const event: NormalizedSecurityEvent = parse([tokenOf(CLIENT)]);

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Hashed,
        value: tokenOf(CLIENT),
      }),
    );
    // The vault may name the address behind it: the client could not have written it.
    expect(
      canNameResolvedClientAddress({
        attributes: event.attributes,
        address: CLIENT,
        proxies: undefined,
      }),
    ).toBe(true);
  });

  test("a hashed claim is never the token the vault is asked about", () => {
    const event: NormalizedSecurityEvent = parse([tokenOf(CLAIM), CLIENT]);

    expect(event.principalIp).toBe(CLIENT);
    expect(readHiddenClientAddress(event)).toBeNull();
    // The claim is kept as the rule left it, under its own attribute.
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress],
    ).toBe(tokenOf(CLAIM));
  });

  test("behind a private load balancer, the hashed client it forwarded is the one hidden", () => {
    const event: NormalizedSecurityEvent = parse([
      tokenOf(CLAIM),
      tokenOf(CLIENT),
      LOAD_BALANCER,
    ]);

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)?.value).toBe(tokenOf(CLIENT));
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("the record's sourceIPs keep what the rule left, as stored", () => {
    const event: NormalizedSecurityEvent = parse([
      tokenOf(CLAIM),
      tokenOf(CLIENT),
    ]);

    expect(JSON.stringify(event.attributes)).toContain(tokenOf(CLAIM));
    expect(event.observables).not.toContain(tokenOf(CLAIM));
    expect(event.observables).not.toContain(tokenOf(CLIENT));
  });
});
