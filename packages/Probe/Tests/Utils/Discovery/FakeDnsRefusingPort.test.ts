// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { classifyReverseDnsLookupError } from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  RefusingUdpPort,
  startRefusingUdpPort,
} from "../../TestingUtils/FakeDnsServer";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import { describe, expect, it } from "@jest/globals";
import dgram from "dgram";
import dns from "dns";
import { AddressInfo } from "net";

/*
 * The "nothing listening" nameserver the real-resolver suites of #3916 point
 * the probe at, and why it is a port HELD by a socket connected to itself
 * rather than a port bound and closed again.
 *
 * Probe Test failed on 2026-09-27 (a pull request) and 2026-10-05 (master),
 * each time with exactly one host behind a refused nameserver filed as
 * "no-record" instead of "unreachable" — once with no other server
 * configured at all, so no fallback order could have produced it. The refused nameserver was a closed
 * ephemeral port, and a closed port is a free one: the kernel picks the local
 * port of every socket that connects without binding first — every c-ares
 * query socket — at random from the free ephemeral ports, and now and then
 * (about one lookup in 28,000) it picked that very port. The first two tests
 * below are the two halves of what followed, built deterministically; the
 * last two pin the fixture that rules it out.
 */

function bind(
  socket: dgram.Socket,
  port: number,
  address: string,
): Promise<void> {
  return new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      socket.once("error", reject);
      socket.bind(port, address, () => {
        socket.off("error", reject);
        resolve();
      });
    },
  );
}

function close(socket: dgram.Socket): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    socket.close(() => {
      resolve();
    });
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("expected the lookup to reject");
}

describe("the refusing nameserver the real-resolver suites ask", () => {
  it("the hazard, in the kernel: a socket connected to a loopback port FROM that port hears its own datagrams", async () => {
    /*
     * Bound explicitly here; the kernel's random choice of a free port does
     * the same to a c-ares socket asking a closed port.
     */
    const socket: dgram.Socket = dgram.createSocket("udp4");

    try {
      await bind(socket, 0, "127.0.0.1");
      const port: number = (socket.address() as AddressInfo).port;

      await new Promise<void>((resolve: () => void) => {
        socket.connect(port, "127.0.0.1", () => {
          resolve();
        });
      });

      const received: Promise<dgram.RemoteInfo> = new Promise<dgram.RemoteInfo>(
        (resolve: (remote: dgram.RemoteInfo) => void) => {
          socket.once(
            "message",
            (_message: Buffer, remote: dgram.RemoteInfo) => {
              resolve(remote);
            },
          );
        },
      );

      socket.send(Buffer.from("a PTR query"));

      expect((await received).port).toBe(port);
    } finally {
      await close(socket);
    }
  });

  it("the hazard, in c-ares: its own query sent straight back reads as NOERROR with no answers — ENODATA, filed as 'no PTR record'", async () => {
    /*
     * A server that returns every datagram unchanged: what a query socket
     * connected to itself receives. c-ares does not check that a reply is a
     * response, Node asks without EDNS (so without a cookie to tell them
     * apart), and the question matches — so it is taken as the answer. If
     * this ever starts failing with ETIMEOUT, c-ares has begun dropping its
     * own queries; a self-connected socket would then read as a timeout,
     * which is still not the refusal these suites set up, so the port stays
     * held either way.
     */
    const mirror: dgram.Socket = dgram.createSocket("udp4");

    mirror.on("message", (message: Buffer, remote: dgram.RemoteInfo) => {
      mirror.send(message, remote.port, remote.address);
    });

    try {
      await bind(mirror, 0, "127.0.0.1");

      const resolver: dns.promises.Resolver = new dns.promises.Resolver({
        timeout: 2000,
        tries: 1,
      });
      resolver.setServers([
        `127.0.0.1:${(mirror.address() as AddressInfo).port}`,
      ]);

      const error: unknown = await rejectionOf(
        resolver.resolvePtr("51.42.16.10.in-addr.arpa"),
      );

      expect(error).toMatchObject({ code: "ENODATA" });
      expect(classifyReverseDnsLookupError(error).status).toBe(
        DiscoveredHostReverseDnsStatus.NoRecord,
      );
    } finally {
      await close(mirror);
    }
  });

  it("holds its port until closed, so no other socket can be handed it", async () => {
    /*
     * A socket that connects without binding is given a port the kernel
     * finds free against exactly this check, on the wildcard address — so
     * a port nobody can bind is a port no c-ares socket can connect from,
     * and no fake server another suite starts can be listening on.
     */
    const refusing: RefusingUdpPort = await startRefusingUdpPort();

    try {
      for (const address of ["127.0.0.1", "0.0.0.0"]) {
        const intruder: dgram.Socket = dgram.createSocket("udp4");

        try {
          await expect(
            bind(intruder, refusing.port, address),
          ).rejects.toMatchObject({ code: "EADDRINUSE" });
        } finally {
          intruder.close();
        }
      }
    } finally {
      await refusing.close();
    }
  });

  it("refuses every query, as a closed port does: ECONNREFUSED through the resolver the probe uses", async () => {
    const refusing: RefusingUdpPort = await startRefusingUdpPort();

    try {
      const codes: Array<unknown> = await Promise.all(
        Array.from(
          { length: 64 },
          async (_unused: unknown, index: number): Promise<unknown> => {
            // A fresh resolver per lookup, as the probe's lookups use.
            const resolver: dns.promises.Resolver = new dns.promises.Resolver({
              timeout: 2000,
              tries: 1,
            });
            resolver.setServers([refusing.address]);

            const error: unknown = await rejectionOf(
              resolver.resolvePtr(`${index + 1}.42.16.10.in-addr.arpa`),
            );

            return (error as { code?: unknown }).code;
          },
        ),
      );

      expect([...new Set(codes)]).toEqual(["ECONNREFUSED"]);
    } finally {
      await refusing.close();
    }
  });
});
