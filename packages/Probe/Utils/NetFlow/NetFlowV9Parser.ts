import DecodedFlowRecord from "./DecodedFlowRecord";
import TemplateFlowDecoder, {
  NetFlowV9Header,
  TemplateDecodeResult,
} from "./TemplateFlowDecoder";

/*
 * NetFlow v9 (RFC 3954). Template-based, like IPFIX: the exporter sends
 * templates that describe its records, then data that only decodes with
 * them, so the parser is stateful and one INSTANCE must live as long as the
 * receiving socket. The template machinery, sampling options and the
 * holding of data that arrives before its template live in
 * TemplateFlowDecoder, which IPFIX shares; this is the v9 face of it.
 *
 * Malformed input degrades gracefully rather than throwing: a datagram too
 * short for a header, or of another version, returns null; a FlowSet whose
 * declared length runs past the end of the datagram stops the walk and
 * whatever decoded before it is returned.
 */

export type { NetFlowV9Header } from "./TemplateFlowDecoder";

/*
 * A flow as the v9 template laid it out. Fields a template does not carry
 * decode as 0 ("0.0.0.0" for addresses, the export time for times).
 */
export type NetFlowV9Record = DecodedFlowRecord;

export interface ParsedNetFlowV9Datagram {
  header: NetFlowV9Header;
  /*
   * The flows in this datagram, and those of earlier data FlowSets that
   * waited for a template this datagram finally brought.
   */
  records: Array<NetFlowV9Record>;
  // Templates (re)learned from this datagram's template FlowSets.
  templatesLearned: number;
  /*
   * Data FlowSets that named a template this parser has not seen - routine
   * right after an exporter (or this probe) restarts. They are held and
   * decoded when the template arrives; counted as FlowSets, because without
   * the template the number of records in them is unknowable.
   */
  dataFlowSetsSkippedForUnknownTemplate: number;
  // Of those, how many could not even be held (the holding area was full).
  dataFlowSetsDropped: number;
  // Earlier held data FlowSets this datagram's templates decoded.
  dataFlowSetsReplayed: number;
  // The address the exporter gives for itself in its option records, if any.
  exporterAddress: string | null;
  isMalformed: boolean;
}

export default class NetFlowV9Parser {
  private decoder: TemplateFlowDecoder;

  public constructor(options?: {
    // Injectable clock so tests can drive template expiry deterministically.
    now?: (() => number) | undefined;
    // Share the template state with the IPFIX parser (the receiver does).
    decoder?: TemplateFlowDecoder | undefined;
  }) {
    this.decoder =
      options?.decoder ?? new TemplateFlowDecoder({ now: options?.now });
  }

  /*
   * Parses one NetFlow v9 export datagram from the exporter at this address
   * (and UDP source port: two exporters behind one NAT share the address).
   * Returns null when the buffer cannot be a v9 datagram.
   */
  public parse(
    datagram: Buffer,
    exporterIpAddress: string,
    exporterPort: number = 0,
  ): ParsedNetFlowV9Datagram | null {
    const decoded: {
      header: NetFlowV9Header;
      result: TemplateDecodeResult;
    } | null = this.decoder.decodeNetFlowV9(
      datagram,
      exporterIpAddress,
      exporterPort,
    );

    if (!decoded) {
      return null;
    }

    return {
      header: decoded.header,
      records: decoded.result.records,
      templatesLearned: decoded.result.templatesLearned,
      dataFlowSetsSkippedForUnknownTemplate:
        decoded.result.dataSetsWaitingForTemplate +
        decoded.result.dataSetsDroppedWithoutTemplate,
      dataFlowSetsDropped: decoded.result.dataSetsDroppedWithoutTemplate,
      dataFlowSetsReplayed: decoded.result.dataSetsReplayed,
      exporterAddress: decoded.result.exporterAddress,
      isMalformed: decoded.result.isMalformed,
    };
  }
}
