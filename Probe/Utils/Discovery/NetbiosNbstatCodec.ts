import { normalizeNetbiosName } from "Common/Utils/NetworkDiscovery/NetbiosNameUtil";

/*
 * The wire format of a NetBIOS NODE STATUS (NBSTAT) query and its response,
 * RFC 1002 sections 4.2.17 and 4.2.18 (OneUptime issue #3677).
 *
 * Pure functions over Buffers, with no socket anywhere, so that every byte
 * this file reads can be pinned by a test and every malformed datagram a
 * scanned network can send is exercised without one.
 *
 * WHY NBSTAT and not a name query: a name query asks "who is FOO?", which only
 * helps if the name is already known. A node status request asks the machine
 * at an ADDRESS for the table of names it has registered — exactly the question
 * a discovered host with no DNS record and no SNMP needs answered. It is plain
 * unicast UDP to port 137, so unlike mDNS or ARP it crosses routers and works
 * from a probe running on Kubernetes pod networking.
 *
 * Everything parsed here is SELF-REPORTED by the host that answered, and the
 * scanned subnet is frequently not administered by this project. The parser is
 * therefore written to be handed hostile bytes: it bounds every read against
 * the buffer, never follows a compression pointer, never allocates in
 * proportion to a length field, and NEVER throws.
 */

/*
 * RFC 1002 4.2.1.1 header, 12 bytes:
 *
 *   NAME_TRN_ID (16) | FLAGS (16) | QDCOUNT (16) | ANCOUNT (16)
 *   NSCOUNT (16)     | ARCOUNT (16)
 *
 * FLAGS packs R (1 bit), OPCODE (4), NM_FLAGS (7) and RCODE (4), from the most
 * significant bit down.
 */
const HEADER_LENGTH: number = 12;
const FLAG_RESPONSE: number = 0x8000;
const FLAG_OPCODE_MASK: number = 0x7800;
const FLAG_RCODE_MASK: number = 0x000f;

// RFC 1002 4.2.1.3: NBSTAT is 0x0021 and IN is 0x0001.
export const NBSTAT_QUESTION_TYPE: number = 0x0021;
export const NBSTAT_QUESTION_CLASS_IN: number = 0x0001;

/*
 * The one query this probe ever sends is exactly this long: the 12-byte
 * header, a 34-byte encoded name (one length byte, 32 encoded characters, the
 * terminating zero-length root label) and 4 bytes of type and class.
 */
export const NBSTAT_QUERY_LENGTH: number = 50;

/*
 * RFC 1002 4.2.18 NAME_FLAGS, 16 bits, drawn MSB-first as:
 *
 *     0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
 *   | G |  ONT  |DRG|CNF|ACT|PRM|           RESERVED                |
 *
 * so bit 0 is 0x8000 and each position to the right halves it:
 *
 *   G   (bit 0)    0x8000  group name, shared by many machines
 *   ONT (bits 1-2) 0x6000  owner node type (B/P/M/H), not used here
 *   DRG (bit 3)    0x1000  name is being deregistered
 *   CNF (bit 4)    0x0800  name is in conflict with another machine
 *   ACT (bit 5)    0x0400  name is active (Windows sets it on every live name)
 *   PRM (bit 6)    0x0200  the permanent node name, not used here
 */
export const NETBIOS_NAME_FLAG_GROUP: number = 0x8000;
export const NETBIOS_NAME_FLAG_DEREGISTERING: number = 0x1000;
export const NETBIOS_NAME_FLAG_CONFLICT: number = 0x0800;
export const NETBIOS_NAME_FLAG_ACTIVE: number = 0x0400;

// RFC 1002 4.2.18: 15 name bytes, 1 suffix byte, 2 flag bytes.
const NODE_NAME_ENTRY_LENGTH: number = 18;
const NETBIOS_NAME_FIELD_LENGTH: number = 15;

/*
 * The service suffixes worth naming a device after. <00> is the workstation
 * service every Windows and Samba host registers under its machine name; <20>
 * is the file server service, registered under the same name, and is the
 * fallback for a stack that registers only that. <03> (messenger) and the
 * domain/browser suffixes (<1B>, <1C>, <1D>, <1E>) are skipped: the first is
 * sometimes the logged-on USER's name, and the rest name the domain.
 */
export const NETBIOS_WORKSTATION_SUFFIX: number = 0x00;
export const NETBIOS_FILE_SERVER_SUFFIX: number = 0x20;

