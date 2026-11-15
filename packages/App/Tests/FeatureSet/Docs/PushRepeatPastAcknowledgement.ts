import { readPage } from "./DocsContentSupport";
import ObjectID from "Common/Types/ObjectID";
import {
  OnCallAcknowledgePageRun,
  isOnCallPageEndedOnlyByAnAnswer,
} from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import { expect } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A PUSH THAT REPEATS PAST AN ACKNOWLEDGEMENT (#7840).
 *
 * A push rule's Repeat until acknowledged sends its page again until the
 * incident, alert or episode is acknowledged. Some pages go on after that,
 * until somebody they paged answers or the record is resolved - a page
 * again, a page to observers, a page someone sent from Slack or Microsoft
 * Teams, a policy started by hand - and their pushes repeat on too: the
 * UserOnCallLog worker asks isOnCallPageEndedOnlyByAnAnswer of the page's
 * run, and skips the record's acknowledgement for it. The two pages that
 * describe the repeat said it always stops at an acknowledgement, so a
 * reader concluded a page again's push never repeats.
 *
 * Both pages (Self-Hosted > Push Notifications, Notifications > On-Call
 * Rules) now say so in the same sentence, linking to the list of those
 * pages on the policies page. This holds that sentence to the worker's
 * rule.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const WORKER: string =
  "packages/App/FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions.ts";
const OVER_REASON: string =
  "packages/Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout.ts";

const POLICIES_PAGE: string = "on-call/policies";
const POLICIES_HEADING: string = "## When several policies page";

export const PUSH_REPEAT_PAST_ACKNOWLEDGEMENT_SENTENCE: string =
  "A page that goes on after an acknowledgement, such as a page again, repeats until somebody it paged answers it or the incident, alert or episode is resolved: [When several policies page](/docs/on-call/policies#when-several-policies-page) lists them.";

const USER: ObjectID = new ObjectID("07840000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("07840000-0000-4000-8000-000000000002");
const WORKFLOW: ObjectID = new ObjectID("07840000-0000-4000-8000-000000000003");

function run(
  fields: Partial<OnCallAcknowledgePageRun>,
): OnCallAcknowledgePageRun {
  return {
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    ...fields,
  } as OnCallAcknowledgePageRun;
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
}

/*
 * What the page says of a push's repeat, held to the worker: right after
 * `stopsLine` - the repeat stopping at an acknowledgement - the sentence
 * that names the pages it goes on for, which are the ones the worker
 * keeps paging past an acknowledgement.
 */
export function expectPushRepeatPastAcknowledgement(data: {
  page: string;
  stopsLine: string;
}): void {
  // Said right after the line that says a repeat stops at an acknowledgement.
  expect(data.page).toContain(
    `${data.stopsLine} ${PUSH_REPEAT_PAST_ACKNOWLEDGEMENT_SENTENCE}`,
  );

  // The pages that go on past an acknowledgement, by the worker's rule.
  expect(isOnCallPageEndedOnlyByAnAnswer(run({ pageAgainNumber: 1 }))).toBe(
    true,
  );
  expect(
    isOnCallPageEndedOnlyByAnAnswer(
      run({ onCallDutyPolicyId: POLICY, isObserverPage: true }),
    ),
  ).toBe(true);
  expect(
    isOnCallPageEndedOnlyByAnAnswer(run({ triggeredByUserId: USER })),
  ).toBe(true);
  expect(
    isOnCallPageEndedOnlyByAnAnswer(
      run({ onCallDutyPolicyId: POLICY, triggeredByUserId: USER }),
    ),
  ).toBe(true);

  // Every other run stops at an acknowledgement, its repeats with it.
  expect(
    isOnCallPageEndedOnlyByAnAnswer(run({ onCallDutyPolicyId: POLICY })),
  ).toBe(false);
  expect(
    isOnCallPageEndedOnlyByAnAnswer(
      run({
        onCallDutyPolicyId: POLICY,
        triggeredByUserId: USER,
        triggeredByWorkflowId: WORKFLOW,
      }),
    ),
  ).toBe(false);

  /*
   * The worker that sends every notification and every repeat asks that
   * rule of the page's run, and ends such a page only once somebody it
   * paged answered it or its record is resolved.
   */
  const worker: string = readRepoFile(WORKER);

  expect(worker).toContain("isOnCallPageEndedOnlyByAnAnswer(");
  expect(worker).toContain("getPageAgainOverReason(");

  const overReason: string = readRepoFile(OVER_REASON);
  const reasonStart: number = overReason.indexOf(
    "public static async getPageAgainOverReason(",
  );

  expect(reasonStart).toBeGreaterThan(-1);

  const reason: string = overReason.slice(
    reasonStart,
    overReason.indexOf("\n  }\n", reasonStart),
  );

  expect(reason).toContain("data.run.acknowledgedAt");
  expect(reason).toContain("state.isResolved");

  // The link names the policies page's list of those pages.
  const policies: string = readPage("en", POLICIES_PAGE);
  const section: string = policies.slice(
    policies.indexOf(POLICIES_HEADING),
    policies.indexOf("\n## ", policies.indexOf(POLICIES_HEADING) + 1),
  );

  expect(policies).toContain(`\n${POLICIES_HEADING}\n`);
  expect(section).toContain(
    "Some pages go on after it is acknowledged, until somebody they paged answers or it is resolved: a page again, a page to observers, a page someone sent to people from Slack or Microsoft Teams, and a policy started by hand.",
  );
}
