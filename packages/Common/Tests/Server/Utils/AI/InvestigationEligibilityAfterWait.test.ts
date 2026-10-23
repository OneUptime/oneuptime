import InvestigationEligibility, {
  InvestigationSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INCIDENT'S (OR ALERT'S) AI CARD SAYS WHEN ITS RULE'S WAIT ENDED
 * (issue #5074).
 *
 * - resolved_before_investigation: an AI rule made OneUptime AI
 *   wait, and the record was resolved before the investigation started -
 *   the card says so, with the wait and where it is set.
 * - Any other decision taken when a wait ended (the rules changed, AI was
 *   turned off, a limit was reached...) says "when the wait ended" where a
 *   decision taken at creation says "at creation", and carries the wait so
 *   the card's source line can say so too.
 * - Decisions taken at creation read exactly as before.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const incident: InvestigationSubject = { projectId, incidentId };
const alert: InvestigationSubject = { projectId, alertId };

afterEach(() => {
  jest.restoreAllMocks();
});

describe("resolved_before_investigation", () => {
  test("an incident's card says it was resolved before the investigation started, and why it waited", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "resolved_before_investigation",
        incident,
        undefined,
        { waitMinutes: 10 },
      );

    expect(reason).toMatchObject({
      code: "resolved_before_investigation",
      title: "Resolved before the investigation started",
      description:
        "An AI rule made OneUptime AI wait 10 minutes to see whether this incident would still be open. It was resolved first, so it was not investigated.",
      nextStep:
        "To look into it anyway, ask OneUptime AI below. The wait is set on the AI rules under Incidents → AI → Settings → More settings.",
      source: "recorded",
      decidedAfterWaitMinutes: 10,
    });
  });

  test("an alert's card names alerts, and the alerts' AI settings", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "resolved_before_investigation",
        alert,
        undefined,
        { waitMinutes: 30 },
      );

    expect(reason.description).toBe(
      "An AI rule made OneUptime AI wait 30 minutes to see whether this alert would still be open. It was resolved first, so it was not investigated.",
    );
    expect(reason.nextStep).toContain("Alerts → AI → Settings → More settings");
  });

  test("a one-minute wait reads in the singular", () => {
    expect(
      InvestigationEligibility.reason(
        "resolved_before_investigation",
        incident,
        undefined,
        { waitMinutes: 1 },
      ).description,
    ).toContain("wait 1 minute to see whether");
  });

  test("without the wait it still reads, leaving the minutes out", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "resolved_before_investigation",
        incident,
      );

    expect(reason.description).toBe(
      "An AI rule made OneUptime AI wait to see whether this incident would still be open. It was resolved first, so it was not investigated.",
    );
    expect(reason.decidedAfterWaitMinutes).toBeUndefined();
  });

  test("is stored first-write-only on the incident, as every recorded decision is", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await InvestigationEligibility.recordSkipped(
      incident,
      "resolved_before_investigation",
      undefined,
      { waitMinutes: 10 },
    );

    expect(update).toHaveBeenCalledWith({
      id: incidentId,
      expectedData: { projectId, aiInvestigationDecision: null },
      data: {
        aiInvestigationDecision: expect.objectContaining({
          code: "resolved_before_investigation",
          title: "Resolved before the investigation started",
          decidedAfterWaitMinutes: 10,
          source: "recorded",
        }),
      },
      skipUpdateDateColumn: true,
    });
  });

  test("an alert's is stored on the alert", async () => {
    const updateAlert: jest.SpyInstance = jest
      .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);
    const updateIncident: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "updateColumnsByIdWithoutHooks",
    );

    await InvestigationEligibility.recordSkipped(
      alert,
      "resolved_before_investigation",
      undefined,
      { waitMinutes: 5 },
    );

    expect(updateAlert).toHaveBeenCalledTimes(1);
    expect(updateIncident).not.toHaveBeenCalled();
  });
});

