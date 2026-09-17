/*
 * NetFlow v9 (RFC 3954) datagram parser. Unlike v5's fixed 48-byte records,
 * v9 is template-based: the exporter periodically sends template FlowSets
 * that describe the layout of its data records (an ordered list of
 * {fieldType, fieldLength} pairs), and data FlowSets that can only be
 * decoded with a previously seen template. That makes the parser stateful —
 * it holds a template cache keyed by (exporter address, source ID, template
 * ID), so one parser INSTANCE must live as long as the receiving socket.
 * Everything on the wire is big-endian.
 *
 * Malformed input degrades gracefully rather than throwing: a datagram that
 * is too short for a header or has the wrong version returns null, and a
 * FlowSet whose declared length runs past the end of the datagram (a
 * truncated UDP read) stops the walk and returns whatever decoded cleanly
 * before it.
 */

/*
 * Header: version, count, sysUptime, unixSecs, sequenceNumber, sourceId.
 * Note v9 dropped v5's unixNsecs — export time is whole seconds only.
 */
const HEADER_LENGTH_BYTES: number = 20;

// Each FlowSet starts with flowSetId (2 bytes) and total length (2 bytes).
const FLOWSET_HEADER_LENGTH_BYTES: number = 4;

const NETFLOW_VERSION: number = 9;

/*
 * FlowSet IDs: 0 defines templates, 1 defines options templates (exporter
 * metadata such as sampling configuration — not flows), 2-255 are reserved,
 * and 256+ are data FlowSets whose ID names the template that decodes them.
 * Template IDs share the 256+ space for the same reason.
 */
const TEMPLATE_FLOWSET_ID: number = 0;
const OPTIONS_TEMPLATE_FLOWSET_ID: number = 1;
const MIN_DATA_FLOWSET_ID: number = 256;

// Each template field definition is fieldType (2 bytes) + fieldLength (2 bytes).
const TEMPLATE_FIELD_LENGTH_BYTES: number = 4;

/*
 * RFC 3954 tells collectors to age out templates the exporter has stopped
 * refreshing (exporters resend them every few minutes). Thirty minutes is
 * generous; the entry count cap bounds memory against a misbehaving or
 * hostile exporter that streams unique (sourceId, templateId) pairs.
 */
const TEMPLATE_TTL_MS: number = 30 * 60 * 1000;
const MAX_CACHED_TEMPLATES: number = 1000;

/*
 * RFC 3954 field type IDs for the fields NetworkFlowRecord needs. Field
 * LENGTHS are not fixed by the RFC — e.g. counters are commonly exported as
 * 4 bytes but 8 on high-throughput links, SNMP ifIndexes as 2 or 4 — so
 * every numeric field is read at whatever width its template declares.
 */
const FIELD_IN_BYTES: number = 1;
const FIELD_IN_PKTS: number = 2;
const FIELD_PROTOCOL: number = 4;
const FIELD_SRC_TOS: number = 5;
const FIELD_TCP_FLAGS: number = 6;
const FIELD_L4_SRC_PORT: number = 7;
const FIELD_IPV4_SRC_ADDR: number = 8;
const FIELD_INPUT_SNMP: number = 10;
const FIELD_L4_DST_PORT: number = 11;
const FIELD_IPV4_DST_ADDR: number = 12;
const FIELD_OUTPUT_SNMP: number = 14;
const FIELD_LAST_SWITCHED: number = 21;
const FIELD_FIRST_SWITCHED: number = 22;
const FIELD_IPV6_SRC_ADDR: number = 27;
const FIELD_IPV6_DST_ADDR: number = 28;

const IPV4_ADDRESS_LENGTH_BYTES: number = 4;
const IPV6_ADDRESS_LENGTH_BYTES: number = 16;

export interface NetFlowV9Header {
  version: number;
  // Total records (template + data) the exporter placed in this datagram.
  count: number;
  // Milliseconds since the exporting device booted.
  sysUptime: number;
  // Export time: whole seconds since epoch (v9 has no nanosecond field).
  unixSecs: number;
  sequenceNumber: number;
  /*
   * Identifies the exporting process/line card on the device. Templates are
   * only valid for the source ID that announced them, so it is part of the
   * template cache key.
   */
  sourceId: number;
}

export interface NetFlowV9TemplateField {
  fieldType: number;
  fieldLength: number;
}

export interface NetFlowV9Template {
  templateId: number;
  fields: Array<NetFlowV9TemplateField>;
  // Sum of the field lengths — the size of one data record.
  recordLengthBytes: number;
}

