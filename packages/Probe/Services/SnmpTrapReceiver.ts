import {
  PROBE_INGEST_URL,
  PROBE_SNMP_ENGINE_ID,
  PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE,
  PROBE_SNMP_TRAP_RECEIVER_ENABLED,
  PROBE_SNMP_TRAP_RECEIVER_PORT,
} from "../Config";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import { toSnmpWalkRow } from "../Utils/Snmp/SnmpWalkRowFormatter";
import RecentInforms from "../Utils/Snmp/V3/RecentInforms";
import SnmpEngine, { ResolvedSnmpEngineId } from "../Utils/Snmp/V3/SnmpEngine";
import { isSnmpV3Message } from "../Utils/Snmp/V3/SnmpV3Message";
import SnmpV3NotificationProcessor, {
  SnmpV3Notification,
  SnmpV3Outcome,
} from "../Utils/Snmp/V3/SnmpV3NotificationProcessor";
import SnmpV3UserTable from "../Utils/Snmp/V3/SnmpV3UserTable";
import SnmpTrapRefusals from "../Utils/Snmp/V3/SnmpTrapRefusals";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrap, {
  SnmpTrapVarbind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";
// Repairs net-snmp's DES privacy on OpenSSL 3 — must load with net-snmp.
import "../Utils/Snmp/SnmpDesPrivacyCompat";
import snmp from "net-snmp";
import dgram from "dgram";

/*
 * THE PROBE'S SNMP TRAP RECEIVER: v1, v2c and v3 traps and informs.
 *
 * v1 and v2c go through net-snmp's receiver as they always have: any
 * community is taken (the trap is matched to a device by its source
 * address on the server), and a v2c inform is acknowledged.
 *
 * SNMPv3 never reaches net-snmp's receiver. Its one authorization switch
 * covers communities and v3 users alike, and with it off for communities -
 * as it must be, to take any community - it accepts a v3 message without
 * checking its digest; it also never checks the time window or that an
 * inform is addressed to it. So the sockets net-snmp creates (through the
 * dgramModule it lets the caller hand it) pass every SNMPv3 datagram to
 * the probe's own USM instead (Utils/Snmp/V3/SnmpV3NotificationProcessor),
 * which takes a trap only from a user of a device on this probe, with that
 * user's keys, inside the time window, and acknowledges an inform with a
 * Response signed and encrypted the way it came.
 *
 * The users are OneUptime's to hand: every thirty seconds the probe reports
 * this receiver - its engine ID, its users count, the traps it refused - and
 * is handed the SNMPv3 users of the devices assigned to it and the default
 * credential profiles of the sites whose Default Probe it is
 * (Jobs/SnmpTrap/SyncSnmpTrapReceiver), which replace the table at once,
 * while the receiver keeps listening. Until the first set arrives, SNMPv3
 * datagrams wait (a minute at most) rather than being refused as from an
 * unknown user. Each user comes with the records that hold it, which an
 * authenticated trap is forwarded with (SnmpTrap.signedBy): OneUptime keeps
 * the trap in a project whose own keys signed it, on the device that
 * carries them.
 *
 * A refused SNMPv3 trap is never forwarded and nothing it carried is logged
 * - only its source, user name and why - and it is counted for the probe's
 * page (SnmpTrapRefusals).
 */

/*
 * Standard SNMPv1 generic-trap numbers → SNMPv2 notification OIDs
 * (RFC 3584 section 3.1).
 */
const V1_GENERIC_TRAP_OIDS: Record<number, string> = {
  0: "1.3.6.1.6.3.1.1.5.1", // coldStart
  1: "1.3.6.1.6.3.1.1.5.2", // warmStart
  2: "1.3.6.1.6.3.1.1.5.3", // linkDown
  3: "1.3.6.1.6.3.1.1.5.4", // linkUp
  4: "1.3.6.1.6.3.1.1.5.5", // authenticationFailure
  5: "1.3.6.1.6.3.1.1.5.6", // egpNeighborLoss
};

const SNMP_TRAP_OID_VARBIND: string = "1.3.6.1.6.3.1.1.4.1.0";

/*
 * Bound each trap forward so a hung ingest cannot leave POSTs pending
 * indefinitely under a trap storm (same bound the NetFlow/syslog forwards
 * use).
 */
const FORWARD_REQUEST_TIMEOUT_MS: number = 30000;

// How long SNMPv3 datagrams wait for the first set of users, and how many.
export const USERS_LOAD_WAIT_MS: number = 60 * 1000;
export const MAX_DATAGRAMS_WAITING_FOR_USERS: number = 1000;

/*
 * The most SNMPv3 datagrams taken through authentication in one second. A
 * flood past it is dropped before any key is computed, so a sender that
 * knows one user name cannot turn the probe's CPU into a hash farm.
 */
export const MAX_SNMP_V3_DATAGRAMS_PER_SECOND: number = 2000;

// How many users have their keys derived in one turn of the event loop.
const KEY_DERIVATIONS_PER_TURN: number = 2;

type SnmpTransport = "udp4" | "udp6";

export interface SnmpTrapListenerSettings {
  port: number;
  // The address to listen on; every address when absent.
  address?: string | undefined;
  transports: Array<SnmpTransport>;
  engineId: Buffer;
  rateLimitPerMinute: number;
  // Where a trap goes once taken: OneUptime's /probe/snmp-trap, or a test.
  forward: (trap: SnmpTrap) => Promise<void>;
  now?: (() => number) | undefined;
  usersLoadWaitMs?: number | undefined;
}

interface WaitingDatagram {
  socket: dgram.Socket;
  buffer: Buffer;
  rinfo: dgram.RemoteInfo;
}

type MessageListener = (buffer: Buffer, rinfo: dgram.RemoteInfo) => void;

/*
 * One receiver: net-snmp's v1/v2c receivers (one per transport) and the
 * SNMPv3 path in front of them, on the same sockets.
 */
export class SnmpTrapListener {
  private readonly settings: SnmpTrapListenerSettings;
  private readonly now: () => number;
  private readonly users: SnmpV3UserTable = new SnmpV3UserTable();
  private readonly processor: SnmpV3NotificationProcessor;
  private readonly refusals: SnmpTrapRefusals = new SnmpTrapRefusals();
  private readonly recentInforms: RecentInforms = new RecentInforms();
  private readonly receivers: Array<{ close: () => void }> = [];
  private readonly sockets: Array<dgram.Socket> = [];
  private waitingForUsers: Array<WaitingDatagram> = [];
  private hasStoppedWaitingForUsers: boolean = false;
  private usersWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private listenError: string | undefined = undefined;
  private lastReceivedAtMs: number | undefined = undefined;
  private forwardedThisMinute: number = 0;
  private droppedThisMinute: number = 0;
  private minuteWindowStartedAt: number = 0;
  private v3ThisSecond: number = 0;
  private v3DroppedThisSecond: number = 0;
  private secondWindowStartedAt: number = 0;
  private isWarmingUp: boolean = false;

  public constructor(settings: SnmpTrapListenerSettings) {
    this.settings = settings;
    this.now = settings.now || Date.now;
    this.processor = new SnmpV3NotificationProcessor({
      engineId: settings.engineId,
      users: this.users,
      now: this.now,
    });
  }

  public start(): void {
    for (const transport of this.settings.transports) {
      this.startReceiver(transport);
    }

    this.usersWaitTimer = setTimeout(() => {
      this.stopWaitingForUsers();
    }, this.settings.usersLoadWaitMs ?? USERS_LOAD_WAIT_MS);
    this.usersWaitTimer.unref?.();
  }

  public stop(): Promise<void> {
    if (this.usersWaitTimer) {
      clearTimeout(this.usersWaitTimer);
      this.usersWaitTimer = null;
    }

    for (const receiver of this.receivers) {
      try {
        receiver.close();
      } catch {
        // A socket that never bound has nothing to close.
      }
    }

    this.receivers.length = 0;
    this.sockets.length = 0;

    return Promise.resolve();
  }

  /*
   * The SNMPv3 users this receiver accepts from now on, replacing the ones
   * it had. The first set also lets go of the datagrams waiting for it.
   */
  public setUsers(users: Array<SnmpTrapReceiverUser>): void {
    this.users.replace(users);
    this.warmUpKeys();
    this.stopWaitingForUsers();
  }

  public getEngineId(): Buffer {
    return this.processor.getEngineId();
  }

  public getUserCount(): number {
    return this.users.getUserCount();
  }

  public getReport(): SnmpTrapReceiverReport {
    const report: SnmpTrapReceiverReport = {
      isEnabled: true,
      port: this.settings.port,
      engineId: SnmpEngine.toHex(this.processor.getEngineId()),
      userCount: this.users.getUserCount(),
      refusals: this.refusals.list(this.now()),
    };

    if (this.listenError) {
      report.listenError = this.listenError;
    }

    if (this.lastReceivedAtMs !== undefined) {
      // To the minute: the report changes - and is written - at most once a minute for it.
      report.lastReceivedAt = new Date(
        Math.floor(this.lastReceivedAtMs / 60000) * 60000,
      ).toISOString();
    }

    return report;
  }

  // Where the receiver listens, once bound: what a test sends to.
  public getBoundPorts(): Array<number> {
    const ports: Array<number> = [];

    for (const socket of this.sockets) {
      try {
        ports.push(socket.address().port);
      } catch {
        // Not bound (yet, or at all).
      }
    }

    return ports;
  }

  private startReceiver(transport: SnmpTransport): void {
    let hasLoggedBindFailure: boolean = false;
    const port: number = this.settings.port;

    try {
      const receiver: { close: () => void } = snmp.createReceiver(
        {
          port: port,
          ...(this.settings.address ? { address: this.settings.address } : {}),
          disableAuthorization: true, // any community for v1/v2c; v3 never gets here
          includeAuthentication: true, // surface the community string
          transport: transport,
          /*
           * net-snmp creates its sockets with this, so it is where SNMPv3
           * datagrams are taken off to the probe's own USM. For udp6 the
           * socket is v6-only: on Linux a dual-stack [::] bind collides
           * (EADDRINUSE) with the udp4 receiver already on 0.0.0.0.
           */
          dgramModule: {
            createSocket: (type: dgram.SocketType): dgram.Socket => {
              return this.divertSnmpV3(
                dgram.createSocket({
                  type: type,
                  ipv6Only: type === "udp6",
                }),
              );
            },
          },
        },
        (error: Error | null, notification: JSONObject | null) => {
          if (error) {
            const errorCode: string | undefined = (
              error as NodeJS.ErrnoException
            ).code;

            /*
             * Socket-level bind failures (no privilege for ports < 1024
             * outside Docker, the port is taken, or — for udp6 — the host
             * has no IPv6) arrive through this callback. Say clearly —
             * once — what is off and how to fix it; polling is unaffected
             * either way.
             */
            if (
              errorCode === "EACCES" ||
              errorCode === "EADDRINUSE" ||
              errorCode === "EAFNOSUPPORT" ||
              errorCode === "EADDRNOTAVAIL"
            ) {
              if (!hasLoggedBindFailure) {
                hasLoggedBindFailure = true;

                if (transport === "udp6") {
                  logger.warn(
                    `SNMP trap receiver could not bind udp6 port ${port} (${errorCode}); ` +
                      `this host may not have IPv6. IPv6 traps will not be received; IPv4 reception is unaffected.`,
                  );
                } else {
                  this.listenError = errorCode;
                  logger.error(
                    `SNMP trap receiver could not bind UDP port ${port} (${errorCode}). ` +
                      `Traps will not be received; monitoring checks are unaffected. ` +
                      `Fix: run the probe with privileges for low ports, or set PROBE_SNMP_TRAP_RECEIVER_PORT to a port above 1024, ` +
                      `or set PROBE_SNMP_TRAP_RECEIVER_ENABLED=false to silence this.`,
                  );
                }
              }
              return;
            }

            /*
             * Per-message parse failures are routine on an open UDP port
             * (scanners, malformed agents) — log and keep listening.
             */
            logger.debug(
              `SNMP trap receiver message error (${transport}): ${error}`,
            );
            return;
          }

          if (!notification) {
            return;
          }

          this.handleCommunityNotification(notification).catch((err: Error) => {
            logger.error(`SNMP trap forward failed: ${err}`);
          });
        },
      ) as unknown as { close: () => void };

      this.receivers.push(receiver);

      // Bind completes asynchronously; failures surface via the callback.
      logger.info(`SNMP trap receiver starting on ${transport} port ${port}`);
    } catch (err) {
      /*
       * Binding can fail (port in use, no privilege for ports < 1024, no
       * IPv6 on the host). The probe's polling duties are unaffected —
       * log and move on; a udp6 failure still leaves udp4 receiving.
       */
      if (transport === "udp6") {
        logger.warn(
          `Could not start SNMP trap receiver on udp6 port ${port}: ${err}. Continuing with IPv4 only.`,
        );
        return;
      }

      logger.error(
        `Could not start SNMP trap receiver on port ${port}: ${err}`,
      );
    }
  }

  /*
   * The socket net-snmp listens on, with every SNMPv3 datagram taken off to
   * the probe's own USM before net-snmp's handler sees it. Everything else
   * - v1, v2c, and what is not SNMP at all - goes on to net-snmp as before.
   */
  private divertSnmpV3(socket: dgram.Socket): dgram.Socket {
    this.sockets.push(socket);

    const addListener: (
      event: string,
      listener: (...args: Array<never>) => void,
    ) => dgram.Socket = socket.on.bind(socket) as unknown as (
      event: string,
      listener: (...args: Array<never>) => void,
    ) => dgram.Socket;

    const on: (
      event: string,
      listener: (...args: Array<never>) => void,
    ) => dgram.Socket = (
      event: string,
      listener: (...args: Array<never>) => void,
    ): dgram.Socket => {
      if (event !== "message") {
        return addListener(event, listener);
      }

      const netSnmpListener: MessageListener =
        listener as unknown as MessageListener;

      return addListener("message", ((
        buffer: Buffer,
        rinfo: dgram.RemoteInfo,
      ): void => {
        if (isSnmpV3Message(buffer)) {
          this.handleSnmpV3Datagram(socket, buffer, rinfo);
          return;
        }

        netSnmpListener(buffer, rinfo);
      }) as (...args: Array<never>) => void);
    };

    (socket as unknown as { on: typeof on }).on = on;

    return socket;
  }

  private handleSnmpV3Datagram(
    socket: dgram.Socket,
    buffer: Buffer,
    rinfo: dgram.RemoteInfo,
  ): void {
    if (!this.users.isLoaded() && !this.hasStoppedWaitingForUsers) {
      if (this.waitingForUsers.length < MAX_DATAGRAMS_WAITING_FOR_USERS) {
        this.waitingForUsers.push({
          socket: socket,
          buffer: buffer,
          rinfo: rinfo,
        });
      }
      return;
    }

    if (!this.takeSnmpV3Slot()) {
      return;
    }

    let outcome: SnmpV3Outcome;

    try {
      outcome = this.processor.process(buffer, rinfo.address);
    } catch (err) {
      // Never a crash from a datagram: say what kind of failure, not what it carried.
      logger.debug(
        `SNMPv3 datagram from ${rinfo.address} could not be processed: ${(err as Error).name}`,
      );
      return;
    }

    if ("reply" in outcome && outcome.reply) {
      this.reply(socket, outcome.reply, rinfo);
    }

    switch (outcome.kind) {
      case "accepted":
        this.onSnmpV3Accepted(outcome.notification, rinfo);
        return;
      case "refused":
        this.onSnmpV3Refused({
          sourceAddress: rinfo.address,
          reason: outcome.reason,
          userName: outcome.userName,
        });
        return;
      case "discovery":
        return;
      case "ignored":
        logger.debug(
          `SNMPv3 datagram from ${rinfo.address} ignored: ${outcome.why}`,
        );
        return;
    }
  }

  private onSnmpV3Accepted(
    notification: SnmpV3Notification,
    rinfo: dgram.RemoteInfo,
  ): void {
    this.lastReceivedAtMs = this.now();
    this.refusals.clear(rinfo.address, notification.userName);

    const trap: SnmpTrap | null = SnmpTrapReceiver.toSnmpV3Trap(
      notification,
      rinfo.address,
    );

    if (!trap) {
      return;
    }

    if (
      notification.isInform &&
      !this.recentInforms.isFirstSeen({
        sender: `${rinfo.address}|3|${notification.userName}`,
        requestId: notification.requestId,
        varbinds: JSON.stringify(trap.varbinds),
        nowMs: this.now(),
      })
    ) {
      return;
    }

    this.forward(trap);
  }

  private onSnmpV3Refused(data: {
    sourceAddress: string;
    reason: SnmpTrapRefusalReason;
    userName: string;
  }): void {
    const isFirst: boolean = this.refusals.record({
      sourceAddress: data.sourceAddress,
      reason: data.reason,
      userName: data.userName,
      atMs: this.now(),
    });

    // Only that it was refused, from where, as whom and why - never what it carried.
    const line: string = `Refused an SNMPv3 trap from ${data.sourceAddress} (user "${data.userName}"): ${data.reason}.`;

    if (isFirst) {
      logger.warn(
        `${line} Further ones like it are counted on this probe's page in OneUptime.`,
      );
    } else {
      logger.debug(line);
    }
  }

  private async handleCommunityNotification(
    notification: JSONObject,
  ): Promise<void> {
    const pdu: JSONObject | undefined = notification["pdu"] as
      | JSONObject
      | undefined;

    /*
     * Belt and braces: an SNMPv3 message never reaches net-snmp's handler
     * (divertSnmpV3), and if one ever did, it would have skipped every
     * check - so it is dropped, never forwarded.
     */
    if (pdu && "user" in pdu) {
      return;
    }

    const trap: SnmpTrap | null =
      SnmpTrapReceiver.parseNotification(notification);

    if (!trap) {
      return;
    }

    this.lastReceivedAtMs = this.now();

    if (
      trap.isInform &&
      !this.recentInforms.isFirstSeen({
        sender: `${trap.sourceIpAddress}|${trap.snmpVersion}|${trap.community || ""}`,
        requestId: Number(pdu?.["id"] ?? 0),
        varbinds: JSON.stringify(trap.varbinds),
        nowMs: this.now(),
      })
    ) {
      return;
    }

    this.forward(trap);
  }

  private forward(trap: SnmpTrap): void {
    if (!this.consumeRateLimitSlot()) {
      return;
    }

    logger.debug(
      `SNMP trap received from ${trap.sourceIpAddress}: ${trap.trapOid}`,
    );

    this.settings.forward(trap).catch((err: Error) => {
      logger.error(`SNMP trap forward failed: ${err}`);
    });
  }

  private reply(
    socket: dgram.Socket,
    reply: Buffer,
    rinfo: dgram.RemoteInfo,
  ): void {
    try {
      socket.send(reply, rinfo.port, rinfo.address, (err: Error | null) => {
        if (err) {
          logger.debug(
            `Could not answer the SNMPv3 message from ${rinfo.address}: ${err.message}`,
          );
        }
      });
    } catch (err) {
      logger.debug(
        `Could not answer the SNMPv3 message from ${rinfo.address}: ${(err as Error).message}`,
      );
    }
  }

  private stopWaitingForUsers(): void {
    if (this.usersWaitTimer) {
      clearTimeout(this.usersWaitTimer);
      this.usersWaitTimer = null;
    }

    this.hasStoppedWaitingForUsers = true;

    const waiting: Array<WaitingDatagram> = this.waitingForUsers;
    this.waitingForUsers = [];

    for (const datagram of waiting) {
      this.handleSnmpV3Datagram(
        datagram.socket,
        datagram.buffer,
        datagram.rinfo,
      );
    }
  }

  /*
   * Derives the users' slow keys a couple at a time, between datagrams, so
   * the first trap from each does not wait for them and no turn of the event
   * loop is held for long.
   */
  private warmUpKeys(): void {
    if (this.isWarmingUp) {
      return;
    }

    this.isWarmingUp = true;

    const step: () => void = (): void => {
      let left: number = 0;

      try {
        left = this.users.warmUp(KEY_DERIVATIONS_PER_TURN);
      } catch {
        left = 0;
      }

      if (left > 0) {
        setImmediate(step);
        return;
      }

      this.isWarmingUp = false;
    };

    setImmediate(step);
  }

  private takeSnmpV3Slot(): boolean {
    const now: number = this.now();

    if (now - this.secondWindowStartedAt >= 1000) {
      if (this.v3DroppedThisSecond > 0) {
        logger.warn(
          `SNMP trap receiver dropped ${this.v3DroppedThisSecond} SNMPv3 datagrams in one second, past ${MAX_SNMP_V3_DATAGRAMS_PER_SECOND} a second.`,
        );
      }

      this.secondWindowStartedAt = now;
      this.v3ThisSecond = 0;
      this.v3DroppedThisSecond = 0;
    }

    if (this.v3ThisSecond >= MAX_SNMP_V3_DATAGRAMS_PER_SECOND) {
      this.v3DroppedThisSecond++;
      return false;
    }

    this.v3ThisSecond++;
    return true;
  }

  private consumeRateLimitSlot(): boolean {
    const now: number = this.now();

    if (now - this.minuteWindowStartedAt >= 60000) {
      if (this.droppedThisMinute > 0) {
        logger.warn(
          `SNMP trap receiver dropped ${this.droppedThisMinute} traps in the last minute (rate limit: ${this.settings.rateLimitPerMinute}/min)`,
        );
      }
      this.minuteWindowStartedAt = now;
      this.forwardedThisMinute = 0;
      this.droppedThisMinute = 0;
    }

    if (this.forwardedThisMinute >= this.settings.rateLimitPerMinute) {
      this.droppedThisMinute++;
      return false;
    }

    this.forwardedThisMinute++;
    return true;
  }
}

export default class SnmpTrapReceiver {
  private static listener: SnmpTrapListener | null = null;
  private static engine: ResolvedSnmpEngineId | null = null;

  public static start(): void {
    if (!PROBE_SNMP_TRAP_RECEIVER_ENABLED) {
      logger.debug(
        "SNMP trap receiver is disabled (PROBE_SNMP_TRAP_RECEIVER_ENABLED=false).",
      );
      return;
    }

    const engine: ResolvedSnmpEngineId = SnmpTrapReceiver.getEngine();

    SnmpTrapReceiver.listener = new SnmpTrapListener({
      port: PROBE_SNMP_TRAP_RECEIVER_PORT,
      /*
       * IPv4 is the primary; IPv6 best effort. net-snmp supports one
       * transport per receiver, so dual-stack reception is a second
       * receiver on the same port; a host without IPv6 fails its bind,
       * which is logged as a warning and leaves IPv4 unaffected.
       */
      transports: ["udp4", "udp6"],
      engineId: engine.engineId,
      rateLimitPerMinute: PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE,
      forward: SnmpTrapReceiver.forwardToOneUptime,
    });

    SnmpTrapReceiver.listener.start();

    logger.info(
      `SNMP trap receiver SNMPv3 engine ID: ${SnmpEngine.toHex(engine.engineId)} (${
        engine.source === "configured"
          ? "PROBE_SNMP_ENGINE_ID"
          : engine.source === "probe"
            ? "derived from this probe's ID"
            : "random: this probe has no ID yet, so it changes at the next start"
      })`,
    );
  }

  /*
   * What the receiver is, for OneUptime: off, or its port, engine ID, users
   * and refusals. Read every thirty seconds (SyncSnmpTrapReceiver).
   */
  public static getReport(): SnmpTrapReceiverReport {
    if (!PROBE_SNMP_TRAP_RECEIVER_ENABLED || !SnmpTrapReceiver.listener) {
      return { isEnabled: false, refusals: [] };
    }

    return SnmpTrapReceiver.listener.getReport();
  }

  public static setUsers(users: Array<SnmpTrapReceiverUser>): void {
    SnmpTrapReceiver.listener?.setUsers(users);
  }

  public static isRunning(): boolean {
    return SnmpTrapReceiver.listener !== null;
  }

  // The probe's SNMPv3 engine ID: resolved once, and said once if PROBE_SNMP_ENGINE_ID is not one.
  public static getEngine(): ResolvedSnmpEngineId {
    if (!SnmpTrapReceiver.engine) {
      SnmpTrapReceiver.engine = SnmpEngine.resolveEngineId({
        configured: PROBE_SNMP_ENGINE_ID,
        probeId: LocalCache.getString("PROBE", "PROBE_ID"),
      });

      if (SnmpTrapReceiver.engine.configuredValueIsInvalid) {
        logger.error(
          "PROBE_SNMP_ENGINE_ID is not an SNMP engine ID: it must be 5 to 32 octets of hex, not all zeros or all FF. The engine ID derived from this probe's ID is used instead.",
        );
      }
    }

    return SnmpTrapReceiver.engine;
  }

  private static async forwardToOneUptime(trap: SnmpTrap): Promise<void> {
    /*
     * Build the URL from a fresh copy of PROBE_INGEST_URL — Route.addRoute
     * mutates in place, so calling it on the shared global would permanently
     * append "/probe/snmp-trap" to the base URL used by every probe request.
     */
    const ingestUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
      "/probe/snmp-trap",
    );

    await API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: ingestUrl,
      data: {
        ...ProbeAPIRequest.getDefaultRequestBody(),
        snmpTrap: trap as unknown as JSONObject,
      },
      options: ProbeAPIRequest.getDefaultRequestOptions(ingestUrl, {
        timeout: FORWARD_REQUEST_TIMEOUT_MS,
      }),
    });
  }

  public static parseNotification(notification: JSONObject): SnmpTrap | null {
    const pdu: JSONObject | undefined = notification["pdu"] as
      | JSONObject
      | undefined;
    const rinfo: JSONObject | undefined = notification["rinfo"] as
      | JSONObject
      | undefined;

    if (!pdu || !rinfo || !rinfo["address"]) {
      return null;
    }

    const rawVarbinds: Array<JSONObject> =
      (pdu["varbinds"] as Array<JSONObject>) || [];

    const varbinds: Array<SnmpTrapVarbind> = rawVarbinds.map(
      (varbind: JSONObject) => {
        return {
          oid: String(varbind["oid"] || ""),
          value: SnmpTrapReceiver.renderVarbindValue(
            varbind["type"],
            varbind["value"],
          ),
        };
      },
    );

    let trapOid: string | undefined = undefined;
    let snmpVersion: string = "2c";

    const trapOidVarbind: SnmpTrapVarbind | undefined = varbinds.find(
      (varbind: SnmpTrapVarbind) => {
        return varbind.oid === SNMP_TRAP_OID_VARBIND;
      },
    );

    if (trapOidVarbind) {
      trapOid = trapOidVarbind.value;
    } else if (pdu["enterprise"]) {
      // SNMPv1 trap PDU: map generic/specific to a v2 notification OID.
      snmpVersion = "1";
      const genericTrap: number = Number(pdu["generic"] ?? -1);
      trapOid =
        V1_GENERIC_TRAP_OIDS[genericTrap] ||
        `${String(pdu["enterprise"])}.0.${Number(pdu["specific"] ?? 0)}`;
    }

    if (!trapOid) {
      return null;
    }

    const trap: SnmpTrap = {
      sourceIpAddress: String(rinfo["address"]),
      trapOid: trapOid,
      snmpVersion: snmpVersion,
      community: pdu["community"] ? String(pdu["community"]) : undefined,
      receivedAt: new Date(),
      varbinds: varbinds,
    };

    if (pdu["type"] === snmp.PduType.InformRequest) {
      trap.isInform = true;
    }

    return trap;
  }

  /*
   * An authenticated SNMPv3 notification as the trap OneUptime stores: the
   * same shape as a v2c one, with the user it came as and how instead of a
   * community. Null when nothing names the trap (no snmpTrapOID.0).
   */
  public static toSnmpV3Trap(
    notification: SnmpV3Notification,
    sourceAddress: string,
  ): SnmpTrap | null {
    const varbinds: Array<SnmpTrapVarbind> = notification.varbinds.map(
      (varbind: { oid: string; type: number; value: unknown }) => {
        return {
          oid: varbind.oid,
          value: SnmpTrapReceiver.renderVarbindValue(
            varbind.type,
            varbind.value,
          ),
        };
      },
    );

    const trapOid: string | undefined = varbinds.find(
      (varbind: SnmpTrapVarbind) => {
        return varbind.oid === SNMP_TRAP_OID_VARBIND;
      },
    )?.value;

    if (!trapOid) {
      return null;
    }

    const engineId: Buffer = notification.senderEngineId;

    const trap: SnmpTrap = {
      sourceIpAddress: sourceAddress,
      trapOid: trapOid,
      snmpVersion: "3",
      receivedAt: new Date(),
      varbinds: varbinds,
      isInform: notification.isInform,
      securityName: notification.userName,
      securityLevel: notification.securityLevel,
    };

    if (engineId.length > 0) {
      trap.engineId = SnmpEngine.toHex(engineId);
    }

    if (notification.contextName) {
      trap.contextName = notification.contextName;
    }

    /*
     * Which records hold the credential that authenticated it, as OneUptime
     * handed them over (#11172, #11174): which project may keep the trap,
     * and which of the devices at its address sent it.
     */
    if (notification.signedBy) {
      trap.signedBy = notification.signedBy;
    }

    return trap;
  }

  /*
   * A varbind's value as text, the way an SNMP walk shows it
   * (SnmpWalkRowFormatter): a Counter64 in full, an OCTET STRING as text
   * when it is text and as hex when it is not (a MAC address), an Opaque as
   * hex. net-snmp hands a Counter64, an Opaque and every OCTET STRING over as
   * octets, which used to be printed as UTF-8 here - garbage for all but
   * text. A value without a known type is printed as before.
   */
  public static renderVarbindValue(type: unknown, value: unknown): string {
    if (typeof type === "number" && snmp.ObjectType[type] !== undefined) {
      const rendered: string | number | null = toSnmpWalkRow({
        oid: "",
        type: type as snmp.ObjectType,
        value: value as snmp.Varbind["value"],
      }).value;

      return rendered === null || rendered === undefined
        ? ""
        : String(rendered);
    }

    if (value === null || value === undefined) {
      return "";
    }

    if (Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    return String(value);
  }
}
