import InvestigationEligibility, {
  InvestigationSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIService, {
  AutonomousBudgetStatus,
} from "../../../../Server/Services/AIService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../../Types/ObjectID";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
  InvestigationNotStartedFacts,
} from "../../../../Types/AI/InvestigationNotStartedReason";

/*
 * THE FACTS A DASHBOARD WORDS A REASON FROM (#6656).
 *
 * The server words why an incident or alert was not investigated in
 * English, and still does, for API readers and older Dashboards. Beside
 * those sentences it now sends the facts they were worded from - the
 * severity names, the cooldown, the daily token limit - so the Dashboard
 * can say the same in its reader's language (InvestigationNotStartedWords).
 * Only the facts the reason has are sent; a reason with none sends no
 * `facts` at all, as before.
 */

const projectId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const SUBJECTS: Array<[string, InvestigationSubject]> = [
  ["alert", { projectId, alertId }],
  ["incident", { projectId, incidentId }],
];

function budget(limitInTokens: number | null): AutonomousBudgetStatus {
  return {
    exhausted: true,
    limitInTokens,
    usedTokensToday: limitInTokens && limitInTokens > 0 ? limitInTokens : 0,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getFacts", () => {
  it("keeps every fact that is known", () => {
    expect(
      InvestigationEligibility.getFacts(
        {
          severityName: "Low",
          minimumSeverityName: "High",
          cooldownWindowMinutes: 30,
        },
        budget(50000),
      ),
    ).toEqual({
      severityName: "Low",
      minimumSeverityName: "High",
      cooldownWindowMinutes: 30,
      dailyTokenLimit: 50000,
    });
  });

  it("is null when nothing is known", () => {
    expect(InvestigationEligibility.getFacts()).toBeNull();
    expect(InvestigationEligibility.getFacts({}, budget(null))).toBeNull();
  });

  it("leaves out a blank name and a count that is not one", () => {
    expect(
      InvestigationEligibility.getFacts({
        severityName: "  ",
        minimumSeverityName: "",
        cooldownWindowMinutes: -1,
      }),
    ).toBeNull();
    expect(
      InvestigationEligibility.getFacts({
        cooldownWindowMinutes: Number.NaN,
        minimumSeverityName: "Critical",
      }),
    ).toEqual({ minimumSeverityName: "Critical" });
  });

  // getAutonomousDailyBudgetStatus pauses the work at 0 or below.
  it.each([
    [0, 0],
    [-5, 0],
    [1, 1],
  ])("sends a daily token limit of %p as %p", (limit: number, sent: number) => {
    expect(InvestigationEligibility.getFacts(undefined, budget(limit))).toEqual(
      { dailyTokenLimit: sent },
    );
  });

  it("never sends a fact the Dashboard does not read", () => {
    const facts: InvestigationNotStartedFacts | null =
      InvestigationEligibility.getFacts(
        {
          severityName: "Low",
          minimumSeverityName: "High",
          cooldownWindowMinutes: 30,
          rulesChecked: 2,
          waitMinutes: 10,
        },
        { exhausted: true, limitInTokens: 100, usedTokensToday: 150 },
      );

    expect(Object.keys(facts || {}).sort()).toEqual([
      "cooldownWindowMinutes",
      "dailyTokenLimit",
      "minimumSeverityName",
      "severityName",
    ]);
  });
});

