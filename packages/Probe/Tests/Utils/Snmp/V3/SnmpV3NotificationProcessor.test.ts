import SnmpV3NotificationProcessor, {
  SNMP_TIME_WINDOW_SECONDS,
  SnmpV3Notification,
  SnmpV3Outcome,
  USM_STATS_OIDS,
} from "../../../../Utils/Snmp/V3/SnmpV3NotificationProcessor";
import SnmpEngine, {
  SNMP_ENGINE_BOOTS,
} from "../../../../Utils/Snmp/V3/SnmpEngine";
import SnmpV3UserTable from "../../../../Utils/Snmp/V3/SnmpV3UserTable";
import {
  BerTag,
  encodeConstructed,
  encodeInteger,
  encodeOctetString,
} from "../../../../Utils/Snmp/V3/SnmpBer";
import {
  ParsedSnmpV3Message,
  ScopedPdu,
  parseScopedPdu,
  parseV3Message,
} from "../../../../Utils/Snmp/V3/SnmpV3Message";
import UsmCrypto from "../../../../Utils/Snmp/V3/UsmCrypto";
import {
  LINK_DOWN_OID,
  SNMP_TRAP_OID_OID,
  TestCredential,
  buildDiscoveryProbe,
  buildTestV3Message,
  integerValue,
  linkDownVarbinds,
  oidValue,
  textValue,
} from "../../../TestingUtils/SnmpV3TestMessages";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverUser,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import { SnmpV3CredentialHolders } from "Common/Types/Probe/SnmpV3CredentialHolders";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ONE SNMPv3 DATAGRAM THROUGH THE USER-BASED SECURITY MODEL (RFC 3414
 * section 3.2), CHECK BY CHECK.
 *
 * Every message here is a real SNMPv3 message, built as a device's stack
 * builds it (TestingUtils/SnmpV3TestMessages): signed, encrypted, with the
 * engine boots and time a test needs. Every reply the processor gives - an
 * inform's Response, a Report - is read back as the sender would read it:
 * parsed, its digest checked with the user's key localized to the probe's
 * engine, decrypted.
 */

const PROBE_ENGINE_ID: Buffer = Buffer.from(
  "8000B98380A1B2C3D4E5F60718293A4B",
  "hex",
);
const DEVICE_ENGINE_ID: Buffer = Buffer.from("80001F8880D5E4C3B2A1", "hex");
const OTHER_DEVICE_ENGINE_ID: Buffer = Buffer.from(
  "80001F888011223344556677",
  "hex",
);
const DEVICE: string = "10.20.0.5";
const OTHER_DEVICE: string = "10.20.0.6";

// 2026-11-24 12:00:00 UTC.
const START_MS: number = Date.UTC(2026, 10, 24, 12, 0, 0);

function user(
  credential: TestCredential,
  securityLevel: SnmpSecurityLevel,
  addresses: Array<string> = [DEVICE],
): SnmpTrapReceiverUser {
  const receiverUser: SnmpTrapReceiverUser = {
    userName: credential.userName,
    securityLevel: securityLevel,
    addresses: addresses,
  };

  if (credential.authProtocol) {
    receiverUser.authProtocol = credential.authProtocol;
    receiverUser.authKey = credential.authPassphrase;
  }

  if (credential.privProtocol) {
    receiverUser.privProtocol = credential.privProtocol;
    receiverUser.privKey = credential.privPassphrase;
  }

  return receiverUser;
}

const SAN_MONITOR: TestCredential = {
  userName: "san-monitor",
  authProtocol: SnmpAuthProtocol.SHA,
  authPassphrase: "auth-passphrase-1",
  privProtocol: SnmpPrivProtocol.AES,
  privPassphrase: "priv-passphrase-1",
};

const PRIV_CREDENTIALS: Array<TestCredential> = [
  SAN_MONITOR,
  {
    userName: "md5-des",
    authProtocol: SnmpAuthProtocol.MD5,
    authPassphrase: "md5-auth-pass",
    privProtocol: SnmpPrivProtocol.DES,
    privPassphrase: "des-priv-pass",
  },
  {
    userName: "sha-des",
    authProtocol: SnmpAuthProtocol.SHA,
    authPassphrase: "sha-auth-pass",
    privProtocol: SnmpPrivProtocol.DES,
    privPassphrase: "des-priv-pass-2",
  },
  {
    userName: "md5-aes",
    authProtocol: SnmpAuthProtocol.MD5,
    authPassphrase: "md5-auth-pass-2",
    privProtocol: SnmpPrivProtocol.AES,
    privPassphrase: "aes-priv-pass",
  },
  {
    userName: "sha256-aes256",
    authProtocol: SnmpAuthProtocol.SHA256,
    authPassphrase: "sha256-auth-pass",
    privProtocol: SnmpPrivProtocol.AES256,
    privPassphrase: "aes256-priv-pass",
  },
  {
    userName: "sha512-aes256",
    authProtocol: SnmpAuthProtocol.SHA512,
    authPassphrase: "sha512-auth-pass",
    privProtocol: SnmpPrivProtocol.AES256,
    privPassphrase: "aes256-priv-pass-2",
  },
  {
    userName: "md5-aes256",
    authProtocol: SnmpAuthProtocol.MD5,
    authPassphrase: "md5-auth-pass-3",
    privProtocol: SnmpPrivProtocol.AES256,
    privPassphrase: "aes256-priv-pass-3",
  },
  {
    userName: "sha512-des",
    authProtocol: SnmpAuthProtocol.SHA512,
    authPassphrase: "sha512-auth-pass-2",
    privProtocol: SnmpPrivProtocol.DES,
    privPassphrase: "des-priv-pass-3",
  },
];

