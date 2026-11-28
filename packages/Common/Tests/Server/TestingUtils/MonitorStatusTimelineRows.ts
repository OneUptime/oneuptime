import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import MonitorStatusTimelineUtil from "../../../Server/Utils/Monitor/MonitorStatusTimeline";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { jest } from "@jest/globals";

/*
 * A monitor's status timeline, kept in memory, for suites that drive
 * MonitorResourceUtil.monitorResource end to end and want the status written
 * the way the product writes it: the real MonitorStatusTimelineUtil decides
 * whether a criteria moves the monitor, and every status change - a criteria
 * that sets one, the move back to the default status, a status kept - is a
 * row here, with when it started and ended. What a status page and an uptime
 * report read is these rows (UptimeUtil, StatusPageService).
 *
 * Call it after mockMonitorRecordTables, in beforeEach: it puts the real
 * status change back in place of the one MonitorRecordTables stands in, and
 * keeps the rows instead. Restore with jest.restoreAllMocks in afterEach.
 */
export interface MonitorStatusTimelineRows {
  // Every row, oldest first; the newest has no endsAt.
  rows: Array<MonitorStatusTimeline>;
  // The status of each row, by the name statusNames gives it.
  statusNames(): Array<string>;
}

export function mockMonitorStatusTimelineRows(input: {
  getMonitor: () => Monitor;
  projectId: ObjectID;
  // The project's statuses, by id: their names and order, as a page reads them.
  statuses: Array<MonitorStatus>;
}): MonitorStatusTimelineRows {
  const rows: Array<MonitorStatusTimeline> = [];

  const statusOf: (
    statusId: ObjectID | undefined,
  ) => MonitorStatus | undefined = (
    statusId: ObjectID | undefined,
  ): MonitorStatus | undefined => {
    return input.statuses.find((status: MonitorStatus): boolean => {
      return status.id?.toString() === statusId?.toString();
    });
  };

  const nameOf: (statusId: ObjectID | undefined) => string = (
    statusId: ObjectID | undefined,
  ): string => {
    return statusOf(statusId)?.name || statusId?.toString() || "";
  };

  // The monitor's first status, as creating it writes one.
  const first: MonitorStatusTimeline = new MonitorStatusTimeline();
  first.id = ObjectID.generate();
  first.monitorId = input.getMonitor().id!;
  first.projectId = input.projectId;
  first.monitorStatusId = new ObjectID(
    input.getMonitor().currentMonitorStatusId!.toString(),
  );
  // The status itself, as uptime reads it (UptimeUtil.getMonitorEventsForId).
  const firstStatus: MonitorStatus | undefined = statusOf(
    first.monitorStatusId,
  );

  if (firstStatus) {
    first.monitorStatus = firstStatus;
  }

  first.startsAt = OneUptimeDate.getCurrentDate();
  first.rootCause = "This status was created when the monitor was created.";
  rows.push(first);

  // The real decision whether a criteria moves the monitor.
  (
    MonitorStatusTimelineUtil.updateMonitorStatusTimeline as unknown as {
      mockRestore?: () => void;
    }
  ).mockRestore?.();

  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation((async (): Promise<MonitorStatusTimeline | null> => {
      return rows[rows.length - 1] || null;
    }) as never);

  jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: MonitorStatusTimeline;
    }): Promise<MonitorStatusTimeline> => {
      const row: MonitorStatusTimeline = createBy.data;
      const now: Date = OneUptimeDate.getCurrentDate();
      const previous: MonitorStatusTimeline | undefined = rows[rows.length - 1];

      if (previous && !previous.endsAt) {
        previous.endsAt = now;
      }

      row.id = ObjectID.generate();
      row.startsAt = row.startsAt || now;

      const rowStatus: MonitorStatus | undefined = statusOf(
        row.monitorStatusId,
      );

      if (rowStatus) {
        row.monitorStatus = rowStatus;
      }

      rows.push(row);

      input.getMonitor().currentMonitorStatusId = new ObjectID(
        row.monitorStatusId!.toString(),
      );

      return row;
    }) as never);

  // Every status the project has is its own.
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: JSONObject;
    }): Promise<MonitorStatus | null> => {
      const id: string = String(findBy.query["_id"]);

      const known: MonitorStatus | undefined = input.statuses.find(
        (status: MonitorStatus): boolean => {
          return status.id?.toString() === id;
        },
      );

      if (!known) {
        return null;
      }

      const status: MonitorStatus = new MonitorStatus();
      status._id = id;
      status.projectId = input.projectId;
      status.name = known.name!;
      return status;
    }) as never);

  return {
    rows: rows,
    statusNames: (): Array<string> => {
      return rows.map((row: MonitorStatusTimeline): string => {
        return nameOf(row.monitorStatusId);
      });
    },
  };
}