describe.each(SUBJECTS)(
  "a recorded %s decision",
  (_kind: string, subject: InvestigationSubject) => {
    it("carries the severity names beside the server's own English", () => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "severity_below_threshold",
          subject,
          undefined,
          { severityName: "Low", minimumSeverityName: "High" },
        );

      expect(reason.facts).toEqual({
        severityName: "Low",
        minimumSeverityName: "High",
      });
      // The English is what it was.
      expect(reason.description).toContain("Low");
      expect(reason.description).toContain("High");
    });

    it("carries the cooldown", () => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "monitor_cooldown",
          subject,
          undefined,
          {
            cooldownWindowMinutes: 75,
          },
        );

      expect(reason.facts).toEqual({ cooldownWindowMinutes: 75 });
      expect(reason.description).toContain("75-minute");
    });

    it("carries the daily token limit, 0 when it pauses the work", () => {
      expect(
        InvestigationEligibility.reason(
          "daily_budget_exhausted",
          subject,
          budget(0),
        ).facts,
      ).toEqual({ dailyTokenLimit: 0 });
      expect(
        InvestigationEligibility.reason(
          "daily_budget_exhausted",
          subject,
          budget(20000),
        ).facts,
      ).toEqual({ dailyTokenLimit: 20000 });
    });

    it.each<[InvestigationNotStartedCode]>([
      ["ai_disabled"],
      ["provider_missing"],
      ["created_resolved"],
      ["enqueue_failed"],
      ["no_run_recorded"],
    ])("sends no facts at all for %s", (code: InvestigationNotStartedCode) => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason(code, subject);

      expect("facts" in reason).toBe(false);
      expect(JSON.parse(JSON.stringify(reason))).not.toHaveProperty("facts");
    });

    it("sends a wait as decidedAfterWaitMinutes, never as a fact", () => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "resolved_before_investigation",
          subject,
          undefined,
          { waitMinutes: 10 },
        );

      expect(reason.decidedAfterWaitMinutes).toBe(10);
      expect("facts" in reason).toBe(false);
    });

    it("stores the facts with the decision it records", async () => {
      const alertUpdate: jest.SpyInstance = jest
        .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined as never);
      const incidentUpdate: jest.SpyInstance = jest
        .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined as never);

      await InvestigationEligibility.recordSkipped(
        subject,
        "monitor_cooldown",
        undefined,
        { cooldownWindowMinutes: 45 },
      );

      const update: jest.SpyInstance = subject.alertId
        ? alertUpdate
        : incidentUpdate;

      expect(update).toHaveBeenCalledTimes(1);
      expect(
        (
          update.mock.calls[0]![0] as {
            data: { aiInvestigationDecision: InvestigationNotStartedReason };
          }
        ).data.aiInvestigationDecision.facts,
      ).toEqual({ cooldownWindowMinutes: 45 });
    });
  },
);

/*
 * A reason worded from the settings as they are now (no decision was
 * recorded) carries the facts its check found, as a recorded one does.
 */
describe.each(SUBJECTS)(
  "the %s's current reason",
  (_kind: string, subject: InvestigationSubject) => {
    function noDecisionRecorded(): void {
      jest
        .spyOn(AlertService, "findOneBy")
        .mockResolvedValue(new Alert(alertId));
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockResolvedValue(new Incident(incidentId));
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReasonForSubject")
        .mockResolvedValue(null);
    }

    function gate(result: {
      investigate: boolean;
      notStartedCode?: InvestigationNotStartedCode;
      notStartedDetails?: {
        severityName?: string;
        minimumSeverityName?: string;
        cooldownWindowMinutes?: number;
      };
    }): void {
      jest
        .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
        .mockResolvedValue(result as never);
      jest
        .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
        .mockResolvedValue(result as never);
    }

    it("carries the severity names its check found", async () => {
      noDecisionRecorded();
      gate({
        investigate: false,
        notStartedCode: "severity_below_threshold",
        notStartedDetails: {
          severityName: "Minor",
          minimumSeverityName: "Major",
        },
      });

      const reason: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);

      expect(reason.source).toBe("current_configuration");
      expect(reason.code).toBe("severity_below_threshold");
      expect(reason.facts).toEqual({
        severityName: "Minor",
        minimumSeverityName: "Major",
      });
    });

    it("carries the daily token limit that holds it now", async () => {
      noDecisionRecorded();
      gate({ investigate: true });
      jest
        .spyOn(AIService, "getAutonomousDailyBudgetStatus")
        .mockResolvedValue(budget(0));

      const reason: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);

      expect(reason.code).toBe("daily_budget_exhausted");
      expect(reason.facts).toEqual({ dailyTokenLimit: 0 });
    });

    it("returns a recorded decision's facts as they were stored", async () => {
      const stored: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "monitor_cooldown",
          subject,
          undefined,
          {
            cooldownWindowMinutes: 20,
          },
        );
      const alert: Alert = new Alert(alertId);
      const incident: Incident = new Incident(incidentId);
      alert.aiInvestigationDecision = stored;
      incident.aiInvestigationDecision = stored;
      jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alert);
      jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);

      const reason: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);

      expect(reason.source).toBe("recorded");
      expect(reason.facts).toEqual({ cooldownWindowMinutes: 20 });
    });
  },
);
