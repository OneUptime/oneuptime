import MonitorLogService from "../../Services/MonitorLogService";
import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import DataToProcess from "./DataToProcess";

export default class MonitorLogUtil {
  public static saveMonitorLog(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
  }): void {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    const logIngestionDate: Date = OneUptimeDate.getCurrentDate();
    const logTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(logIngestionDate);

    const monitorLogRow: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: logTimestamp,
      updatedAt: logTimestamp,
      projectId: data.projectId.toString(),
      monitorId: data.monitorId.toString(),
      time: logTimestamp,
      logBody: JSON.parse(JSON.stringify(data.dataToProcess)),
    };

    MonitorLogService.insertJsonRows([monitorLogRow]).catch((err: Error) => {
      logger.error(err);
    });
  }
}
