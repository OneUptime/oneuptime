import DecodedFlowRecord from "./DecodedFlowRecord";
import FlowBytes from "./FlowBytes";

/*
 * The decoder shared by the two template-based flow formats: NetFlow v9
 * (RFC 3954) and IPFIX (RFC 7011, "NetFlow v10").
 *
 * Neither format can be read on its own. An exporter first sends TEMPLATES
 * - the list of fields, and their lengths, its records will carry - and
 * then DATA sets that only make sense with the template they name. Option
 * templates and option data work the same way, and carry what the exporter
 * says about itself: its sampling rate, the samplers it runs, when it booted.
 * So this decoder keeps state, per exporter:
 *
 *   - the templates it announced, aged out after TEMPLATE_TTL_MS without a
 *     refresh (exporters resend them every few minutes);
 *   - what its option records said (sampling rates, boot time, the address
 *     it calls itself);
 *   - data that arrived BEFORE its template - routine right after the
 *     exporter or this probe restarts - held for PENDING_TTL_MS and decoded
 *     as soon as the template arrives, rather than thrown away.
 *
 * An exporter is the UDP source address AND port, plus the observation
 * domain (IPFIX) or source ID (v9) the datagram names: two routers behind
 * one NAT share an address but not a port, and both commonly number their
 * templates from 256, so a key on the address alone would decode one
 * router's data with the other's templates.
 *
 * Every cache is bounded; malformed input never throws - a set that runs
 * past its datagram ends the walk, and whatever decoded before it is kept.
 */

// Header sizes.
const NETFLOW_V9_HEADER_LENGTH_BYTES: number = 20;
const IPFIX_HEADER_LENGTH_BYTES: number = 16;
const SET_HEADER_LENGTH_BYTES: number = 4;

export const NETFLOW_V9_VERSION: number = 9;
export const IPFIX_VERSION: number = 10;

// NetFlow v9 FlowSet IDs and IPFIX Set IDs.
const NETFLOW_V9_TEMPLATE_SET_ID: number = 0;
const NETFLOW_V9_OPTIONS_TEMPLATE_SET_ID: number = 1;
const IPFIX_TEMPLATE_SET_ID: number = 2;
const IPFIX_OPTIONS_TEMPLATE_SET_ID: number = 3;
const MIN_DATA_SET_ID: number = 256;

// An IPFIX field whose length is given per record (RFC 7011 section 7).
export const VARIABLE_LENGTH: number = 0xffff;

// The enterprise bit of an IPFIX field specifier.
const ENTERPRISE_BIT: number = 0x8000;

/*
 * NetFlow v9 option SCOPE fields have their own numbering (1 System,
 * 2 Interface, 3 Line Card, 4 Cache, 5 Template), which collides with the
 * field numbering (1 is IN_BYTES). They are filed under this base so they
 * can never be read as a field of the same number.
 */
const NETFLOW_V9_SCOPE_FIELD_ID_BASE: number = 0x10000;

/*
 * Cache bounds. Exporters refresh templates every few minutes (Cisco
 * defaults to 30 minutes for Flexible NetFlow, which is why the docs say
 * to set it to a minute); a template not refreshed for TEMPLATE_TTL_MS is
 * dropped, and past MAX_CACHED_TEMPLATES the one refreshed longest ago
 * goes first. Waiting data is bounded by bytes, by sets per template and
 * by age.
 */
export const TEMPLATE_TTL_MS: number = 30 * 60 * 1000;
export const MAX_CACHED_TEMPLATES: number = 4000;
export const PENDING_TTL_MS: number = 10 * 60 * 1000;
export const MAX_PENDING_BYTES: number = 4 * 1024 * 1024;
export const MAX_PENDING_SETS_PER_TEMPLATE: number = 32;
const MAX_EXPORTER_STATES: number = 5000;
const MAX_SAMPLERS_PER_EXPORTER: number = 256;

// A sampling rate past this is not a rate anybody configured.
export const MAX_SAMPLING_RATE: number = 16777216;

/*
 * Information Elements (IANA IPFIX numbering, which NetFlow v9 shares for
 * every field the collector reads).
 */
const IE_OCTET_DELTA_COUNT: number = 1;
const IE_PACKET_DELTA_COUNT: number = 2;
const IE_PROTOCOL: number = 4;
const IE_TOS: number = 5;
const IE_TCP_FLAGS: number = 6;
const IE_SOURCE_PORT: number = 7;
const IE_SOURCE_IPV4: number = 8;
const IE_INGRESS_INTERFACE: number = 10;
const IE_DESTINATION_PORT: number = 11;
const IE_DESTINATION_IPV4: number = 12;
const IE_EGRESS_INTERFACE: number = 14;
const IE_FLOW_END_SYS_UP_TIME: number = 21;
const IE_FLOW_START_SYS_UP_TIME: number = 22;
const IE_POST_OCTET_DELTA_COUNT: number = 23;
const IE_POST_PACKET_DELTA_COUNT: number = 24;
const IE_SOURCE_IPV6: number = 27;
const IE_DESTINATION_IPV6: number = 28;
const IE_SAMPLING_INTERVAL: number = 34;
const IE_SAMPLER_ID: number = 48;
const IE_SAMPLER_RANDOM_INTERVAL: number = 50;
const IE_OCTET_TOTAL_COUNT: number = 85;
const IE_PACKET_TOTAL_COUNT: number = 86;
const IE_EXPORTER_IPV4: number = 130;
const IE_EXPORTER_IPV6: number = 131;
const IE_FLOW_START_SECONDS: number = 150;
const IE_FLOW_END_SECONDS: number = 151;
const IE_FLOW_START_MILLISECONDS: number = 152;
const IE_FLOW_END_MILLISECONDS: number = 153;
const IE_FLOW_START_MICROSECONDS: number = 154;
const IE_FLOW_END_MICROSECONDS: number = 155;
const IE_FLOW_START_NANOSECONDS: number = 156;
const IE_FLOW_END_NANOSECONDS: number = 157;
const IE_FLOW_START_DELTA_MICROSECONDS: number = 158;
const IE_FLOW_END_DELTA_MICROSECONDS: number = 159;
const IE_SYSTEM_INIT_TIME_MILLISECONDS: number = 160;
const IE_INITIATOR_OCTETS: number = 231;
const IE_RESPONDER_OCTETS: number = 232;
const IE_INGRESS_PHYSICAL_INTERFACE: number = 252;
const IE_EGRESS_PHYSICAL_INTERFACE: number = 253;
const IE_INITIATOR_PACKETS: number = 298;
const IE_RESPONDER_PACKETS: number = 299;
const IE_SELECTOR_ID: number = 302;
const IE_SAMPLING_PACKET_INTERVAL: number = 305;
const IE_SAMPLING_PACKET_SPACE: number = 306;
const IE_SAMPLING_SIZE: number = 309;
const IE_SAMPLING_POPULATION: number = 310;
const IE_OBSERVATION_TIME_MILLISECONDS: number = 323;

