import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import QueryHelper from "../Types/Database/QueryHelper";

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

    /*
     * Check if an OPEN (not-yet-ended) time log already exists for the user.
     * The endsAt IS NULL filter is essential: without it, a user who rotated
     * off and later rotates back on would match their already-CLOSED prior log
     * and skip creating a new one, so their later on-call stints would never be
     * recorded (and a "who is on call now" query filtering endsAt IS NULL would
     * miss them). Each distinct on-call stint must be its own row.
     */
    const existingTimeLog: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: data.onCallDutyPolicyEscalationRuleId,
        userId,
        /*
         * Scope the context columns explicitly so a direct-user log dedups only
         * against other direct logs, a team log only against team logs, and a
         * schedule log only against schedule logs. The old `...(x && {x})`
         * OMITTED the column when absent, so an absent column matched ANY value:
         * a direct-user start then deduped against an already-open schedule/team
         * log and never created the direct log, leaving the user with zero open
         * logs once that schedule/team log closed (audit L4).
         */
        teamId: teamId ?? QueryHelper.isNull(),
        onCallDutyPolicyScheduleId:
          onCallDutyPolicyScheduleId ?? QueryHelper.isNull(),
        endsAt: QueryHelper.isNull(),
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
      // only close still-open logs; never overwrite historical closed intervals.
      query: {
        projectId: data.projectId,
        onCallDutyPolicyScheduleId,
        endsAt: QueryHelper.isNull(),
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
      // only close still-open logs; never overwrite historical closed intervals.
      query: {
        projectId: data.projectId,
        teamId,
        endsAt: QueryHelper.isNull(),
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
    /*
     * When set, only close logs derived from this team. Leaving one team must
     * not close a user's still-active logs from other teams, direct escalation
     * assignments, or schedule rosters (audit F17).
     */
    teamId?: ObjectID | undefined;
    endsAt: Date;
  }): Promise<void> {
    const { endsAt, userId, teamId } = data;
    await this.updateBy({
      // only close still-open logs; never overwrite historical closed intervals.
      query: {
        projectId: data.projectId,
        userId,
        ...(teamId && { teamId }),
        endsAt: QueryHelper.isNull(),
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
      // only close the still-open stint; leave prior closed stints intact.
      query: {
        projectId: data.projectId,
        onCallDutyPolicyId,
        onCallDutyPolicyEscalationRuleId: data.onCallDutyPolicyEscalationRuleId,
        userId,
        /*
         * Constrain the context columns to IS NULL when not supplied so each
         * context closes ONLY its own stint. The old `...(x && {x})` omitted the
         * column, so ending a direct-user assignment (no teamId/scheduleId)
         * matched — and closed — that user's still-open SCHEDULE and TEAM logs
         * for the same rule too, leaving a permanent hole in the "who is on call
         * now" view until the next roster change (audit M3).
         */
        teamId: teamId ?? QueryHelper.isNull(),
        onCallDutyPolicyScheduleId:
          onCallDutyPolicyScheduleId ?? QueryHelper.isNull(),
        endsAt: QueryHelper.isNull(),
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
