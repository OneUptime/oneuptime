import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";

/*
 * Sums the records of one conversation that arrive close together, so the
 * probe forwards - and the server stores - one row where a device sent many.
 *
 * Two records are the same conversation when they come from the same
 * exporter in the same format at the same sampling rate, between the same
 * addresses, over the same protocol and ports, through the same interfaces.
 * Because the decoder folds a client's ephemeral port into 0, every
 * connection a laptop makes to one web server in the window is one
 * conversation here: on typical traffic that is several times fewer rows,
 * with the same bytes, packets and flow counts.
 *
 * The aggregator holds what arrived since the last flush (a few seconds),
 * bounded by maxEntries: past it the OLDEST conversations are dropped - flow
 * export is lossy by design, and a collector that cannot forward must not
 * grow without bound.
 */
export default class FlowAggregator {
  private entries: Map<string, NetworkFlowRecord> = new Map();
  private droppedEntries: number = 0;

  public constructor(private readonly maxEntries: number) {}

  public get size(): number {
    return this.entries.size;
  }

  // Conversations dropped to stay under maxEntries since the last call.
  public takeDroppedCount(): number {
    const dropped: number = this.droppedEntries;
    this.droppedEntries = 0;
    return dropped;
  }

  public static getKey(record: NetworkFlowRecord): string {
    return [
      record.exporterIpAddress,
      record.flowFormat || "",
      record.samplingRate || 1,
      record.sourceIpAddress,
      record.destinationIpAddress,
      record.protocolNumber,
      record.sourcePort,
      record.destinationPort,
      record.inputInterfaceIndex || 0,
      record.outputInterfaceIndex || 0,
    ].join("|");
  }

  public add(record: NetworkFlowRecord): void {
    const key: string = FlowAggregator.getKey(record);
    const existing: NetworkFlowRecord | undefined = this.entries.get(key);

    if (existing) {
      existing.octets += record.octets;
      existing.packets += record.packets;
      existing.flowCount = (existing.flowCount || 1) + (record.flowCount || 1);
      existing.tcpFlags = (existing.tcpFlags || 0) | (record.tcpFlags || 0);

      if (record.flowStartAt.getTime() < existing.flowStartAt.getTime()) {
        existing.flowStartAt = record.flowStartAt;
      }

      if (record.flowEndAt.getTime() > existing.flowEndAt.getTime()) {
        existing.flowEndAt = record.flowEndAt;
      }

      return;
    }

    this.entries.set(key, {
      ...record,
      flowCount: record.flowCount || 1,
    });

    while (this.entries.size > this.maxEntries) {
      const oldestKey: string | undefined = this.entries.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.entries.delete(oldestKey);
      this.droppedEntries++;
    }
  }

  // Takes up to `max` conversations out, oldest first.
  public drain(max: number): Array<NetworkFlowRecord> {
    const drained: Array<NetworkFlowRecord> = [];

    for (const [key, record] of this.entries) {
      if (drained.length >= max) {
        break;
      }

      drained.push(record);
      this.entries.delete(key);
    }

    return drained;
  }

  public clear(): void {
    this.entries.clear();
    this.droppedEntries = 0;
  }
}
