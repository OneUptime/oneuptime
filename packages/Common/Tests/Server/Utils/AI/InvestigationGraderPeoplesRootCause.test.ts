import InvestigationGrader, {
  MONITOR_ROOT_CAUSE_OPENING,
} from "../../../../Server/Utils/AI/SRE/InvestigationGrader";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHICH ROOT CAUSE AN INVESTIGATION IS GRADED AGAINST (#7765).
 *
 * Grading compares OneUptime AI's analysis with the root cause people wrote.
 * A record OneUptime opened holds what OneUptime wrote - a monitor's "Created
 * because the following criteria was met: Response Status Code was 503", a
 * budget's, a rule's - and graded against that, a right analysis reads as a
 * miss. So, for an incident and an alert alike, the root cause is:
 *
 *   - the one written as it was resolved (the Resolve dialog's "Add the root
 *     cause"), whoever opened the record;
 *   - else, for a record a person declared, the one it holds - unless it is
 *     the line OneUptime used to write to say who opened it;
 *   - else none: the investigation is not graded.
 *
 * Alerts were not graded at all before: nothing asked for their root cause
 * as they were resolved.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const personId: ObjectID = ObjectID.generate();
const runCompletedAt: Date = new Date("2026-11-19T10:00:00.000Z");

const MONITOR_ROOT_CAUSE: string = `
${MONITOR_ROOT_CAUSE_OPENING}:

**Criteria Name**: Website is down

**Filter Conditions Met**: Response Status Code was 503, at or above the 500 threshold.
`;

const ANALYSIS: string =
  "## Most likely root cause\nThe v2.14.0 deploy broke discount codes [C1].";

function fakeRun(autoGrade?: AIRunAutoGrade): AIRun {
  return {
    id: ObjectID.generate(),
    autoGrade,
    completedAt: runCompletedAt,
  } as unknown as AIRun;
}

function fakeIncident(
  rootCause: string | undefined,
  createdByUserId: ObjectID | undefined,
): Incident {
  return { id: incidentId, rootCause, createdByUserId } as unknown as Incident;
}

function fakeAlert(
  rootCause: string | undefined,
  createdByUserId: ObjectID | undefined,
): Alert {
  return { id: alertId, rootCause, createdByUserId } as unknown as Alert;
}

interface GradingSpies {
  findRun: jest.SpyInstance;
  executeWithLogging: jest.SpyInstance;
  updateRun: jest.SpyInstance;
  getForInvestigation: jest.SpyInstance;
}

function spyOnGrading(run: AIRun | null = fakeRun()): GradingSpies {
  return {
    findRun: jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run),
    executeWithLogging: jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue({ content: "MATCH" } as unknown as AILogResponse),
    updateRun: jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never),
    getForInvestigation: jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(ANALYSIS),
  };
}

// The human-recorded root cause the grading call was asked about.
function gradedRootCause(spies: GradingSpies): string {
  const content: string = (
    spies.executeWithLogging.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    }
  ).messages[1]!.content;

  return content.split('"""')[1]!.trim();
}

beforeEach(() => {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: projectId,
    enableAi: true,
  } as unknown as Project);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InvestigationGrader.getPeoplesRootCause", () => {
  test("a record a person declared holds people's words", () => {
    expect(
      InvestigationGrader.getPeoplesRootCause({
        rootCause: "  The pool was cut to 10.\n",
        createdByUserId: personId,
      }),
    ).toBe("The pool was cut to 10.");
  });

  test("a record OneUptime opened - no person declared it - holds none", () => {
    expect(
      InvestigationGrader.getPeoplesRootCause({
        rootCause: "The pool was cut to 10.",
        createdByUserId: undefined,
      }),
    ).toBe("");
  });

  test("no record, or none written, is none", () => {
    expect(InvestigationGrader.getPeoplesRootCause(null)).toBe("");
    expect(
      InvestigationGrader.getPeoplesRootCause({ createdByUserId: personId }),
    ).toBe("");
  });
});

describe("InvestigationGrader.isWrittenByOneUptime", () => {
  test.each([
    ["a monitor's root cause, as it is stored", MONITOR_ROOT_CAUSE],
    ["a monitor's root cause, trimmed", MONITOR_ROOT_CAUSE.trim()],
    [
      "the line that said who opened an incident",
      "Incident created via Microsoft Teams",
    ],
    [
      "the line that said who opened an alert",
      "Alert created by [Maya Chen](/dashboard/123/settings/users/1)",
    ],
  ])("%s: yes", (_what: string, rootCause: string) => {
    expect(InvestigationGrader.isWrittenByOneUptime(rootCause)).toBe(true);
  });

  test.each([
    "The connection pool was cut from 40 to 10 by config release cfg-7731.",
    "Created a new index while the old one served traffic.",
    "",
  ])("%p: no", (rootCause: string) => {
    expect(InvestigationGrader.isWrittenByOneUptime(rootCause)).toBe(false);
  });

  test("a root cause that is OneUptime's is never graded against", () => {
    for (const rootCause of [
      MONITOR_ROOT_CAUSE,
      "Incident created via the OneUptime AI copilot.",
    ]) {
      expect(
        InvestigationGrader.shouldGradeInvestigation({
          run: { id: ObjectID.generate() },
          rootCause,
        }),
      ).toBe(false);
    }
  });
});

