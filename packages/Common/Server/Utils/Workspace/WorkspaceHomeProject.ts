import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceHomeChoiceService from "../../Services/WorkspaceHomeChoiceService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHICH OF SOMEBODY'S PROJECTS THEIR HOME OPENS ON.
 *
 * In a Slack workspace or a Microsoft 365 organization connected to several
 * projects, the app's Home of somebody connected as a member in two or more
 * of them shows one at a time, with a Switch project menu of the others
 * (SlackHome, MicrosoftTeamsHome). The project they pick there is recorded
 * (rememberChosenProject), and their Home opens on it from then on - while
 * it is still one of theirs, which the Home reads again every time it is
 * drawn and hands in here (memberProjectIds). Before they pick one, or once
 * none they picked is theirs any more, it opens on the first of their
 * projects, in the order the projects were connected.
 *
 * The choice is kept in Postgres (WorkspaceHomeChoice), for good: the cache
 * that kept it before forgot every choice whenever Valkey restarted. It
 * grants nothing - a project somebody may not see is never in
 * memberProjectIds, so never shown - and nothing here ever throws: a choice
 * that cannot be read or kept only means the Home opens on the first
 * project.
 */
export default class WorkspaceHomeProject {
  /*
   * The project of `memberProjectIds` the chat account chose last for its
   * Home; null when it chose none of them, or the choice cannot be read.
   */
  @CaptureSpan()
  public static async getChosenProject(data: {
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    memberProjectIds: Array<ObjectID>;
  }): Promise<ObjectID | null> {
    if (!data.workspaceUserId || data.memberProjectIds.length === 0) {
      return null;
    }

    try {
      const chosen: ObjectID | null =
        await WorkspaceHomeChoiceService.findLastChosenProject({
          workspaceType: data.workspaceType,
          workspaceUserId: data.workspaceUserId,
          projectIds: data.memberProjectIds,
        });

      // One of theirs, as they are listed: never a project they were not offered.
      return (
        data.memberProjectIds.find((projectId: ObjectID): boolean => {
          return (
            Boolean(chosen) &&
            projectId.toString().toLowerCase() ===
              chosen!.toString().toLowerCase()
          );
        }) || null
      );
    } catch (err) {
      logger.debug(
        "Could not read the project a chat Home was last switched to; showing the first.",
      );
      logger.debug(err);
      return null;
    }
  }

  /*
   * Records that the chat account chose `projectId` for its Home: its
   * later Homes open on it. Never throws.
   */
  @CaptureSpan()
  public static async rememberChosenProject(data: {
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    if (!data.workspaceUserId) {
      return;
    }

    try {
      await WorkspaceHomeChoiceService.recordChoice({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        workspaceUserId: data.workspaceUserId,
      });
    } catch (err) {
      logger.error(
        "Could not record the project a chat Home was switched to.",
        {
          projectId: data.projectId.toString(),
        },
      );
      logger.error(err, { projectId: data.projectId.toString() });
    }
  }
}