// sysUptime is a 32-bit millisecond counter; it wraps every ~49.7 days.
const SYS_UPTIME_WRAP_MS: number = 0x100000000;

export interface FlowTemplateField {
  // The Information Element number (enterprise bit cleared).
  id: number;
  // 0 for IANA elements; a vendor's private elements are skipped.
  enterpriseNumber: number;
  // VARIABLE_LENGTH when each record says how long the field is.
  length: number;
}

export interface FlowTemplate {
  templateId: number;
  fields: Array<FlowTemplateField>;
  isOptions: boolean;
  // The fewest bytes one record can take (1 per variable-length field).
  minimumRecordLength: number;
}

export interface NetFlowV9Header {
  version: number;
  // Total records (template + data) the exporter put in this datagram.
  count: number;
  // Milliseconds since the exporting device booted.
  sysUptime: number;
  // Export time: whole seconds since the epoch.
  unixSecs: number;
  sequenceNumber: number;
  // The exporting process or line card; templates are scoped to it.
  sourceId: number;
}

export interface IpfixHeader {
  version: number;
  // The message length the header declares, header included.
  length: number;
  // Export time: whole seconds since the epoch.
  exportTime: number;
  sequenceNumber: number;
  // The observation domain; templates are scoped to it.
  observationDomainId: number;
}

export interface TemplateDecodeResult {
  records: Array<DecodedFlowRecord>;
  // Templates (re)learned from this datagram.
  templatesLearned: number;
  // Templates this datagram withdrew (IPFIX).
  templatesWithdrawn: number;
  /*
   * Data sets that named a template this decoder does not have yet: held
   * for PENDING_TTL_MS (and decoded once the template arrives) unless the
   * holding bounds are full, in which case they are dropped.
   */
  dataSetsWaitingForTemplate: number;
  dataSetsDroppedWithoutTemplate: number;
  // Earlier data sets this datagram's templates finally decoded.
  dataSetsReplayed: number;
  /*
   * The address the exporter calls itself in its option records
   * (exporterIPv4Address / exporterIPv6Address), when it says: the one to
   * match it to a device by, rather than the address of a NAT in between.
   */
  exporterAddress: string | null;
  // A set ran past the datagram, or a template could not be read.
  isMalformed: boolean;
}

interface CachedTemplate {
  template: FlowTemplate;
  cachedAt: number;
}

interface ExportContext {
  version: number;
  exporterKey: string;
  exportTimeMs: number;
  // NetFlow v9 headers carry the device's uptime; IPFIX headers do not.
  sysUptimeMs: number | null;
}

interface PendingDataSet {
  body: Buffer;
  context: ExportContext;
  receivedAt: number;
}

interface ExporterState {
  // The rate an option record gave with no sampler named: every flow's.
  defaultSamplingRate: number | null;
  // Rates per sampler (v9 FLOW_SAMPLER_ID) or selector (IPFIX selectorId).
  samplerRates: Map<number, number>;
  // When the device booted (systemInitTimeMilliseconds), for IPFIX uptimes.
  systemInitTimeMs: number | null;
  exporterAddress: string | null;
}

interface FieldValue {
  offset: number;
  length: number;
}

type FieldValues = Map<number, FieldValue>;

export interface TemplateFlowDecoderOptions {
  now?: (() => number) | undefined;
}

export default class TemplateFlowDecoder {
  private templates: Map<string, CachedTemplate> = new Map();
  private pending: Map<string, Array<PendingDataSet>> = new Map();
  private pendingBytes: number = 0;
  private exporterStates: Map<string, ExporterState> = new Map();
  private now: () => number;

  public constructor(options?: TemplateFlowDecoderOptions) {
    this.now =
      options?.now ??
      ((): number => {
        return Date.now();
      });
  }

  public static getExporterKey(data: {
    exporterAddress: string;
    exporterPort: number;
    version: number;
    domainId: number;
  }): string {
    return `${data.exporterAddress}|${data.exporterPort}|${data.version}|${data.domainId}`;
  }

  // How many data sets are waiting for a template, across every exporter.
  public getPendingDataSetCount(): number {
    let count: number = 0;

    for (const sets of this.pending.values()) {
      count += sets.length;
    }

    return count;
  }

