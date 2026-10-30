import Alert from "../../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Project from "../../../../../Models/DatabaseModels/Project";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../../Server/Services/ResourceAiAccessService";
import AiFirstResponderEligibility, {
  AI_HOLD_CHECK_FAILED_REASON,
  AiHoldDecision,
  AiHoldFacts,
  decideAiHold,
  getAiHoldPlanReason,
  getInvestigationNotStartedWords,
} from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponderEligibility";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import { InvestigationNotStartedCode } from "../../../../../Types/AI/InvestigationNotStartedReason";
import { KubernetesAiRemediationMode } from "../../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * MAY ONEUPTIME AI RESPOND FIRST TO THIS RECORD? (AiFirstResponderEligibility)
 *
 * Only where AI can actually fix something: every reason not to hold pages
 * right away and says why, in a fixed order, so the feed names the first
 * thing to change. Nothing that cannot be read holds a page.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000003");

// Everything that lets AI hold: each test turns one thing off.
function holdable(overrides?: Partial<AiHoldFacts>): AiHoldFacts {
  return {
    recordKind: "incident",
    isCreatedByPerson: false,
    isHighestSeverity: false,
    otherRecordsOpenedRecently: 0,
    planNeededToHold: null,
    investigationNotStartedCode: null,
    isAutomaticFixingOn: true,
    hasMonitor: true,
    unattendedFixTargetCount: 1,
    hasRecentAiResolvedRecurrence: false,
    ...(overrides || {}),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the decision, from what was read", () => {
  test("with everything in place, AI holds the page", () => {
    expect(decideAiHold(holdable())).toEqual({ canHold: true });
  });

  test("a person declared the incident, or created the alert: someone is on it", () => {
    expect(decideAiHold(holdable({ isCreatedByPerson: true }))).toEqual({
      canHold: false,
      reason: "A person declared this incident.",
    });
    expect(
      decideAiHold(holdable({ recordKind: "alert", isCreatedByPerson: true })),
    ).toEqual({ canHold: false, reason: "A person created this alert." });
  });

  test("the project's highest severity pages people at once", () => {
    expect(decideAiHold(holdable({ isHighestSeverity: true }))).toEqual({
      canHold: false,
      reason: "This incident has the project's highest severity.",
    });
  });

  test("3 or more others opened just before it look like an outage, and say so", () => {
    expect(
      decideAiHold(holdable({ otherRecordsOpenedRecently: 2 })).canHold,
    ).toBe(true);

    const decision: AiHoldDecision = decideAiHold(
      holdable({ otherRecordsOpenedRecently: 3 }),
    );

    expect(decision.canHold).toBe(false);
    expect(decision.isOutage).toBe(true);
    expect(decision.reason).toBe(
      "3 other alerts and incidents opened within 5 minutes, which looks like an outage.",
    );
  });

  /*
   * A held page is an on-call run, and a project below the runs' plan
   * cannot read one: no "OneUptime AI is on it", no Page now, no execution
   * log. Held there, a page would wait where nobody could see it or end it.
   */
  test("a project below the plan its on-call runs need pages right away, and says the plan", () => {
    expect(
      decideAiHold(holdable({ planNeededToHold: PlanType.Growth })),
    ).toEqual({
      canHold: false,
      reason: "OneUptime AI responds first on the Growth plan and above.",
    });
    expect(getAiHoldPlanReason(PlanType.Scale)).toBe(
      "OneUptime AI responds first on the Scale plan and above.",
    );
  });

  test("the plan is said after what is about the record and an outage, and before what is about AI", () => {
    expect(
      decideAiHold(
        holdable({
          planNeededToHold: PlanType.Growth,
          isCreatedByPerson: true,
        }),
      ).reason,
    ).toBe("A person declared this incident.");
    expect(
      decideAiHold(
        holdable({
          planNeededToHold: PlanType.Growth,
          isHighestSeverity: true,
        }),
      ).reason,
    ).toBe("This incident has the project's highest severity.");

    // An outage still says so, so the pages AI holds start at once.
    const outage: AiHoldDecision = decideAiHold(
      holdable({
        planNeededToHold: PlanType.Growth,
        otherRecordsOpenedRecently: 4,
      }),
    );
    expect(outage.isOutage).toBe(true);

    expect(
      decideAiHold(
        holdable({
          planNeededToHold: PlanType.Growth,
          investigationNotStartedCode: "insufficient_ai_balance",
          isAutomaticFixingOn: false,
          hasMonitor: false,
          unattendedFixTargetCount: 0,
        }),
      ).reason,
    ).toBe("OneUptime AI responds first on the Growth plan and above.");
  });

  test("AI that may not investigate holds nothing, and says why in the reader's words", () => {
    const codes: Array<[InvestigationNotStartedCode, string]> = [
      ["ai_disabled", "OneUptime AI is off for this project."],
      [
        "automatic_investigation_disabled",
        "OneUptime AI does not investigate new incidents in this project.",
      ],
      ["provider_missing", "There is no LLM provider OneUptime AI can use."],
      ["insufficient_ai_balance", "The project has no AI credits left."],
      [
        "project_daily_limit_reached",
        "The project reached its daily AI limit.",
      ],
      ["eligibility_check_failed", "OneUptime AI may not investigate it now."],
    ];

    for (const [code, words] of codes) {
      expect(
        decideAiHold(holdable({ investigationNotStartedCode: code })),
      ).toEqual({ canHold: false, reason: words });
    }
  });

  test("automatic fixing off holds nothing", () => {
    expect(decideAiHold(holdable({ isAutomaticFixingOn: false }))).toEqual({
      canHold: false,
      reason: "Fixing new incidents automatically is off.",
    });
    expect(
      decideAiHold(
        holdable({ recordKind: "alert", isAutomaticFixingOn: false }),
      ).reason,
    ).toBe("Fixing new alerts automatically is off.");
  });

  test("no monitor to check a fix against holds nothing", () => {
    expect(decideAiHold(holdable({ hasMonitor: false }))).toEqual({
      canHold: false,
      reason: "No monitor is linked to check a fix against.",
    });
  });

  test("no linked cluster or resource whose AI agent fixes on its own holds nothing", () => {
    expect(decideAiHold(holdable({ unattendedFixTargetCount: 0 }))).toEqual({
      canHold: false,
      reason:
        "No linked cluster or resource has an AI agent that fixes on its own (Automatic or Bypass approval).",
    });
  });

  test("the monitor's last record AI resolved is back: the fix did not hold", () => {
    expect(
      decideAiHold(holdable({ hasRecentAiResolvedRecurrence: true })),
    ).toEqual({
      canHold: false,
      reason:
        "OneUptime AI resolved this monitor's last incident within 24 hours, and it is back.",
    });
  });

  test("the first reason in the order is the one said, whatever else is off", () => {
    expect(
      decideAiHold({
        recordKind: "incident",
        isCreatedByPerson: true,
        isHighestSeverity: true,
        otherRecordsOpenedRecently: 10,
        planNeededToHold: PlanType.Growth,
        investigationNotStartedCode: "ai_disabled",
        isAutomaticFixingOn: false,
        hasMonitor: false,
        unattendedFixTargetCount: 0,
        hasRecentAiResolvedRecurrence: true,
      }).reason,
    ).toBe("A person declared this incident.");

    expect(
      decideAiHold(
        holdable({
          investigationNotStartedCode: "ai_disabled",
          isAutomaticFixingOn: false,
          unattendedFixTargetCount: 0,
        }),
      ).reason,
    ).toBe("OneUptime AI is off for this project.");
  });

  test("the investigation words name the record's kind", () => {
    expect(
      getInvestigationNotStartedWords(
        "automatic_investigation_disabled",
        "alert",
      ),
    ).toBe("OneUptime AI does not investigate new alerts in this project.");
  });
});

