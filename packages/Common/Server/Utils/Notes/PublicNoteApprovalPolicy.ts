import Project from "../../../Models/DatabaseModels/Project";
import PublicNoteApprovalStep from "../../../Models/DatabaseModels/PublicNoteApprovalStep";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  PublicNoteApprovalEventType,
  PublicNoteApprovalStepRule,
} from "../../../Types/StatusPage/PublicNoteApproval";
import ProjectService from "../../Services/ProjectService";
import PublicNoteApprovalStepService from "../../Services/PublicNoteApprovalStepService";
import TeamMemberService from "../../Services/TeamMemberService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A project's public note approval, as it is now: whether its switch for a
 * kind of event is on (Project.requireApprovalFor*PublicNotes), and its
 * approval steps for that kind (PublicNoteApprovalStep), with the people and
 * teams each names. Read fresh every time - a decision is made on who may
 * decide now, never on who could a minute ago.
 */

export type PublicNoteApprovalSwitchColumn =
  | "requireApprovalForIncidentPublicNotes"
  | "requireApprovalForScheduledMaintenancePublicNotes";

export const PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS: Record<
  PublicNoteApprovalEventType,
  PublicNoteApprovalSwitchColumn
> = {
  [PublicNoteApprovalEventType.Incident]:
    "requireApprovalForIncidentPublicNotes",
  [PublicNoteApprovalEventType.ScheduledMaintenance]:
    "requireApprovalForScheduledMaintenancePublicNotes",
};

export const PublicNoteApprovalPolicyMessages: {
  noApproverToTurnOn: (eventType: PublicNoteApprovalEventType) => string;
  stepNeedsApprover: string;
  lastStepWhileOn: string;
} = {
  noApproverToTurnOn: (eventType: PublicNoteApprovalEventType): string => {
    return eventType === PublicNoteApprovalEventType.ScheduledMaintenance
      ? "Add who approves scheduled maintenance public notes before you turn on approval: nobody could approve a note otherwise."
      : "Add who approves incident public notes before you turn on approval: nobody could approve a note otherwise.";
  },
  stepNeedsApprover:
    "Choose at least one person or team who can approve public notes for this step.",
  lastStepWhileOn:
    "Public notes need approval, so they need at least one approval step. Turn approval off first, or add another step before you delete this one.",
};

export interface PublicNoteApprovalPolicyRead {
  isRequired: boolean;
  steps: Array<PublicNoteApprovalStepRule>;
}

export default class PublicNoteApprovalPolicy {
  // Whether the project asks for its public notes of this kind to be approved.
  @CaptureSpan()
  public static async isRequired(data: {
    projectId: ObjectID;
    eventType: PublicNoteApprovalEventType;
  }): Promise<boolean> {
    const column: PublicNoteApprovalSwitchColumn =
      PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS[data.eventType];

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        [column]: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(project && project.getColumnValue(column) === true);
  }

  // The project's approval steps for the kind, in their order, as they are now.
  @CaptureSpan()
  public static async getSteps(data: {
    projectId: ObjectID;
    eventType: PublicNoteApprovalEventType;
  }): Promise<Array<PublicNoteApprovalStepRule>> {
    const steps: Array<PublicNoteApprovalStep> =
      await PublicNoteApprovalStepService.findBy({
        query: {
          projectId: data.projectId,
          eventType: data.eventType,
        },
        select: {
          _id: true,
          name: true,
          order: true,
          approverUsers: {
            _id: true,
          },
          approverTeams: {
            _id: true,
          },
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return steps
      .filter((step: PublicNoteApprovalStep): boolean => {
        return Boolean(step.id);
      })
      .map((step: PublicNoteApprovalStep): PublicNoteApprovalStepRule => {
        const rule: PublicNoteApprovalStepRule = {
          id: step.id!.toString(),
          order: typeof step.order === "number" ? step.order : 0,
          userIds: this.idsOf(step.approverUsers),
          teamIds: this.idsOf(step.approverTeams),
        };

        if (step.name && step.name.trim()) {
          rule.name = step.name.trim();
        }

        return rule;
      });
  }

  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    eventType: PublicNoteApprovalEventType;
  }): Promise<PublicNoteApprovalPolicyRead> {
    const [isRequired, steps]: [boolean, Array<PublicNoteApprovalStepRule>] =
      await Promise.all([this.isRequired(data), this.getSteps(data)]);

    return { isRequired, steps };
  }

  /*
   * The teams of the project a person is on now - an accepted membership,
   * as every other team rule reads it. Read fresh rather than from the
   * member cache: who may approve is decided on who is on a team now.
   */
  @CaptureSpan()
  public static async getUserTeamIds(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<string>> {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        hasAcceptedInvitation: true,
      },
      select: {
        teamId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return Array.from(
      new Set<string>(
        members
          .map((member: TeamMember): string => {
            return member.teamId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );
  }

  // The members of each of these teams of the project, by team.
  @CaptureSpan()
  public static async getTeamMemberIds(data: {
    projectId: ObjectID;
    teamIds: ReadonlyArray<string>;
  }): Promise<Record<string, Array<string>>> {
    const byTeam: Record<string, Array<string>> = {};

    if (data.teamIds.length === 0) {
      return byTeam;
    }

    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        teamId: QueryHelper.any(
          data.teamIds.map((teamId: string): ObjectID => {
            return new ObjectID(teamId);
          }),
        ),
        hasAcceptedInvitation: true,
      },
      select: {
        teamId: true,
        userId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const member of members) {
      const teamId: string = member.teamId?.toString() || "";
      const userId: string = member.userId?.toString() || "";

      if (!teamId || !userId) {
        continue;
      }

      const list: Array<string> = byTeam[teamId] || [];

      if (!list.includes(userId)) {
        list.push(userId);
      }

      byTeam[teamId] = list;
    }

    return byTeam;
  }

  /*
   * Turning a project's approval on takes an approval step that names
   * somebody: with none, a note would wait for nobody. Asked by
   * ProjectService before an update that turns a switch on; a write that
   * leaves it as it is, or turns it off, is never asked.
   */
  @CaptureSpan()
  public static async assertCanTurnOn(data: {
    projectIds: ReadonlyArray<ObjectID>;
    written: Partial<Record<PublicNoteApprovalSwitchColumn, unknown>>;
  }): Promise<void> {
    for (const eventType of Object.values(PublicNoteApprovalEventType)) {
      const column: PublicNoteApprovalSwitchColumn =
        PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS[eventType];

      if (data.written[column] !== true) {
        continue;
      }

      for (const projectId of data.projectIds) {
        const steps: Array<PublicNoteApprovalStepRule> = await this.getSteps({
          projectId,
          eventType,
        });

        const hasApprover: boolean = steps.some(
          (step: PublicNoteApprovalStepRule): boolean => {
            return step.userIds.length > 0 || step.teamIds.length > 0;
          },
        );

        if (!hasApprover) {
          throw new BadDataException(
            PublicNoteApprovalPolicyMessages.noApproverToTurnOn(eventType),
          );
        }
      }
    }
  }

  private static idsOf(
    records: Array<User> | Array<Team> | undefined,
  ): Array<string> {
    return Array.from(
      new Set<string>(
        (records || [])
          .map((record: User | Team): string => {
            return (record.id || record._id || "").toString();
          })
          .filter(Boolean),
      ),
    );
  }
}
