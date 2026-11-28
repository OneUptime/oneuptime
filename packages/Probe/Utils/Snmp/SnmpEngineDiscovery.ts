import { BerTag, encodeConstructed } from "./V3/SnmpBer";
import {
  MAX_SNMP_MESSAGE_SIZE,
  ParsedSnmpV3Message,
  ScopedPdu,
  buildScopedPdu,
  buildV3Message,
  isSnmpV3Message,
  parseScopedPdu,
  parseV3Message,
} from "./V3/SnmpV3Message";
import IP from "Common/Types/IP/IP";
import SnmpTrapReceiverUtil from "Common/Types/Probe/SnmpTrapReceiver";
import crypto from "crypto";
import dgram from "dgram";

/*
 * AN SNMP AGENT'S ENGINE ID, BY SNMPv3 ENGINE DISCOVERY (RFC 3414 section 4;
 * OneUptime issue #11405).
 *
 * Before an SNMPv3 manager can talk to an agent it learns the agent's
 * engine ID: it sends a GetRequest that names no user and no engine and
 * asks for nothing - noAuthNoPriv, reportable - and the agent answers with
 * a Report (usmStatsUnknownEngineIDs) whose msgAuthoritativeEngineID is its
 * own snmpEngineID: the engine its SNMPv3 traps are sent as. Net-SNMP's
 * tools and net-snmp send exactly this first; it needs no credential, and
 * an agent counts it as discovery, never as a failed login - no user name
 * is sent at all.
 *
 * So the probe can read the engine ID of a device it polls over v1 or v2c
 * (SnmpEngineIdReader), at the address and port it polls the device at. One
 * datagram out, the agent's answer in, or nothing within the timeout. Never
 * throws: an agent that does not speak SNMPv3, a closed port, a name that
 * does not resolve, and an answer that is not that Report are all
 * undefined.
 */

export const DEFAULT_ENGINE_DISCOVERY_TIMEOUT_MS: number = 2000;

const EMPTY: Buffer = Buffer.alloc(0);

export default class SnmpEngineDiscovery {
  /*
   * The engine ID the agent at host:port answers discovery with, as hex in
   * capitals (SnmpTrapReceiverUtil.normalizeEngineId), or undefined.
   */
  public static async discover(data: {
    host: string;
    port: number;
    timeoutMs?: number | undefined;
  }): Promise<string | undefined> {
    const host: string = (data.host || "").trim();

    if (!host || !Number.isInteger(data.port) || data.port < 1) {
      return undefined;
    }

    const msgId: number = SnmpEngineDiscovery.randomId();
    const requestId: number = SnmpEngineDiscovery.randomId();
    const request: Buffer = SnmpEngineDiscovery.buildRequest({
      msgId: msgId,
      requestId: requestId,
    });

    return await new Promise<string | undefined>(
      (resolve: (engineId: string | undefined) => void): void => {
        let socket: dgram.Socket | null = null;
        let isDone: boolean = false;

        const finish: (engineId: string | undefined) => void = (
          engineId: string | undefined,
        ): void => {
          if (isDone) {
            return;
          }

          isDone = true;
          clearTimeout(timer);

          try {
            socket?.close();
          } catch {
            // Already closed: an error closed it.
          }

          resolve(engineId);
        };

        const timer: ReturnType<typeof setTimeout> = setTimeout(
          (): void => {
            finish(undefined);
          },
          Math.max(1, data.timeoutMs ?? DEFAULT_ENGINE_DISCOVERY_TIMEOUT_MS),
        );

        // Never keep the probe alive just for this.
        timer.unref?.();

        try {
          socket = dgram.createSocket(
            IP.isIP(host) && new IP(host).isIPv6() ? "udp6" : "udp4",
          );
        } catch {
          finish(undefined);
          return;
        }

        socket.unref();

        socket.on("error", (): void => {
          finish(undefined);
        });

        socket.on("message", (datagram: Buffer): void => {
          const engineId: string | undefined = SnmpEngineDiscovery.readEngineId(
            {
              datagram: datagram,
              msgId: msgId,
              requestId: requestId,
            },
          );

          // Anything else on the socket is not the answer: keep waiting.
          if (engineId) {
            finish(engineId);
          }
        });

        socket.send(request, data.port, host, (error: Error | null): void => {
          if (error) {
            finish(undefined);
          }
        });
      },
    );
  }

  /*
   * The discovery request: an SNMPv3 GetRequest with no user, no engine and
   * no varbinds, noAuthNoPriv and reportable (RFC 3414 section 4), as
   * Net-SNMP and net-snmp send it.
   */
  public static buildRequest(data: {
    msgId: number;
    requestId: number;
  }): Buffer {
    return buildV3Message({
      msgId: data.msgId,
      // The largest datagram the probe reads: one UDP datagram.
      msgMaxSize: MAX_SNMP_MESSAGE_SIZE,
      flags: {
        isAuthenticated: false,
        isEncrypted: false,
        isReportable: true,
      },
      engineId: EMPTY,
      engineBoots: 0,
      engineTime: 0,
      userName: EMPTY,
      scopedPdu: buildScopedPdu({
        contextEngineId: EMPTY,
        contextName: EMPTY,
        pduType: BerTag.GetRequestPdu,
        requestId: data.requestId,
        varbindList: encodeConstructed([]),
      }),
    });
  }

  /*
   * The engine ID an answer to the request says, or undefined when it is
   * not that answer: an SNMPv3 message with the request's msgID, from an
   * authoritative engine of 5 to 32 octets, whose PDU - when it can be read
   * - is a Report for the request (or, from an agent that answers
   * discovery as a request, a Response to it).
   */
  public static readEngineId(data: {
    datagram: Buffer;
    msgId: number;
    requestId: number;
  }): string | undefined {
    if (!isSnmpV3Message(data.datagram)) {
      return undefined;
    }

    let message: ParsedSnmpV3Message;

    try {
      message = parseV3Message(data.datagram);
    } catch {
      // Not a message this can read (SnmpBer's BerError): not the answer.
      return undefined;
    }

    if (message.msgId !== data.msgId) {
      return undefined;
    }

    if (message.scopedPdu) {
      let pdu: ScopedPdu;

      try {
        pdu = parseScopedPdu(message.scopedPdu);
      } catch {
        return undefined;
      }

      const isAnswer: boolean =
        pdu.pduType === BerTag.ReportPdu || pdu.pduType === BerTag.ResponsePdu;

      /*
       * A Report's request-id is the request's (Net-SNMP), the msgID
       * (net-snmp's agent), or zero when the agent could not read the
       * request: the msgID above is what pairs them, as for any manager.
       */
      if (
        !isAnswer ||
        ![data.requestId, data.msgId, 0].includes(pdu.requestId)
      ) {
        return undefined;
      }
    }

    if (message.engineId.length === 0) {
      return undefined;
    }

    return (
      SnmpTrapReceiverUtil.normalizeEngineId(
        message.engineId.toString("hex"),
      ) || undefined
    );
  }

  // A msgID or request-id: positive, 31 bits, as INTEGER (0..2147483647).
  private static randomId(): number {
    return crypto.randomInt(1, 2147483647);
  }
}