/*
 * Same shape as the v5 record where the fields overlap — the receiver maps
 * either into the NetworkFlowRecord DTO. Fields a template does not carry
 * decode as 0 (or "0.0.0.0" / the export time for addresses / timestamps).
 */
export interface NetFlowV9Record {
  sourceIpAddress: string;
  destinationIpAddress: string;
  inputInterfaceIndex: number;
  outputInterfaceIndex: number;
  packets: number;
  octets: number;
  flowStartAt: Date;
  flowEndAt: Date;
  sourcePort: number;
  destinationPort: number;
  tcpFlags: number;
  protocolNumber: number;
  tos: number;
}

export interface ParsedNetFlowV9Datagram {
  header: NetFlowV9Header;
  records: Array<NetFlowV9Record>;
  // Templates (re)learned from this datagram's template FlowSets.
  templatesLearned: number;
  /*
   * Data FlowSets that referenced a template this parser has not seen (data
   * routinely arrives before the exporter's periodic template refresh).
   * Counted as FlowSets, not records — without the template the record
   * length, and therefore the record count, is unknowable.
   */
  dataFlowSetsSkippedForUnknownTemplate: number;
}

interface CachedTemplate {
  template: NetFlowV9Template;
  cachedAt: number;
}

export default class NetFlowV9Parser {
  /*
   * Insertion-ordered (Map preserves it): the first key is always the
   * least-recently-learned template, which is what the size cap evicts.
   */
  private templateCache: Map<string, CachedTemplate> = new Map();

  // Injectable clock so tests can drive template expiry deterministically.
  private now: () => number;

  public constructor(options?: { now?: (() => number) | undefined }) {
    this.now =
      options?.now ??
      (() => {
        return Date.now();
      });
  }

  /*
   * Parses a raw NetFlow v9 export datagram from the given exporter.
   * Returns null when the buffer cannot be a v9 datagram (too short for a
   * header, or wrong version). A structurally damaged FlowSet mid-datagram
   * ends the walk early and returns the records decoded before it — unlike
   * v5 there is no total-length check to reject on, because FlowSet count
   * is not declared up front.
   */
  public parse(
    datagram: Buffer,
    exporterIpAddress: string,
  ): ParsedNetFlowV9Datagram | null {
    if (!datagram || datagram.length < HEADER_LENGTH_BYTES) {
      return null;
    }

    const version: number = datagram.readUInt16BE(0);

    if (version !== NETFLOW_VERSION) {
      return null;
    }

    const header: NetFlowV9Header = {
      version: version,
      count: datagram.readUInt16BE(2),
      sysUptime: datagram.readUInt32BE(4),
      unixSecs: datagram.readUInt32BE(8),
      sequenceNumber: datagram.readUInt32BE(12),
      sourceId: datagram.readUInt32BE(16),
    };

    const exportTimeMs: number = header.unixSecs * 1000;

    const records: Array<NetFlowV9Record> = [];
    let templatesLearned: number = 0;
    let dataFlowSetsSkippedForUnknownTemplate: number = 0;

    let offset: number = HEADER_LENGTH_BYTES;

    while (offset + FLOWSET_HEADER_LENGTH_BYTES <= datagram.length) {
      const flowSetId: number = datagram.readUInt16BE(offset);
      const flowSetLength: number = datagram.readUInt16BE(offset + 2);

      /*
       * The declared length includes the 4-byte FlowSet header. A length
       * smaller than that can never advance the walk, and one running past
       * the end of the buffer means the datagram was truncated — either
       * way nothing after this point can be trusted.
       */
      if (
        flowSetLength < FLOWSET_HEADER_LENGTH_BYTES ||
        offset + flowSetLength > datagram.length
      ) {
        break;
      }

      const bodyOffset: number = offset + FLOWSET_HEADER_LENGTH_BYTES;
      const bodyLength: number = flowSetLength - FLOWSET_HEADER_LENGTH_BYTES;

      if (flowSetId === TEMPLATE_FLOWSET_ID) {
        templatesLearned += this.parseTemplateFlowSet(
          datagram,
          bodyOffset,
          bodyLength,
          exporterIpAddress,
          header.sourceId,
        );
      } else if (flowSetId === OPTIONS_TEMPLATE_FLOWSET_ID) {
        /*
         * Options templates describe exporter metadata (sampling rate,
         * flow cache sizes, ...), not traffic flows. The FlowSet header
         * already gives its total length, so it is skipped wholesale —
         * nothing inside it needs to parse for the walk to stay aligned.
         */
      } else if (flowSetId >= MIN_DATA_FLOWSET_ID) {
        const template: NetFlowV9Template | null = this.lookupTemplate(
          exporterIpAddress,
          header.sourceId,
          flowSetId,
        );

        if (!template) {
          dataFlowSetsSkippedForUnknownTemplate++;
        } else {
          this.parseDataFlowSet(
            datagram,
            bodyOffset,
            bodyLength,
            template,
            header,
            exportTimeMs,
            records,
          );
        }
      }
      // FlowSet IDs 2-255 are reserved — skipped by their declared length.

      offset += flowSetLength;
    }

    return {
      header: header,
      records: records,
      templatesLearned: templatesLearned,
      dataFlowSetsSkippedForUnknownTemplate:
        dataFlowSetsSkippedForUnknownTemplate,
    };
  }