  public getPendingByteCount(): number {
    return this.pendingBytes;
  }

  public getCachedTemplateCount(): number {
    return this.templates.size;
  }

  /*
   * Decodes a NetFlow v9 export datagram. Null when the buffer cannot be
   * one (too short for a header, or another version).
   */
  public decodeNetFlowV9(
    datagram: Buffer,
    exporterAddress: string,
    exporterPort: number = 0,
  ): { header: NetFlowV9Header; result: TemplateDecodeResult } | null {
    if (!datagram || datagram.length < NETFLOW_V9_HEADER_LENGTH_BYTES) {
      return null;
    }

    if (datagram.readUInt16BE(0) !== NETFLOW_V9_VERSION) {
      return null;
    }

    const header: NetFlowV9Header = {
      version: NETFLOW_V9_VERSION,
      count: datagram.readUInt16BE(2),
      sysUptime: datagram.readUInt32BE(4),
      unixSecs: datagram.readUInt32BE(8),
      sequenceNumber: datagram.readUInt32BE(12),
      sourceId: datagram.readUInt32BE(16),
    };

    const context: ExportContext = {
      version: NETFLOW_V9_VERSION,
      exporterKey: TemplateFlowDecoder.getExporterKey({
        exporterAddress: exporterAddress,
        exporterPort: exporterPort,
        version: NETFLOW_V9_VERSION,
        domainId: header.sourceId,
      }),
      exportTimeMs: header.unixSecs * 1000,
      sysUptimeMs: header.sysUptime,
    };

    const result: TemplateDecodeResult = TemplateFlowDecoder.emptyResult();

    this.walkSets(
      datagram,
      NETFLOW_V9_HEADER_LENGTH_BYTES,
      datagram.length,
      context,
      result,
    );

    return { header: header, result: result };
  }

  /*
   * Decodes an IPFIX message. Null when the buffer cannot be one (too short
   * for a header, another version, or a declared length shorter than the
   * header itself).
   */
  public decodeIpfix(
    datagram: Buffer,
    exporterAddress: string,
    exporterPort: number = 0,
  ): { header: IpfixHeader; result: TemplateDecodeResult } | null {
    if (!datagram || datagram.length < IPFIX_HEADER_LENGTH_BYTES) {
      return null;
    }

    if (datagram.readUInt16BE(0) !== IPFIX_VERSION) {
      return null;
    }

    const header: IpfixHeader = {
      version: IPFIX_VERSION,
      length: datagram.readUInt16BE(2),
      exportTime: datagram.readUInt32BE(4),
      sequenceNumber: datagram.readUInt32BE(8),
      observationDomainId: datagram.readUInt32BE(12),
    };

    if (header.length < IPFIX_HEADER_LENGTH_BYTES) {
      return null;
    }

    const context: ExportContext = {
      version: IPFIX_VERSION,
      exporterKey: TemplateFlowDecoder.getExporterKey({
        exporterAddress: exporterAddress,
        exporterPort: exporterPort,
        version: IPFIX_VERSION,
        domainId: header.observationDomainId,
      }),
      exportTimeMs: header.exportTime * 1000,
      sysUptimeMs: null,
    };

    const result: TemplateDecodeResult = TemplateFlowDecoder.emptyResult();

    /*
     * The message ends where the header says. Bytes past it are not part
     * of this message; a declared length past the datagram means the read
     * was cut short, and the sets that fit are still decoded.
     */
    const messageEnd: number = Math.min(header.length, datagram.length);

    if (header.length > datagram.length) {
      result.isMalformed = true;
    }

    this.walkSets(
      datagram,
      IPFIX_HEADER_LENGTH_BYTES,
      messageEnd,
      context,
      result,
    );

    return { header: header, result: result };
  }

  private static emptyResult(): TemplateDecodeResult {
    return {
      records: [],
      templatesLearned: 0,
      templatesWithdrawn: 0,
      dataSetsWaitingForTemplate: 0,
      dataSetsDroppedWithoutTemplate: 0,
      dataSetsReplayed: 0,
      exporterAddress: null,
      isMalformed: false,
    };
  }

