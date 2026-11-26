import {
  BerTag,
  encodeConstructed,
  encodeOid,
  encodeUnsigned32,
} from "./SnmpBer";
import SnmpEngine, {
  MAX_SNMP_ENGINE_TIME,
  SNMP_ENGINE_BOOTS,
} from "./SnmpEngine";
import {
  MAX_SNMP_MESSAGE_SIZE,
  ParsedSnmpV3Message,
  ScopedPdu,
  SnmpVarbindValue,
  USM_SECURITY_MODEL,
  buildScopedPdu,
  buildV3Message,
  parseScopedPdu,
  parseV3Message,
} from "./SnmpV3Message";
import SnmpV3UserTable, { UsmLocalizedKeys, UsmUser } from "./SnmpV3UserTable";
import UsmCrypto, { UsmDecryptionError, UsmPrivacyKey } from "./UsmCrypto";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpTrapReceiverUtil, {
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import crypto from "crypto";

/*
 * ONE SNMPv3 DATAGRAM, TAKEN THROUGH THE USER-BASED SECURITY MODEL
 * (RFC 3414 section 3.2) TO A NOTIFICATION, A REFUSAL OR A REPORT.
 *
 * The checks run in the RFC's order, and each one that fails is a reason
 * the probe's page can name (SnmpTrapRefusalReason):
 *
 *   1. The engine. A trap is sent with the SENDER's engine ID (it is the
 *      authoritative engine for a trap); an inform with the PROBE's. A
 *      confirmed message (an inform, a discovery probe) to any other engine
 *      ID is answered with a Report carrying the probe's engine ID, boots
 *      and time - which is how an inform sender discovers them.
 *   2. The user name: a user of a device on this probe, or Unknown User.
 *   3. The security level: at least what that user is configured for - an
 *      authPriv user's traps are refused unauthenticated or in the clear.
 *   4. The digest, with the user's key localized to the message's engine
 *      ID - tried for each user of that name, those of the devices at the
 *      source address first. None matches: Wrong Digest.
 *   5. The time window. For an inform (the probe is authoritative): the
 *      probe's boots, and its time within 150 seconds. For a trap: the
 *      sender's boots and time must not go back past what it sent before by
 *      more than 150 seconds - Net-SNMP snmptrapd's rule, which is what
 *      devices are built to pass.
 *   6. Decryption, with the user's privacy key localized the same way.
 *   7. The PDU: an SNMPv2 trap or an inform. An inform the probe accepts is
 *      acknowledged with a Response, authenticated and encrypted as it came,
 *      so the sender stops retrying.
 *
 * Authentication comes before decryption, so nothing a forged message
 * carries is ever decrypted, and nothing in a refused one is read past its
 * user name. A confirmed message that is refused is answered with the
 * Report the RFC calls for, so its sender can say what went wrong; a trap
 * is never answered.
 *
 * Pure but for the clock, the per-engine time cache and the usmStats
 * counters: the socket, the forwarding and the refusal counts the probe's
 * page shows are the receiver's (Services/SnmpTrapReceiver).
 */

// RFC 3414 section 2.2.3.
export const SNMP_TIME_WINDOW_SECONDS: number = 150;
const MAX_ENGINE_BOOTS: number = 2147483647;

// Remote engines whose last boots and time are kept, most recent last.
export const MAX_REMOTE_ENGINES: number = 10000;

// usmStats (RFC 3414 section 5): the counter OIDs a Report carries.
export const USM_STATS_OIDS: Record<SnmpTrapRefusalReason, string> = {
  [SnmpTrapRefusalReason.UnsupportedSecurityLevel]: "1.3.6.1.6.3.15.1.1.1.0",
  [SnmpTrapRefusalReason.NotInTimeWindow]: "1.3.6.1.6.3.15.1.1.2.0",
  [SnmpTrapRefusalReason.UnknownUser]: "1.3.6.1.6.3.15.1.1.3.0",
  [SnmpTrapRefusalReason.UnknownEngineId]: "1.3.6.1.6.3.15.1.1.4.0",
  [SnmpTrapRefusalReason.WrongDigest]: "1.3.6.1.6.3.15.1.1.5.0",
  [SnmpTrapRefusalReason.DecryptionError]: "1.3.6.1.6.3.15.1.1.6.0",
};

const LEVEL_RANK: Record<SnmpSecurityLevel, number> = {
  [SnmpSecurityLevel.NoAuthNoPriv]: 0,
  [SnmpSecurityLevel.AuthNoPriv]: 1,
  [SnmpSecurityLevel.AuthPriv]: 2,
};

export interface SnmpV3Notification {
  isInform: boolean;
  // The user it was authenticated as, as configured.
  userName: string;
  securityLevel: SnmpSecurityLevel;
  contextEngineId: Buffer;
  contextName: string;
  requestId: number;
  varbinds: Array<SnmpVarbindValue>;
  /*
   * The sending device's engine. For a trap, the engine it was
   * authenticated as - the sender is the authoritative engine of a trap, and
   * its keys were localized to that ID. For an inform, which is
   * authenticated with the PROBE's engine, the scoped PDU's contextEngineID
   * - unless that is the probe's own too (net-snmp puts it there), which
   * says nothing about the device. Empty when nothing names it.
   */
  senderEngineId: Buffer;
}

export type SnmpV3IgnoredReason =
  // Not an SNMPv3 message this can read, or flags no sender may set.
  | "malformed"
  // Another security model than USM.
  | "unsupportedSecurityModel"
  // Authentic, but not a trap or an inform: a GetRequest, a Response.
  | "notANotification";

export type SnmpV3Outcome =
  | { kind: "accepted"; notification: SnmpV3Notification; reply?: Buffer }
  | {
      kind: "refused";
      reason: SnmpTrapRefusalReason;
      // As it was sent, made safe to show.
      userName: string;
      reply?: Buffer;
    }
  // An engine discovery probe, answered with the probe's engine ID.
  | { kind: "discovery"; reply: Buffer }
  | { kind: "ignored"; why: SnmpV3IgnoredReason };

interface RemoteEngineTime {
  boots: number;
  time: number;
  receivedAtMs: number;
}

// Who signed an authenticated message, and their keys localized to its engine.
interface Signer {
  user: UsmUser;
  authProtocol: SnmpAuthProtocol;
  authKey: Buffer;
  privacyKey?: UsmPrivacyKey | undefined;
}

export default class SnmpV3NotificationProcessor {
  private readonly engineId: Buffer;
  private readonly users: SnmpV3UserTable;
  private readonly now: () => number;
  // Least recently heard from first.
  private readonly remoteEngines: Map<string, RemoteEngineTime> = new Map();
  private readonly usmStats: Record<SnmpTrapRefusalReason, number> = {
    [SnmpTrapRefusalReason.UnsupportedSecurityLevel]: 0,
    [SnmpTrapRefusalReason.NotInTimeWindow]: 0,
    [SnmpTrapRefusalReason.UnknownUser]: 0,
    [SnmpTrapRefusalReason.UnknownEngineId]: 0,
    [SnmpTrapRefusalReason.WrongDigest]: 0,
    [SnmpTrapRefusalReason.DecryptionError]: 0,
  };
  // The 64-bit salt counter for the messages the probe encrypts.
  private salt: bigint;

  public constructor(data: {
    engineId: Buffer;
    users: SnmpV3UserTable;
    now?: (() => number) | undefined;
  }) {
    this.engineId = Buffer.from(data.engineId);
    this.users = data.users;
    this.now = data.now || Date.now;
    this.salt = crypto.randomBytes(8).readBigUInt64BE(0);
  }

  public getEngineId(): Buffer {
    return Buffer.from(this.engineId);
  }

  public process(datagram: Buffer, sourceAddress: string): SnmpV3Outcome {
    let message: ParsedSnmpV3Message;

    try {
      message = parseV3Message(datagram);
    } catch {
      return { kind: "ignored", why: "malformed" };
    }

    if (message.securityModel !== USM_SECURITY_MODEL) {
      return { kind: "ignored", why: "unsupportedSecurityModel" };
    }

    // RFC 3412 section 7.2 step 5: privacy without authentication is no valid message.
    if (message.flags.isEncrypted && !message.flags.isAuthenticated) {
      return { kind: "ignored", why: "malformed" };
    }

    const userName: string = SnmpTrapReceiverUtil.toDisplayableUserName(
      message.userName.toString("utf8"),
    );
    const isAuthoritative: boolean = message.engineId.equals(this.engineId);

    /*
     * 1. A confirmed message that is not signed: an engine discovery probe
     * (Net-SNMP and net-snmp send a GetRequest with no engine ID and no user
     * name), or an inform sent to the wrong engine ID, which is refused.
     * Either is answered with the probe's engine ID, boots and time. (A
     * signed message is read first, below: only once it is authentic can it
     * be told for an inform.)
     */
    if (message.flags.isReportable && !message.flags.isAuthenticated) {
      const plaintext: ScopedPdu | null = SnmpV3NotificationProcessor.tryParse(
        message.scopedPdu,
      );
      const isNotification: boolean =
        plaintext?.pduType === BerTag.TrapV2Pdu ||
        plaintext?.pduType === BerTag.InformRequestPdu;
      const isInformToAnotherEngine: boolean =
        plaintext?.pduType === BerTag.InformRequestPdu && !isAuthoritative;

      if (
        (!isNotification &&
          (!isAuthoritative || message.userName.length === 0)) ||
        isInformToAnotherEngine
      ) {
        this.count(SnmpTrapRefusalReason.UnknownEngineId);

        const reply: Buffer = this.buildReport({
          request: message,
          scopedPdu: plaintext,
          reason: SnmpTrapRefusalReason.UnknownEngineId,
        });

        if (
          isInformToAnotherEngine &&
          message.engineId.length > 0 &&
          message.userName.length > 0
        ) {
          return {
            kind: "refused",
            reason: SnmpTrapRefusalReason.UnknownEngineId,
            userName: userName,
            reply: reply,
          };
        }

        return { kind: "discovery", reply: reply };
      }
    }

    // 2. The user.
    const candidates: Array<UsmUser> = this.users.getCandidates(
      message.userName,
      sourceAddress,
    );

    if (candidates.length === 0) {
      return this.refuse({
        message: message,
        reason: SnmpTrapRefusalReason.UnknownUser,
        userName: userName,
      });
    }

    // 3. The security level.
    const messageLevel: SnmpSecurityLevel =
      SnmpV3NotificationProcessor.getMessageLevel(message);
    const eligible: Array<UsmUser> = candidates.filter(
      (user: UsmUser): boolean => {
        return SnmpV3NotificationProcessor.canTake(user, messageLevel);
      },
    );

    if (eligible.length === 0) {
      return this.refuse({
        message: message,
        reason: SnmpTrapRefusalReason.UnsupportedSecurityLevel,
        userName: userName,
      });
    }

    // 4. The digest.
    let user: UsmUser = eligible[0]!;
    let signer: Signer | null = null;

    if (message.flags.isAuthenticated) {
      signer = this.findSigner(message, eligible);

      if (!signer) {
        return this.refuse({
          message: message,
          reason: SnmpTrapRefusalReason.WrongDigest,
          userName: userName,
        });
      }

      user = signer.user;

      // 5. The time window: only an authenticated message can be placed in it.
      if (!this.isInTimeWindow(message, isAuthoritative)) {
        return this.refuse({
          message: message,
          reason: SnmpTrapRefusalReason.NotInTimeWindow,
          userName: userName,
          // The probe's time, signed, so an inform sender can correct its own.
          signedBy: isAuthoritative ? signer : undefined,
        });
      }
    }

    // 6. Decryption.
    let scopedPdu: ScopedPdu;

    try {
      scopedPdu = SnmpV3NotificationProcessor.readScopedPdu(message, signer);
    } catch (err) {
      if (err instanceof UsmDecryptionError) {
        return this.refuse({
          message: message,
          reason: SnmpTrapRefusalReason.DecryptionError,
          userName: userName,
        });
      }

      return { kind: "ignored", why: "malformed" };
    }

    // 7. The PDU.
    if (scopedPdu.pduType === BerTag.InformRequestPdu) {
      if (!isAuthoritative) {
        // Authentic, but addressed to another engine than the probe's.
        return this.refuse({
          message: message,
          reason: SnmpTrapRefusalReason.UnknownEngineId,
          userName: userName,
          scopedPdu: scopedPdu,
        });
      }

      return {
        kind: "accepted",
        notification: this.toNotification(message, scopedPdu, user, true),
        reply: this.buildInformResponse(message, scopedPdu, signer),
      };
    }

    if (scopedPdu.pduType === BerTag.TrapV2Pdu) {
      return {
        kind: "accepted",
        notification: this.toNotification(message, scopedPdu, user, false),
      };
    }

    return { kind: "ignored", why: "notANotification" };
  }

  // The usmStats counter of a reason: how many times it was refused for it.
  public getUsmStat(reason: SnmpTrapRefusalReason): number {
    return this.usmStats[reason];
  }

  // The level a message was sent at, from its flags.
  public static getMessageLevel(
    message: ParsedSnmpV3Message,
  ): SnmpSecurityLevel {
    if (message.flags.isEncrypted) {
      return SnmpSecurityLevel.AuthPriv;
    }

    return message.flags.isAuthenticated
      ? SnmpSecurityLevel.AuthNoPriv
      : SnmpSecurityLevel.NoAuthNoPriv;
  }

  /*
   * Whether a user can take a message sent at a level: the level is at
   * least the user's own - an authPriv user's traps must be encrypted - and
   * the user has the keys the level needs.
   */
  public static canTake(user: UsmUser, level: SnmpSecurityLevel): boolean {
    if (LEVEL_RANK[level] < LEVEL_RANK[user.securityLevel]) {
      return false;
    }

    if (level !== SnmpSecurityLevel.NoAuthNoPriv && !user.authProtocol) {
      return false;
    }

    if (level === SnmpSecurityLevel.AuthPriv && !user.privProtocol) {
      return false;
    }

    return true;
  }

  private findSigner(
    message: ParsedSnmpV3Message,
    users: Array<UsmUser>,
  ): Signer | null {
    for (const user of users) {
      const authProtocol: SnmpAuthProtocol | undefined = user.authProtocol;

      if (
        !authProtocol ||
        message.authParameters.length !== UsmCrypto.getMacLength(authProtocol)
      ) {
        continue;
      }

      const keys: UsmLocalizedKeys = this.users.getLocalizedKeys(
        user,
        message.engineId,
      );

      if (
        keys.authKey &&
        UsmCrypto.isAuthentic({
          protocol: authProtocol,
          localizedAuthKey: keys.authKey,
          message: message.datagram,
          macOffset: message.authParametersOffset,
          mac: message.authParameters,
        })
      ) {
        return {
          user: user,
          authProtocol: authProtocol,
          authKey: keys.authKey,
          privacyKey: keys.privacyKey,
        };
      }
    }

    return null;
  }

  /*
   * RFC 3414 section 3.2 step 7. Authoritative (an inform to the probe): the
   * probe's own boots, and its time within the window. Not authoritative (a
   * trap): checked against what the sending engine said last, which is then
   * moved forward - only ever after the message was authenticated, so a
   * forged one cannot move it.
   */
  private isInTimeWindow(
    message: ParsedSnmpV3Message,
    isAuthoritative: boolean,
  ): boolean {
    const nowMs: number = this.now();

    if (isAuthoritative) {
      return (
        message.engineBoots === SNMP_ENGINE_BOOTS &&
        Math.abs(message.engineTime - SnmpEngine.getEngineTime(nowMs)) <=
          SNMP_TIME_WINDOW_SECONDS
      );
    }

    const engineKey: string = message.engineId.toString("hex");
    const known: RemoteEngineTime | undefined =
      this.remoteEngines.get(engineKey);

    if (known) {
      if (
        known.boots === MAX_ENGINE_BOOTS ||
        known.boots > message.engineBoots
      ) {
        return false;
      }

      if (
        known.boots === message.engineBoots &&
        message.engineTime < known.time
      ) {
        /*
         * Older than the last message the engine sent: taken only while it is
         * within the window of where that engine's clock is now, and it moves
         * nothing.
         */
        const elapsedSeconds: number = Math.max(
          0,
          Math.floor((nowMs - known.receivedAtMs) / 1000),
        );
        const theirTimeNow: number = Math.min(
          known.time + elapsedSeconds,
          MAX_SNMP_ENGINE_TIME,
        );

        return (
          Math.abs(theirTimeNow - message.engineTime) <=
          SNMP_TIME_WINDOW_SECONDS
        );
      }
    }

    this.remoteEngines.delete(engineKey);
    this.remoteEngines.set(engineKey, {
      boots: message.engineBoots,
      time: message.engineTime,
      receivedAtMs: nowMs,
    });

    while (this.remoteEngines.size > MAX_REMOTE_ENGINES) {
      const oldest: string | undefined = this.remoteEngines.keys().next()
        .value as string | undefined;

      if (oldest === undefined) {
        break;
      }

      this.remoteEngines.delete(oldest);
    }

    return true;
  }

  private static readScopedPdu(
    message: ParsedSnmpV3Message,
    signer: Signer | null,
  ): ScopedPdu {
    if (!message.flags.isEncrypted) {
      if (!message.scopedPdu) {
        throw new Error("An unencrypted message has no plaintext scoped PDU");
      }

      return parseScopedPdu(message.scopedPdu);
    }

    if (!message.encryptedScopedPdu || !signer?.privacyKey) {
      throw new UsmDecryptionError("There is no key to decrypt this message");
    }

    const plaintext: Buffer = UsmCrypto.decrypt({
      privacyKey: signer.privacyKey,
      privParameters: message.privParameters,
      engineBoots: message.engineBoots,
      engineTime: message.engineTime,
      encrypted: message.encryptedScopedPdu,
    });

    try {
      return parseScopedPdu(plaintext);
    } catch {
      // A wrong privacy key decrypts to noise: what does not read as a scoped PDU was not decrypted.
      throw new UsmDecryptionError("The decrypted scoped PDU does not parse");
    }
  }

  private toNotification(
    message: ParsedSnmpV3Message,
    scopedPdu: ScopedPdu,
    user: UsmUser,
    isInform: boolean,
  ): SnmpV3Notification {
    let senderEngineId: Buffer =
      !isInform && message.engineId.length > 0
        ? message.engineId
        : scopedPdu.contextEngineId;

    if (senderEngineId.equals(this.engineId)) {
      senderEngineId = Buffer.alloc(0);
    }

    return {
      isInform: isInform,
      userName: user.userName,
      securityLevel: SnmpV3NotificationProcessor.getMessageLevel(message),
      contextEngineId: Buffer.from(scopedPdu.contextEngineId),
      contextName: SnmpTrapReceiverUtil.toDisplayableUserName(
        scopedPdu.contextName.toString("utf8"),
      ),
      requestId: scopedPdu.requestId,
      varbinds: scopedPdu.varbinds,
      senderEngineId: Buffer.from(senderEngineId),
    };
  }

  /*
   * A refusal, counted, and answered with a Report when the message asked
   * for one (it is confirmed: an inform). A trap is never answered.
   */
  private refuse(data: {
    message: ParsedSnmpV3Message;
    reason: SnmpTrapRefusalReason;
    userName: string;
    scopedPdu?: ScopedPdu | undefined;
    signedBy?: Signer | undefined;
  }): SnmpV3Outcome {
    this.count(data.reason);

    if (!data.message.flags.isReportable) {
      return { kind: "refused", reason: data.reason, userName: data.userName };
    }

    return {
      kind: "refused",
      reason: data.reason,
      userName: data.userName,
      reply: this.buildReport({
        request: data.message,
        scopedPdu:
          data.scopedPdu ||
          (data.message.flags.isEncrypted
            ? null
            : SnmpV3NotificationProcessor.tryParse(data.message.scopedPdu)),
        reason: data.reason,
        signedBy: data.signedBy,
      }),
    };
  }

  private count(reason: SnmpTrapRefusalReason): void {
    this.usmStats[reason] = (this.usmStats[reason] + 1) % 4294967296;
  }

  /*
   * A Report (RFC 3412 section 7.1): the usmStats counter of what went
   * wrong, from the probe's engine with its boots and time. Unsigned, but
   * for Not In Time Window to an inform: that one is signed with the user's
   * key (RFC 3414 section 3.2 step 7a), so the sender can trust the time in
   * it and correct its own.
   */
  private buildReport(data: {
    request: ParsedSnmpV3Message;
    scopedPdu: ScopedPdu | null;
    reason: SnmpTrapRefusalReason;
    signedBy?: Signer | undefined;
  }): Buffer {
    const varbindList: Buffer = encodeConstructed([
      encodeConstructed([
        encodeOid(USM_STATS_OIDS[data.reason]),
        encodeUnsigned32(this.usmStats[data.reason], BerTag.Counter32),
      ]),
    ]);

    const scopedPdu: Buffer = buildScopedPdu({
      contextEngineId: this.engineId,
      contextName: data.scopedPdu?.contextName || Buffer.alloc(0),
      pduType: BerTag.ReportPdu,
      requestId: data.scopedPdu ? data.scopedPdu.requestId : data.request.msgId,
      varbindList: varbindList,
    });

    const signer: Signer | undefined = data.signedBy;

    return buildV3Message({
      msgId: data.request.msgId,
      msgMaxSize: MAX_SNMP_MESSAGE_SIZE,
      flags: {
        isAuthenticated: Boolean(signer),
        isEncrypted: false,
        isReportable: false,
      },
      engineId: this.engineId,
      engineBoots: SNMP_ENGINE_BOOTS,
      engineTime: SnmpEngine.getEngineTime(this.now()),
      userName: signer ? data.request.userName : Buffer.alloc(0),
      scopedPdu: scopedPdu,
      authenticate: signer
        ? SnmpV3NotificationProcessor.signWith(signer)
        : undefined,
    });
  }

  /*
   * An inform's acknowledgement: a Response PDU with the inform's request ID
   * and varbinds, from the probe's engine, at the level the inform came at -
   * signed, and encrypted, with the user's keys localized to the probe.
   */
  private buildInformResponse(
    request: ParsedSnmpV3Message,
    inform: ScopedPdu,
    signer: Signer | null,
  ): Buffer {
    const engineTime: number = SnmpEngine.getEngineTime(this.now());
    const privacyKey: UsmPrivacyKey | undefined = signer?.privacyKey;

    return buildV3Message({
      msgId: request.msgId,
      msgMaxSize: MAX_SNMP_MESSAGE_SIZE,
      flags: {
        isAuthenticated: request.flags.isAuthenticated,
        isEncrypted: request.flags.isEncrypted,
        isReportable: false,
      },
      engineId: this.engineId,
      engineBoots: SNMP_ENGINE_BOOTS,
      engineTime: engineTime,
      userName: request.userName,
      scopedPdu: buildScopedPdu({
        contextEngineId: inform.contextEngineId,
        contextName: inform.contextName,
        pduType: BerTag.ResponsePdu,
        requestId: inform.requestId,
        varbindList: inform.varbindList,
      }),
      authenticate: signer
        ? SnmpV3NotificationProcessor.signWith(signer)
        : undefined,
      encrypt: privacyKey
        ? (
            plaintext: Buffer,
          ): { encrypted: Buffer; privParameters: Buffer } => {
            return UsmCrypto.encrypt({
              privacyKey: privacyKey,
              engineBoots: SNMP_ENGINE_BOOTS,
              engineTime: engineTime,
              salt: this.nextSalt(),
              scopedPdu: plaintext,
            });
          }
        : undefined,
    });
  }

  private static signWith(signer: Signer): {
    macLength: number;
    computeMac: (messageWithZeroedMac: Buffer) => Buffer;
  } {
    return {
      macLength: UsmCrypto.getMacLength(signer.authProtocol),
      computeMac: (messageWithZeroedMac: Buffer): Buffer => {
        return UsmCrypto.computeMac(
          signer.authProtocol,
          signer.authKey,
          messageWithZeroedMac,
        );
      },
    };
  }

  private nextSalt(): Buffer {
    this.salt = (this.salt + BigInt(1)) & BigInt("0xFFFFFFFFFFFFFFFF");
    const salt: Buffer = Buffer.alloc(8);
    salt.writeBigUInt64BE(this.salt, 0);
    return salt;
  }

  private static tryParse(bytes: Buffer | undefined): ScopedPdu | null {
    if (!bytes) {
      return null;
    }

    try {
      return parseScopedPdu(bytes);
    } catch {
      return null;
    }
  }
}
