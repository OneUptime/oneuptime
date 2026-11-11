import Project from "../../../Models/DatabaseModels/Project";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import ProjectMilestoneService, {
  Service as ProjectMilestoneServiceClass,
} from "../../Services/ProjectMilestoneService";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import ProductAnalytics from "../ProductAnalytics";

/*
 * WHAT A TEST PAGE RECORDS (OnCallTestPage), in one place:
 *
 *   - the activation milestone `first_test_page_acknowledged` (#6830,
 *     ProjectMilestoneService): the first time anybody in a project
 *     acknowledges a test page - the moment a project knows its pages
 *     reach a person;
 *   - `test_page/sent`: somebody sent a test page - to themselves, to a
 *     member, or a policy's test;
 *   - `test_page/acknowledged`: somebody acknowledged one, and by what.
 *
 * The two events follow the rule every event follows
 * (Docs/analytics/activation.md): `area/thing_happened`, with the project's
 * id, its plan and the server's edition, and nothing that names anyone.
 * They go only where product analytics is set up (OneUptime Cloud). None of
 * this ever throws or waits: a test page is not to fail, or slow down,
 * because analytics did.
 */
export const TEST_PAGE_SENT_EVENT: string = "test_page/sent";
export const TEST_PAGE_ACKNOWLEDGED_EVENT: string = "test_page/acknowledged";

// What every event carries about its project.
interface ProjectProperties {
  projectId: string;
  plan: string;
  edition: string;
}

export default class OnCallTestPageEvents {
  public static onTestPageSent(data: {
    projectId: ObjectID;
    executionLogId: ObjectID;
    sentByUserId: ObjectID;
    kind: OnCallTestPageKind;
    recordKind: OnCallTestPageRecordKind;
  }): void {
    this.withProjectProperties(
      data.projectId,
      (project: ProjectProperties): void => {
        ProductAnalytics.captureForUser({
          userId: data.sentByUserId,
          event: TEST_PAGE_SENT_EVENT,
          properties: {
            project_id: project.projectId,
            plan: project.plan,
            edition: project.edition,
            execution_log_id: data.executionLogId.toString(),
            kind: data.kind,
            record_kind: data.recordKind,
          },
        });
      },
    );
  }

  /*
   * Called once a test page's acknowledgement is written. Every call may
   * be the project's first: the milestone keeps the first and ignores the
   * rest without a query.
   */
  public static onTestPageAcknowledged(data: {
    projectId?: ObjectID | undefined;
    executionLogId: ObjectID;
    acknowledgedByUserId: ObjectID;
    channel?: OnCallPageChannel | undefined;
  }): void {
    try {
      if (data.projectId) {
        ProjectMilestoneService.reachInBackground({
          projectId: data.projectId,
          milestone: ActivationMilestone.FirstTestPageAcknowledged,
        });
      }
    } catch (err) {
      logger.error(err as Error);
    }

    this.withProjectProperties(
      data.projectId,
      (project: ProjectProperties): void => {
        ProductAnalytics.captureForUser({
          userId: data.acknowledgedByUserId,
          event: TEST_PAGE_ACKNOWLEDGED_EVENT,
          properties: {
            project_id: project.projectId,
            plan: project.plan,
            edition: project.edition,
            execution_log_id: data.executionLogId.toString(),
            channel: data.channel || "",
          },
        });
      },
    );
  }

  /*
   * Hands `send` what every event carries about its project - its id, its
   * plan and the server's edition - once the plan is read. Only where
   * analytics is set up: elsewhere nothing is read and nothing is sent.
   */
  private static withProjectProperties(
    projectId: ObjectID | undefined,
    send: (project: ProjectProperties) => void,
  ): void {
    try {
      if (!ProductAnalytics.isConfigured()) {
        return;
      }

      void this.readPlan(projectId)
        .then((plan: string) => {
          send({
            projectId: projectId?.toString() || "",
            plan: plan,
            edition: ProjectMilestoneServiceClass.getEdition(),
          });
        })
        .catch((err: Error) => {
          logger.error(err);
        });
    } catch (err) {
      logger.error(err as Error);
    }
  }

  private static async readPlan(
    projectId: ObjectID | undefined,
  ): Promise<string> {
    if (!projectId) {
      return "";
    }

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          planName: true,
        },
        props: {
          isRoot: true,
        },
      });

      return project?.planName?.toString() || "";
    } catch (err) {
      logger.error(err as Error);
      return "";
    }
  }
}