  /*
   * Walks the sets of one datagram in order. Templates learned here take
   * effect for the data sets after them; data that waited for one of them
   * is decoded at the END of the datagram, so the option records this
   * same datagram carries (a sampling rate, typically) apply to it too.
   */
  private walkSets(
    datagram: Buffer,
    start: number,
    end: number,
    context: ExportContext,
    result: TemplateDecodeResult,
  ): void {
    const learnedTemplateIds: Array<number> = [];
    let offset: number = start;

    while (offset + SET_HEADER_LENGTH_BYTES <= end) {
      const setId: number = datagram.readUInt16BE(offset);
      const setLength: number = datagram.readUInt16BE(offset + 2);

      /*
       * The declared length includes the set header. Shorter than that can
       * never advance the walk; past the end means the datagram was cut
       * short. Either way nothing after this point can be trusted.
       */
      if (setLength < SET_HEADER_LENGTH_BYTES || offset + setLength > end) {
        result.isMalformed = true;
        break;
      }

      const bodyStart: number = offset + SET_HEADER_LENGTH_BYTES;
      const bodyEnd: number = offset + setLength;

      if (
        (context.version === NETFLOW_V9_VERSION &&
          setId === NETFLOW_V9_TEMPLATE_SET_ID) ||
        (context.version === IPFIX_VERSION && setId === IPFIX_TEMPLATE_SET_ID)
      ) {
        this.readTemplateSet(
          datagram,
          bodyStart,
          bodyEnd,
          context,
          false,
          result,
          learnedTemplateIds,
        );
      } else if (
        (context.version === NETFLOW_V9_VERSION &&
          setId === NETFLOW_V9_OPTIONS_TEMPLATE_SET_ID) ||
        (context.version === IPFIX_VERSION &&
          setId === IPFIX_OPTIONS_TEMPLATE_SET_ID)
      ) {
        if (context.version === NETFLOW_V9_VERSION) {
          this.readNetFlowV9OptionsTemplateSet(
            datagram,
            bodyStart,
            bodyEnd,
            context,
            result,
            learnedTemplateIds,
          );
        } else {
          this.readTemplateSet(
            datagram,
            bodyStart,
            bodyEnd,
            context,
            true,
            result,
            learnedTemplateIds,
          );
        }
      } else if (setId >= MIN_DATA_SET_ID) {
        const template: FlowTemplate | null = this.getTemplate(
          context.exporterKey,
          setId,
        );

        if (template) {
          this.decodeDataSet(
            datagram,
            bodyStart,
            bodyEnd,
            template,
            context,
            result,
          );
        } else if (
          this.holdDataSet(
            context,
            setId,
            Buffer.from(datagram.subarray(bodyStart, bodyEnd)),
          )
        ) {
          result.dataSetsWaitingForTemplate++;
        } else {
          result.dataSetsDroppedWithoutTemplate++;
        }
      }
      // Set IDs below 256 that are not templates are reserved: skipped whole.

      offset += setLength;
    }

    this.replayHeldDataSets(context.exporterKey, learnedTemplateIds, result);

    const state: ExporterState | undefined = this.exporterStates.get(
      context.exporterKey,
    );

    if (state?.exporterAddress) {
      result.exporterAddress = state.exporterAddress;
    }
  }

  /*
   * A template set (NetFlow v9 FlowSet 0, IPFIX set 2) or an IPFIX options
   * template set (3): templates back to back. An IPFIX template with no
   * fields withdraws it - template ID 2 or 3 withdraws all of that kind.
   * Fewer bytes than a template header at the end are padding.
   */
  private readTemplateSet(
    datagram: Buffer,
    start: number,
    end: number,
    context: ExportContext,
    isOptionsSet: boolean,
    result: TemplateDecodeResult,
    learnedTemplateIds: Array<number>,
  ): void {
    const isIpfix: boolean = context.version === IPFIX_VERSION;
    let offset: number = start;

    while (offset + 4 <= end) {
      const templateId: number = datagram.readUInt16BE(offset);
      const fieldCount: number = datagram.readUInt16BE(offset + 2);

      if (fieldCount === 0) {
        if (!isIpfix) {
          // A v9 template with no fields is padding or garbage: stop here.
          break;
        }

        offset += 4;
        result.templatesWithdrawn += this.withdrawTemplate(
          context.exporterKey,
          templateId,
          isOptionsSet,
        );
        continue;
      }

      let scopeFieldCount: number = 0;
      let headerLength: number = 4;

      if (isOptionsSet) {
        if (offset + 6 > end) {
          result.isMalformed = true;
          break;
        }

        scopeFieldCount = datagram.readUInt16BE(offset + 4);
        headerLength = 6;

        if (scopeFieldCount === 0 || scopeFieldCount > fieldCount) {
          result.isMalformed = true;
          break;
        }
      }

      if (templateId < MIN_DATA_SET_ID) {
        result.isMalformed = true;
        break;
      }

      offset += headerLength;

      const fields: Array<FlowTemplateField> = [];
      let truncated: boolean = false;

      for (let i: number = 0; i < fieldCount; i++) {
        if (offset + 4 > end) {
          truncated = true;
          break;
        }

        const rawId: number = datagram.readUInt16BE(offset);
        const length: number = datagram.readUInt16BE(offset + 2);
        offset += 4;

        let enterpriseNumber: number = 0;

        if (isIpfix && rawId & ENTERPRISE_BIT) {
          if (offset + 4 > end) {
            truncated = true;
            break;
          }

          enterpriseNumber = datagram.readUInt32BE(offset);
          offset += 4;
        }

        fields.push({
          id: isIpfix ? rawId & ~ENTERPRISE_BIT : rawId,
          enterpriseNumber: enterpriseNumber,
          length: length,
        });
      }

      if (truncated) {
        result.isMalformed = true;
        break;
      }

      if (
        this.learnTemplate(
          context.exporterKey,
          templateId,
          fields,
          isOptionsSet,
        )
      ) {
        result.templatesLearned++;
        learnedTemplateIds.push(templateId);
      }
    }
  }

  /*
   * A NetFlow v9 options template FlowSet (1): each template is its ID, the
   * byte length of its scope fields and of its option fields, then the
   * fields. Scope fields are numbered on their own (see
   * NETFLOW_V9_SCOPE_FIELD_ID_BASE).
   */
  private readNetFlowV9OptionsTemplateSet(
    datagram: Buffer,
    start: number,
    end: number,
    context: ExportContext,
    result: TemplateDecodeResult,
    learnedTemplateIds: Array<number>,
  ): void {
    let offset: number = start;

    while (offset + 6 <= end) {
      const templateId: number = datagram.readUInt16BE(offset);
      const scopeLength: number = datagram.readUInt16BE(offset + 2);
      const optionLength: number = datagram.readUInt16BE(offset + 4);

      if (
        templateId < MIN_DATA_SET_ID ||
        scopeLength % 4 !== 0 ||
        optionLength % 4 !== 0 ||
        scopeLength + optionLength === 0
      ) {
        // Padding, or nothing a template can be read from.
        break;
      }

      offset += 6;

      if (offset + scopeLength + optionLength > end) {
        result.isMalformed = true;
        break;
      }

      const fields: Array<FlowTemplateField> = [];

      for (let i: number = 0; i < scopeLength / 4; i++) {
        fields.push({
          id: NETFLOW_V9_SCOPE_FIELD_ID_BASE + datagram.readUInt16BE(offset),
          enterpriseNumber: 0,
          length: datagram.readUInt16BE(offset + 2),
        });
        offset += 4;
      }

      for (let i: number = 0; i < optionLength / 4; i++) {
        fields.push({
          id: datagram.readUInt16BE(offset),
          enterpriseNumber: 0,
          length: datagram.readUInt16BE(offset + 2),
        });
        offset += 4;
      }

      if (this.learnTemplate(context.exporterKey, templateId, fields, true)) {
        result.templatesLearned++;
        learnedTemplateIds.push(templateId);
      }
    }
  }

