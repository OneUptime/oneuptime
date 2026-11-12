import DatabaseConfig from "../DatabaseConfig";
import ProjectService from "./ProjectService";
import UserService from "./UserService";
import logger from "../Utils/Logger";
import SampleProjectSeeder from "../Utils/SampleProject/SampleProjectSeeder";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { toProjectProductSettingsJSON } from "../../Types/Product/ProjectProducts";
import {
  SAMPLE_PROJECT_NAME,
  SAMPLE_PROJECT_REFUSALS,
  SampleProjectCreateAnswer,
  getSampleProjectProductSettings,
} from "../../Types/SampleProject/SampleProject";

/*
 * MAKING AND DELETING A PERSON'S SAMPLE PROJECT (issue #6808).
 *
 *   - createForUser: the person's sample, "Sample: Acme Shop" - the one they
 *     have, opened again, or a new one: a project made as any project is
 *     (its default teams, states and severities, the person its owner), but
 *     never billed, then filled (SampleProjectSeeder). One sample a person:
 *     a second click opens the first.
 *   - deleteSample: deletes a sample, as the person asking (who may delete
 *     it: its owner). The project's delete takes everything with it - its
 *     records, its sample people and its analytics rows
 *     (ProjectService.onDeleteSuccess).
 *
 * A server whose admin keeps project creation to admins
 * (DatabaseConfig.shouldDisableUserProjectCreation) makes no sample for
 * anyone else: a sample is a project on that server, with members, records
 * and telemetry, and the admin decided who may make projects.
 */
export default class SampleProjectService {
  // The sample this person made and still has, if any.
  public static async findSampleOf(userId: ObjectID): Promise<ObjectID | null> {
    const project: Project | null = await ProjectService.findOneBy({
      query: {
        isSampleProject: true,
        createdByUserId: userId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return project?.id || null;
  }

  /*
   * Whether this person may have a sample made: everyone, unless only admins
   * may make projects on this server and they are not one.
   */
  public static async canCreateFor(data: {
    isMasterAdmin: boolean;
  }): Promise<boolean> {
    if (data.isMasterAdmin) {
      return true;
    }

    return !(await DatabaseConfig.shouldDisableUserProjectCreation());
  }

  @CaptureSpan()
  public static async createForUser(data: {
    userId: ObjectID;
    now?: Date | undefined;
  }): Promise<SampleProjectCreateAnswer> {
    const existingId: ObjectID | null = await SampleProjectService.findSampleOf(
      data.userId,
    );

    if (existingId) {
      return { projectId: existingId.toString(), isNew: false };
    }

    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        _id: true,
        isMasterAdmin: true,
        sampleProjectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new BadDataException(
        "Your account was not found. Sign in again, then explore the sample project.",
      );
    }

    // A sample person never signs in; were one ever to ask, nothing is made.
    if (user.sampleProjectId) {
      throw new NotAuthorizedException(
        SAMPLE_PROJECT_REFUSALS.samplePersonElsewhere,
      );
    }

    if (
      !(await SampleProjectService.canCreateFor({
        isMasterAdmin: Boolean(user.isMasterAdmin),
      }))
    ) {
      throw new NotAuthorizedException(
        SAMPLE_PROJECT_REFUSALS.creationRestricted,
      );
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const project: Project = new Project();
    project.name = SAMPLE_PROJECT_NAME;
    project.isSampleProject = true;
    project.productSettings = toProjectProductSettingsJSON(
      getSampleProjectProductSettings(now),
    ) as JSONObject;

    /*
     * As OneUptime (root), with the person as its creator: the flag is
     * OneUptime's to write, and the person becomes its owner as they would
     * of any project they make (ProjectService.addDefaultProjectTeams).
     */
    const props: DatabaseCommonInteractionProps = {
      isRoot: true,
      userId: data.userId,
    };

    const createdProject: Project = await ProjectService.create({
      data: project,
      props: props,
    });

    const projectId: ObjectID = createdProject.id!;

    try {
      await SampleProjectSeeder.seed({
        projectId: projectId,
        ownerUserId: data.userId,
        now: now,
      });
    } catch (err) {
      logger.error(
        `Could not fill sample project ${projectId.toString()}; it is deleted.`,
        { projectId: projectId.toString() },
      );
      logger.error(err);

      await SampleProjectService.deleteHalfMade(projectId);

      throw new BadDataException(
        "The sample project could not be made. Try again in a minute.",
      );
    }

    return { projectId: projectId.toString(), isNew: true };
  }

  /*
   * Deletes a sample, as the person asking: only a sample, and only by
   * someone who may delete the project (its owner).
   */
  @CaptureSpan()
  public static async deleteSample(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!(await ProjectService.isSampleProject(data.projectId))) {
      throw new BadDataException(SAMPLE_PROJECT_REFUSALS.notASample);
    }

    await ProjectService.deleteOneById({
      id: data.projectId,
      props: data.props,
    });
  }

  // A sample whose filling failed: deleted, with whatever it holds.
  private static async deleteHalfMade(projectId: ObjectID): Promise<void> {
    try {
      await ProjectService.deleteOneById({
        id: projectId,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        `Could not delete half-made sample project ${projectId.toString()}.`,
        { projectId: projectId.toString() },
      );
      logger.error(err);
    }
  }
}
