import DataMigrationBase from "./DataMigrationBase";
import AlertMeasurementService from "Common/Server/Services/AlertMeasurementService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import IncidentMeasurementService from "Common/Server/Services/IncidentMeasurementService";
import ScheduledMaintenanceMeasurementService from "Common/Server/Services/ScheduledMaintenanceMeasurementService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import MeasurementUnit, {
  getMeasurementUnit,
} from "Common/Types/Measurement/MeasurementUnit";
import ObjectID from "Common/Types/ObjectID";

/*
 * Rewrites the chart points of every measurement saved in minutes, hours or
 * days, so they are in that unit.
 *
 * A measurement's unit used to be free text, and the metric writer wrote
 * each value in seconds whatever it said: a measurement saved with "minutes"
 * charted an hour and a half as 5,400 minutes. The writer now converts each
 * value into the measurement's unit (Types/Measurement/MeasurementUnit), so
 * every point written from now on is right - but a closed incident is only
 * written again when its measurements are worked out again. This asks the
 * backfill worker (Jobs/Measurement/BackfillMeasurements) to do that for
 * every measurement whose unit is not seconds, the same way changing a
 * measurement's unit does.
 *
 * A unit that reads as seconds - "seconds", "secs", "s", or anything that is
 * no time unit at all - is left alone: its points were in seconds already.
 *
 * Postgres only; the worker writes the points. Idempotent in effect: a
 * second run only asks for a backfill that is already asked for. One
 * table's failure is logged and the rest still run, so it never halts the
 * migrations after it.
 */
export default class RewriteMeasurementPointsInTheirUnit extends DataMigrationBase {
  public constructor() {
    super("RewriteMeasurementPointsInTheirUnit");
  }

  // The incident, alert and scheduled maintenance measurement services.
  public static getServices(): Array<DatabaseService<any>> {
    return [
      IncidentMeasurementService,
      AlertMeasurementService,
      ScheduledMaintenanceMeasurementService,
    ];
  }

  public override async migrate(): Promise<void> {
    for (const service of RewriteMeasurementPointsInTheirUnit.getServices()) {
      const table: string = service.getModel().tableName || "measurements";

      try {
        const measurements: Array<{
          _id?: string | undefined;
          unit?: string | undefined;
        }> = (await service.findAllBy({
          query: { unit: QueryHelper.notNull() },
          select: { _id: true, unit: true },
          props: { isRoot: true },
        })) as unknown as Array<{
          _id?: string | undefined;
          unit?: string | undefined;
        }>;

        let requested: number = 0;

        for (const measurement of measurements) {
          if (
            !measurement._id ||
            getMeasurementUnit(measurement.unit) === MeasurementUnit.Seconds
          ) {
            continue;
          }

          /*
           * What the service does when a measurement's unit changes:
           * restart its backfill from the beginning.
           */
          await service.updateOneById({
            id: new ObjectID(measurement._id.toString()),
            data: {
              backfillRequestedAt: OneUptimeDate.getCurrentDate(),
              backfillCursorCreatedAt: null,
              backfillCompletedAt: null,
            } as never,
            props: { isRoot: true },
          });

          requested++;
        }

        logger.info(
          `RewriteMeasurementPointsInTheirUnit: ${table}: ${requested} measurement(s) in minutes, hours or days will be worked out again.`,
        );
      } catch (err) {
        logger.error(
          `RewriteMeasurementPointsInTheirUnit: ${table} was skipped: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: the points are only written again.
    return;
  }
}
