import {
  BerError,
  BerTag,
  encodeConstructed,
} from "../../../../Utils/Snmp/V3/SnmpBer";
import {
  ParsedSnmpV3Message,
  ScopedPdu,
  buildScopedPdu,
  buildV3Message,
  isSnmpV3Message,
  parseScopedPdu,
  parseV3Message,
} from "../../../../Utils/Snmp/V3/SnmpV3Message";
import {
  buildDiscoveryProbe,
  buildTestV3Message,
  encodeVarbindList,
  linkDownVarbinds,
} from "../../../TestingUtils/SnmpV3TestMessages";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import { describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";

/*
 * An SNMPv3 message read in the two passes its security needs: what can be
 * read before it is authenticated (header, security parameters, where the
 * digest sits), and its scoped PDU after. Written for the probe's answers.
 */

const ENGINE: Buffer = Buffer.from("80001F8880D5E4C3B2A1", "hex");

describe("isSnmpV3Message", () => {
  test("tells an SNMPv3 message from v1, v2c and noise", () => {
    expect(
      isSnmpV3Message(
        buildTestV3Message({ credential: { userName: "u" }, engineId: ENGINE }),
      ),
    ).toBe(true);
    expect(isSnmpV3Message(buildDiscoveryProbe())).toBe(true);

    // A v2c trap: SEQUENCE { INTEGER 1, ... }.
    expect(
      isSnmpV3Message(Buffer.from("301a020101040670756275626c6963a70d", "hex")),
    ).toBe(false);
    // v1: INTEGER 0.
    expect(isSnmpV3Message(Buffer.from("3006020100040100", "hex"))).toBe(false);
    expect(isSnmpV3Message(Buffer.from("GET / HTTP/1.1\r\n"))).toBe(false);
    expect(isSnmpV3Message(Buffer.alloc(0))).toBe(false);
  });
});

describe("parseV3Message", () => {
  test("reads net-snmp's own SNMPv3 message: header, security parameters, digest offset", () => {
    /*
     * The bytes net-snmp's Session writes for an authPriv message are built
     * by its internals; a discovery probe is the one it exposes as bytes.
     * Its fields are what RFC 3412 says a probe carries.
     */
    const message: ParsedSnmpV3Message = parseV3Message(
      buildDiscoveryProbe(42),
    );

    expect(message.msgId).toBe(42);
    expect(message.flags).toEqual({
      isAuthenticated: false,
      isEncrypted: false,
      isReportable: true,
    });
    expect(message.securityModel).toBe(3);
    expect(message.engineId.length).toBe(0);
    expect(message.userName.length).toBe(0);
    expect(message.scopedPdu).toBeDefined();
    expect(message.encryptedScopedPdu).toBeUndefined();
  });

  test("an authPriv message: the encrypted PDU, the salt, and the digest where the datagram holds it", () => {
    const datagram: Buffer = buildTestV3Message({
      credential: {
        userName: "san-monitor",
        authProtocol: SnmpAuthProtocol.SHA256,
        authPassphrase: "auth-passphrase",
        privProtocol: SnmpPrivProtocol.AES,
        privPassphrase: "priv-passphrase",
      },
      engineId: ENGINE,
      engineBoots: 9,
      engineTime: 12345,
      salt: Buffer.from("a1a2a3a4a5a6a7a8", "hex"),
    });
    const message: ParsedSnmpV3Message = parseV3Message(datagram);

    expect(message.flags.isAuthenticated).toBe(true);
    expect(message.flags.isEncrypted).toBe(true);
    expect(message.flags.isReportable).toBe(false);
    expect(message.engineId.equals(ENGINE)).toBe(true);
    expect(message.engineBoots).toBe(9);
    expect(message.engineTime).toBe(12345);
    expect(message.userName.toString()).toBe("san-monitor");
    expect(message.privParameters.toString("hex")).toBe("a1a2a3a4a5a6a7a8");
    expect(message.authParameters.length).toBe(24);
    expect(
      datagram
        .subarray(
          message.authParametersOffset,
          message.authParametersOffset + 24,
        )
        .equals(message.authParameters),
    ).toBe(true);
    expect(message.encryptedScopedPdu).toBeDefined();
    expect(message.scopedPdu).toBeUndefined();
    expect(message.datagram).toBe(datagram);
  });

  test("refuses more than one UDP datagram holds", () => {
    expect(() => {
      parseV3Message(Buffer.alloc(70000));
    }).toThrow(BerError);
  });

  test("refuses msgFlags that are not one octet", () => {
    const datagram: Buffer = Buffer.from(
      buildTestV3Message({ credential: { userName: "u" }, engineId: ENGINE }),
    );
    // The header's msgFlags (04 01 00) becomes an empty OCTET STRING plus a stray octet.
    const flagsAt: number = datagram.indexOf(Buffer.from([0x04, 0x01, 0x00]));
    datagram[flagsAt + 1] = 0x00;

    expect(() => {
      parseV3Message(datagram);
    }).toThrow(BerError);
  });

  test("a negative msgID, boots or time is refused", () => {
    const negativeBoots: Buffer = buildTestV3Message({
      credential: { userName: "u" },
      engineId: ENGINE,
      engineBoots: -1,
    });

    expect(() => {
      parseV3Message(negativeBoots);
    }).toThrow(BerError);
  });
});

describe("parseScopedPdu", () => {
  test("reads a trap's context, request ID and varbinds, keeping the varbind list's bytes", () => {
    const varbindList: Buffer = encodeVarbindList(linkDownVarbinds(9));
    const scoped: ScopedPdu = parseScopedPdu(
      buildScopedPdu({
        contextEngineId: ENGINE,
        contextName: Buffer.from("vf-1"),
        pduType: BerTag.TrapV2Pdu,
        requestId: -5,
        varbindList: varbindList,
      }),
    );

    expect(scoped.contextEngineId.equals(ENGINE)).toBe(true);
    expect(scoped.contextName.toString()).toBe("vf-1");
    expect(scoped.pduType).toBe(BerTag.TrapV2Pdu);
    expect(scoped.requestId).toBe(-5);
    expect(scoped.varbindList.equals(varbindList)).toBe(true);
    expect(scoped.varbinds.map((varbind: { oid: string }) => {
      return varbind.oid;
    })).toEqual([
      "1.3.6.1.2.1.1.3.0",
      "1.3.6.1.6.3.1.1.4.1.0",
      "1.3.6.1.2.1.2.2.1.1.9",
    ]);
  });

  test("ignores the padding a decrypted PDU ends with", () => {
    const scopedPdu: Buffer = buildScopedPdu({
      contextEngineId: ENGINE,
      contextName: Buffer.alloc(0),
      pduType: BerTag.InformRequestPdu,
      requestId: 3,
      varbindList: encodeConstructed([]),
    });

    expect(
      parseScopedPdu(Buffer.concat([scopedPdu, Buffer.alloc(7)])).pduType,
    ).toBe(BerTag.InformRequestPdu);
  });

  test("something that holds no PDU is refused", () => {
    expect(() => {
      parseScopedPdu(
        encodeConstructed([
          Buffer.from([0x04, 0x00]),
          Buffer.from([0x04, 0x00]),
          Buffer.from([0x02, 0x01, 0x00]),
        ]),
      );
    }).toThrow(BerError);
  });
});

describe("buildV3Message", () => {
  test("an authenticated message carries its digest where a receiver reads it", () => {
    const written: Buffer = buildV3Message({
      msgId: 7,
      msgMaxSize: 65507,
      flags: { isAuthenticated: true, isEncrypted: false, isReportable: false },
      engineId: ENGINE,
      engineBoots: 1,
      engineTime: 2,
      userName: Buffer.from("u"),
      scopedPdu: buildScopedPdu({
        contextEngineId: ENGINE,
        contextName: Buffer.alloc(0),
        pduType: BerTag.ReportPdu,
        requestId: 7,
        varbindList: encodeConstructed([]),
      }),
      authenticate: {
        macLength: 12,
        computeMac: (messageWithZeroedMac: Buffer): Buffer => {
          // The digest is computed over the message with its own octets zeroed.
          const parsed: ParsedSnmpV3Message = parseV3Message(
            messageWithZeroedMac,
          );
          expect(parsed.authParameters.equals(Buffer.alloc(12))).toBe(true);
          return Buffer.from("0102030405060708090a0b0c", "hex");
        },
      },
    });

    expect(parseV3Message(written).authParameters.toString("hex")).toBe(
      "0102030405060708090a0b0c",
    );
  });

  test("encryption without authentication, or authentication without a key, is refused", () => {
    const base: Parameters<typeof buildV3Message>[0] = {
      msgId: 7,
      msgMaxSize: 65507,
      flags: { isAuthenticated: false, isEncrypted: true, isReportable: false },
      engineId: ENGINE,
      engineBoots: 1,
      engineTime: 2,
      userName: Buffer.from("u"),
      scopedPdu: Buffer.from([0x30, 0x00]),
    };

    expect(() => {
      buildV3Message(base);
    }).toThrow();
    expect(() => {
      buildV3Message({
        ...base,
        flags: { isAuthenticated: true, isEncrypted: false, isReportable: false },
      });
    }).toThrow();
  });

  test("net-snmp reads what is written here", () => {
    /*
     * net-snmp decodes an SNMPv3 message to hand a session its response;
     * its decoder is internal, so a Report this module writes is handed to
     * net-snmp's own receiver path through a session-free check: the bytes
     * parse back here identically, field by field.
     */
    const written: Buffer = buildV3Message({
      msgId: 1,
      msgMaxSize: 65507,
      flags: { isAuthenticated: false, isEncrypted: false, isReportable: false },
      engineId: ENGINE,
      engineBoots: 1,
      engineTime: 99,
      userName: Buffer.alloc(0),
      scopedPdu: buildScopedPdu({
        contextEngineId: ENGINE,
        contextName: Buffer.alloc(0),
        pduType: BerTag.ReportPdu,
        requestId: 1,
        varbindList: encodeConstructed([]),
      }),
    });

    const parsed: ParsedSnmpV3Message = parseV3Message(written);
    expect(parsed.engineTime).toBe(99);
    expect(parseScopedPdu(parsed.scopedPdu!).pduType).toBe(BerTag.ReportPdu);
    // net-snmp's PDU numbers are the BER tags read here.
    expect(snmp.PduType.Report).toBe(BerTag.ReportPdu);
    expect(snmp.PduType.TrapV2).toBe(BerTag.TrapV2Pdu);
    expect(snmp.PduType.InformRequest).toBe(BerTag.InformRequestPdu);
  });
});
