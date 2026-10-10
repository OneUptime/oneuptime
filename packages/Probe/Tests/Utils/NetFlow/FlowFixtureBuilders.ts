/*
 * Builders for NetFlow v9 and IPFIX datagrams in tests: templates, option
 * templates, data sets and the records in them, laid out byte for byte as
 * RFC 3954 and RFC 7011 say. A record is written from its template's field
 * list and a value per field, so a test reads like the template it sends.
 */

export const VARIABLE_LENGTH: number = 0xffff;

export interface FieldSpec {
  id: number;
  length: number;
  // IPFIX only: a vendor element (the enterprise bit is set for it).
  enterpriseNumber?: number | undefined;
}

export interface TemplateSpec {
  templateId: number;
  fields: Array<FieldSpec>;
}

export interface OptionsTemplateSpec extends TemplateSpec {
  // IPFIX: how many of `fields` are scope fields (they come first).
  scopeFieldCount: number;
}

// A field's value: a number (big-endian, at the field's length), an address, or raw bytes.
export type FieldValue = number | bigint | string | Buffer;

export function ipv4Bytes(address: string): Buffer {
  return Buffer.from(
    address.split(".").map((octet: string): number => {
      return Number(octet);
    }),
  );
}

export function ipv6Bytes(address: string): Buffer {
  const [head, tail]: Array<string | undefined> = address.split("::");
  const headGroups: Array<string> = head ? head.split(":") : [];
  const tailGroups: Array<string> =
    tail !== undefined && tail ? tail.split(":") : [];
  const groups: Array<string> = [
    ...headGroups,
    ...new Array(8 - headGroups.length - tailGroups.length).fill("0"),
    ...tailGroups,
  ];
  const buffer: Buffer = Buffer.alloc(16);
  groups.forEach((group: string, index: number) => {
    buffer.writeUInt16BE(parseInt(group, 16), index * 2);
  });
  return buffer;
}

function encodeValue(value: FieldValue, length: number): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value.includes(":") ? ipv6Bytes(value) : ipv4Bytes(value);
  }

  const buffer: Buffer = Buffer.alloc(length);
  let remaining: bigint = BigInt(value);

  for (let i: number = length - 1; i >= 0; i--) {
    buffer[i] = Number(remaining & BigInt(0xff));
    remaining >>= BigInt(8);
  }

  return buffer;
}

/*
 * One data record: each field's value in template order. A variable-length
 * field takes a Buffer and gets a 1-byte length prefix (or 255 and a 2-byte
 * length past 254 bytes).
 */
export function encodeRecord(
  fields: Array<FieldSpec>,
  values: Array<FieldValue>,
): Buffer {
  const parts: Array<Buffer> = [];

  fields.forEach((field: FieldSpec, index: number) => {
    const value: FieldValue = values[index] ?? 0;

    if (field.length === VARIABLE_LENGTH) {
      const bytes: Buffer = Buffer.isBuffer(value)
        ? value
        : Buffer.from(String(value));

      if (bytes.length < 255) {
        parts.push(Buffer.from([bytes.length]));
      } else {
        const prefix: Buffer = Buffer.alloc(3);
        prefix[0] = 255;
        prefix.writeUInt16BE(bytes.length, 1);
        parts.push(prefix);
      }

      parts.push(bytes);
      return;
    }

    const encoded: Buffer = encodeValue(value, field.length);

    if (encoded.length !== field.length) {
      throw new Error(
        `Field ${field.id} is ${field.length} bytes, its value ${encoded.length}`,
      );
    }

    parts.push(encoded);
  });

  return Buffer.concat(parts);
}

function set(setId: number, body: Buffer, paddingBytes: number = 0): Buffer {
  const buffer: Buffer = Buffer.alloc(4 + body.length + paddingBytes);
  buffer.writeUInt16BE(setId, 0);
  buffer.writeUInt16BE(buffer.length, 2);
  body.copy(buffer, 4);
  return buffer;
}

function fieldSpecifiers(fields: Array<FieldSpec>, isIpfix: boolean): Buffer {
  const parts: Array<Buffer> = [];

  for (const field of fields) {
    const specifier: Buffer = Buffer.alloc(4);
    const isEnterprise: boolean =
      isIpfix && field.enterpriseNumber !== undefined;
    specifier.writeUInt16BE(isEnterprise ? field.id | 0x8000 : field.id, 0);
    specifier.writeUInt16BE(field.length, 2);
    parts.push(specifier);

    if (isEnterprise) {
      const enterprise: Buffer = Buffer.alloc(4);
      enterprise.writeUInt32BE(field.enterpriseNumber!, 0);
      parts.push(enterprise);
    }
  }

  return Buffer.concat(parts);
}

