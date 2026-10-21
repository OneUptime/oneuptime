import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import ProjectService from "../../../Services/ProjectService";

/*
 * Record and transcribe incident calls, the project's one switch for it
 * (Project.recordAndTranscribeIncidentCalls, on the Video Calls page), read
 * as root: when an incident's call is started, and each time OneUptime is
 * about to ask a provider for a call's transcript. Only an explicit true is
 * on. A read that fails throws: each caller decides what that means for
 * the call in front of it.
 */
export default class IncidentCallRecordingSetting {
  public static async isOn(projectId: ObjectID): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { recordAndTranscribeIncidentCalls: true },
      props: { isRoot: true },
    });

    return project?.recordAndTranscribeIncidentCalls === true;
  }
}