  /*
   * A template FlowSet packs one or more templates back to back, each being
   * templateId, fieldCount, then fieldCount (type, length) pairs. Returns
   * how many templates were cached. Fewer than 4 trailing bytes is the
   * FlowSet's 32-bit-boundary padding; a template that would read past the
   * FlowSet, claims a reserved (< 256) ID, or declares zero fields ends the
   * scan — the remaining bytes are not aligned to anything trustworthy.
   */
  private parseTemplateFlowSet(
    datagram: Buffer,
    bodyOffset: number,
    bodyLength: number,
    exporterIpAddress: string,
    sourceId: number,
  ): number {
    let templatesLearned: number = 0;
    let offset: number = bodyOffset;
    const endOffset: number = bodyOffset + bodyLength;

    while (offset + TEMPLATE_FIELD_LENGTH_BYTES <= endOffset) {
      const templateId: number = datagram.readUInt16BE(offset);
      const fieldCount: number = datagram.readUInt16BE(offset + 2);
      offset += 4;

      if (templateId < MIN_DATA_FLOWSET_ID || fieldCount === 0) {
        break;
      }

      if (offset + fieldCount * TEMPLATE_FIELD_LENGTH_BYTES > endOffset) {
        break;
      }

      const fields: Array<NetFlowV9TemplateField> = [];
      let recordLengthBytes: number = 0;

      for (let i: number = 0; i < fieldCount; i++) {
        const fieldType: number = datagram.readUInt16BE(offset);
        const fieldLength: number = datagram.readUInt16BE(offset + 2);
        offset += TEMPLATE_FIELD_LENGTH_BYTES;

        fields.push({
          fieldType: fieldType,
          fieldLength: fieldLength,
        });
        recordLengthBytes += fieldLength;
      }

      /*
       * All-zero field lengths would make a zero-byte record — caching it
       * would spin the data FlowSet walk forever without advancing.
       */
      if (recordLengthBytes === 0) {
        continue;
      }

      this.cacheTemplate(exporterIpAddress, sourceId, {
        templateId: templateId,
        fields: fields,
        recordLengthBytes: recordLengthBytes,
      });
      templatesLearned++;
    }

    return templatesLearned;
  }

  /*
   * Decodes every whole record in a data FlowSet. Trailing bytes shorter
   * than one record are the FlowSet's 32-bit-boundary padding (RFC 3954
   * allows up to 3 bytes; being length-driven, this tolerates any short
   * remainder).
   */
  private parseDataFlowSet(
    datagram: Buffer,
    bodyOffset: number,
    bodyLength: number,
    template: NetFlowV9Template,
    header: NetFlowV9Header,
    exportTimeMs: number,
    records: Array<NetFlowV9Record>,
  ): void {
    let offset: number = bodyOffset;
    const endOffset: number = bodyOffset + bodyLength;

    while (offset + template.recordLengthBytes <= endOffset) {
      records.push(
        this.parseDataRecord(datagram, offset, template, header, exportTimeMs),
      );
      offset += template.recordLengthBytes;
    }
  }