describe("an incident's investigation is graded against the root cause people wrote", () => {
  test("one OneUptime opened, resolved with a root cause written as it was resolved: graded against that, whatever it held", async () => {
    const spies: GradingSpies = spyOnGrading();
    const readIncident: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident(MONITOR_ROOT_CAUSE, undefined));

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
      writtenRootCause: "  The v2.14.0 deploy reads percentOff.  ",
    });

    // The written one is the root cause: the incident is not read for it.
    expect(readIncident).not.toHaveBeenCalled();
    expect(gradedRootCause(spies)).toBe("The v2.14.0 deploy reads percentOff.");
    expect(spies.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoGrade: AIRunAutoGrade.Match }),
      }),
    );
  });

  test("one OneUptime opened, resolved without one: not graded, though it holds a root cause", async () => {
    const spies: GradingSpies = spyOnGrading();
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        fakeIncident("- CPU above 90% for 5 minutes on web-1", undefined),
      );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(spies.executeWithLogging).not.toHaveBeenCalled();
    expect(spies.updateRun).not.toHaveBeenCalled();
  });

  test("one a person declared, resolved without one: graded against the root cause it holds", async () => {
    const spies: GradingSpies = spyOnGrading();
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident("A bad discount rule.", personId));

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(gradedRootCause(spies)).toBe("A bad discount rule.");
  });

  test("one a person declared whose root cause only says who opened it: not graded", async () => {
    const spies: GradingSpies = spyOnGrading();
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        fakeIncident("Incident created via Microsoft Teams", personId),
      );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(spies.executeWithLogging).not.toHaveBeenCalled();
  });

  test("a root cause written as it was resolved that is only spaces is none", async () => {
    const spies: GradingSpies = spyOnGrading();
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident(MONITOR_ROOT_CAUSE, undefined));

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
      writtenRootCause: " \n ",
    });

    expect(spies.executeWithLogging).not.toHaveBeenCalled();
  });
});

describe("an alert's investigation is graded as an incident's is", () => {
  test("resolved with a root cause written as it was resolved: its own investigation, its own report, graded against that", async () => {
    const spies: GradingSpies = spyOnGrading();
    const readAlert: jest.SpyInstance = jest.spyOn(AlertService, "findOneById");
    const readIncident: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );

    await InvestigationGrader.gradeInvestigationOnResolve({
      alertId,
      projectId,
      writtenRootCause: "A batch container took the host's CPU.",
    });

    // The alert's latest completed investigation.
    expect(spies.findRun).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          triggeredByAlertId: alertId,
        },
      }),
    );
    // Its report, posted to the alert.
    expect(spies.getForInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ alertId, runCompletedAt }),
    );
    expect(spies.getForInvestigation.mock.calls[0]![0]).not.toHaveProperty(
      "incidentId",
    );
    // Logged against the alert, in the same budget as an incident's grade.
    expect(spies.executeWithLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        alertId,
        feature: "AI Investigation Grading",
        storeContentPreviews: false,
        temperature: 0,
      }),
    );
    expect(spies.executeWithLogging.mock.calls[0]![0]).not.toHaveProperty(
      "incidentId",
    );
    expect(gradedRootCause(spies)).toBe(
      "A batch container took the host's CPU.",
    );
    expect(spies.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoGrade: AIRunAutoGrade.Match,
          autoGradeAt: expect.any(Date),
        }),
      }),
    );
    expect(readAlert).not.toHaveBeenCalled();
    expect(readIncident).not.toHaveBeenCalled();
  });

  test("one a monitor raised, resolved without one: not graded against what the monitor wrote", async () => {
    const spies: GradingSpies = spyOnGrading();
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(fakeAlert(MONITOR_ROOT_CAUSE, undefined));

    await InvestigationGrader.gradeInvestigationOnResolve({
      alertId,
      projectId,
    });

    expect(spies.executeWithLogging).not.toHaveBeenCalled();
    expect(spies.updateRun).not.toHaveBeenCalled();
  });

  test("one a person raised, resolved without one: graded against the root cause it holds", async () => {
    const spies: GradingSpies = spyOnGrading();
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(fakeAlert("The cron job filled the disk.", personId));

    await InvestigationGrader.gradeInvestigationOnResolve({
      alertId,
      projectId,
    });

    expect(gradedRootCause(spies)).toBe("The cron job filled the disk.");
  });

  test("no completed investigation of the alert: nothing read, nothing asked", async () => {
    const spies: GradingSpies = spyOnGrading(null);
    const readAlert: jest.SpyInstance = jest.spyOn(AlertService, "findOneById");

    await InvestigationGrader.gradeInvestigationOnResolve({
      alertId,
      projectId,
      writtenRootCause: "A batch container took the host's CPU.",
    });

    expect(readAlert).not.toHaveBeenCalled();
    expect(spies.executeWithLogging).not.toHaveBeenCalled();
  });

  test("an alert graded once is not graded again", async () => {
    const spies: GradingSpies = spyOnGrading(fakeRun(AIRunAutoGrade.Mismatch));

    await InvestigationGrader.gradeInvestigationOnResolve({
      alertId,
      projectId,
      writtenRootCause: "A batch container took the host's CPU.",
    });

    expect(spies.executeWithLogging).not.toHaveBeenCalled();
  });

  test("a failure is swallowed: grading never throws into the resolve", async () => {
    spyOnGrading().executeWithLogging.mockRejectedValue(
      new Error("provider down"),
    );

    await expect(
      InvestigationGrader.gradeInvestigationOnResolve({
        alertId,
        projectId,
        writtenRootCause: "A batch container took the host's CPU.",
      }),
    ).resolves.toBeUndefined();
  });

  test("neither an incident nor an alert: nothing is asked", async () => {
    const spies: GradingSpies = spyOnGrading();

    await InvestigationGrader.gradeInvestigationOnResolve({ projectId });

    expect(spies.findRun).not.toHaveBeenCalled();
  });
});
