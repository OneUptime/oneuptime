import {
  PROBE_INGEST_URL,
  PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE,
  PROBE_SNMP_TRAP_RECEIVER_ENABLED,
  PROBE_SNMP_TRAP_RECEIVER_PORT,
} from "../Config";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import ProxyConfig from "../Utils/ProxyConfig";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrap, {
  SnmpTrapVarbind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
// Repairs net-snmp's DES privacy on OpenSSL 3 — must load with net-snmp.
import "../Utils/Snmp/SnmpDesPrivacyCompat";
import snmp from "net-snmp";
import dgram from "dgram";

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

export default class SnmpTrapReceiver {
  private static forwardedThisMinute: number = 0;
  private static minuteWindowStartedAt: number = 0;
  private static droppedThisMinute: number = 0;

  public static start(): void {
    if (!PROBE_SNMP_TRAP_RECEIVER_ENABLED) {
      logger.debug(
        "SNMP trap receiver is disabled (PROBE_SNMP_TRAP_RECEIVER_ENABLED=false).",
      );
      return;
    }

    // IPv4 receiver — the primary; bind failures are loud errors.
    SnmpTrapReceiver.startReceiver("udp4");

    /*
     * IPv6 receiver — best effort. net-snmp supports one transport per
     * receiver instance, so dual-stack reception means a second receiver
     * on the same port. A host without IPv6 fails this bind; that is
     * logged as a warning and IPv4 reception continues unaffected.
     */
    SnmpTrapReceiver.startReceiver("udp6");
  }

  private static startReceiver(transport: "udp4" | "udp6"): void {
    let hasLoggedBindFailure: boolean = false;

    try {
      snmp.createReceiver(
        {
          port: PROBE_SNMP_TRAP_RECEIVER_PORT,
          disableAuthorization: true, // accept any community for v1/v2c
          includeAuthentication: true, // surface the community string
          transport: transport,
          /*
           * net-snmp creates its sockets with dgram.createSocket(transport),
           * which for udp6 binds the wildcard address dual-stack. On Linux a
           * dual-stack [::] bind collides (EADDRINUSE) with the udp4
           * receiver already bound to 0.0.0.0 on the same port, so inject a
           * dgram module that makes the udp6 socket v6-only.
           */
          dgramModule: {
            createSocket: (type: dgram.SocketType): dgram.Socket => {
              return dgram.createSocket({
                type: type,
                ipv6Only: type === "udp6",
              });
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
                    `SNMP trap receiver could not bind udp6 port ${PROBE_SNMP_TRAP_RECEIVER_PORT} (${errorCode}); ` +
                      `this host may not have IPv6. IPv6 traps will not be received; IPv4 reception is unaffected.`,
                  );
                } else {
                  logger.error(
                    `SNMP trap receiver could not bind UDP port ${PROBE_SNMP_TRAP_RECEIVER_PORT} (${errorCode}). ` +
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

          SnmpTrapReceiver.handleNotification(notification).catch(
            (err: Error) => {
              logger.error(`SNMP trap forward failed: ${err}`);
            },
          );
        },
      );

      // Bind completes asynchronously; failures surface via the callback.
      logger.info(
        `SNMP trap receiver starting on ${transport} port ${PROBE_SNMP_TRAP_RECEIVER_PORT}`,
      );
    } catch (err) {
      /*
       * Binding can fail (port in use, no privilege for ports < 1024, no
       * IPv6 on the host). The probe's polling duties are unaffected —
       * log and move on; a udp6 failure still leaves udp4 receiving.
       */
      if (transport === "udp6") {
        logger.warn(
          `Could not start SNMP trap receiver on udp6 port ${PROBE_SNMP_TRAP_RECEIVER_PORT}: ${err}. Continuing with IPv4 only.`,
        );
        return;
      }

      logger.error(
        `Could not start SNMP trap receiver on port ${PROBE_SNMP_TRAP_RECEIVER_PORT}: ${err}`,
      );
    }
  }

  private static async handleNotification(
    notification: JSONObject,
  ): Promise<void> {
    const trap: SnmpTrap | null =
      SnmpTrapReceiver.parseNotification(notification);

    if (!trap) {
      return;
    }

    if (!SnmpTrapReceiver.consumeRateLimitSlot()) {
      return;
    }

    logger.debug(
      `SNMP trap received from ${trap.sourceIpAddress}: ${trap.trapOid}`,
    );

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
      options: {
        ...ProxyConfig.getRequestProxyAgents(ingestUrl),
        timeout: FORWARD_REQUEST_TIMEOUT_MS,
      },
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
          value: SnmpTrapReceiver.stringifyVarbindValue(varbind["value"]),
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

    return {
      sourceIpAddress: String(rinfo["address"]),
      trapOid: trapOid,
      snmpVersion: snmpVersion,
      community: pdu["community"] ? String(pdu["community"]) : undefined,
      receivedAt: new Date(),
      varbinds: varbinds,
    };
  }

  private static stringifyVarbindValue(value: unknown): string {
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

  private static consumeRateLimitSlot(): boolean {
    const now: number = Date.now();

    if (now - SnmpTrapReceiver.minuteWindowStartedAt >= 60000) {
      if (SnmpTrapReceiver.droppedThisMinute > 0) {
        logger.warn(
          `SNMP trap receiver dropped ${SnmpTrapReceiver.droppedThisMinute} traps in the last minute (rate limit: ${PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE}/min)`,
        );
      }
      SnmpTrapReceiver.minuteWindowStartedAt = now;
      SnmpTrapReceiver.forwardedThisMinute = 0;
      SnmpTrapReceiver.droppedThisMinute = 0;
    }

    if (
      SnmpTrapReceiver.forwardedThisMinute >=
      PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE
    ) {
      SnmpTrapReceiver.droppedThisMinute++;
      return false;
    }

    SnmpTrapReceiver.forwardedThisMinute++;
    return true;
  }
}