const AUTH_ONLY: TestCredential = {
  userName: "auth-only",
  authProtocol: SnmpAuthProtocol.SHA256,
  authPassphrase: "auth-only-passphrase",
};

const NO_AUTH: TestCredential = { userName: "lab-noauth" };

const SHARED_AT_DEVICE: TestCredential = {
  userName: "shared",
  authProtocol: SnmpAuthProtocol.SHA,
  authPassphrase: "shared-device-one",
};

const SHARED_AT_OTHER_DEVICE: TestCredential = {
  userName: "shared",
  authProtocol: SnmpAuthProtocol.SHA,
  authPassphrase: "shared-device-two",
};

const USERS: Array<SnmpTrapReceiverUser> = [
  ...PRIV_CREDENTIALS.map((credential: TestCredential) => {
    return user(credential, SnmpSecurityLevel.AuthPriv);
  }),
  user(AUTH_ONLY, SnmpSecurityLevel.AuthNoPriv),
  user(NO_AUTH, SnmpSecurityLevel.NoAuthNoPriv),
  user(SHARED_AT_DEVICE, SnmpSecurityLevel.AuthNoPriv, [DEVICE]),
  user(SHARED_AT_OTHER_DEVICE, SnmpSecurityLevel.AuthNoPriv, [OTHER_DEVICE]),
];

let nowMs: number = START_MS;
let users: SnmpV3UserTable;
let processor: SnmpV3NotificationProcessor;

function probeTime(): number {
  return SnmpEngine.getEngineTime(nowMs);
}

function accepted(outcome: SnmpV3Outcome): SnmpV3Notification {
  if (outcome.kind !== "accepted") {
    throw new Error(`Expected accepted, got ${JSON.stringify(outcome)}`);
  }

  return outcome.notification;
}

function refusedFor(outcome: SnmpV3Outcome): SnmpTrapRefusalReason {
  if (outcome.kind !== "refused") {
    throw new Error(`Expected refused, got ${outcome.kind}`);
  }

  return outcome.reason;
}

function replyOf(outcome: SnmpV3Outcome): Buffer {
  if (!("reply" in outcome) || !outcome.reply) {
    throw new Error(`Expected a reply, got ${outcome.kind}`);
  }

  return outcome.reply;
}

/*
 * A reply as its sender reads it: parsed, its digest checked and its scoped
 * PDU decrypted with the credential's keys localized to the probe's engine.
 */
function readReply(
  reply: Buffer,
  credential?: TestCredential,
): { message: ParsedSnmpV3Message; scopedPdu: ScopedPdu } {
  const message: ParsedSnmpV3Message = parseV3Message(reply);

  if (message.flags.isAuthenticated) {
    expect(credential?.authProtocol).toBeDefined();

    const authKey: Buffer = UsmCrypto.localizeKey(
      credential!.authProtocol!,
      UsmCrypto.passwordToKu(
        credential!.authProtocol!,
        credential!.authPassphrase!,
      ),
      message.engineId,
    );

    expect(
      UsmCrypto.isAuthentic({
        protocol: credential!.authProtocol!,
        localizedAuthKey: authKey,
        message: reply,
        macOffset: message.authParametersOffset,
        mac: message.authParameters,
      }),
    ).toBe(true);
  }

  if (!message.flags.isEncrypted) {
    return { message: message, scopedPdu: parseScopedPdu(message.scopedPdu!) };
  }

  const plaintext: Buffer = UsmCrypto.decrypt({
    privacyKey: UsmCrypto.localizePrivacyKey({
      authProtocol: credential!.authProtocol!,
      privProtocol: credential!.privProtocol!,
      privKu: UsmCrypto.passwordToKu(
        credential!.authProtocol!,
        credential!.privPassphrase!,
      ),
      engineId: message.engineId,
    }),
    privParameters: message.privParameters,
    engineBoots: message.engineBoots,
    engineTime: message.engineTime,
    encrypted: message.encryptedScopedPdu!,
  });

  return { message: message, scopedPdu: parseScopedPdu(plaintext) };
}

function expectReport(
  reply: Buffer,
  reason: SnmpTrapRefusalReason,
  credential?: TestCredential,
): ScopedPdu {
  const { message, scopedPdu } = readReply(reply, credential);

  expect(scopedPdu.pduType).toBe(BerTag.ReportPdu);
  expect(message.engineId.equals(PROBE_ENGINE_ID)).toBe(true);
  expect(message.engineBoots).toBe(SNMP_ENGINE_BOOTS);
  expect(message.engineTime).toBe(probeTime());
  expect(message.flags.isReportable).toBe(false);
  expect(message.flags.isEncrypted).toBe(false);
  expect(scopedPdu.varbinds).toHaveLength(1);
  expect(scopedPdu.varbinds[0]!.oid).toBe(USM_STATS_OIDS[reason]);
  expect(scopedPdu.varbinds[0]!.type).toBe(BerTag.Counter32);

  return scopedPdu;
}

beforeEach(() => {
  nowMs = START_MS;
  users = new SnmpV3UserTable();
  users.replace(USERS);
  processor = new SnmpV3NotificationProcessor({
    engineId: PROBE_ENGINE_ID,
    users: users,
    now: () => {
      return nowMs;
    },
  });
});

