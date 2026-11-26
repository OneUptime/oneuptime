import { SnmpTrapListener } from "../../Services/SnmpTrapReceiver";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import { SnmpTrapReceiverUser } from "Common/Types/Probe/SnmpTrapReceiver";
import dgram from "dgram";

/*
 * A real SNMP trap listener on a loopback port of its own, for tests that
 * send it real datagrams: what it forwards is kept instead of being posted
 * to OneUptime.
 */

export const HARNESS_ENGINE_ID: Buffer = Buffer.from(
  "8000B98380A1B2C3D4E5F60718293A4B",
  "hex",
);

export interface SnmpTrapListenerHarness {
  listener: SnmpTrapListener;
  port: number;
  forwarded: Array<SnmpTrap>;
  // Resolves once at least `count` traps were forwarded, or after timeoutMs.
  waitForForwarded: (count: number, timeoutMs?: number) => Promise<void>;
  // Lets a datagram that should NOT be forwarded have its chance to be.
  settle: (ms?: number) => Promise<void>;
  stop: () => Promise<void>;
}

export function findFreeUdpPort(): Promise<number> {
  return new Promise(
    (resolve: (port: number) => void, reject: (error: Error) => void) => {
      const socket: dgram.Socket = dgram.createSocket("udp4");

      socket.once("error", (error: Error) => {
        reject(error);
      });

      socket.bind(0, "127.0.0.1", () => {
        const port: number = socket.address().port;
        socket.close(() => {
          resolve(port);
        });
      });
    },
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

export async function startSnmpTrapListenerHarness(options?: {
  users?: Array<SnmpTrapReceiverUser> | undefined;
  engineId?: Buffer | undefined;
  now?: (() => number) | undefined;
  rateLimitPerMinute?: number | undefined;
  usersLoadWaitMs?: number | undefined;
}): Promise<SnmpTrapListenerHarness> {
  const port: number = await findFreeUdpPort();
  const forwarded: Array<SnmpTrap> = [];
  const waiters: Array<() => void> = [];

  const listener: SnmpTrapListener = new SnmpTrapListener({
    port: port,
    address: "127.0.0.1",
    transports: ["udp4"],
    engineId: options?.engineId || HARNESS_ENGINE_ID,
    rateLimitPerMinute: options?.rateLimitPerMinute ?? 100000,
    now: options?.now,
    usersLoadWaitMs: options?.usersLoadWaitMs,
    forward: (trap: SnmpTrap): Promise<void> => {
      forwarded.push(trap);

      for (const waiter of waiters.splice(0)) {
        waiter();
      }

      return Promise.resolve();
    },
  });

  listener.start();

  if (options?.users) {
    listener.setUsers(options.users);
  }

  // The socket binds asynchronously.
  for (let attempt: number = 0; attempt < 50; attempt++) {
    if (listener.getBoundPorts().length > 0) {
      break;
    }

    await sleep(20);
  }

  return {
    listener: listener,
    port: port,
    forwarded: forwarded,
    waitForForwarded: async (
      count: number,
      timeoutMs: number = 5000,
    ): Promise<void> => {
      const deadline: number = Date.now() + timeoutMs;

      while (forwarded.length < count && Date.now() < deadline) {
        await new Promise<void>((resolve: () => void) => {
          const timer: ReturnType<typeof setTimeout> = setTimeout(
            resolve,
            Math.max(1, deadline - Date.now()),
          );
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
    settle: (ms: number = 300): Promise<void> => {
      return sleep(ms);
    },
    stop: (): Promise<void> => {
      return listener.stop();
    },
  };
}