// ---- IPFIX (RFC 7011) -------------------------------------------------------

export function ipfixTemplateSet(
  templates: Array<TemplateSpec>,
  paddingBytes: number = 0,
): Buffer {
  const parts: Array<Buffer> = templates.map((template: TemplateSpec) => {
    const header: Buffer = Buffer.alloc(4);
    header.writeUInt16BE(template.templateId, 0);
    header.writeUInt16BE(template.fields.length, 2);
    return Buffer.concat([header, fieldSpecifiers(template.fields, true)]);
  });

  return set(2, Buffer.concat(parts), paddingBytes);
}

// A template withdrawal: the template ID with a field count of 0.
export function ipfixTemplateWithdrawalSet(
  templateIds: Array<number>,
  isOptions: boolean = false,
): Buffer {
  const body: Buffer = Buffer.alloc(templateIds.length * 4);
  templateIds.forEach((templateId: number, index: number) => {
    body.writeUInt16BE(templateId, index * 4);
    body.writeUInt16BE(0, index * 4 + 2);
  });
  return set(isOptions ? 3 : 2, body);
}

export function ipfixOptionsTemplateSet(
  templates: Array<OptionsTemplateSpec>,
): Buffer {
  const parts: Array<Buffer> = templates.map(
    (template: OptionsTemplateSpec) => {
      const header: Buffer = Buffer.alloc(6);
      header.writeUInt16BE(template.templateId, 0);
      header.writeUInt16BE(template.fields.length, 2);
      header.writeUInt16BE(template.scopeFieldCount, 4);
      return Buffer.concat([header, fieldSpecifiers(template.fields, true)]);
    },
  );

  return set(3, Buffer.concat(parts));
}

export function dataSet(
  templateId: number,
  records: Array<Buffer>,
  paddingBytes: number = 0,
): Buffer {
  return set(templateId, Buffer.concat(records), paddingBytes);
}

export interface IpfixHeaderOptions {
  exportTime?: number | undefined;
  sequenceNumber?: number | undefined;
  observationDomainId?: number | undefined;
  // Override the declared message length (to test cut-short messages).
  declaredLength?: number | undefined;
}

export const IPFIX_EXPORT_TIME: number = 1767225600; // 2026-01-01T00:00:00Z

export function ipfixMessage(
  sets: Array<Buffer>,
  options?: IpfixHeaderOptions,
): Buffer {
  const body: Buffer = Buffer.concat(sets);
  const header: Buffer = Buffer.alloc(16);
  header.writeUInt16BE(10, 0);
  header.writeUInt16BE(options?.declaredLength ?? 16 + body.length, 2);
  header.writeUInt32BE(options?.exportTime ?? IPFIX_EXPORT_TIME, 4);
  header.writeUInt32BE(options?.sequenceNumber ?? 1, 8);
  header.writeUInt32BE(options?.observationDomainId ?? 0, 12);
  return Buffer.concat([header, body]);
}

// ---- NetFlow v9 (RFC 3954) --------------------------------------------------

export function netFlowV9TemplateSet(templates: Array<TemplateSpec>): Buffer {
  const parts: Array<Buffer> = templates.map((template: TemplateSpec) => {
    const header: Buffer = Buffer.alloc(4);
    header.writeUInt16BE(template.templateId, 0);
    header.writeUInt16BE(template.fields.length, 2);
    return Buffer.concat([header, fieldSpecifiers(template.fields, false)]);
  });

  return set(0, Buffer.concat(parts));
}

/*
 * A v9 options template: scope fields (numbered on their own: 1 System,
 * 2 Interface, 3 Line Card, 4 Cache, 5 Template) then option fields.
 */
export function netFlowV9OptionsTemplateSet(
  templateId: number,
  scopeFields: Array<FieldSpec>,
  optionFields: Array<FieldSpec>,
): Buffer {
  const header: Buffer = Buffer.alloc(6);
  header.writeUInt16BE(templateId, 0);
  header.writeUInt16BE(scopeFields.length * 4, 2);
  header.writeUInt16BE(optionFields.length * 4, 4);

  return set(
    1,
    Buffer.concat([
      header,
      fieldSpecifiers(scopeFields, false),
      fieldSpecifiers(optionFields, false),
    ]),
    2,
  );
}