describe("traps at every security level and with every protocol", () => {
  test.each(
    PRIV_CREDENTIALS.map(
      (credential: TestCredential): [string, TestCredential] => {
        return [
          `${credential.authProtocol}/${credential.privProtocol}`,
          credential,
        ];
      },
    ),
  )("authPriv %s", (_label: string, credential: TestCredential) => {
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({
          credential: credential,
          engineId: DEVICE_ENGINE_ID,
        }),
        DEVICE,
      ),
    );

    expect(notification.isInform).toBe(false);
    expect(notification.userName).toBe(credential.userName);
    expect(notification.securityLevel).toBe(SnmpSecurityLevel.AuthPriv);
    expect(notification.senderEngineId.equals(DEVICE_ENGINE_ID)).toBe(true);
    expect(notification.varbinds).toEqual([
      { oid: "1.3.6.1.2.1.1.3.0", type: BerTag.TimeTicks, value: 4242 },
      { oid: SNMP_TRAP_OID_OID, type: BerTag.Oid, value: LINK_DOWN_OID },
      { oid: "1.3.6.1.2.1.2.2.1.1.3", type: BerTag.Integer, value: 3 },
    ]);
  });

  test("authNoPriv", () => {
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({
          credential: AUTH_ONLY,
          engineId: DEVICE_ENGINE_ID,
        }),
        DEVICE,
      ),
    );

    expect(notification.securityLevel).toBe(SnmpSecurityLevel.AuthNoPriv);
  });

  test("noAuthNoPriv, from a user configured without authentication", () => {
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({ credential: NO_AUTH, engineId: DEVICE_ENGINE_ID }),
        DEVICE,
      ),
    );

    expect(notification.securityLevel).toBe(SnmpSecurityLevel.NoAuthNoPriv);
    expect(notification.userName).toBe("lab-noauth");
  });

  test("an authPriv user's trap sent at authPriv is accepted with more than its level: an authNoPriv user's never is", () => {
    // A user configured authNoPriv has no privacy key: an encrypted trap cannot be read.
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: {
              ...AUTH_ONLY,
              privProtocol: SnmpPrivProtocol.AES,
              privPassphrase: "whatever-it-is",
            },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.UnsupportedSecurityLevel);
  });

  test("the context name and every varbind type come through as net-snmp hands them over", () => {
    const counter64: Buffer = Buffer.from("00ffffffffffffffff", "hex");
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({
          credential: SAN_MONITOR,
          engineId: DEVICE_ENGINE_ID,
          contextName: "vf-128",
          varbinds: [
            ...linkDownVarbinds(),
            {
              oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.36",
              value: textValue("port 7 down"),
            },
            {
              oid: "1.3.6.1.2.1.2.2.1.6.7",
              value: textValue(Buffer.from("001b21aabbcc", "hex")),
            },
            {
              oid: "1.3.6.1.2.1.31.1.1.1.6.7",
              value: Buffer.concat([
                Buffer.from([BerTag.Counter64, counter64.length]),
                counter64,
              ]),
            },
            {
              oid: "1.3.6.1.2.1.4.20.1.1.10.0.0.1",
              value: Buffer.from([BerTag.IpAddress, 4, 10, 0, 0, 1]),
            },
            {
              oid: "1.3.6.1.2.1.2.2.1.10.7",
              value: Buffer.from([
                BerTag.Counter32,
                5,
                0,
                0xff,
                0xff,
                0xff,
                0xff,
              ]),
            },
            {
              oid: "1.3.6.1.4.1.9.9.1",
              value: Buffer.from([BerTag.NoSuchObject, 0]),
            },
            { oid: "1.3.6.1.4.1.9.9.2", value: Buffer.from([BerTag.Null, 0]) },
          ],
        }),
        DEVICE,
      ),
    );

    expect(notification.contextName).toBe("vf-128");
    expect(notification.varbinds.slice(3)).toEqual([
      {
        oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.36",
        type: BerTag.OctetString,
        value: Buffer.from("port 7 down"),
      },
      {
        oid: "1.3.6.1.2.1.2.2.1.6.7",
        type: BerTag.OctetString,
        value: Buffer.from("001b21aabbcc", "hex"),
      },
      {
        oid: "1.3.6.1.2.1.31.1.1.1.6.7",
        type: BerTag.Counter64,
        value: counter64,
      },
      {
        oid: "1.3.6.1.2.1.4.20.1.1.10.0.0.1",
        type: BerTag.IpAddress,
        value: "10.0.0.1",
      },
      {
        oid: "1.3.6.1.2.1.2.2.1.10.7",
        type: BerTag.Counter32,
        value: 4294967295,
      },
      { oid: "1.3.6.1.4.1.9.9.1", type: BerTag.NoSuchObject, value: null },
      { oid: "1.3.6.1.4.1.9.9.2", type: BerTag.Null, value: null },
    ]);
  });
});