  private learnTemplate(
    exporterKey: string,
    templateId: number,
    fields: Array<FlowTemplateField>,
    isOptions: boolean,
  ): boolean {
    let minimumRecordLength: number = 0;

    for (const field of fields) {
      minimumRecordLength +=
        field.length === VARIABLE_LENGTH ? 1 : field.length;
    }

    /*
     * A zero-byte record could never advance a data set walk: caching such
     * a template would loop forever on its data.
     */
    if (minimumRecordLength === 0) {
      return false;
    }

    const key: string = TemplateFlowDecoder.templateKey(
      exporterKey,
      templateId,
    );

    /*
     * Delete-then-set moves a refreshed template to the back of the Map's
     * insertion order, so the size cap below evicts the template whose
     * exporter has gone quiet longest.
     */
    this.templates.delete(key);
    this.templates.set(key, {
      template: {
        templateId: templateId,
        fields: fields,
        isOptions: isOptions,
        minimumRecordLength: minimumRecordLength,
      },
      cachedAt: this.now(),
    });

    while (this.templates.size > MAX_CACHED_TEMPLATES) {
      const oldestKey: string | undefined = this.templates.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.templates.delete(oldestKey);
    }

    return true;
  }

  private withdrawTemplate(
    exporterKey: string,
    templateId: number,
    isOptionsSet: boolean,
  ): number {
    /*
     * Template ID 2 in a template set (or 3 in an options template set)
     * withdraws every template of that kind the exporter announced.
     */
    const withdrawAll: boolean =
      templateId === IPFIX_TEMPLATE_SET_ID ||
      templateId === IPFIX_OPTIONS_TEMPLATE_SET_ID;

    if (!withdrawAll) {
      return this.templates.delete(
        TemplateFlowDecoder.templateKey(exporterKey, templateId),
      )
        ? 1
        : 0;
    }

    let withdrawn: number = 0;
    const prefix: string = `${exporterKey}#`;

    for (const [key, cached] of Array.from(this.templates.entries())) {
      if (
        key.startsWith(prefix) &&
        cached.template.isOptions === isOptionsSet
      ) {
        this.templates.delete(key);
        withdrawn++;
      }
    }

    return withdrawn;
  }

  private getTemplate(
    exporterKey: string,
    templateId: number,
  ): FlowTemplate | null {
    const key: string = TemplateFlowDecoder.templateKey(
      exporterKey,
      templateId,
    );
    const cached: CachedTemplate | undefined = this.templates.get(key);

    if (!cached) {
      return null;
    }

    // Expired entries are dropped lazily, on the lookup that finds them stale.
    if (this.now() - cached.cachedAt > TEMPLATE_TTL_MS) {
      this.templates.delete(key);
      return null;
    }

    return cached.template;
  }

  private static templateKey(exporterKey: string, templateId: number): string {
    return `${exporterKey}#${templateId}`;
  }

  /*
   * Holds a data set whose template has not arrived. False when it cannot
   * be held: the holding bounds are full even after old sets aged out.
   */
  private holdDataSet(
    context: ExportContext,
    templateId: number,
    body: Buffer,
  ): boolean {
    const now: number = this.now();

    this.dropExpiredHeldDataSets(now);

    if (this.pendingBytes + body.length > MAX_PENDING_BYTES) {
      return false;
    }

    const key: string = TemplateFlowDecoder.templateKey(
      context.exporterKey,
      templateId,
    );
    const sets: Array<PendingDataSet> = this.pending.get(key) || [];

    if (sets.length >= MAX_PENDING_SETS_PER_TEMPLATE) {
      return false;
    }

    sets.push({ body: body, context: context, receivedAt: now });
    this.pending.set(key, sets);
    this.pendingBytes += body.length;

    return true;
  }

  private dropExpiredHeldDataSets(now: number): void {
    for (const [key, sets] of Array.from(this.pending.entries())) {
      const fresh: Array<PendingDataSet> = sets.filter(
        (set: PendingDataSet): boolean => {
          return now - set.receivedAt <= PENDING_TTL_MS;
        },
      );

      for (const set of sets) {
        if (now - set.receivedAt > PENDING_TTL_MS) {
          this.pendingBytes -= set.body.length;
        }
      }

      if (fresh.length === 0) {
        this.pending.delete(key);
      } else if (fresh.length !== sets.length) {
        this.pending.set(key, fresh);
      }
    }
  }

