import {
  AuditLogExportBatch,
  AuditLogExportDelivery,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
} from "../../../../Server/AuditLogExport/Destinations/Types";

/*
 * A destination that keeps every batch it was sent, in order, and fails
 * when a test tells it to: the exporter's suites read what arrived where.
 * Not a test file itself.
 */
export default class RecordingDestination implements AuditLogExportDestination {
  public readonly batches: Array<AuditLogExportBatch> = [];
  public readonly deliveries: Array<AuditLogExportDelivery> = [];
  public attempts: number = 0;
  private readonly failures: Array<AuditLogExportDeliveryError | Error> = [];

  public failNext(
    count: number,
    error: AuditLogExportDeliveryError | Error,
  ): void {
    for (let index: number = 0; index < count; index++) {
      this.failures.push(error);
    }
  }

  public async deliver(
    delivery: AuditLogExportDelivery,
  ): Promise<AuditLogExportDeliveryReceipt> {
    this.attempts++;

    const failure: AuditLogExportDeliveryError | Error | undefined =
      this.failures.shift();

    if (failure) {
      throw failure;
    }

    this.batches.push(delivery.batch);
    this.deliveries.push(delivery);

    return { location: `recorded://${delivery.batch.id}` };
  }

  // Every entry id delivered, in order (a repeat shows up twice).
  public deliveredIds(): Array<string> {
    return this.batches.flatMap((batch: AuditLogExportBatch): Array<string> => {
      return batch.records.map((record: { id: string }): string => {
        return record.id;
      });
    });
  }
}