// Label-type bits of a DNS-style length byte (RFC 1035 4.1.4).
const LABEL_TYPE_MASK: number = 0xc0;
const LABEL_TYPE_POINTER: number = 0xc0;

export interface NetbiosNodeName {
  /*
   * The raw 15-byte name field decoded as latin1, padding and all. Kept raw on
   * purpose: this is a codec, and deciding what counts as a usable name is
   * normalizeNetbiosName's job, applied by chooseNetbiosName below.
   */
  name: string;
  // The 16th byte: the service the name is registered for.
  suffix: number;
  isGroup: boolean;
  isConflict: boolean;
  isDeregistering: boolean;
  isActive: boolean;
}

export interface NbstatResponse {
  transactionId: number;
  names: Array<NetbiosNodeName>;
}

/**
 * Coerces anything into a 16-bit transaction id by keeping its low 16 bits.
 *
 * MASKED rather than rejected. The only caller draws ids from 0..0xFFFF, so
 * the choice only matters for a programming error, and throwing from the
 * query encoder would turn that error into a failed enrichment on every scan
 * instead of a query with a different id. Non-finite values become 0.
 * The resolver compares replies against the MASKED id, which is also what
 * parseNbstatResponse reports, so a round trip always agrees.
 */
export function toNbstatTransactionId(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return (Math.trunc(value) & 0xffff) >>> 0;
}

/*
 * RFC 1001 14.1 "first-level encoding": each byte of the 16-byte NetBIOS name
 * becomes two characters, 'A' plus its high nibble and 'A' plus its low
 * nibble. "*" (0x2A) is "CK", and each NUL of the padding is "AA".
 */
function encodeFirstLevel(nameBytes: Buffer): string {
  let encoded: string = "";

  for (const byte of nameBytes) {
    encoded += String.fromCharCode(0x41 + (byte >> 4));
    encoded += String.fromCharCode(0x41 + (byte & 0x0f));
  }

  return encoded;
}

/*
 * The wildcard name an NBSTAT request asks about (RFC 1002 4.2.17): "*"
 * followed by fifteen NULs — NUL-padded, NOT space-padded, which is what makes
 * it the "tell me every name you have" query rather than a lookup of a machine
 * literally called "*".
 */
const WILDCARD_NAME_BYTES: Buffer = Buffer.concat([
  Buffer.from("*", "latin1"),
  Buffer.alloc(NETBIOS_NAME_FIELD_LENGTH),
]);

export const NBSTAT_WILDCARD_ENCODED_NAME: string =
  encodeFirstLevel(WILDCARD_NAME_BYTES);

/**
 * The 50-byte NBSTAT request for one host.
 *
 * FLAGS are all zero: a request (R clear), opcode 0 (query), and no RD or B
 * bit — this is a unicast question to one machine, not a broadcast and not a
 * request to a NetBIOS name server to recurse on our behalf.
 */
export function encodeNbstatQuery(transactionId: number): Buffer {
  const buffer: Buffer = Buffer.alloc(NBSTAT_QUERY_LENGTH);

  buffer.writeUInt16BE(toNbstatTransactionId(transactionId), 0);
  buffer.writeUInt16BE(0x0000, 2); // FLAGS
  buffer.writeUInt16BE(1, 4); // QDCOUNT
  // ANCOUNT, NSCOUNT and ARCOUNT stay zero from Buffer.alloc.

  let offset: number = HEADER_LENGTH;

  buffer.writeUInt8(NBSTAT_WILDCARD_ENCODED_NAME.length, offset); // 0x20
  offset += 1;
  buffer.write(NBSTAT_WILDCARD_ENCODED_NAME, offset, "latin1");
  offset += NBSTAT_WILDCARD_ENCODED_NAME.length;
  buffer.writeUInt8(0x00, offset); // root label
  offset += 1;

  buffer.writeUInt16BE(NBSTAT_QUESTION_TYPE, offset);
  offset += 2;
  buffer.writeUInt16BE(NBSTAT_QUESTION_CLASS_IN, offset);

  return buffer;
}

/*
 * The offset just past a name that starts at `offset`, or null when the name
 * runs off the end of the buffer or uses a reserved label type.
 *
 * A compression pointer (top two bits set) ENDS the name and is NOT followed.
 * Nothing here needs the name's value — only where it stops — and a parser
 * that follows pointers has to defend against loops and forward references;
 * one that skips them has nothing to defend. Every iteration advances by at
 * least one byte, so the loop is bounded by the buffer's length.
 */