  /*
   * Decodes the data that waited for templates this datagram announced:
   * option data first, so a sampling rate it carries applies to the flow
   * data decoded after it. Each set decodes with the export header it
   * arrived with, so its flows keep their own times.
   */
  private replayHeldDataSets(
    exporterKey: string,
    learnedTemplateIds: Array<number>,
    result: TemplateDecodeResult,
  ): void {
    if (learnedTemplateIds.length === 0 || this.pending.size === 0) {
      return;
    }

    this.dropExpiredHeldDataSets(this.now());

    const templates: Array<FlowTemplate> = [];

    for (const templateId of new Set(learnedTemplateIds)) {
      const template: FlowTemplate | null = this.getTemplate(
        exporterKey,
        templateId,
      );

      if (template) {
        templates.push(template);
      }
    }

    templates.sort((a: FlowTemplate, b: FlowTemplate): number => {
      return Number(b.isOptions) - Number(a.isOptions);
    });

    for (const template of templates) {
      const key: string = TemplateFlowDecoder.templateKey(
        exporterKey,
        template.templateId,
      );
      const sets: Array<PendingDataSet> | undefined = this.pending.get(key);

      if (!sets) {
        continue;
      }

      this.pending.delete(key);

      for (const set of sets) {
        this.pendingBytes -= set.body.length;
        this.decodeDataSet(
          set.body,
          0,
          set.body.length,
          template,
          set.context,
          result,
        );
        result.dataSetsReplayed++;
      }
    }
  }

  /*
   * Decodes every whole record in a data set. Fewer trailing bytes than the
   * shortest record are the set's padding; a variable-length record that
   * runs past the set ends the walk.
   */
  private decodeDataSet(
    buffer: Buffer,
    start: number,
    end: number,
    template: FlowTemplate,
    context: ExportContext,
    result: TemplateDecodeResult,
  ): void {
    let offset: number = start;

    while (offset + template.minimumRecordLength <= end) {
      const values: FieldValues = new Map();
      const recordLength: number | null = TemplateFlowDecoder.readRecord(
        buffer,
        offset,
        end,
        template,
        values,
      );

      if (recordLength === null) {
        result.isMalformed = true;
        break;
      }

      if (template.isOptions) {
        this.applyOptionRecord(buffer, values, context);
      } else {
        result.records.push(this.toDecodedFlowRecord(buffer, values, context));
      }

      offset += recordLength;
    }
  }

  /*
   * Reads one record's fields into `values` (the first occurrence of each
   * element wins) and returns its length, or null when it runs past `end`.
   * Every field - known or not - advances by its length, so an element the
   * collector does not read never misaligns the ones after it.
   */
  private static readRecord(
    buffer: Buffer,
    start: number,
    end: number,
    template: FlowTemplate,
    values: FieldValues,
  ): number | null {
    let offset: number = start;

    for (const field of template.fields) {
      let length: number = field.length;

      if (length === VARIABLE_LENGTH) {
        if (offset + 1 > end) {
          return null;
        }

        length = buffer.readUInt8(offset);
        offset += 1;

        if (length === 255) {
          if (offset + 2 > end) {
            return null;
          }

          length = buffer.readUInt16BE(offset);
          offset += 2;
        }
      }

      if (offset + length > end) {
        return null;
      }

      if (field.enterpriseNumber === 0 && !values.has(field.id)) {
        values.set(field.id, { offset: offset, length: length });
      }

      offset += length;
    }

    return offset - start;
  }

  private static readNumber(
    buffer: Buffer,
    values: FieldValues,
    id: number,
  ): number | null {
    const value: FieldValue | undefined = values.get(id);

    if (!value) {
      return null;
    }

    return FlowBytes.readUnsigned(buffer, value.offset, value.length);
  }

  private static readAddress(
    buffer: Buffer,
    values: FieldValues,
    ipv4Id: number,
    ipv6Id: number,
  ): string | null {
    const ipv4: FieldValue | undefined = values.get(ipv4Id);

    if (ipv4 && ipv4.length === 4) {
      return FlowBytes.readIpV4(buffer, ipv4.offset);
    }

    const ipv6: FieldValue | undefined = values.get(ipv6Id);

    if (ipv6 && ipv6.length === 16) {
      return FlowBytes.readIpV6(buffer, ipv6.offset);
    }

    return null;
  }

  /*
   * The sampling rate a record (data or option) states in its own fields:
   * an interval (1 in N), a packet interval and space (count `interval`,
   * skip `space`), or a size out of a population (n of N). Null when it
   * states none.
   */
  private static readSamplingRate(
    buffer: Buffer,
    values: FieldValues,
  ): number | null {
    const interval: number | null =
      TemplateFlowDecoder.readNumber(buffer, values, IE_SAMPLING_INTERVAL) ??
      TemplateFlowDecoder.readNumber(
        buffer,
        values,
        IE_SAMPLER_RANDOM_INTERVAL,
      );

    if (interval !== null && interval > 0) {
      return TemplateFlowDecoder.boundRate(interval);
    }

    const packetInterval: number | null = TemplateFlowDecoder.readNumber(
      buffer,
      values,
      IE_SAMPLING_PACKET_INTERVAL,
    );

    if (packetInterval !== null && packetInterval > 0) {
      const packetSpace: number =
        TemplateFlowDecoder.readNumber(
          buffer,
          values,
          IE_SAMPLING_PACKET_SPACE,
        ) ?? 0;

      return TemplateFlowDecoder.boundRate(
        (packetInterval + packetSpace) / packetInterval,
      );
    }

    const size: number | null = TemplateFlowDecoder.readNumber(
      buffer,
      values,
      IE_SAMPLING_SIZE,
    );
    const population: number | null = TemplateFlowDecoder.readNumber(
      buffer,
      values,
      IE_SAMPLING_POPULATION,
    );

    if (size !== null && size > 0 && population !== null && population > 0) {
      return TemplateFlowDecoder.boundRate(population / size);
    }

    return null;
  }

