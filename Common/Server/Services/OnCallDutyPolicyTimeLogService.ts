import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicyTimeLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async startTimeLogForUser(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID; 
    onCallDutyPolicyEscalationRuleId: ObjectID;
    userId: ObjectID;
    teamId?: ObjectID;
    onCallDutyPolicyScheduleId?: ObjectID;
    startsAt: Date;
  }){
    const { onCallDutyPolicyId, userId, teamId, onCallDutyPolicyScheduleId, startsAt } = data;
    const timeLog = new Model();
    timeLog.onCallDutyPolicyId = onCallDutyPolicyId;
    timeLog.userId = userId;
    if(teamId) timeLog.teamId = teamId;
    timeLog.onCallDutyPolicyEscalationRuleId = data.onCallDutyPolicyEscalationRuleId;
    if(onCallDutyPolicyScheduleId) timeLog.onCallDutyPolicyScheduleId = onCallDutyPolicyScheduleId;
    timeLog.startsAt = startsAt;


    return await this.create({
      data: timeLog,
      props: {
        isRoot: true,
      }
    });
  }


  public async endTimeLogForUser(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID; 
    onCallDutyPolicyEscalationRuleId: ObjectID;
    userId: ObjectID;
    teamId?: ObjectID;
    onCallDutyPolicyScheduleId?: ObjectID;
    endsAt: Date;
  }){
    const { onCallDutyPolicyId, userId, teamId, onCallDutyPolicyScheduleId, endsAt } = data;

    return await this.updateOneBy({
      query: {
        onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: data.onCallDutyPolicyEscalationRuleId,
        userId,
        ...(teamId && { teamId }),
        ...(onCallDutyPolicyScheduleId && { onCallDutyPolicyScheduleId }),

      },
      data: {
        endsAt: endsAt,
      },
      props: {
        isRoot: true,
      }
    });
  }

}

export default new Service();
