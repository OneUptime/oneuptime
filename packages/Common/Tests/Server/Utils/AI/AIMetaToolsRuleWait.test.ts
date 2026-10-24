import {
  GetAIInvestigationTool,
  StartInvestigationTool,
} from "../../../../Server/Utils/AI/Toolbox/AIMetaTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import InvestigationRuleWait, {
  RuleWaitSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE CHAT AND AN INVESTIGATION RULE'S WAIT (issue #5074).
 *
 * get_ai_investigation on a record an AI rule makes OneUptime AI
 * wait for says so - until when, and that it investigates only if the record
 * is still open then - so the model neither calls it skipped nor starts one
 * unasked. start_investigation on such a record starts it now, the way the
 * AI card's Investigate now does: one run, through InvestigationRuleWait
 * .startNow, never a second run beside the waiting one - and the chat's
 * guards against a duplicate still come first.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();
const WAIT_UNTIL: Date = new Date("2026-10-20T10:40:00.000Z");

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = 12;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  incident.monitors = [monitor];

  return incident;
}

function buildAlert(): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.alertNumber = 7;
  alert.monitorId = MONITOR_ID;
  return alert;
}

function subjectOf(spy: jest.SpyInstance, call: number = 0): RuleWaitSubject {
  return spy.mock.calls[call]?.[0] as RuleWaitSubject;
}

beforeEach(() => {
  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(buildIncident() as never);
  jest
    .spyOn(AlertService, "findOneById")
    .mockResolvedValue(buildAlert() as never);
  jest
    .spyOn(IncidentService, "findOneUpdatableById")
    .mockResolvedValue(buildIncident() as never);
  jest
    .spyOn(AlertService, "findOneUpdatableById")
    .mockResolvedValue(buildAlert() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_ai_investigation on a record that waits", () => {
  test("says until when OneUptime AI waits, and that it investigates only if still open", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([] as never);
    const getWaiting: jest.SpyInstance = jest
      .spyOn(InvestigationRuleWait, "getWaiting")
      .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 10 });

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).toContain(
      "No AI investigation has started for Incident #12 yet: an AI rule makes OneUptime AI wait 10 minutes after it was created",
    );
    expect(result.dataForLlm).toContain(
      `investigate it at ${WAIT_UNTIL.toISOString()} only if it is still open then`,
    );
    expect(result.dataForLlm).toContain(
      "offer to start it with start_investigation, which starts it at once",
    );
    // Not the "the gates may have skipped it" answer: nothing was skipped.
    expect(result.dataForLlm).not.toContain("may have skipped");

    expect(subjectOf(getWaiting)).toEqual({
      lane: "Incident",
      projectId: ctx.projectId,
      subjectId: INCIDENT_ID,
    });
  });

  test("reads an alert's wait on the alert's lane", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([] as never);
    const getWaiting: jest.SpyInstance = jest
      .spyOn(InvestigationRuleWait, "getWaiting")
      .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 5 });

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { alertId: ALERT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("Alert #7");
    expect(result.dataForLlm).toContain("wait 5 minutes");
    expect(subjectOf(getWaiting)).toEqual({
      lane: "Alert",
      projectId: ctx.projectId,
      subjectId: ALERT_ID,
    });
  });

  test("a one-minute wait reads in the singular", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(InvestigationRuleWait, "getWaiting")
      .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 1 });

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "makes OneUptime AI wait 1 minute after it was created",
    );
    expect(result.dataForLlm).not.toContain("1 minutes");
  });

  test("a record that does not wait reads as before", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(InvestigationRuleWait, "getWaiting").mockResolvedValue(null);

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "No AI investigation runs exist for Incident #12.",
    );
    expect(result.dataForLlm).not.toContain("AI rule");
  });

  test("a record with a run is read from its run: the wait is not asked about", async () => {
    const run: { _id: string; status: string } = {
      _id: RUN_ID.toString(),
      status: "Running",
    };
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([run] as never);
    const getWaiting: jest.SpyInstance = jest.spyOn(
      InvestigationRuleWait,
      "getWaiting",
    );

    await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(getWaiting).not.toHaveBeenCalled();
  });
});