describe("a decision taken when a wait ended says so", () => {
  test.each([
    [
      "ai_disabled",
      "Project AI was turned off when the wait ended",
      "AI was disabled for this project when this incident's 10-minute wait ended",
    ],
    [
      "automatic_investigation_disabled",
      "Automatic incident investigation was off when the wait ended",
      "Automatic investigation was not enabled for incidents when this incident's 10-minute wait ended.",
    ],
    [
      "provider_missing",
      "No AI provider was available when the wait ended",
      "Automatic investigation was enabled when this incident's 10-minute wait ended, but no configured AI provider was available to run it.",
    ],
    [
      "insufficient_ai_balance",
      "The project was out of AI credits when the wait ended",
      "This project had no AI credits left when this incident's 10-minute wait ended",
    ],
    [
      "project_daily_limit_reached",
      "The project's daily AI limit had been reached when the wait ended",
      "This project had reached one of its own daily AI limits when this incident's 10-minute wait ended",
    ],
  ])("%s", (code: string, title: string, description: string) => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        code as InvestigationNotStartedCode,
        incident,
        undefined,
        { waitMinutes: 10 },
      );

    expect(reason.title).toBe(title);
    expect(reason.description).toContain(description);
    expect(reason.title).not.toContain("at creation");
    expect(reason.description).not.toContain("was created");
    expect(reason.decidedAfterWaitMinutes).toBe(10);
  });

  test("severity below the floor names the moment it was judged", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "severity_below_threshold",
        alert,
        undefined,
        { severityName: "Low", minimumSeverityName: "High", waitMinutes: 15 },
      );

    expect(reason.title).toBe(
      "Severity was below the investigation threshold when the wait ended",
    );
    expect(reason.description).toBe(
      "When this alert's 15-minute wait ended, its Low severity did not meet the minimum High investigation severity.",
    );
  });

  test("outside the rules after the wait: it matched one when it was created, so the card says what changed", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "no_investigation_rule_matched",
        incident,
        undefined,
        { rulesChecked: 3, waitMinutes: 10 },
      );

    expect(reason.title).toBe(
      "This incident was outside the AI rules that investigate when the wait ended",
    );
    expect(reason.description).toBe(
      "An AI rule made OneUptime AI wait 10 minutes before investigating this incident, and when the wait ended it matched none of the 3 AI rules that investigate any more: the incident or the rules had changed. Only the incidents that match one are investigated automatically.",
    );
  });

  test("a one-minute wait reads in the singular", () => {
    const description: string = InvestigationEligibility.reason(
      "no_investigation_rule_matched",
      incident,
      undefined,
      { rulesChecked: 2, waitMinutes: 1 },
    ).description;

    expect(description).toContain(
      "made OneUptime AI wait 1 minute before investigating this incident",
    );
    expect(description).not.toContain("1 minutes");
  });

  test("one rule checked reads in the singular", () => {
    expect(
      InvestigationEligibility.reason(
        "no_investigation_rule_matched",
        incident,
        undefined,
        { rulesChecked: 1, waitMinutes: 10 },
      ).description,
    ).toContain("none of the 1 AI rule that investigates any more");
  });

  test("the daily token limit names the check after the wait", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "daily_budget_exhausted",
        incident,
        { exhausted: true, limitInTokens: 1000, usedTokensToday: 1200 },
        { waitMinutes: 10 },
      );

    expect(reason.description).toContain("when checked as its wait ended");
    expect(reason.description).not.toContain("at creation");

    expect(
      InvestigationEligibility.reason(
        "daily_budget_exhausted",
        incident,
        undefined,
        { waitMinutes: 10 },
      ).description,
    ).toContain("had been reached when this record's wait ended");
  });

  test("the cooldown's words need no change: it never said when", () => {
    const afterWait: InvestigationNotStartedReason =
      InvestigationEligibility.reason("monitor_cooldown", incident, undefined, {
        cooldownWindowMinutes: 60,
        waitMinutes: 10,
      });
    const atCreation: InvestigationNotStartedReason =
      InvestigationEligibility.reason("monitor_cooldown", incident, undefined, {
        cooldownWindowMinutes: 60,
      });

    expect(afterWait.title).toBe(atCreation.title);
    expect(afterWait.description).toBe(atCreation.description);
    expect(afterWait.decidedAfterWaitMinutes).toBe(10);
  });
});

describe("decisions taken at creation read exactly as before", () => {
  test.each([
    ["ai_disabled", "Project AI was turned off at creation"],
    [
      "automatic_investigation_disabled",
      "Automatic incident investigation was off at creation",
    ],
    ["provider_missing", "No AI provider was available at creation"],
    [
      "no_investigation_rule_matched",
      "This incident was outside the AI rules that investigate at creation",
    ],
    [
      "severity_below_threshold",
      "Severity was below the investigation threshold at creation",
    ],
  ])("%s", (code: string, title: string) => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        code as InvestigationNotStartedCode,
        incident,
        undefined,
        { rulesChecked: 2 },
      );

    expect(reason.title).toBe(title);
    expect(reason.decidedAfterWaitMinutes).toBeUndefined();
    expect(reason).not.toHaveProperty("decidedAfterWaitMinutes");
  });

  test("a wait of 0 is no wait", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason("ai_disabled", incident, undefined, {
        waitMinutes: 0,
      });

    expect(reason.title).toBe("Project AI was turned off at creation");
    expect(reason).not.toHaveProperty("decidedAfterWaitMinutes");
  });
});
