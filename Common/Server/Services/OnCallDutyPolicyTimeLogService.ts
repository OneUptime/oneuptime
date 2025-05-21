import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyTimeLog";

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
  }): Promise<Model> {
    const {
      onCallDutyPolicyId,
      userId,
      teamId,
      onCallDutyPolicyScheduleId,
      startsAt,
    } = data;

    // check if the time log already exists for the user.

    const existingTimeLog: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: data.onCallDutyPolicyEscalationRuleId,
        userId,
        ...(teamId && { teamId }),
        ...(onCallDutyPolicyScheduleId && { onCallDutyPolicyScheduleId }),
      },
      props: {
        isRoot: true,
      },
    });

    if (existingTimeLog) {
      return existingTimeLog;
    }

    const timeLog: Model = new Model();
    timeLog.onCallDutyPolicyId = onCallDutyPolicyId;
    timeLog.userId = userId;
    if (teamId) {
      timeLog.teamId = teamId;
    }
    timeLog.onCallDutyPolicyEscalationRuleId =
      data.onCallDutyPolicyEscalationRuleId;
    if (onCallDutyPolicyScheduleId) {
      timeLog.onCallDutyPolicyScheduleId = onCallDutyPolicyScheduleId;
    }
    timeLog.projectId = data.projectId;
    timeLog.startsAt = startsAt;

    return await this.create({
      data: timeLog,
      props: {
        isRoot: true,
      },
    });
  }

  public async endTimeForSchedule(data: {
    projectId: ObjectID;
    onCallDutyPolicyScheduleId: ObjectID;
    endsAt: Date;
  }): Promise<void> {
    const { endsAt, onCallDutyPolicyScheduleId } = data;
    await this.updateBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyScheduleId,
      },
      data: {
        endsAt: endsAt,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  public async endTimeForTeam(data: {
    projectId: ObjectID;
    teamId: ObjectID;
    endsAt: Date;
  }): Promise<void> {
    const { endsAt, teamId } = data;
    await this.updateBy({
      query: {
        projectId: data.projectId,
        teamId,
      },

      limit: LIMIT_PER_PROJECT,
      skip: 0,
      data: {
        endsAt: endsAt,
      },
      props: {
        isRoot: true,
      },
    });
  }

  public async endTimeForUser(data: {
    projectId: ObjectID;
    userId: ObjectID;
    endsAt: Date;
  }): Promise<void> {
    const { endsAt, userId } = data;
    await this.updateBy({
      query: {
        projectId: data.projectId,
        userId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      data: {
        endsAt: endsAt,
      },
      props: {
        isRoot: true,
      },
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
  }): Promise<void> {
    const {
      onCallDutyPolicyId,
      userId,
      teamId,
      onCallDutyPolicyScheduleId,
      endsAt,
    } = data;

    await this.updateBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: data.onCallDutyPolicyEscalationRuleId,
        userId,
        ...(teamId && { teamId }),
        ...(onCallDutyPolicyScheduleId && { onCallDutyPolicyScheduleId }),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      data: {
        endsAt: endsAt,
      },
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
