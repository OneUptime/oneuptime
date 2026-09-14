// Set required env vars before importing anything that pulls Probe/Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import PortMonitor, {
  PortMonitorResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PortMonitor";
import IPv4 from "Common/Types/IP/IPv4";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import net from "net";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Where the SSRF egress guard does, and does not, sit.
 *
 * Since 78b19735bd every HTTP-capable monitor runs
 * DataSourceEgressGuard.assertUrlAllowed over the RESOLVED address before it
 * opens a socket (Probe/Utils/Monitors/HttpMonitorRequest.ts), and loopback is
 * refused in the always-blocked tier whatever a deployment's private-network
 * policy says. PortMonitor does not: it opens a TCP connection directly and
 * never consults the guard.
 *
 * This test pins that as the CURRENT boundary, deliberately and in one place,
 * rather than leaving it as an accident nobody has written down.
 *
 * It matters for two reasons:
 *
 *  1. E2E/Tests/Dashboard/ProbeExecution.spec.ts depends on it. That spec is
 *     the only end-to-end coverage of a probe claiming work, opening a socket
 *     and reporting the result, and it can only exist because a Port monitor
 *     may check the ingress this stack publishes on loopback.
 *  2. A Port check is a readback channel of its own. What it learns about the
 *     target — reachable or not, classified errno, connect timing — is
 *     persisted to MonitorProbe.lastMonitoringLog, which a project Viewer can
 *     read. That is a smaller surface than an HTTP response body, but it is
 *     not nothing.
 *
 * So this is a boundary marker, not an endorsement. If a future change puts
 * Port monitors behind the guard, that is a defensible thing to want — and it
 * should update THIS test and the E2E spec deliberately, rather than
 * discovering both as a mysterious red release gate.
 */

describe("PortMonitor egress boundary", () => {
  let server: net.Server;
  let port: number;

  beforeAll(async () => {
    server = net.createServer((socket: net.Socket): void => {
      socket.end();
    });

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close((): void => {
        resolve();
      });
    });
  });

  test("a Port check reaches a loopback listener, which an HTTP monitor could not", async () => {
    const response: PortMonitorResponse | null = await PortMonitor.ping(
      new IPv4("127.0.0.1"),
      new Port(port),
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response).not.toBeNull();
    expect(response?.isOnline).toBe(true);
  });

  test("a Port check reports a closed loopback port as offline rather than refusing it", async () => {
    /*
     * The distinction that makes the E2E refusal assertion meaningful: this is
     * what "could not connect" looks like, and it is NOT what a guard refusal
     * looks like. An HTTP monitor pointed at loopback never gets this far.
     */
    const closed: net.Server = net.createServer();

    await new Promise<void>((resolve: () => void) => {
      closed.listen(0, "127.0.0.1", resolve);
    });

    const closedPort: number = (closed.address() as net.AddressInfo).port;

    await new Promise<void>((resolve: () => void) => {
      closed.close((): void => {
        resolve();
      });
    });

    const response: PortMonitorResponse | null = await PortMonitor.ping(
      new IPv4("127.0.0.1"),
      new Port(closedPort),
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response).not.toBeNull();
    expect(response?.isOnline).toBe(false);
    expect(String(response?.failureCause)).not.toContain("is not allowed");
  });
});