function skipEncodedName(buffer: Buffer, start: number): number | null {
  let offset: number = start;

  while (offset < buffer.length) {
    const lengthByte: number = buffer[offset]!;
    const labelType: number = lengthByte & LABEL_TYPE_MASK;

    if (labelType === LABEL_TYPE_POINTER) {
      return offset + 2 <= buffer.length ? offset + 2 : null;
    }

    // 0x40 and 0x80 are reserved label types; nothing legitimate sends them.
    if (labelType !== 0) {
      return null;
    }

    if (lengthByte === 0) {
      return offset + 1;
    }

    offset += 1 + lengthByte;
  }

  return null;
}

/**
 * The node name table from an NBSTAT response, or null when the datagram is
 * not a well-formed successful NBSTAT response.
 *
 * NEVER throws, whatever it is handed — including things that are not Buffers.
 * A datagram arriving at the probe's socket is attacker-controlled input, and
 * an exception out of a 'message' listener is an uncaught exception that ends
 * the probe process.
 *
 * What makes it a response worth reading (anything else is null):
 *   - at least a full header;
 *   - R bit set, OPCODE 0 (query), RCODE 0 (no error);
 *   - ANCOUNT >= 1, and the first answer's TYPE is NBSTAT and CLASS is IN;
 *   - RR_NAME is either a label sequence or a compression pointer;
 *   - there is a NUM_NAMES byte inside RDATA.
 *
 * QDCOUNT is 0 in every response RFC 1002 describes, but a stack that echoes
 * the question is tolerated by skipping the questions it declares.
 *
 * TRUNCATED name tables yield a SUBSET, not null. Only the entries that fit
 * entirely inside BOTH the declared RDLENGTH and the bytes actually received
 * are returned, so an oversized NUM_NAMES, a lying RDLENGTH or a datagram cut
 * short all degrade to "the names we can read". The alternative — refusing the
 * whole reply — would throw away the workstation name, which responders list
 * FIRST, because of damage further down the table. What survives is bounded
 * bytes from the queried address with the right transaction id, and it still
 * has to pass normalizeNetbiosName before it names anything.
 *
 * The STATISTICS block that follows the table (MAC address and counters) is
 * not read or required: Samba zeroes it, some stacks omit it, and nothing here
 * needs it.
 */
