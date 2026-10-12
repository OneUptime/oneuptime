import PacketCaptureEndReason from "./PacketCaptureEndReason";
import PacketCaptureStatus from "./PacketCaptureStatus";

/*
 * What the server and a probe say to each other about packet captures,
 * over the probe-ingest routes:
 *
 *   POST /probe/packet-capture/capability       the probe's report (PacketCaptureCapability)
 *   POST /probe/packet-capture/list             { limit, runningPacketCaptureIds }
 *                                               -> PacketCaptureListResponse
 *   POST /probe/packet-capture/response/ingest  PacketCaptureReport
 *
 * The probe asks for work every ten seconds, the way it asks for monitors
 * and diagnostics. The same request tells the server which captures it is
 * running, and the answer tells it which of those to stop: one a person
 * stopped from the dashboard, or one that was deleted.
 */

// One capture a probe was handed: everything it needs to run it.
export interface PacketCaptureJob {
  id: string;
  interfaceName: string;
  // The BPF expression; empty to keep every packet.
  bpfFilter: string;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInBytes: number;
}

export interface PacketCaptureListResponse {
  packetCaptures: Array<PacketCaptureJob>;
  /*
   * Of the captures the probe said it is running, the ones to stop now. A
   * capture stopped from the dashboard is uploaded with what it has; one the
   * server no longer knows is dropped (its upload would be refused).
   */
  stopPacketCaptureIds: Array<string>;
}

// What a probe posts when a capture it ran is over.
export interface PacketCaptureReport {
  packetCaptureId: string;
  status: PacketCaptureStatus.Completed | PacketCaptureStatus.Failed;
  // Completed: why it stopped. Failed: never set.
  endReason?: PacketCaptureEndReason | undefined;
  /*
   * Failed: why, in words. Completed: what the capture tool said when it
   * stopped by itself, if it did; otherwise unset.
   */
  statusMessage?: string | undefined;
  /*
   * Completed: the pcap file, as base64. Absent when no packet matched the
   * filter - there is then nothing to open.
   */
  pcapBase64?: string | undefined;
}

/*
 * How many captures a probe runs at once, and so the most one list request
 * hands out.
 */
export const PACKET_CAPTURE_PROBE_CONCURRENCY: number = 2;

// How many running captures one list request may ask about.
export const MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST: number = 32;