  private parseDataRecord(
    datagram: Buffer,
    recordOffset: number,
    template: NetFlowV9Template,
    header: NetFlowV9Header,
    exportTimeMs: number,
  ): NetFlowV9Record {
    let sourceIpAddress: string = "0.0.0.0";
    let destinationIpAddress: string = "0.0.0.0";
    let inputInterfaceIndex: number = 0;
    let outputInterfaceIndex: number = 0;
    let packets: number = 0;
    let octets: number = 0;
    let sourcePort: number = 0;
    let destinationPort: number = 0;
    let tcpFlags: number = 0;
    let protocolNumber: number = 0;
    let tos: number = 0;
    let firstSwitchedUptimeMs: number | null = null;
    let lastSwitchedUptimeMs: number | null = null;

    /*
     * Walk the record exactly as the template lays it out. Every field —
     * known or not — advances the offset by its declared length, so an
     * unknown field type never desynchronizes the fields after it.
     */
    let offset: number = recordOffset;

    for (const field of template.fields) {
      switch (field.fieldType) {
        case FIELD_IN_BYTES:
          octets = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_IN_PKTS:
          packets = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_PROTOCOL:
          protocolNumber = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_SRC_TOS:
          tos = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_TCP_FLAGS:
          tcpFlags = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_L4_SRC_PORT:
          sourcePort = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_L4_DST_PORT:
          destinationPort = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_INPUT_SNMP:
          inputInterfaceIndex = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_OUTPUT_SNMP:
          outputInterfaceIndex = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_FIRST_SWITCHED:
          firstSwitchedUptimeMs = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_LAST_SWITCHED:
          lastSwitchedUptimeMs = NetFlowV9Parser.readUnsignedBE(
            datagram,
            offset,
            field.fieldLength,
          );
          break;
        case FIELD_IPV4_SRC_ADDR:
          if (field.fieldLength === IPV4_ADDRESS_LENGTH_BYTES) {
            sourceIpAddress = NetFlowV9Parser.readIpV4(datagram, offset);
          }
          break;
        case FIELD_IPV4_DST_ADDR:
          if (field.fieldLength === IPV4_ADDRESS_LENGTH_BYTES) {
            destinationIpAddress = NetFlowV9Parser.readIpV4(datagram, offset);
          }
          break;
        case FIELD_IPV6_SRC_ADDR:
          if (field.fieldLength === IPV6_ADDRESS_LENGTH_BYTES) {
            sourceIpAddress = NetFlowV9Parser.readIpV6(datagram, offset);
          }
          break;
        case FIELD_IPV6_DST_ADDR:
          if (field.fieldLength === IPV6_ADDRESS_LENGTH_BYTES) {
            destinationIpAddress = NetFlowV9Parser.readIpV6(datagram, offset);
          }
          break;
        default:
          // Unknown field type — the template declared its length, skip it.
          break;
      }

      offset += field.fieldLength;
    }

    /*
     * FIRST/LAST_SWITCHED are sysUptime timestamps exactly like v5's
     * first/last — convert with the same wrap-safe signed-delta approach.
     * Templates without them (e.g. counter-only exports) fall back to the
     * export time, the most truthful single timestamp available.
     */
    return {
      sourceIpAddress: sourceIpAddress,
      destinationIpAddress: destinationIpAddress,
      inputInterfaceIndex: inputInterfaceIndex,
      outputInterfaceIndex: outputInterfaceIndex,
      packets: packets,
      octets: octets,
      flowStartAt:
        firstSwitchedUptimeMs === null
          ? new Date(exportTimeMs)
          : NetFlowV9Parser.uptimeToDate(
              firstSwitchedUptimeMs,
              header,
              exportTimeMs,
            ),
      flowEndAt:
        lastSwitchedUptimeMs === null
          ? new Date(exportTimeMs)
          : NetFlowV9Parser.uptimeToDate(
              lastSwitchedUptimeMs,
              header,
              exportTimeMs,
            ),
      sourcePort: sourcePort,
      destinationPort: destinationPort,
      tcpFlags: tcpFlags,
      protocolNumber: protocolNumber,
      tos: tos,
    };
  }

  private static templateCacheKey(
    exporterIpAddress: string,
    sourceId: number,
    templateId: number,
  ): string {
    return `${exporterIpAddress}|${sourceId}|${templateId}`;
  }

  private cacheTemplate(
    exporterIpAddress: string,
    sourceId: number,
    template: NetFlowV9Template,
  ): void {
    const key: string = NetFlowV9Parser.templateCacheKey(
      exporterIpAddress,
      sourceId,
      template.templateId,
    );

    /*
     * Delete-then-set moves a refreshed template to the back of the Map's
     * insertion order, so the size-cap eviction below always removes the
     * template whose exporter has gone quietest.
     */
    this.templateCache.delete(key);
    this.templateCache.set(key, {
      template: template,
      cachedAt: this.now(),
    });

    while (this.templateCache.size > MAX_CACHED_TEMPLATES) {
      const oldestKey: string | undefined = this.templateCache
        .keys()
        .next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.templateCache.delete(oldestKey);
    }
  }

  private lookupTemplate(
    exporterIpAddress: string,
    sourceId: number,
    templateId: number,
  ): NetFlowV9Template | null {
    const key: string = NetFlowV9Parser.templateCacheKey(
      exporterIpAddress,
      sourceId,
      templateId,
    );

    const cached: CachedTemplate | undefined = this.templateCache.get(key);

    if (!cached) {
      return null;
    }

    // Expired entries are dropped lazily, on the lookup that finds them stale.
    if (this.now() - cached.cachedAt > TEMPLATE_TTL_MS) {
      this.templateCache.delete(key);
      return null;
    }

    return cached.template;
  }