export function parseNbstatResponse(buffer: Buffer): NbstatResponse | null {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_LENGTH) {
      return null;
    }

    const transactionId: number = buffer.readUInt16BE(0);
    const flags: number = buffer.readUInt16BE(2);
    const questionCount: number = buffer.readUInt16BE(4);
    const answerCount: number = buffer.readUInt16BE(6);

    if ((flags & FLAG_RESPONSE) === 0) {
      return null;
    }

    if ((flags & FLAG_OPCODE_MASK) !== 0) {
      return null;
    }

    if ((flags & FLAG_RCODE_MASK) !== 0) {
      return null;
    }

    if (answerCount < 1) {
      return null;
    }

    let offset: number = HEADER_LENGTH;

    /*
     * Each question is at least five bytes (a one-byte name plus type and
     * class) and any that does not fit returns null, so a QDCOUNT of 65535 in
     * a 60-byte datagram costs a handful of iterations, not 65535.
     */
    for (let index: number = 0; index < questionCount; index++) {
      const afterName: number | null = skipEncodedName(buffer, offset);

      if (afterName === null || afterName + 4 > buffer.length) {
        return null;
      }

      offset = afterName + 4;
    }

    const afterRecordName: number | null = skipEncodedName(buffer, offset);

    // TYPE (2) + CLASS (2) + TTL (4) + RDLENGTH (2)
    if (afterRecordName === null || afterRecordName + 10 > buffer.length) {
      return null;
    }

    offset = afterRecordName;

    const recordType: number = buffer.readUInt16BE(offset);
    const recordClass: number = buffer.readUInt16BE(offset + 2);
    // TTL at offset + 4 is always 0 for NBSTAT and carries nothing we use.
    const recordDataLength: number = buffer.readUInt16BE(offset + 8);

    if (recordType !== NBSTAT_QUESTION_TYPE) {
      return null;
    }

    if (recordClass !== NBSTAT_QUESTION_CLASS_IN) {
      return null;
    }

    const recordDataStart: number = offset + 10;

    // NUM_NAMES must exist, both by the record's own account and in the bytes.
    if (recordDataLength < 1 || recordDataStart + 1 > buffer.length) {
      return null;
    }

    const declaredNameCount: number = buffer[recordDataStart]!;
    const tableStart: number = recordDataStart + 1;

    const tableBytesAvailable: number = Math.min(
      recordDataLength - 1,
      buffer.length - tableStart,
    );

    const readableNameCount: number = Math.min(
      declaredNameCount,
      Math.floor(tableBytesAvailable / NODE_NAME_ENTRY_LENGTH),
    );

    const names: Array<NetbiosNodeName> = [];

    for (let index: number = 0; index < readableNameCount; index++) {
      const entryStart: number = tableStart + index * NODE_NAME_ENTRY_LENGTH;
      const nameFlags: number = buffer.readUInt16BE(
        entryStart + NETBIOS_NAME_FIELD_LENGTH + 1,
      );

      names.push({
        name: buffer.toString(
          "latin1",
          entryStart,
          entryStart + NETBIOS_NAME_FIELD_LENGTH,
        ),
        suffix: buffer[entryStart + NETBIOS_NAME_FIELD_LENGTH]!,
        isGroup: (nameFlags & NETBIOS_NAME_FLAG_GROUP) !== 0,
        isConflict: (nameFlags & NETBIOS_NAME_FLAG_CONFLICT) !== 0,
        isDeregistering: (nameFlags & NETBIOS_NAME_FLAG_DEREGISTERING) !== 0,
        isActive: (nameFlags & NETBIOS_NAME_FLAG_ACTIVE) !== 0,
      });
    }

    return { transactionId: transactionId, names: names };
  } catch {
    /*
     * Unreachable by construction — every read above is bounds-checked — and
     * caught anyway, because the consequence of being wrong is the probe
     * process dying on one malformed datagram from a scanned subnet.
     */
    return null;
  }
}

/*
 * Names that are registered as UNIQUE but still do not name the machine.
 *
 * "__MSBROWSE__" is the browser-election pseudo-name (normally a group, but a
 * broken stack may not flag it so). "IS~<machine>" is registered by IIS under
 * <00> — often right beside the real workstation name — and must not win by
 * being listed first. Both already fail normalizeNetbiosName; they are skipped
 * here as well so the rule does not rest on a character class alone.
 */
function isPseudoName(rawName: string): boolean {
  const upperCased: string = rawName.toUpperCase();

  return (
    upperCased.includes("__MSBROWSE__") ||
    upperCased.trimStart().startsWith("IS~")
  );
}

/**
 * The single name to call this machine by, or undefined when its table has
 * none worth using.
 *
 * Considers only UNIQUE names — not group, not in conflict, not being
 * deregistered — because a group name (the domain or workgroup) is shared by
 * every machine in it, and a conflicted or deregistering name may belong to
 * another machine by the time anyone reads it.
 *
 * The first usable unique <00> (workstation) name wins; failing that, the
 * first usable unique <20> (file server) name. "Usable" means it survives
 * normalizeNetbiosName, so a junk first entry cannot hide a good second one,
 * and what is returned is already the normalised, lower-cased form.
 *
 * ACT is not required. Windows and Samba set it on every live name, but a
 * stack that leaves it clear is still answering with its own registered name,
 * and requiring the bit would buy nothing but fewer names.
 */
export function chooseNetbiosName(
  names: Array<NetbiosNodeName>,
): string | undefined {
  if (!Array.isArray(names)) {
    return undefined;
  }

  const uniqueNames: Array<NetbiosNodeName> = names.filter(
    (entry: NetbiosNodeName) => {
      return (
        Boolean(entry) &&
        typeof entry.name === "string" &&
        !entry.isGroup &&
        !entry.isConflict &&
        !entry.isDeregistering &&
        !isPseudoName(entry.name)
      );
    },
  );

  for (const suffix of [
    NETBIOS_WORKSTATION_SUFFIX,
    NETBIOS_FILE_SERVER_SUFFIX,
  ]) {
    for (const entry of uniqueNames) {
      if (entry.suffix !== suffix) {
        continue;
      }

      const normalized: string | undefined = normalizeNetbiosName(entry.name);

      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}
