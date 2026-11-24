import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { readSecurityAutomaticResponseHourlyLimit } from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import ProjectService from "../../Services/ProjectService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE HOURLY LIMIT OF AUTOMATIC BLOCKS A PROJECT IS HELD TO (#10746): its
 * own, as a Security Admin set it on the Automatic Response page under
 * More settings (Project.securityAutomaticResponseMaxBlocksPerHour), or 50.
 *
 * Read afresh for every decision (SecurityAutomaticResponse.decide, under
 * the project's lock, beside countBlocksThisHour) and every read of the
 * page (SecurityAutomaticResponseOverview), never kept: a limit changed in
 * the middle of an hour holds from the next decision on. Lowered below the
 * blocks the hour has made already, the policies stop until enough of
 * those age out; raised, they act again at the next detection.
 */
export default class SecurityAutomaticResponseLimit {
  @CaptureSpan()
  public static async read(projectId: ObjectID): Promise<number> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { securityAutomaticResponseMaxBlocksPerHour: true },
      props: { isRoot: true },
    });

    return readSecurityAutomaticResponseHourlyLimit(
      project?.securityAutomaticResponseMaxBlocksPerHour,
    );
  }
}
