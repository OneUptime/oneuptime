import MqttPacketSizeGuard from "../../FeatureSet/Telemetry/Utils/MqttPacketSizeGuard";
import { describe, expect, test } from "@jest/globals";

/*
 * The guard is the only thing standing between a hostile connection
 * and mqtt-packet buffering a ~256 MB declared packet on the heap —
 * pin down the varint walk.
 */

// Encode an MQTT remaining-length varint.
function varint(value: number): Buffer {
  const bytes: Array<number> = [];
  let remaining: number = value;
  do {
    let byte: number = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function packet(remainingLength: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x30]), // PUBLISH fixed header
    varint(remainingLength),
    Buffer.alloc(remainingLength),
  ] as unknown as Array<Uint8Array>);
}

describe("MqttPacketSizeGuard", () => {
  test("accepts packets at the limit", () => {
    const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(1024);
    expect(guard.feed(packet(1024))).toBe(true);
  });

  test("rejects a packet declaring more than the limit before its body arrives", () => {
    const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(1024);
    // Header + varint only — no body bytes sent yet.
    const header: Buffer = Buffer.concat([
      Buffer.from([0x30]),
      varint(256 * 1024 * 1024 - 1), // ~256 MB declared
    ] as unknown as Array<Uint8Array>);
    expect(guard.feed(header)).toBe(false);
  });

  test("rejects a malformed 5-byte varint", () => {
    const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(1024);
    const malformed: Buffer = Buffer.from([0x30, 0x80, 0x80, 0x80, 0x80, 0x01]);
    expect(guard.feed(malformed)).toBe(false);
  });

  test("tracks packets across arbitrary chunk boundaries", () => {
    const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(1024);
    const bytes: Buffer = Buffer.concat([
      packet(10),
      packet(1024),
      packet(0), // zero-length body (e.g. PINGREQ shape)
      packet(500),
    ] as unknown as Array<Uint8Array>);
    // Feed one byte at a time — worst-case fragmentation.
    for (let i: number = 0; i < bytes.length; i++) {
      expect(guard.feed(bytes.subarray(i, i + 1))).toBe(true);
    }
  });

  test("rejects an oversized packet that follows valid ones in the same stream", () => {
    const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(1024);
    expect(guard.feed(packet(100))).toBe(true);
    expect(guard.feed(packet(50))).toBe(true);
    const oversized: Buffer = Buffer.concat([
      Buffer.from([0x30]),
      varint(1025),
    ] as unknown as Array<Uint8Array>);
    expect(guard.feed(oversized)).toBe(false);
  });

  test("handles a chunk containing the end of one packet and the start of the next", () => {
    const guard: MqttPacketSizeGuard = new MqttPacketSizeGuard(1024);
    const two: Buffer = Buffer.concat([
      packet(3),
      packet(5),
    ] as unknown as Array<Uint8Array>);
    expect(guard.feed(two.subarray(0, 4))).toBe(true); // header+varint+2 body bytes
    expect(guard.feed(two.subarray(4))).toBe(true); // rest of body + next packet
  });
});
