import DecodedFlowRecord from "./DecodedFlowRecord";
import TemplateFlowDecoder, {
  IpfixHeader,
  TemplateDecodeResult,
} from "./TemplateFlowDecoder";

/*
 * IPFIX (RFC 7011), the IETF standard that grew out of NetFlow v9 and is
 * often called "NetFlow v10". Cisco Flexible NetFlow, Juniper, Arista,
 * VMware and most open-source exporters can send it.
 *
 * It differs from v9 in the details TemplateFlowDecoder handles: a 16-byte
 * header that declares the message length and has no device uptime;
 * template and options template sets numbered 2 and 3; vendor (enterprise)
 * fields, which are skipped; fields whose length each record gives; flow
 * times as absolute timestamps; and templates an exporter can withdraw.
 */

export type { IpfixHeader } from "./TemplateFlowDecoder";

export interface ParsedIpfixMessage {
  header: IpfixHeader;
  /*
   * The flows in this message, and those of earlier data sets that waited
   * for a template this message finally brought.
   */
  records: Array<DecodedFlowRecord>;
  templatesLearned: number;
  templatesWithdrawn: number;
  // Data sets that named a template not seen yet (held, or dropped when full).
  dataSetsWaitingForTemplate: number;
  dataSetsDropped: number;
  dataSetsReplayed: number;
  // The address the exporter gives for itself in its option records, if any.
  exporterAddress: string | null;
  isMalformed: boolean;
}

export default class IpfixParser {
  private decoder: TemplateFlowDecoder;

  public constructor(options?: {
    now?: (() => number) | undefined;
    decoder?: TemplateFlowDecoder | undefined;
  }) {
    this.decoder =
      options?.decoder ?? new TemplateFlowDecoder({ now: options?.now });
  }

  /*
   * Parses one IPFIX message from the exporter at this address and UDP
   * source port. Null when the buffer cannot be an IPFIX message.
   */
  public parse(
    datagram: Buffer,
    exporterIpAddress: string,
    exporterPort: number = 0,
  ): ParsedIpfixMessage | null {
    const decoded: {
      header: IpfixHeader;
      result: TemplateDecodeResult;
    } | null = this.decoder.decodeIpfix(
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
      templatesWithdrawn: decoded.result.templatesWithdrawn,
      dataSetsWaitingForTemplate:
        decoded.result.dataSetsWaitingForTemplate +
        decoded.result.dataSetsDroppedWithoutTemplate,
      dataSetsDropped: decoded.result.dataSetsDroppedWithoutTemplate,
      dataSetsReplayed: decoded.result.dataSetsReplayed,
      exporterAddress: decoded.result.exporterAddress,
      isMalformed: decoded.result.isMalformed,
    };
  }
}
