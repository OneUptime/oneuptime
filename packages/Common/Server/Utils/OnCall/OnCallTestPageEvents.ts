import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import logger from "../Logger";
import ProductAnalytics from "../ProductAnalytics";

/*
 * WHAT A TEST PAGE TELLS PRODUCT ANALYTICS (OnCallTestPage).
 *
 * The one place a test page is recorded as an event, so the activation
 * milestones of a project ("first test page acknowledged", #6830) hang off
 * one hook:
 *
 *   - server/test_page_sent: somebody sent a test page - to themselves, to a
 *     member, or a policy's test;
 *   - server/test_page_acknowledged: somebody acknowledged one - the moment
 *     a project knows its pages reach a person.
 *
 * Captured where they cannot be blocked (ProductAnalytics): a no-op where
 * analytics is not configured, as on a self-hosted server. Never throws, and
 * never waits: a test page is not to fail, or slow down, because analytics
 * did.
 */
export const TEST_PAGE_SENT_EVENT: string = "server/test_page_sent";
export const TEST_PAGE_ACKNOWLEDGED_EVENT: string =
  "server/test_page_acknowledged";

export default class OnCallTestPageEvents {
  public static onTestPageSent(data: {
    projectId: ObjectID;
    executionLogId: ObjectID;
    sentByUserId: ObjectID;
    kind: OnCallTestPageKind;
    recordKind: OnCallTestPageRecordKind;
  }): void {
    try {
      ProductAnalytics.captureForUser({
        userId: data.sentByUserId,
        event: TEST_PAGE_SENT_EVENT,
        properties: {
          project_id: data.projectId.toString(),
          execution_log_id: data.executionLogId.toString(),
          kind: data.kind,
          record_kind: data.recordKind,
        },
      });
    } catch (err) {
      logger.error(err as Error);
    }
  }

  public static onTestPageAcknowledged(data: {
    executionLogId: ObjectID;
    acknowledgedByUserId: ObjectID;
    channel?: OnCallPageChannel | undefined;
  }): void {
    try {
      ProductAnalytics.captureForUser({
        userId: data.acknowledgedByUserId,
        event: TEST_PAGE_ACKNOWLEDGED_EVENT,
        properties: {
          execution_log_id: data.executionLogId.toString(),
          channel: data.channel || "",
        },
      });
    } catch (err) {
      logger.error(err as Error);
    }
  }
}