  private static boundRate(rate: number): number {
    if (!Number.isFinite(rate) || rate < 1) {
      return 1;
    }

    return Math.min(Math.round(rate), MAX_SAMPLING_RATE);
  }

  private getExporterState(exporterKey: string): ExporterState {
    let state: ExporterState | undefined = this.exporterStates.get(exporterKey);

    if (!state) {
      state = {
        defaultSamplingRate: null,
        samplerRates: new Map(),
        systemInitTimeMs: null,
        exporterAddress: null,
      };

      this.exporterStates.set(exporterKey, state);

      while (this.exporterStates.size > MAX_EXPORTER_STATES) {
        const oldestKey: string | undefined = this.exporterStates
          .keys()
          .next().value;

        if (oldestKey === undefined) {
          break;
        }

        this.exporterStates.delete(oldestKey);
      }
    }

    return state;
  }

  /*
   * What an option record tells about its exporter. A rate with a sampler
   * or selector ID belongs to that sampler (flow records name it); a rate
   * with none is the exporter's rate for every flow. Records about other
   * things (interface names, flow cache statistics) are read and passed
   * over.
   */
  private applyOptionRecord(
    buffer: Buffer,
    values: FieldValues,
    context: ExportContext,
  ): void {
    const state: ExporterState = this.getExporterState(context.exporterKey);
    const rate: number | null = TemplateFlowDecoder.readSamplingRate(
      buffer,
      values,
    );

    if (rate !== null) {
      const samplerId: number | null =
        TemplateFlowDecoder.readNumber(buffer, values, IE_SAMPLER_ID) ??
        TemplateFlowDecoder.readNumber(buffer, values, IE_SELECTOR_ID);

      if (samplerId === null) {
        state.defaultSamplingRate = rate;
      } else if (
        state.samplerRates.has(samplerId) ||
        state.samplerRates.size < MAX_SAMPLERS_PER_EXPORTER
      ) {
        state.samplerRates.set(samplerId, rate);
      }
    }

    const systemInitTimeMs: number | null = TemplateFlowDecoder.readNumber(
      buffer,
      values,
      IE_SYSTEM_INIT_TIME_MILLISECONDS,
    );

    if (systemInitTimeMs !== null && systemInitTimeMs > 0) {
      state.systemInitTimeMs = systemInitTimeMs;
    }

    const exporterAddress: string | null = TemplateFlowDecoder.readAddress(
      buffer,
      values,
      IE_EXPORTER_IPV4,
      IE_EXPORTER_IPV6,
    );

    if (exporterAddress && exporterAddress !== "0.0.0.0") {
      state.exporterAddress = exporterAddress;
    }
  }

  private toDecodedFlowRecord(
    buffer: Buffer,
    values: FieldValues,
    context: ExportContext,
  ): DecodedFlowRecord {
    const read: (id: number) => number | null = (id: number): number | null => {
      return TemplateFlowDecoder.readNumber(buffer, values, id);
    };

    const state: ExporterState | undefined = this.exporterStates.get(
      context.exporterKey,
    );

    /*
     * Bytes and packets: the delta counters, else what was counted after
     * the device's own processing, else a firewall's initiator plus
     * responder counts (Cisco ASA NSEL), else running totals.
     */
    const initiatorOctets: number | null = read(IE_INITIATOR_OCTETS);
    const responderOctets: number | null = read(IE_RESPONDER_OCTETS);
    const initiatorPackets: number | null = read(IE_INITIATOR_PACKETS);
    const responderPackets: number | null = read(IE_RESPONDER_PACKETS);

    const octets: number =
      read(IE_OCTET_DELTA_COUNT) ??
      read(IE_POST_OCTET_DELTA_COUNT) ??
      (initiatorOctets !== null || responderOctets !== null
        ? (initiatorOctets ?? 0) + (responderOctets ?? 0)
        : null) ??
      read(IE_OCTET_TOTAL_COUNT) ??
      0;

    const packets: number =
      read(IE_PACKET_DELTA_COUNT) ??
      read(IE_POST_PACKET_DELTA_COUNT) ??
      (initiatorPackets !== null || responderPackets !== null
        ? (initiatorPackets ?? 0) + (responderPackets ?? 0)
        : null) ??
      read(IE_PACKET_TOTAL_COUNT) ??
      0;

    /*
     * Sampling: the sampler the record names, else a rate in the record,
     * else the exporter's own rate, else every packet.
     */
    let samplingRate: number | null = null;
    const samplerId: number | null =
      read(IE_SAMPLER_ID) ?? read(IE_SELECTOR_ID);

    if (samplerId !== null && state) {
      samplingRate = state.samplerRates.get(samplerId) ?? null;
    }

    if (samplingRate === null) {
      samplingRate = TemplateFlowDecoder.readSamplingRate(buffer, values);
    }

    if (samplingRate === null && state?.defaultSamplingRate) {
      samplingRate = state.defaultSamplingRate;
    }

    const times: { startMs: number; endMs: number } =
      TemplateFlowDecoder.readFlowTimes(buffer, values, context, state);

    return {
      sourceIpAddress:
        TemplateFlowDecoder.readAddress(
          buffer,
          values,
          IE_SOURCE_IPV4,
          IE_SOURCE_IPV6,
        ) ?? "0.0.0.0",
      destinationIpAddress:
        TemplateFlowDecoder.readAddress(
          buffer,
          values,
          IE_DESTINATION_IPV4,
          IE_DESTINATION_IPV6,
        ) ?? "0.0.0.0",
      inputInterfaceIndex:
        read(IE_INGRESS_INTERFACE) ?? read(IE_INGRESS_PHYSICAL_INTERFACE) ?? 0,
      outputInterfaceIndex:
        read(IE_EGRESS_INTERFACE) ?? read(IE_EGRESS_PHYSICAL_INTERFACE) ?? 0,
      packets: packets,
      octets: octets,
      flowStartAt: new Date(times.startMs),
      flowEndAt: new Date(times.endMs),
      sourcePort: read(IE_SOURCE_PORT) ?? 0,
      destinationPort: read(IE_DESTINATION_PORT) ?? 0,
      tcpFlags: read(IE_TCP_FLAGS) ?? 0,
      protocolNumber: read(IE_PROTOCOL) ?? 0,
      tos: read(IE_TOS) ?? 0,
      samplingRate: samplingRate ?? 1,
    };
  }