describe("start_investigation on a record that waits", () => {
  function noRunYet(): void {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
  }

  test("starts it now through the wait - one run, never a second beside it", async () => {
    noRunYet();
    jest
      .spyOn(InvestigationRuleWait, "getWaiting")
      .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 10 });
    const startNow: jest.SpyInstance = jest
      .spyOn(InvestigationRuleWait, "startNow")
      .mockResolvedValue({ isStarted: true, runId: RUN_ID });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(
      `Queued AI investigation run ${RUN_ID.toString()} for Incident #12`,
    );
    expect(result.citationLabel).toBe(
      "AI investigation queued for Incident #12",
    );
    expect(subjectOf(startNow)).toEqual({
      lane: "Incident",
      projectId: ctx.projectId,
      subjectId: INCIDENT_ID,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an alert's wait is started on the alert's lane", async () => {
    noRunYet();
    jest
      .spyOn(InvestigationRuleWait, "getWaiting")
      .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 10 });
    const startNow: jest.SpyInstance = jest
      .spyOn(InvestigationRuleWait, "startNow")
      .mockResolvedValue({ isStarted: true, runId: RUN_ID });
    jest.spyOn(AIInvestigationQueue, "enqueue");

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { alertId: ALERT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(subjectOf(startNow)).toEqual({
      lane: "Alert",
      projectId: ctx.projectId,
      subjectId: ALERT_ID,
    });
  });

  test("a refusal is said in the wait's own words, and nothing else is queued", async () => {
    noRunYet();
    jest
      .spyOn(InvestigationRuleWait, "getWaiting")
      .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 10 });
    jest.spyOn(InvestigationRuleWait, "startNow").mockResolvedValue({
      isStarted: false,
      problem: "project_daily_limit_reached",
      message:
        "This project has reached its own daily AI limit. It resets at midnight UTC.",
    });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe(
      "The investigation for Incident #12 could not be started: This project has reached its own daily AI limit. It resets at midnight UTC.",
    );
    expect(result.citationLabel).toBe(
      "Investigation not enqueued for Incident #12",
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a record that does not wait is queued as before, and the wait is not touched", async () => {
    noRunYet();
    jest.spyOn(InvestigationRuleWait, "getWaiting").mockResolvedValue(null);
    const startNow: jest.SpyInstance = jest.spyOn(
      InvestigationRuleWait,
      "startNow",
    );
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID as never);

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(startNow).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test("a live run still means no duplicate: the wait is neither read nor started", async () => {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1) as never);
    const getWaiting: jest.SpyInstance = jest.spyOn(
      InvestigationRuleWait,
      "getWaiting",
    );
    const startNow: jest.SpyInstance = jest.spyOn(
      InvestigationRuleWait,
      "startNow",
    );

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("already queued or running");
    expect(getWaiting).not.toHaveBeenCalled();
    expect(startNow).not.toHaveBeenCalled();
  });

  test("someone who may read the incident but not change it cannot start it, waiting or not", async () => {
    jest
      .spyOn(IncidentService, "findOneUpdatableById")
      .mockResolvedValue(null as never);
    const startNow: jest.SpyInstance = jest.spyOn(
      InvestigationRuleWait,
      "startNow",
    );

    await expect(
      StartInvestigationTool.execute(
        { incidentId: INCIDENT_ID.toString() },
        ctx,
      ),
    ).rejects.toThrow();
    expect(startNow).not.toHaveBeenCalled();
  });
});

/*
 * An investigation Ask AI starts uses the LLM provider the record's AI
 * rules that investigate pick, as the one the rules start does
 * (Types/AI/LlmProviderChoice).
 */
describe("start_investigation and the LLM provider the rules pick", () => {
  const OPUS: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc1");

  test("the run it queues records the rules' pick", async () => {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest.spyOn(InvestigationRuleWait, "getWaiting").mockResolvedValue(null);
    const pick: jest.SpyInstance = jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(OPUS);
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID as never);

    await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(pick).toHaveBeenCalledWith({
      projectId: ctx.projectId,
      incidentId: INCIDENT_ID,
      alertId: undefined,
    });
    expect(
      (enqueue.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toEqual(OPUS);
  });

  test("an alert's rules pick for an alert's run", async () => {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest.spyOn(InvestigationRuleWait, "getWaiting").mockResolvedValue(null);
    const pick: jest.SpyInstance = jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(undefined);
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID as never);

    await StartInvestigationTool.execute({ alertId: ALERT_ID.toString() }, ctx);

    expect(pick).toHaveBeenCalledWith({
      projectId: ctx.projectId,
      incidentId: undefined,
      alertId: ALERT_ID,
    });
    expect(
      (enqueue.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toBeUndefined();
  });
});
