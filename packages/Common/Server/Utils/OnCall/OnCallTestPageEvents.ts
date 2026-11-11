import Project from "../../../Models/DatabaseModels/Project";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { JSONObject } from "../../../Types/JSON";
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

export default class OnCallTestPageEvents {
  public static onTestPageSent(data: {
    projectId: ObjectID;
    executionLogId: ObjectID;
    sentByUserId: ObjectID;
    kind: OnCallTestPageKind;
    recordKind: OnCallTestPageRecordKind;
  }): void {
    this.capture({
      userId: data.sentByUserId,
      projectId: data.projectId,
      event: TEST_PAGE_SENT_EVENT,
      properties: {
        execution_log_id: data.executionLogId.toString(),
        kind: data.kind,
        record_kind: data.recordKind,
      },
    });
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

    this.capture({
      userId: data.acknowledgedByUserId,
      projectId: data.projectId,
      event: TEST_PAGE_ACKNOWLEDGED_EVENT,
      properties: {
        execution_log_id: data.executionLogId.toString(),
        channel: data.channel || "",
      },
    });
  }

  /*
   * Sends an event with the properties every event carries: the project's
   * id, its plan and the server's edition. Reads the plan only where
   * analytics is set up.
   */
  private static capture(data: {
    userId: ObjectID;
    projectId?: ObjectID | undefined;
    event: string;
    properties: JSONObject;
  }): void {
    try {
      if (!ProductAnalytics.isConfigured()) {
        return;
      }

      void this.readPlan(data.projectId)
        .then((plan: string) => {
          ProductAnalytics.captureForUser({
            userId: data.userId,
            event: data.event,
            properties: {
              project_id: data.projectId?.toString() || "",
              plan: plan,
              edition: ProjectMilestoneServiceClass.getEdition(),
              ...data.properties,
            },
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
