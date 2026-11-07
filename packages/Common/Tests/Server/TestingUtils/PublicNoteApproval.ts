import { jest } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import { PublicNoteApprovalStepRule } from "../../../Types/StatusPage/PublicNoteApproval";
import PublicNoteApprovalEngine from "../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalPolicy from "../../../Server/Utils/Notes/PublicNoteApprovalPolicy";

/*
 * Answers the reads public note approval makes
 * (Server/Utils/Notes/PublicNoteApprovalPolicy) the way a project would,
 * without a database.
 *
 * A suite about something else turns approval off - every note is
 * published as it is posted, as before approval existed - and every note
 * starts the workflows it always did:
 *
 *   stubPublicNoteApproval({});
 *
 * and a suite about approval says what the project asks for:
 *
 *   stubPublicNoteApproval({
 *     isRequired: true,
 *     steps: [{ id: "s1", order: 1, userIds: [BOB], teamIds: [] }],
 *     userTeamIds: { [CAROL]: [SUPPORT_TEAM] },
 *   });
 */
export interface PublicNoteApprovalWorld {
  isRequired?: boolean | undefined;
  steps?: Array<PublicNoteApprovalStepRule> | undefined;
  // Each person's teams, by user id.
  userTeamIds?: Record<string, Array<string>> | undefined;
  // Each team's members, by team id.
  teamMembers?: Record<string, Array<string>> | undefined;
  // Whether a note's writes start workflows; true when left out.
  isPublishedNow?: boolean | undefined;
}

export function stubPublicNoteApproval(world: PublicNoteApprovalWorld): void {
  jest
    .spyOn(PublicNoteApprovalPolicy, "isRequired")
    .mockImplementation(async (): Promise<boolean> => {
      return world.isRequired === true;
    });

  jest
    .spyOn(PublicNoteApprovalPolicy, "getSteps")
    .mockImplementation(async (): Promise<Array<PublicNoteApprovalStepRule>> => {
      return world.steps || [];
    });

  jest
    .spyOn(PublicNoteApprovalPolicy, "getUserTeamIds")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        userId: ObjectID;
      }): Promise<Array<string>> => {
        return (world.userTeamIds || {})[data.userId.toString()] || [];
      },
    );

  jest
    .spyOn(PublicNoteApprovalPolicy, "getTeamMemberIds")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        teamIds: ReadonlyArray<string>;
      }): Promise<Record<string, Array<string>>> => {
        const byTeam: Record<string, Array<string>> = {};

        for (const teamId of data.teamIds) {
          byTeam[teamId] = (world.teamMembers || {})[teamId] || [];
        }

        return byTeam;
      },
    );

  jest
    .spyOn(PublicNoteApprovalEngine, "isPublishedNow")
    .mockImplementation(async (): Promise<boolean> => {
      return world.isPublishedNow !== false;
    });
}
