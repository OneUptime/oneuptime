import { describe, expect, test } from "@jest/globals";
import OnCallPolicyRunMessageView, {
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";

/*
 * AN OBSERVER'S PAGE, IN ITS SLACK AND MICROSOFT TEAMS MESSAGE
 * (OnCallObserverPage, OnCallPolicyRunMessageView).
 *
 * The run's one message, edited as it goes, says it pages AS OBSERVERS, and
 * that whoever answered it has seen it - not that they acknowledged the
 * record, which they did not. However it ends, it raises no alarm: an
 * observer's page is not the record's response, so nobody needs to take the
 * record because of it.
 */

const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-1";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/incidents/inc-8";
const POLICY_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/oversight";

function run(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "Oversight on-call",
    policyUrl: POLICY_URL,
    runUrl: RUN_URL,
    recordLabel: "Incident INC-8",
    recordUrl: RECORD_URL,
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 2,
    escalateAfterInMinutes: 15,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [
      {
        name: "Nitin",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS"],
        coveringFor: [],
      },
    ],
    notPaged: [],
    isObserverPage: true,
    ...overrides,
  };
}

function firstLine(markdown: string): string {
  return markdown.split("\n\n")[0]!;
}

describe("an observer's page, in its message", () => {
  test("paging: it pages as observers", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run());

    expect(firstLine(markdown)).toContain("is paging as observers for");
    expect(firstLine(markdown)).toContain("👀");
    expect(OnCallPolicyRunMessageView.getPlainText(run())).toBe(
      "Oversight on-call is paging as observers for Incident INC-8",
    );
  });

  test("waiting for working hours: it will page as observers", () => {
    const waiting: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.Waiting,
    });

    expect(
      firstLine(OnCallPolicyRunMessageView.getMarkdown(waiting)),
    ).toContain("is waiting to page as observers for");
    expect(OnCallPolicyRunMessageView.getPlainText(waiting)).toBe(
      "Oversight on-call is waiting to page as observers for Incident INC-8",
    );
  });

  test("answered: they have seen it, and the incident is not acknowledged by it", () => {
    const answered: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Nitin",
      paged: [
        {
          name: "Nitin",
          timesPaged: 1,
          isBeingPaged: false,
          acknowledged: true,
          methods: ["SMS"],
          coveringFor: [],
        },
      ],
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(answered);

    expect(firstLine(markdown)).toContain("**Nitin** has seen the page for");
    expect(firstLine(markdown)).toContain(
      "the incident is not acknowledged by this",
    );
    expect(markdown).not.toContain("acknowledged Incident");
    // Their own line says the same.
    expect(markdown).toContain("**Nitin**: has seen it");
    expect(OnCallPolicyRunMessageView.getPlainText(answered)).toBe(
      "Nitin has seen the page for Incident INC-8",
    );
  });

  test.each([
    OnCallPolicyRunOutcome.NobodyAcknowledged,
    OnCallPolicyRunOutcome.NobodyAnswered,
  ])(
    "ending with nobody answering (%s): said quietly, and no alarm",
    (outcome: OnCallPolicyRunOutcome) => {
      const ended: OnCallPolicyRun = run({ outcome: outcome });

      expect(
        firstLine(OnCallPolicyRunMessageView.getMarkdown(ended)),
      ).toContain("Nobody answered the observer page from");
      expect(OnCallPolicyRunMessageView.getAlarms(ended)).toEqual([]);
    },
  );

  test.each([
    OnCallPolicyRunOutcome.NobodyReached,
    OnCallPolicyRunOutcome.Failed,
    OnCallPolicyRunOutcome.PolicyArchived,
    OnCallPolicyRunOutcome.EverybodyPassedOn,
  ])(
    "no ending of it - %s - tells the channel somebody needs to take the incident",
    (outcome: OnCallPolicyRunOutcome) => {
      expect(
        OnCallPolicyRunMessageView.getAlarms(run({ outcome: outcome })),
      ).toEqual([]);
    },
  );

  test("a rule that reached nobody raises no alarm either", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          firstRuleThatReachedNobody: {
            rule: { order: 1, name: "Level 1" },
            reasons: [],
          },
        } as Partial<OnCallPolicyRun>),
      ),
    ).toEqual([]);
  });
});

describe("a responder's run reads as before", () => {
  test("acknowledged: whoever answered acknowledged the incident", () => {
    const answered: OnCallPolicyRun = run({
      isObserverPage: false,
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Nitin",
    });

    expect(OnCallPolicyRunMessageView.getPlainText(answered)).toBe(
      "Nitin acknowledged Incident INC-8",
    );
  });

  test("nobody acknowledging still raises its alarm", () => {
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          isObserverPage: false,
          outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
        }),
      ).length,
    ).toBe(1);
  });
});
