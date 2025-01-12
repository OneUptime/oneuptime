import BadDataException from "../../Types/Exception/BadDataException";
import LogSeverity from "../../Types/Log/LogSeverity";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model, { IncidentLogEvent } from "Common/Models/DatabaseModels/IncidentLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async createIncidentLog(data: {
    incidentId: ObjectID,
    logInMarkdown: string,
    incidentLogEvent: IncidentLogEvent, 
    projectId: ObjectID,
    moreInformationInMarkdown?: string | undefined,
    logSeverity?: LogSeverity | undefined,
  }): Promise<Model> {
    const incidentLog: Model = new Model();

    if(!data.incidentId){
      throw new BadDataException("Incident ID is required");
    }

    if(!data.logInMarkdown){
      throw new BadDataException("Log in markdown is required");
    }

    if(!data.incidentLogEvent){
      throw new BadDataException("Incident log event is required");
    }

    if(!data.projectId){
      throw new BadDataException("Project ID is required");
    }

    if(!data.logSeverity) {
      data.logSeverity = LogSeverity.Unspecified;
    }
    incidentLog.incidentLogSeverity = data.logSeverity;
    incidentLog.incidentId = data.incidentId;
    incidentLog.logInMarkdown = data.logInMarkdown;
    incidentLog.incidentLogEvent = data.incidentLogEvent;
    incidentLog.projectId = data.projectId;
    
    if(data.moreInformationInMarkdown) {
      incidentLog.moreInformationInMarkdown = data.moreInformationInMarkdown;
    }

    return await this.create({
      data: incidentLog,
      props: {
        isRoot:   true,
      }
    })
  }
}

export default new Service();