  /*
   * When the flow started and ended, from whichever clock the template
   * uses: absolute seconds, milliseconds, microseconds or nanoseconds;
   * microseconds before the export; or the device's uptime - which a v9
   * header ties to the wall clock, and an IPFIX exporter only through the
   * boot time it reports. With none of those the export time is the most
   * truthful single time there is. A time after the export (a device
   * clock running ahead) is the export time.
   */
  private static readFlowTimes(
    buffer: Buffer,
    values: FieldValues,
    context: ExportContext,
    state: ExporterState | undefined,
  ): { startMs: number; endMs: number } {
    const exportTimeMs: number = context.exportTimeMs;

    const read: (id: number) => number | null = (id: number): number | null => {
      return TemplateFlowDecoder.readNumber(buffer, values, id);
    };

    // dateTimeMicroseconds / dateTimeNanoseconds are 8-byte NTP timestamps.
    const readNtp: (id: number) => number | null = (
      id: number,
    ): number | null => {
      const value: FieldValue | undefined = values.get(id);

      if (!value || value.length !== 8) {
        return null;
      }

      return FlowBytes.readNtpTimestampMs(buffer, value.offset);
    };

    const fromUptime: (uptimeMs: number | null) => number | null = (
      uptimeMs: number | null,
    ): number | null => {
      if (uptimeMs === null) {
        return null;
      }

      if (context.sysUptimeMs !== null) {
        return TemplateFlowDecoder.uptimeToWallClock(
          uptimeMs,
          context.sysUptimeMs,
          exportTimeMs,
        );
      }

      const systemInitTimeMs: number | null =
        read(IE_SYSTEM_INIT_TIME_MILLISECONDS) ??
        state?.systemInitTimeMs ??
        null;

      return systemInitTimeMs !== null ? systemInitTimeMs + uptimeMs : null;
    };

    const fromSeconds: (seconds: number | null) => number | null = (
      seconds: number | null,
    ): number | null => {
      return seconds === null ? null : seconds * 1000;
    };

    const fromDelta: (deltaMicros: number | null) => number | null = (
      deltaMicros: number | null,
    ): number | null => {
      return deltaMicros === null
        ? null
        : exportTimeMs - Math.floor(deltaMicros / 1000);
    };

    const startMs: number | null =
      read(IE_FLOW_START_MILLISECONDS) ??
      fromSeconds(read(IE_FLOW_START_SECONDS)) ??
      readNtp(IE_FLOW_START_MICROSECONDS) ??
      readNtp(IE_FLOW_START_NANOSECONDS) ??
      fromDelta(read(IE_FLOW_START_DELTA_MICROSECONDS)) ??
      fromUptime(read(IE_FLOW_START_SYS_UP_TIME)) ??
      read(IE_OBSERVATION_TIME_MILLISECONDS);

    const endMs: number | null =
      read(IE_FLOW_END_MILLISECONDS) ??
      fromSeconds(read(IE_FLOW_END_SECONDS)) ??
      readNtp(IE_FLOW_END_MICROSECONDS) ??
      readNtp(IE_FLOW_END_NANOSECONDS) ??
      fromDelta(read(IE_FLOW_END_DELTA_MICROSECONDS)) ??
      fromUptime(read(IE_FLOW_END_SYS_UP_TIME)) ??
      read(IE_OBSERVATION_TIME_MILLISECONDS);

    const clamp: (ms: number | null) => number = (
      ms: number | null,
    ): number => {
      if (ms === null || !Number.isFinite(ms) || ms < 0 || ms > exportTimeMs) {
        return exportTimeMs;
      }

      return ms;
    };

    const start: number = clamp(startMs);
    const end: number = Math.max(start, clamp(endMs ?? startMs));

    return { startMs: start, endMs: end };
  }

  /*
   * Converts a sysUptime timestamp (ms since the device booted) to wall
   * clock: exportTime + (recordUptime - exportUptime). The difference
   * between the two 32-bit timers is read as a SIGNED value centred on
   * zero, so a flow stamped just before the counter wrapped comes out as
   * its real small age, and the small positive differences some exporters
   * send (the flow cache's timer a beat ahead of the export path's) are
   * not mistaken for a wrap that backdates the flow ~49.7 days.
   */
  public static uptimeToWallClock(
    recordUptimeMs: number,
    exportUptimeMs: number,
    exportTimeMs: number,
  ): number {
    let uptimeDeltaMs: number =
      (recordUptimeMs - exportUptimeMs) % SYS_UPTIME_WRAP_MS;

    if (uptimeDeltaMs >= SYS_UPTIME_WRAP_MS / 2) {
      uptimeDeltaMs -= SYS_UPTIME_WRAP_MS;
    } else if (uptimeDeltaMs < -SYS_UPTIME_WRAP_MS / 2) {
      uptimeDeltaMs += SYS_UPTIME_WRAP_MS;
    }

    return exportTimeMs + uptimeDeltaMs;
  }
}