  /*
   * Reads a big-endian unsigned integer of any template-declared width.
   * Buffer.readUIntBE caps at 6 bytes, so 7- and 8-byte counters (IN_BYTES /
   * IN_PKTS on high-throughput exporters) are split into high and low
   * halves. Values past 2^53 would lose precision, but that is > 9 PB in a
   * single flow — beyond anything an exporter emits. Widths outside 1-8
   * bytes decode as 0; no numeric field the parser consumes is ever wider.
   */
  private static readUnsignedBE(
    datagram: Buffer,
    offset: number,
    length: number,
  ): number {
    if (length <= 0 || length > 8) {
      return 0;
    }

    if (length <= 6) {
      return datagram.readUIntBE(offset, length);
    }

    const highLength: number = length - 4;
    const high: number = datagram.readUIntBE(offset, highLength);
    const low: number = datagram.readUInt32BE(offset + highLength);

    return high * 0x100000000 + low;
  }

  // sysUptime is a 32-bit millisecond counter; it wraps every ~49.7 days.
  private static readonly SYS_UPTIME_WRAP_MS: number = 0x100000000;

  /*
   * Converts a record's sysUptime timestamp (ms since device boot) to wall
   * clock: unixSecs * 1000 + (recordUptime - exportUptime). Same rationale
   * as the v5 parser: the delta between the two uint32 timers is
   * interpreted as a SIGNED 32-bit value (centred on zero) so a flow
   * stamped just before a sysUptime wrap decodes as its real small age,
   * while the small POSITIVE deltas some exporters emit are not mistaken
   * for a wrap and backdated ~49.7 days. Out-of-range results are clamped
   * to the export time rather than producing a garbage date decades off.
   */
  private static uptimeToDate(
    recordUptimeMs: number,
    header: NetFlowV9Header,
    exportTimeMs: number,
  ): Date {
    let uptimeDeltaMs: number =
      (recordUptimeMs - header.sysUptime) % NetFlowV9Parser.SYS_UPTIME_WRAP_MS;

    if (uptimeDeltaMs >= NetFlowV9Parser.SYS_UPTIME_WRAP_MS / 2) {
      uptimeDeltaMs -= NetFlowV9Parser.SYS_UPTIME_WRAP_MS;
    } else if (uptimeDeltaMs < -NetFlowV9Parser.SYS_UPTIME_WRAP_MS / 2) {
      uptimeDeltaMs += NetFlowV9Parser.SYS_UPTIME_WRAP_MS;
    }

    const wallClockMs: number = exportTimeMs + uptimeDeltaMs;

    if (wallClockMs < 0 || wallClockMs > exportTimeMs) {
      return new Date(exportTimeMs);
    }

    return new Date(wallClockMs);
  }

  private static readIpV4(datagram: Buffer, offset: number): string {
    return `${datagram.readUInt8(offset)}.${datagram.readUInt8(
      offset + 1,
    )}.${datagram.readUInt8(offset + 2)}.${datagram.readUInt8(offset + 3)}`;
  }

  /*
   * Formats a 16-byte IPv6 address in standard colon notation: eight
   * lowercase hex groups without leading zeros, with the longest run of
   * two or more zero groups compressed to "::" (RFC 5952 style).
   */
  private static readIpV6(datagram: Buffer, offset: number): string {
    const groups: Array<number> = [];

    for (let i: number = 0; i < 8; i++) {
      groups.push(datagram.readUInt16BE(offset + i * 2));
    }

    let bestRunStart: number = -1;
    let bestRunLength: number = 0;
    let runStart: number = -1;
    let runLength: number = 0;

    for (let i: number = 0; i < groups.length; i++) {
      if (groups[i] === 0) {
        if (runStart === -1) {
          runStart = i;
          runLength = 0;
        }
        runLength++;
        if (runLength > bestRunLength) {
          bestRunStart = runStart;
          bestRunLength = runLength;
        }
      } else {
        runStart = -1;
        runLength = 0;
      }
    }

    const hexGroups: Array<string> = groups.map((group: number) => {
      return group.toString(16);
    });

    // "::" only stands in for two or more zero groups (RFC 5952 §4.2.1).
    if (bestRunLength < 2) {
      return hexGroups.join(":");
    }

    const beforeRun: string = hexGroups.slice(0, bestRunStart).join(":");
    const afterRun: string = hexGroups
      .slice(bestRunStart + bestRunLength)
      .join(":");

    return `${beforeRun}::${afterRun}`;
  }
}
