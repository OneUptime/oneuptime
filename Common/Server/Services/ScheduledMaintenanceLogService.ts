import LogSeverity from "../../Types/Log/LogSeverity";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model, { ScheduledMaintenanceLogEvent } from "Common/Models/DatabaseModels/ScheduledMaintenanceLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async createScheduledMaintenanceLog(data: {
    scheduledMaintenanceId: ObjectID,
    logInMarkdown: string,
    scheduledMaintenanceLogEvent: ScheduledMaintenanceLogEvent,
    projectId: ObjectID,
    moreInformationInMarkdown?: string | undefined,
    logSeverity?: LogSeverity | undefined,
  }): Promise<Model> {


    if(!data.logSeverity) {
      data.logSeverity = LogSeverity.Unspecified;
    }

    const scheduledMaintenanceLog: Model = new Model();

    scheduledMaintenanceLog.scheduledMaintenanceLogSeverity = data.logSeverity;
    scheduledMaintenanceLog.scheduledMaintenanceId = data.scheduledMaintenanceId;
    scheduledMaintenanceLog.logInMarkdown = data.logInMarkdown;
    scheduledMaintenanceLog.scheduledMaintenanceLogEvent = data.scheduledMaintenanceLogEvent;
    scheduledMaintenanceLog.projectId = data.projectId;


    if (data.moreInformationInMarkdown) {
      scheduledMaintenanceLog.moreInformationInMarkdown = data.moreInformationInMarkdown;
    }

    return await this.create({
      data: scheduledMaintenanceLog,
      props: {
        isRoot: true,
      }
    })
  }
}

export default new Service();
