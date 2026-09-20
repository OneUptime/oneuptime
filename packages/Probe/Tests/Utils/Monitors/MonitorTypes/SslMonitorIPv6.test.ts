// Set required env vars before importing SSLMonitor (through Register/Config).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Utils/OnlineCheck", () => {
  return {
    __esModule: true,
    default: {
      canProbeMonitorWebsiteMonitors: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import { AddressInfo } from "net";
import tls from "tls";
import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import SelfSignedCertificate from "./SslTestCertificates";

/*
 * An SSL Certificate Monitor pointed at an IPv6 literal.
 *
 * The URL form of an IPv6 host is bracketed — "https://[2001:db8::1]/" — and
 * Hostname.fromAuthority hands that host back WITH its brackets, because
 * brackets are part of a URL authority. https.get does not strip them: it
 * resolves "[2001:db8::1]" as a name and fails ENOTFOUND, so every IPv6 SSL
 * monitor died on a DNS error for an address that needs no DNS.
 *
 * A real TLS listener on the IPv6 loopback is used rather than a mock,
 * because the whole defect was in what Node does with the string.
 */

let tlsServer: tls.Server;
const openSockets: Array<tls.TLSSocket> = [];
let tlsPort: number = 0;
let ipv6Available: boolean = true;

beforeAll(async () => {
  tlsServer = tls.createServer(
    { key: SelfSignedCertificate.key, cert: SelfSignedCertificate.cert },
    (socket: tls.TLSSocket) => {
      openSockets.push(socket);
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    },
  );

  await new Promise<void>((resolve: () => void) => {
    tlsServer.once("error", () => {
      // A CI runner with IPv6 disabled entirely: skip rather than fail.
      ipv6Available = false;
      resolve();
    });
    tlsServer.listen(0, "::1", () => {
      tlsPort = (tlsServer.address() as AddressInfo).port;
      resolve();
    });
  });
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    if (!tlsServer.listening) {
      resolve();
      return;
    }

    /*
     * close() alone waits for sockets the monitor left half-open, which
     * outlives the hook's deadline.
     */
    for (const socket of openSockets) {
      socket.destroy();
    }
    tlsServer.close(() => {
      return resolve();
    });
  });
}, 30000);

describe("SSLMonitor with an IPv6 literal host", () => {
  test("reaches a listener on the IPv6 loopback instead of failing ENOTFOUND", async () => {
    if (!ipv6Available) {
      return;
    }

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[::1]:${tlsPort}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();

    /*
     * The assertion that pins the fix. Pre-fix the failure cause carried
     * "ENOTFOUND [::1]" — Node had been asked to resolve the brackets as
     * part of a hostname.
     */
    expect(response?.failureCause || "").not.toContain("ENOTFOUND");
    expect(response?.failureCause || "").not.toContain("[::1]");
  }, 30000);

  test("the certificate is actually read back over IPv6", async () => {
    if (!ipv6Available) {
      return;
    }

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[::1]:${tlsPort}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(true);
    expect(response?.isSelfSigned).toBe(true);
    expect(response?.expiresAt).toBeDefined();
  }, 30000);

  test("an IPv6 host with a non-default port still splits host from port", async () => {
    if (!ipv6Available) {
      return;
    }

    /*
     * The bracket-stripping must not undo the port split that
     * https://github.com/OneUptime/oneuptime/issues/3225 added: a monitor on
     * a non-443 port must not try to resolve a host named "[::1]:PORT".
     */
    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[::1]:${tlsPort}/some/path`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(true);
  }, 30000);
});