export const V9_SYS_UPTIME_MS: number = 3600000;
export const V9_UNIX_SECS: number = 1767225600;

export function netFlowV9Datagram(
  sets: Array<Buffer>,
  options?: { sysUptime?: number; unixSecs?: number; sourceId?: number },
): Buffer {
  const header: Buffer = Buffer.alloc(20);
  header.writeUInt16BE(9, 0);
  header.writeUInt16BE(sets.length, 2);
  header.writeUInt32BE(options?.sysUptime ?? V9_SYS_UPTIME_MS, 4);
  header.writeUInt32BE(options?.unixSecs ?? V9_UNIX_SECS, 8);
  header.writeUInt32BE(1, 12);
  header.writeUInt32BE(options?.sourceId ?? 0, 16);
  return Buffer.concat([header, ...sets]);
}

// Information Elements the tests use (IANA numbering, shared by v9).
export const IE = {
  octetDeltaCount: 1,
  packetDeltaCount: 2,
  protocolIdentifier: 4,
  ipClassOfService: 5,
  tcpControlBits: 6,
  sourceTransportPort: 7,
  sourceIPv4Address: 8,
  ingressInterface: 10,
  destinationTransportPort: 11,
  destinationIPv4Address: 12,
  egressInterface: 14,
  flowEndSysUpTime: 21,
  flowStartSysUpTime: 22,
  postOctetDeltaCount: 23,
  postPacketDeltaCount: 24,
  sourceIPv6Address: 27,
  destinationIPv6Address: 28,
  samplingInterval: 34,
  samplerId: 48,
  samplerMode: 49,
  samplerRandomInterval: 50,
  interfaceName: 82,
  octetTotalCount: 85,
  packetTotalCount: 86,
  exporterIPv4Address: 130,
  exporterIPv6Address: 131,
  meteringProcessId: 143,
  flowStartSeconds: 150,
  flowEndSeconds: 151,
  flowStartMilliseconds: 152,
  flowEndMilliseconds: 153,
  flowStartMicroseconds: 154,
  flowEndMicroseconds: 155,
  flowStartDeltaMicroseconds: 158,
  flowEndDeltaMicroseconds: 159,
  systemInitTimeMilliseconds: 160,
  initiatorOctets: 231,
  responderOctets: 232,
  initiatorPackets: 298,
  responderPackets: 299,
  selectorId: 302,
  selectorAlgorithm: 304,
  samplingPacketInterval: 305,
  samplingPacketSpace: 306,
  samplingSize: 309,
  samplingPopulation: 310,
  observationTimeMilliseconds: 323,
} as const;

/*
 * The IPv4 5-tuple template most tests use, with 8-byte counters and
 * absolute millisecond timestamps (as Cisco IOS XE Flexible NetFlow sends
 * IPFIX).
 */
export const IPV4_TEMPLATE: TemplateSpec = {
  templateId: 256,
  fields: [
    { id: IE.sourceIPv4Address, length: 4 },
    { id: IE.destinationIPv4Address, length: 4 },
    { id: IE.sourceTransportPort, length: 2 },
    { id: IE.destinationTransportPort, length: 2 },
    { id: IE.protocolIdentifier, length: 1 },
    { id: IE.tcpControlBits, length: 2 },
    { id: IE.ingressInterface, length: 4 },
    { id: IE.egressInterface, length: 4 },
    { id: IE.octetDeltaCount, length: 8 },
    { id: IE.packetDeltaCount, length: 8 },
    { id: IE.flowStartMilliseconds, length: 8 },
    { id: IE.flowEndMilliseconds, length: 8 },
  ],
};

export interface Ipv4FlowValues {
  source: string;
  destination: string;
  sourcePort: number;
  destinationPort: number;
  protocol: number;
  tcpFlags?: number;
  ingress?: number;
  egress?: number;
  octets: number;
  packets: number;
  startMs: number;
  endMs: number;
}

export function ipv4Record(values: Ipv4FlowValues): Buffer {
  return encodeRecord(IPV4_TEMPLATE.fields, [
    values.source,
    values.destination,
    values.sourcePort,
    values.destinationPort,
    values.protocol,
    values.tcpFlags ?? 0,
    values.ingress ?? 0,
    values.egress ?? 0,
    BigInt(values.octets),
    BigInt(values.packets),
    BigInt(values.startMs),
    BigInt(values.endMs),
  ]);
}
