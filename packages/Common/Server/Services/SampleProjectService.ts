import DatabaseConfig from "../DatabaseConfig";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../Infrastructure/Semaphore";
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

// Making one person's sample, one at a time (createForUser).
export const SAMPLE_PROJECT_MAKING_LOCK_NAMESPACE: string =
  "SampleProjectService.createForUser";

/*
 * Held while a sample is made, which takes seconds; kept on a timer while
 * the making goes on, so it only runs out when the server making it stops.
 */
export const SAMPLE_PROJECT_MAKING_LOCK_TIMEOUT_IN_MS: number = 60 * 1000;

// How long a second click waits for the first to finish.
export const SAMPLE_PROJECT_MAKING_WAIT_IN_MS: number = 45 * 1000;

export const SAMPLE_PROJECT_STILL_BEING_MADE_MESSAGE: string =
  "Your sample project is still being made. Open it again in a minute.";

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

  /*
   * One person's sample is made one at a time, on every server: a second
   * tab's click waits for the first to finish, then opens what it made,
   * instead of making a second sample beside it.
   */
  @CaptureSpan()
  public static async createForUser(data: {
    userId: ObjectID;
    now?: Date | undefined;
  }): Promise<SampleProjectCreateAnswer> {
    const lock: SemaphoreMutex | null =
      await SampleProjectService.lockMakingFor(data.userId);

    try {
      return await SampleProjectService.findOrMake(data);
    } finally {
      await SampleProjectService.unlockMaking(lock);
    }
  }

  /*
   * The lock on making this person's sample. Null when Valkey cannot be
   * reached: making it matters more than the rare second sample two tabs
   * could make at the same moment, which is deleted like any other (the
   * Dashboard's own button already waits for its answer).
   */
  private static async lockMakingFor(
    userId: ObjectID,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: userId.toString(),
        namespace: SAMPLE_PROJECT_MAKING_LOCK_NAMESPACE,
        lockTimeout: SAMPLE_PROJECT_MAKING_LOCK_TIMEOUT_IN_MS,
        acquireTimeout: SAMPLE_PROJECT_MAKING_WAIT_IN_MS,
        retryInterval: 500,
        // Lost half way (a Valkey restart): the making goes on, unlocked.
        onLockLost: (err: Error): void => {
          logger.warn(
            `Lost the lock on making the sample project of user ${userId.toString()}; making it goes on.`,
          );
          logger.warn(err);
        },
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        throw new BadDataException(SAMPLE_PROJECT_STILL_BEING_MADE_MESSAGE);
      }

      logger.error(
        `Could not lock making the sample project of user ${userId.toString()}; making it unlocked.`,
      );
      logger.error(err);
      return null;
    }
  }

  private static async unlockMaking(
    lock: SemaphoreMutex | null,
  ): Promise<void> {
    if (!lock) {
      return;
    }

    try {
      await Semaphore.release(lock);
    } catch (err) {
      // It runs out on its own (SAMPLE_PROJECT_MAKING_LOCK_TIMEOUT_IN_MS).
      logger.error("Could not unlock making a sample project.");
      logger.error(err);
    }
  }

  private static async findOrMake(data: {
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