describe("informs are acknowledged", () => {
  test.each(
    [...PRIV_CREDENTIALS, AUTH_ONLY].map(
      (credential: TestCredential): [string, TestCredential] => {
        return [credential.userName, credential];
      },
    ),
  )(
    "%s: a Response, signed and encrypted as the inform came, from the probe's engine",
    (_label: string, credential: TestCredential) => {
      const outcome: SnmpV3Outcome = processor.process(
        buildTestV3Message({
          credential: credential,
          engineId: PROBE_ENGINE_ID,
          engineBoots: SNMP_ENGINE_BOOTS,
          engineTime: probeTime(),
          pduType: BerTag.InformRequestPdu,
          msgId: 31337,
          requestId: 1011,
          contextEngineId: DEVICE_ENGINE_ID,
          contextName: "ctx",
        }),
        DEVICE,
      );

      const notification: SnmpV3Notification = accepted(outcome);
      expect(notification.isInform).toBe(true);
      expect(notification.requestId).toBe(1011);
      // An inform says who sent it in its context, never by the engine it was sent to.
      expect(notification.senderEngineId.equals(DEVICE_ENGINE_ID)).toBe(true);

      const { message, scopedPdu } = readReply(replyOf(outcome), credential);

      expect(message.msgId).toBe(31337);
      expect(message.engineId.equals(PROBE_ENGINE_ID)).toBe(true);
      expect(message.engineTime).toBe(probeTime());
      expect(message.userName.toString()).toBe(credential.userName);
      expect(message.flags.isReportable).toBe(false);
      expect(message.flags.isAuthenticated).toBe(true);
      expect(message.flags.isEncrypted).toBe(Boolean(credential.privProtocol));
      expect(scopedPdu.pduType).toBe(BerTag.ResponsePdu);
      expect(scopedPdu.requestId).toBe(1011);
      expect(scopedPdu.errorStatus).toBe(0);
      expect(scopedPdu.contextName.toString()).toBe("ctx");
      expect(scopedPdu.varbinds).toEqual(notification.varbinds);
    },
  );

  test("a noAuthNoPriv inform is acknowledged in the clear", () => {
    const outcome: SnmpV3Outcome = processor.process(
      buildTestV3Message({
        credential: NO_AUTH,
        engineId: PROBE_ENGINE_ID,
        pduType: BerTag.InformRequestPdu,
      }),
      DEVICE,
    );

    accepted(outcome);
    const { message, scopedPdu } = readReply(replyOf(outcome));
    expect(message.flags.isAuthenticated).toBe(false);
    expect(scopedPdu.pduType).toBe(BerTag.ResponsePdu);
  });

  test("an inform naming the probe's own engine as its context does not pass it off as the sender's", () => {
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({
          credential: SAN_MONITOR,
          engineId: PROBE_ENGINE_ID,
          engineTime: probeTime(),
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      ),
    );

    expect(notification.senderEngineId.length).toBe(0);
  });

  test("each Response is encrypted with a salt of its own", () => {
    const first: Buffer = replyOf(
      processor.process(
        buildTestV3Message({
          credential: SAN_MONITOR,
          engineId: PROBE_ENGINE_ID,
          engineTime: probeTime(),
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      ),
    );
    const second: Buffer = replyOf(
      processor.process(
        buildTestV3Message({
          credential: SAN_MONITOR,
          engineId: PROBE_ENGINE_ID,
          engineTime: probeTime(),
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      ),
    );

    expect(
      parseV3Message(first).privParameters.equals(
        parseV3Message(second).privParameters,
      ),
    ).toBe(false);
  });
});

describe("engine discovery", () => {
  test("a probe with no engine ID and no user is answered with the probe's engine ID, boots and time", () => {
    const outcome: SnmpV3Outcome = processor.process(
      buildDiscoveryProbe(5150),
      DEVICE,
    );

    expect(outcome.kind).toBe("discovery");
    const scopedPdu: ScopedPdu = expectReport(
      replyOf(outcome),
      SnmpTrapRefusalReason.UnknownEngineId,
    );
    expect(parseV3Message(replyOf(outcome)).msgId).toBe(5150);
    expect(scopedPdu.contextEngineId.equals(PROBE_ENGINE_ID)).toBe(true);
    expect(scopedPdu.requestId).toBe(777);
  });

  test("discovery is not a refusal, and the counter in each report goes up", () => {
    const first: ScopedPdu = expectReport(
      replyOf(processor.process(buildDiscoveryProbe(), DEVICE)),
      SnmpTrapRefusalReason.UnknownEngineId,
    );
    const second: ScopedPdu = expectReport(
      replyOf(processor.process(buildDiscoveryProbe(), DEVICE)),
      SnmpTrapRefusalReason.UnknownEngineId,
    );

    expect(second.varbinds[0]!.value).toBe(
      (first.varbinds[0]!.value as number) + 1,
    );
  });

  test("the probe's time in its reports moves with the clock", () => {
    const before: number = parseV3Message(
      replyOf(processor.process(buildDiscoveryProbe(), DEVICE)),
    ).engineTime;

    nowMs += 90 * 1000;

    expect(
      parseV3Message(replyOf(processor.process(buildDiscoveryProbe(), DEVICE)))
        .engineTime,
    ).toBe(before + 90);
  });
});

describe("refusals", () => {
  test("an unknown user: a trap is refused without an answer", () => {
    const outcome: SnmpV3Outcome = processor.process(
      buildTestV3Message({
        credential: { ...SAN_MONITOR, userName: "stranger" },
        engineId: DEVICE_ENGINE_ID,
      }),
      DEVICE,
    );

    expect(outcome).toEqual({
      kind: "refused",
      reason: SnmpTrapRefusalReason.UnknownUser,
      userName: "stranger",
    });
  });

  test("an unknown user: an inform is answered with usmStatsUnknownUserNames", () => {
    const outcome: SnmpV3Outcome = processor.process(
      buildTestV3Message({
        credential: { ...SAN_MONITOR, userName: "stranger" },
        engineId: PROBE_ENGINE_ID,
        engineTime: probeTime(),
        pduType: BerTag.InformRequestPdu,
      }),
      DEVICE,
    );

    expect(refusedFor(outcome)).toBe(SnmpTrapRefusalReason.UnknownUser);
    expectReport(replyOf(outcome), SnmpTrapRefusalReason.UnknownUser);
  });

  test("a wrong authentication passphrase", () => {
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: {
              ...SAN_MONITOR,
              authPassphrase: "not-the-passphrase",
            },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.WrongDigest);
  });

  test("a wrong authentication protocol is a wrong digest too", () => {
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: { ...SAN_MONITOR, authProtocol: SnmpAuthProtocol.MD5 },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.WrongDigest);
  });

  test("a wrong digest on an inform is answered with usmStatsWrongDigests", () => {
    const outcome: SnmpV3Outcome = processor.process(
      buildTestV3Message({
        credential: { ...SAN_MONITOR, authPassphrase: "not-the-passphrase" },
        engineId: PROBE_ENGINE_ID,
        engineTime: probeTime(),
        pduType: BerTag.InformRequestPdu,
      }),
      DEVICE,
    );

    expect(refusedFor(outcome)).toBe(SnmpTrapRefusalReason.WrongDigest);
    expectReport(replyOf(outcome), SnmpTrapRefusalReason.WrongDigest);
  });

  test("a wrong privacy passphrase", () => {
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: {
              ...SAN_MONITOR,
              privPassphrase: "not-the-privacy-one",
            },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.DecryptionError);
  });

  test("a wrong privacy protocol (DES where AES is configured)", () => {
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: { ...SAN_MONITOR, privProtocol: SnmpPrivProtocol.DES },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.DecryptionError);
  });

  test("a decryption error on an inform is answered with usmStatsDecryptionErrors", () => {
    const outcome: SnmpV3Outcome = processor.process(
      buildTestV3Message({
        credential: { ...SAN_MONITOR, privPassphrase: "not-the-privacy-one" },
        engineId: PROBE_ENGINE_ID,
        engineTime: probeTime(),
        pduType: BerTag.InformRequestPdu,
      }),
      DEVICE,
    );

    expect(refusedFor(outcome)).toBe(SnmpTrapRefusalReason.DecryptionError);
    expectReport(replyOf(outcome), SnmpTrapRefusalReason.DecryptionError);
  });

  describe("less security than the user is configured for", () => {
    test("an authPriv user's trap without authentication", () => {
      expect(
        refusedFor(
          processor.process(
            buildTestV3Message({
              credential: { userName: "san-monitor" },
              engineId: DEVICE_ENGINE_ID,
            }),
            DEVICE,
          ),
        ),
      ).toBe(SnmpTrapRefusalReason.UnsupportedSecurityLevel);
    });

    test("an authPriv user's trap authenticated but in the clear", () => {
      expect(
        refusedFor(
          processor.process(
            buildTestV3Message({
              credential: SAN_MONITOR,
              level: SnmpSecurityLevel.AuthNoPriv,
              engineId: DEVICE_ENGINE_ID,
            }),
            DEVICE,
          ),
        ),
      ).toBe(SnmpTrapRefusalReason.UnsupportedSecurityLevel);
    });

    test("an authNoPriv user's trap without authentication", () => {
      expect(
        refusedFor(
          processor.process(
            buildTestV3Message({
              credential: { userName: "auth-only" },
              engineId: DEVICE_ENGINE_ID,
            }),
            DEVICE,
          ),
        ),
      ).toBe(SnmpTrapRefusalReason.UnsupportedSecurityLevel);
    });

    test("an inform is answered with usmStatsUnsupportedSecLevels", () => {
      const outcome: SnmpV3Outcome = processor.process(
        buildTestV3Message({
          credential: { userName: "san-monitor" },
          engineId: PROBE_ENGINE_ID,
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      );

      expect(refusedFor(outcome)).toBe(
        SnmpTrapRefusalReason.UnsupportedSecurityLevel,
      );
      expectReport(
        replyOf(outcome),
        SnmpTrapRefusalReason.UnsupportedSecurityLevel,
      );
    });
  });

  describe("an inform sent to another engine than the probe's", () => {
    test("signed with keys localized to that engine (a device given a wrong engine ID for the probe)", () => {
      const outcome: SnmpV3Outcome = processor.process(
        buildTestV3Message({
          credential: SAN_MONITOR,
          engineId: OTHER_DEVICE_ENGINE_ID,
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      );

      expect(refusedFor(outcome)).toBe(SnmpTrapRefusalReason.UnknownEngineId);
      expectReport(replyOf(outcome), SnmpTrapRefusalReason.UnknownEngineId);
    });

    test("unsigned", () => {
      const outcome: SnmpV3Outcome = processor.process(
        buildTestV3Message({
          credential: NO_AUTH,
          engineId: OTHER_DEVICE_ENGINE_ID,
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      );

      expect(refusedFor(outcome)).toBe(SnmpTrapRefusalReason.UnknownEngineId);
      expectReport(replyOf(outcome), SnmpTrapRefusalReason.UnknownEngineId);
    });
  });
});

describe("the time window", () => {
  function trapAt(
    boots: number,
    time: number,
    engineId: Buffer = DEVICE_ENGINE_ID,
  ): SnmpV3Outcome {
    return processor.process(
      buildTestV3Message({
        credential: AUTH_ONLY,
        engineId: engineId,
        engineBoots: boots,
        engineTime: time,
      }),
      DEVICE,
    );
  }

  test("a trap's engine is trusted the first time it is heard from", () => {
    accepted(trapAt(1, 1));
    accepted(trapAt(2147483646, 2147483646, OTHER_DEVICE_ENGINE_ID));
  });

  test("its time going forward, and a restart it counted, are taken", () => {
    accepted(trapAt(5, 1000));
    accepted(trapAt(5, 1500));
    accepted(trapAt(6, 3));
  });

  test("a trap from further back than the window is refused: a replay, or a delayed copy", () => {
    accepted(trapAt(5, 1000));

    expect(refusedFor(trapAt(5, 1000 - SNMP_TIME_WINDOW_SECONDS - 1))).toBe(
      SnmpTrapRefusalReason.NotInTimeWindow,
    );
  });

  test("one from a little back is taken and moves nothing", () => {
    accepted(trapAt(5, 1000));
    accepted(trapAt(5, 1000 - SNMP_TIME_WINDOW_SECONDS));

    // The engine's clock is still where its newest trap put it.
    expect(refusedFor(trapAt(5, 1000 - SNMP_TIME_WINDOW_SECONDS - 1))).toBe(
      SnmpTrapRefusalReason.NotInTimeWindow,
    );
  });

  test("the engine's clock is reckoned forward while it is quiet", () => {
    accepted(trapAt(5, 1000));
    nowMs += 600 * 1000;

    // Behind its last trap, and 600 seconds behind where its clock must be now.
    expect(refusedFor(trapAt(5, 999))).toBe(
      SnmpTrapRefusalReason.NotInTimeWindow,
    );
    accepted(trapAt(5, 1600));
  });

  test("boots going backwards is refused", () => {
    accepted(trapAt(5, 1000));
    expect(refusedFor(trapAt(4, 99999))).toBe(
      SnmpTrapRefusalReason.NotInTimeWindow,
    );
  });

  test("an engine at the last boots there is is never in the window again", () => {
    accepted(trapAt(2147483647, 10));
    expect(refusedFor(trapAt(2147483647, 11))).toBe(
      SnmpTrapRefusalReason.NotInTimeWindow,
    );
  });

  test("a sender that never moves its clock (boots and time 0, as net-snmp sends) is taken every time", () => {
    accepted(trapAt(0, 0));
    nowMs += 3600 * 1000;
    accepted(trapAt(0, 0));
  });

  test("engines are kept apart", () => {
    accepted(trapAt(5, 1000));
    accepted(trapAt(1, 1, OTHER_DEVICE_ENGINE_ID));
  });

  test("a forged message cannot move an engine's clock: only authentic ones are counted", () => {
    accepted(trapAt(5, 1000));

    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: { ...AUTH_ONLY, authPassphrase: "forger-guess" },
            engineId: DEVICE_ENGINE_ID,
            engineBoots: 99,
            engineTime: 99999,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.WrongDigest);

    // Had the forgery counted, boots 5 would now be refused.
    accepted(trapAt(5, 1001));
  });

  describe("an inform must be within the probe's own window", () => {
    function informAt(boots: number, time: number): SnmpV3Outcome {
      return processor.process(
        buildTestV3Message({
          credential: SAN_MONITOR,
          engineId: PROBE_ENGINE_ID,
          engineBoots: boots,
          engineTime: time,
          pduType: BerTag.InformRequestPdu,
        }),
        DEVICE,
      );
    }

    test("150 seconds either way is in it", () => {
      accepted(
        informAt(SNMP_ENGINE_BOOTS, probeTime() - SNMP_TIME_WINDOW_SECONDS),
      );
      accepted(
        informAt(SNMP_ENGINE_BOOTS, probeTime() + SNMP_TIME_WINDOW_SECONDS),
      );
    });

    test("more is not, and the sender is told the probe's time in a SIGNED report it can trust", () => {
      const outcome: SnmpV3Outcome = informAt(
        SNMP_ENGINE_BOOTS,
        probeTime() - SNMP_TIME_WINDOW_SECONDS - 1,
      );

      expect(refusedFor(outcome)).toBe(SnmpTrapRefusalReason.NotInTimeWindow);

      const { message } = readReply(replyOf(outcome), SAN_MONITOR);
      expect(message.flags.isAuthenticated).toBe(true);
      expect(message.flags.isEncrypted).toBe(false);
      expect(message.userName.toString()).toBe("san-monitor");
      expectReport(
        replyOf(outcome),
        SnmpTrapRefusalReason.NotInTimeWindow,
        SAN_MONITOR,
      );
    });

    test("other boots is not", () => {
      expect(refusedFor(informAt(SNMP_ENGINE_BOOTS + 1, probeTime()))).toBe(
        SnmpTrapRefusalReason.NotInTimeWindow,
      );
    });
  });
});

describe("one user name, several keys", () => {
  test("the key of the device at the source address signs it", () => {
    expect(
      accepted(
        processor.process(
          buildTestV3Message({
            credential: SHARED_AT_DEVICE,
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ).userName,
    ).toBe("shared");
  });

  test("another device's key is tried too: a device may send from an address it is not registered with", () => {
    expect(
      accepted(
        processor.process(
          buildTestV3Message({
            credential: SHARED_AT_OTHER_DEVICE,
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ).securityLevel,
    ).toBe(SnmpSecurityLevel.AuthNoPriv);
  });

  test("neither key: a wrong digest", () => {
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: { ...SHARED_AT_DEVICE, authPassphrase: "a third key" },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.WrongDigest);
  });
});

describe("who signed it is sent back with it (#11172)", () => {
  const BLADE_1: TestCredential = {
    userName: "blade-monitor",
    authProtocol: SnmpAuthProtocol.SHA,
    authPassphrase: "blade-1-auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES,
    privPassphrase: "blade-1-priv-passphrase",
  };
  const BLADE_2: TestCredential = {
    ...BLADE_1,
    authPassphrase: "blade-2-auth-passphrase",
    privPassphrase: "blade-2-priv-passphrase",
  };
  const OPEN: TestCredential = { userName: "open-traps" };

  function holders(deviceId: string): SnmpV3CredentialHolders {
    return {
      projectIds: ["11720000-0000-4000-8000-0000000000a1"],
      deviceIds: [deviceId],
      siteIds: [],
    };
  }

  const HELD_BY_BLADE_1: SnmpV3CredentialHolders = holders(
    "11720000-0000-4000-8000-000000000b01",
  );
  const HELD_BY_BLADE_2: SnmpV3CredentialHolders = holders(
    "11720000-0000-4000-8000-000000000b02",
  );

  beforeEach(() => {
    // Two blades behind one chassis address: one user name, their own keys.
    users.replace([
      {
        ...user(BLADE_1, SnmpSecurityLevel.AuthPriv),
        heldBy: HELD_BY_BLADE_1,
      },
      {
        ...user(BLADE_2, SnmpSecurityLevel.AuthPriv),
        heldBy: HELD_BY_BLADE_2,
      },
      {
        ...user(OPEN, SnmpSecurityLevel.NoAuthNoPriv),
        heldBy: holders("11720000-0000-4000-8000-000000000b03"),
      },
      user(SAN_MONITOR, SnmpSecurityLevel.AuthPriv),
    ]);
  });

  test("a trap carries the holders of the key that verified it, not of the name it came as", () => {
    expect(
      accepted(
        processor.process(
          buildTestV3Message({ credential: BLADE_1, engineId: DEVICE_ENGINE_ID }),
          DEVICE,
        ),
      ).signedBy,
    ).toEqual(HELD_BY_BLADE_1);

    expect(
      accepted(
        processor.process(
          buildTestV3Message({
            credential: BLADE_2,
            engineId: OTHER_DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ).signedBy,
    ).toEqual(HELD_BY_BLADE_2);
  });

  test("an inform carries them too", () => {
    expect(
      accepted(
        processor.process(
          buildTestV3Message({
            credential: BLADE_2,
            engineId: PROBE_ENGINE_ID,
            engineBoots: SNMP_ENGINE_BOOTS,
            engineTime: probeTime(),
            pduType: BerTag.InformRequestPdu,
          }),
          DEVICE,
        ),
      ).signedBy,
    ).toEqual(HELD_BY_BLADE_2);
  });

  test("a noAuthNoPriv trap carries none: its user name is anyone's to send", () => {
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({ credential: OPEN, engineId: DEVICE_ENGINE_ID }),
        DEVICE,
      ),
    );

    expect(notification.userName).toBe("open-traps");
    expect(notification).not.toHaveProperty("signedBy");
  });

  test("a user OneUptime handed with no holders (a server older than #11172) sends none", () => {
    expect(
      accepted(
        processor.process(
          buildTestV3Message({
            credential: SAN_MONITOR,
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).not.toHaveProperty("signedBy");
  });
});

describe("nothing in a refused message is read past its user name", () => {
  test("a message whose digest is wrong is never decrypted", () => {
    const decrypt: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UsmCrypto,
      "decrypt",
    );

    try {
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: {
              ...SAN_MONITOR,
              authPassphrase: "not-the-passphrase",
            },
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      );

      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
  });

  test("an unknown user's message derives no key", () => {
    const passwordToKu: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UsmCrypto,
      "passwordToKu",
    );

    try {
      const datagram: Buffer = buildTestV3Message({
        credential: { ...SAN_MONITOR, userName: "stranger" },
        engineId: DEVICE_ENGINE_ID,
      });
      passwordToKu.mockClear();

      refusedFor(processor.process(datagram, DEVICE));
      expect(passwordToKu).not.toHaveBeenCalled();
    } finally {
      passwordToKu.mockRestore();
    }
  });
});

describe("what is not a notification, or not an SNMPv3 message at all", () => {
  test("noise", () => {
    expect(processor.process(Buffer.from("not snmp"), DEVICE)).toEqual({
      kind: "ignored",
      why: "malformed",
    });
    expect(processor.process(Buffer.alloc(0), DEVICE).kind).toBe("ignored");
  });

  test("a message cut short", () => {
    const datagram: Buffer = buildTestV3Message({
      credential: SAN_MONITOR,
      engineId: DEVICE_ENGINE_ID,
    });

    for (const length of [1, 10, 40, datagram.length - 1]) {
      expect(processor.process(datagram.subarray(0, length), DEVICE).kind).toBe(
        "ignored",
      );
    }
  });

  test("another security model than USM", () => {
    const datagram: Buffer = Buffer.from(
      buildTestV3Message({ credential: NO_AUTH, engineId: DEVICE_ENGINE_ID }),
    );
    // The header's last INTEGER is msgSecurityModel: 3 -> 2.
    const header: number = datagram.indexOf(Buffer.from([0x02, 0x01, 0x03]), 8);
    datagram[header + 2] = 0x02;

    expect(processor.process(datagram, DEVICE)).toEqual({
      kind: "ignored",
      why: "unsupportedSecurityModel",
    });
  });

  test("privacy without authentication is not a valid message", () => {
    const datagram: Buffer = Buffer.from(
      buildTestV3Message({ credential: NO_AUTH, engineId: DEVICE_ENGINE_ID }),
    );
    // msgFlags: 0x00 -> 0x02 (priv without auth).
    const flags: number = datagram.indexOf(Buffer.from([0x04, 0x01, 0x00]));
    datagram[flags + 2] = 0x02;

    expect(processor.process(datagram, DEVICE)).toEqual({
      kind: "ignored",
      why: "malformed",
    });
  });

  test.each([
    ["a GetRequest", BerTag.GetRequestPdu],
    ["a Response", BerTag.ResponsePdu],
    ["a Report", BerTag.ReportPdu],
    ["a SetRequest", BerTag.SetRequestPdu],
  ] as Array<[string, number]>)(
    "%s, even signed, is not a notification",
    (_name: string, pduType: number) => {
      expect(
        processor.process(
          buildTestV3Message({
            credential: AUTH_ONLY,
            engineId: PROBE_ENGINE_ID,
            engineTime: probeTime(),
            pduType: pduType,
            isReportable: false,
          }),
          DEVICE,
        ),
      ).toEqual({ kind: "ignored", why: "notANotification" });
    },
  );

  test("a trap with the reportable flag a sender should not set is still a trap", () => {
    accepted(
      processor.process(
        buildTestV3Message({
          credential: NO_AUTH,
          engineId: DEVICE_ENGINE_ID,
          isReportable: true,
        }),
        DEVICE,
      ),
    );
  });

  test("a varbind of a type net-snmp does not know is kept as its octets", () => {
    const notification: SnmpV3Notification = accepted(
      processor.process(
        buildTestV3Message({
          credential: AUTH_ONLY,
          engineId: DEVICE_ENGINE_ID,
          varbinds: [
            ...linkDownVarbinds(),
            {
              oid: "1.3.6.1.4.1.1.1",
              value: Buffer.from([0x47, 0x02, 0xab, 0xcd]),
            },
          ],
        }),
        DEVICE,
      ),
    );

    expect(notification.varbinds[3]).toEqual({
      oid: "1.3.6.1.4.1.1.1",
      type: 0x47,
      value: Buffer.from([0xab, 0xcd]),
    });
  });

  test("a scoped PDU with no PDU in it is malformed, not a crash", () => {
    const datagram: Buffer = buildTestV3Message({
      credential: NO_AUTH,
      engineId: DEVICE_ENGINE_ID,
    });
    const parsed: ParsedSnmpV3Message = parseV3Message(datagram);
    const empty: Buffer = encodeConstructed([
      encodeOctetString(Buffer.alloc(0)),
      encodeOctetString(Buffer.alloc(0)),
      encodeInteger(1),
    ]);

    expect(parsed.scopedPdu).toBeDefined();
    expect(() => {
      parseScopedPdu(empty);
    }).toThrow();
    expect(oidValue("1.3.6").length).toBeGreaterThan(0);
    expect(integerValue(1).length).toBe(3);
  });
});

describe("users replaced while it runs", () => {
  test("a user added is taken at once, one removed refused at once", () => {
    const newcomer: TestCredential = {
      userName: "newcomer",
      authProtocol: SnmpAuthProtocol.SHA256,
      authPassphrase: "newcomer-passphrase",
    };

    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: newcomer,
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.UnknownUser);

    users.replace([...USERS, user(newcomer, SnmpSecurityLevel.AuthNoPriv)]);

    accepted(
      processor.process(
        buildTestV3Message({
          credential: newcomer,
          engineId: DEVICE_ENGINE_ID,
        }),
        DEVICE,
      ),
    );

    users.replace(USERS);

    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: newcomer,
            engineId: DEVICE_ENGINE_ID,
            engineTime: 200,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.UnknownUser);
  });

  test("a passphrase changed takes the new one and refuses the old one", () => {
    const changed: TestCredential = {
      ...AUTH_ONLY,
      authPassphrase: "the-rotated-passphrase",
    };

    users.replace([
      ...USERS.filter((receiverUser: SnmpTrapReceiverUser) => {
        return receiverUser.userName !== "auth-only";
      }),
      user(changed, SnmpSecurityLevel.AuthNoPriv),
    ]);

    accepted(
      processor.process(
        buildTestV3Message({ credential: changed, engineId: DEVICE_ENGINE_ID }),
        DEVICE,
      ),
    );
    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: AUTH_ONLY,
            engineId: DEVICE_ENGINE_ID,
            engineTime: 101,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.WrongDigest);
  });

  test("a security level raised refuses what the old level sent", () => {
    users.replace([
      ...USERS.filter((receiverUser: SnmpTrapReceiverUser) => {
        return receiverUser.userName !== "lab-noauth";
      }),
      user(
        {
          userName: "lab-noauth",
          authProtocol: SnmpAuthProtocol.SHA,
          authPassphrase: "now-it-has-one",
        },
        SnmpSecurityLevel.AuthNoPriv,
      ),
    ]);

    expect(
      refusedFor(
        processor.process(
          buildTestV3Message({
            credential: NO_AUTH,
            engineId: DEVICE_ENGINE_ID,
          }),
          DEVICE,
        ),
      ),
    ).toBe(SnmpTrapRefusalReason.UnsupportedSecurityLevel);
  });
});

test("the usmStats counter of each reason counts its refusals", () => {
  for (let index: number = 0; index < 3; index++) {
    processor.process(
      buildTestV3Message({
        credential: { ...SAN_MONITOR, userName: `stranger-${index}` },
        engineId: DEVICE_ENGINE_ID,
      }),
      DEVICE,
    );
  }

  expect(processor.getUsmStat(SnmpTrapRefusalReason.UnknownUser)).toBe(3);
  expect(processor.getUsmStat(SnmpTrapRefusalReason.WrongDigest)).toBe(0);
});
