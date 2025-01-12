import LogSeverity from "../../Types/Log/LogSeverity";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model, { AlertLogEvent } from "Common/Models/DatabaseModels/AlertLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

   public async createAlertLog(data: {
      alertId: ObjectID,
      logInMarkdown: string,
      alertLogEvent: AlertLogEvent, 
      projectId: ObjectID,
      moreInformationInMarkdown?: string | undefined,
      logSeverity?: LogSeverity | undefined,
    }): Promise<Model> {
      const alertLog: Model = new Model();

      if(!data.logSeverity) {
        data.logSeverity = LogSeverity.Unspecified;
      }
      
      alertLog.alertLogSeverity = data.logSeverity;
  
      alertLog.alertId = data.alertId;
      alertLog.logInMarkdown = data.logInMarkdown;
      alertLog.alertLogEvent = data.alertLogEvent;
      alertLog.projectId = data.projectId;
      
      if(data.moreInformationInMarkdown) {
        alertLog.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }
  
      return await this.create({
        data: alertLog,
        props: {
          isRoot:   true,
        }
      })
    }
}

export default new Service();