describe("reading the record fails toward paging", () => {
  test("a record with no id or project holds nothing", async () => {
    expect(
      await AiFirstResponderEligibility.decideForIncident(new Incident()),
    ).toEqual({ canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON });
    expect(
      await AiFirstResponderEligibility.decideForAlert(new Alert()),
    ).toEqual({ canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON });
  });

  test("a read that throws holds nothing, and says AI could not check", async () => {
    jest
      .spyOn(AiFirstResponderEligibility, "readIncidentFacts")
      .mockRejectedValue(new Error("database is down") as never);

    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.projectId = PROJECT_ID;

    expect(
      await AiFirstResponderEligibility.decideForIncident(incident),
    ).toEqual({ canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON });
  });

  test("facts that let AI hold are decided as such", async () => {
    jest
      .spyOn(AiFirstResponderEligibility, "readAlertFacts")
      .mockResolvedValue(holdable({ recordKind: "alert" }) as never);

    const alert: Alert = new Alert();
    alert.id = ALERT_ID;
    alert.projectId = PROJECT_ID;

    expect(await AiFirstResponderEligibility.decideForAlert(alert)).toEqual({
      canHold: true,
    });
  });
});

describe("what is read about the project and the record", () => {
  test("others opened in the outage window are counted across alerts and incidents, without the record itself", async () => {
    const incidentQueries: Array<Record<string, unknown>> = [];
    const alertQueries: Array<Record<string, unknown>> = [];

    jest.spyOn(IncidentService, "countBy").mockImplementation((async (countBy: {
      query: Record<string, unknown>;
    }): Promise<PositiveNumber> => {
      incidentQueries.push(countBy.query);
      return new PositiveNumber(2);
    }) as never);
    jest.spyOn(AlertService, "countBy").mockImplementation((async (countBy: {
      query: Record<string, unknown>;
    }): Promise<PositiveNumber> => {
      alertQueries.push(countBy.query);
      return new PositiveNumber(1);
    }) as never);

    expect(
      await AiFirstResponderEligibility.countOtherRecordsOpenedRecently({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(3);

    expect(incidentQueries[0]!["projectId"]).toBe(PROJECT_ID);
    expect(incidentQueries[0]!["_id"]).toBeDefined();
    expect(alertQueries[0]!["projectId"]).toBe(PROJECT_ID);
    expect(alertQueries[0]!["_id"]).toBeUndefined();
  });

  test("automatic fixing is the switch of the record's kind, and off while AI is off", async () => {
    const project: Project = new Project();
    project.enableAi = true;
    project.enableAutomaticIncidentRemediation = true;
    project.enableAutomaticAlertRemediation = false;

    const findSpy: SpyInstance<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project);

    expect(
      await AiFirstResponderEligibility.isAutomaticFixingOn({
        projectId: PROJECT_ID,
        recordKind: "incident",
      }),
    ).toBe(true);
    expect(
      await AiFirstResponderEligibility.isAutomaticFixingOn({
        projectId: PROJECT_ID,
        recordKind: "alert",
      }),
    ).toBe(false);

    project.enableAi = false;

    expect(
      await AiFirstResponderEligibility.isAutomaticFixingOn({
        projectId: PROJECT_ID,
        recordKind: "incident",
      }),
    ).toBe(false);

    findSpy.mockResolvedValue(null);

    expect(
      await AiFirstResponderEligibility.isAutomaticFixingOn({
        projectId: PROJECT_ID,
        recordKind: "incident",
      }),
    ).toBe(false);
  });

  test("only ready AI agents that fix on their own count as somewhere AI could fix", async () => {
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([
        {
          remediationMode: KubernetesAiRemediationMode.Automatic,
          isRemediationReady: true,
        },
        {
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          isRemediationReady: true,
        },
        {
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
          isRemediationReady: false,
        },
      ] as never);
    jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([
        {
          resourceType: AiResourceType.Host,
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          isRemediationReady: true,
        },
        {
          resourceType: AiResourceType.DockerHost,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
          isRemediationReady: true,
        },
        {
          resourceType: "NotAnAiResource",
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          isRemediationReady: true,
        },
      ] as never);

    expect(
      await AiFirstResponderEligibility.countUnattendedFixTargets({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(2);
  });
});
