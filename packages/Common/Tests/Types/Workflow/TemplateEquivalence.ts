/*
 * A TEMPLATE AND THE ONE IT REPLACED, ON THE SAME EVENT.
 *
 * The templates were rebuilt to four or five steps each, on the promise
 * that each still does the same job. The equivalence suites
 * (*TemplateEquivalence.test.ts) hold them to it: each runs a template's
 * old graph (TemplateGraphsBeforeSimplifying) and its new one on the same
 * event, each against a project of its own made the same way (TemplateWorld)
 * and an other tool of its own in the same state, and expects:
 *
 *   - the same records: titles, descriptions, severities, states, custom
 *     fields, labels, and whether an incident shows on status pages;
 *   - the same private notes and state changes, with the same text;
 *   - the same calls to the other tool, and the other tool left the same;
 *   - the same pages;
 *   - the same verdict: a run the old graph ended with a ❌ Log fails now,
 *     with nothing connected to the failed step's Error output
 *     (UnhandledStepFailure), and a run it ended with ✅ or ℹ️ succeeds.
 *
 * What the old graphs wrote only to their run log, in Log steps, is not
 * compared: the new templates say it in each step's Steps entry instead.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageRequest,
  OnCallPageResult,
} from "../../../Server/Services/OnCallPageService";
import BadDataException from "../../../Types/Exception/BadDataException";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getPageStepTarget } from "../../../Types/Workflow/Components/OnCall";
import {
  WhoToPagePicks,
  buildGraphForTemplate,
} from "../../../Types/Workflow/Templates";
import { getTemplateGraphBeforeSimplifying } from "./TemplateGraphsBeforeSimplifying";
import TemplateWorld from "./TemplateWorld";
import {
  FakeHttpFunction,
  SimulationTrace,
  runTemplate,
} from "./WorkflowTemplateSimulator";
import { jest } from "@jest/globals";

// The other tool, fresh for each run: how it answers, and what it holds afterwards.
export interface OtherTool {
  http: FakeHttpFunction;
  state: () => JSONValue;
}

export interface EquivalenceScenario {
  templateId: string;
  variables?: Dictionary<string> | undefined;
  // The project as it is before the event, made the same way for both runs.
  setUp?: ((world: TemplateWorld) => void) | undefined;
  // What the trigger hands over, read from the project as it stands.
  trigger: (world: TemplateWorld) => JSONObject;
  // The other tool, made afresh for each run.
  tool?: (() => OtherTool) | undefined;
  // Who was picked to page, by the Page step's id: in the wizard now, in the Builder before.
  picks?: WhoToPagePicks | undefined;
  // Whether paging fails, as it does for a policy with no escalation rules.
  pagingFails?: boolean | undefined;
  // Graphs built some other way, in place of the template's: a Huntress connection's.
  oldGraph?: JSONObject | undefined;
  newGraph?: JSONObject | undefined;
}

export interface EquivalenceOutcome {
  world: JSONObject;
  tool: JSONValue;
  pages: Array<JSONObject>;
  // Whether the run failed: a ❌ Log before, a step failing with nothing on its Error output now.
  failed: boolean;
}

export interface EquivalenceRun {
  old: EquivalenceOutcome;
  new: EquivalenceOutcome;
  oldTrace: SimulationTrace;
  newTrace: SimulationTrace;
  oldWorld: TemplateWorld;
  newWorld: TemplateWorld;
}

let generated: number = 0;

const generateId: () => string = (): string => {
  generated++;
  return `equivalence-${generated}`;
};

// A page as the people paged see it: who, and about which record, by its number.
const describePage: (
  request: OnCallPageRequest,
  world: TemplateWorld,
) => JSONObject = (
  request: OnCallPageRequest,
  world: TemplateWorld,
): JSONObject => {
  const numberOf: (id: ObjectID | undefined, alert: boolean) => string = (
    id: ObjectID | undefined,
    alert: boolean,
  ): string => {
    const rows: Array<{ id?: ObjectID | null; getColumnValue: (column: string) => unknown }> =
      alert ? world.alerts.records.rows : world.incidents.records.rows;
    const found: { getColumnValue: (column: string) => unknown } | undefined =
      rows.find((row: { id?: ObjectID | null }): boolean => {
        return row.id?.toString() === id?.toString();
      });

    return found
      ? String(
          found.getColumnValue(
            alert ? "alertNumberWithPrefix" : "incidentNumberWithPrefix",
          ),
        )
      : `unknown ${id?.toString()}`;
  };
  const ids: (list: Array<ObjectID> | undefined) => Array<string> = (
    list: Array<ObjectID> | undefined,
  ): Array<string> => {
    return (list || []).map((id: ObjectID): string => {
      return id.toString();
    });
  };

  return {
    users: ids(request.targets.userIds),
    teams: ids(request.targets.teamIds),
    schedules: ids(request.targets.onCallScheduleIds),
    policies: ids(request.targets.onCallDutyPolicyIds),
    about: request.about.incidentId
      ? `incident ${numberOf(request.about.incidentId, false)}`
      : request.about.alertId
        ? `alert ${numberOf(request.about.alertId, true)}`
        : `a new alert: ${request.about.newAlert?.title || ""}`,
  };
};

/*
 * The old graph, with who was picked filled into its Page steps as the
 * Builder stored a pick: the old templates left who to page for the Builder.
 */
const withPicksInBuilder: (
  graph: JSONObject,
  picks: WhoToPagePicks | undefined,
) => JSONObject = (
  graph: JSONObject,
  picks: WhoToPagePicks | undefined,
): JSONObject => {
  for (const node of graph["nodes"] as Array<JSONObject>) {
    const data: JSONObject = node["data"] as JSONObject;
    const picked: Array<string> | undefined = picks?.[data["id"] as string];
    const target: ReturnType<typeof getPageStepTarget> = getPageStepTarget(
      data["metadataId"] as string,
    );

    if (picked && picked.length > 0 && target) {
      data["arguments"] = {
        ...((data["arguments"] as JSONObject) || {}),
        [target.argumentId]: picked,
      };
    }
  }

  return graph;
};

type RunOneFunction = (data: {
  scenario: EquivalenceScenario;
  graph: JSONObject;
  isOld: boolean;
}) => Promise<{
  outcome: EquivalenceOutcome;
  trace: SimulationTrace;
  world: TemplateWorld;
}>;

const runOne: RunOneFunction = async (data: {
  scenario: EquivalenceScenario;
  graph: JSONObject;
  isOld: boolean;
}): Promise<{
  outcome: EquivalenceOutcome;
  trace: SimulationTrace;
  world: TemplateWorld;
}> => {
  const world: TemplateWorld = new TemplateWorld();

  if (data.scenario.setUp) {
    data.scenario.setUp(world);
  }

  const tool: OtherTool | null = data.scenario.tool
    ? data.scenario.tool()
    : null;
  const pages: Array<OnCallPageRequest> = [];

  const pageSpy: { mockRestore: () => void } = jest
    .spyOn(OnCallPageService, "page")
    .mockImplementation((async (
      request: OnCallPageRequest,
    ): Promise<OnCallPageResult> => {
      pages.push(request);

      if (data.scenario.pagingFails) {
        throw new BadDataException(
          "The on-call policy Ops has no escalation rules.",
        );
      }

      // The record the page is about, as the service hands it back.
      return {
        record: {
          type: request.about.alertId
            ? OnCallPageRecordType.Alert
            : OnCallPageRecordType.Incident,
          id:
            request.about.incidentId ||
            request.about.alertId ||
            ObjectID.generate(),
          label: "",
          title: "",
          url: "",
          isNew: !request.about.incidentId && !request.about.alertId,
        },
        paged: [],
        startedPolicies: [],
        notPaged: [],
        isAnyonePaged: true,
        directPageExecutionLogId: null,
        summary: "Paged Ops.",
      } as unknown as OnCallPageResult;
    }) as never) as unknown as { mockRestore: () => void };

  let trace: SimulationTrace;

  try {
    trace = await runTemplate({
      templateId: data.scenario.templateId,
      trigger: data.scenario.trigger(world),
      variables: data.scenario.variables || {},
      ...(tool ? { http: tool.http } : {}),
      graph: data.graph,
      world: world,
    });
  } finally {
    pageSpy.mockRestore();
  }

  return {
    trace: trace,
    world: world,
    outcome: {
      world: world.snapshot(),
      tool: tool ? tool.state() : null,
      pages: pages.map((request: OnCallPageRequest): JSONObject => {
        return describePage(request, world);
      }),
      failed: data.isOld
        ? trace.logs.some((line: string): boolean => {
            return line.startsWith("❌");
          })
        : trace.failedSteps.length > 0,
    },
  };
};

export interface TemplateRun {
  outcome: EquivalenceOutcome;
  trace: SimulationTrace;
  world: TemplateWorld;
}

export type RunNewTemplateFunction = (
  scenario: EquivalenceScenario,
) => Promise<TemplateRun>;

/*
 * The template as it is now, alone, on an event: for the simulation suites,
 * which hold it to what it should do rather than to what the old one did.
 */
export const runNewTemplate: RunNewTemplateFunction = async (
  scenario: EquivalenceScenario,
): Promise<TemplateRun> => {
  const graph: JSONObject | null =
    scenario.newGraph ||
    buildGraphForTemplate(scenario.templateId, generateId, scenario.picks || {});

  if (!graph) {
    throw new Error(`There is no template ${scenario.templateId}.`);
  }

  return await runOne({ scenario: scenario, graph: graph, isOld: false });
};

export type RunOldAndNewFunction = (
  scenario: EquivalenceScenario,
) => Promise<EquivalenceRun>;

// The old graph and the new template on the same event, each in a world of its own.
export const runOldAndNew: RunOldAndNewFunction = async (
  scenario: EquivalenceScenario,
): Promise<EquivalenceRun> => {
  const oldGraph: JSONObject = withPicksInBuilder(
    scenario.oldGraph || getTemplateGraphBeforeSimplifying(scenario.templateId),
    scenario.picks,
  );
  const newGraph: JSONObject | null =
    scenario.newGraph ||
    buildGraphForTemplate(scenario.templateId, generateId, scenario.picks || {});

  if (!newGraph) {
    throw new Error(`There is no template ${scenario.templateId} now.`);
  }

  const before: Awaited<ReturnType<RunOneFunction>> = await runOne({
    scenario: scenario,
    graph: oldGraph,
    isOld: true,
  });
  const after: Awaited<ReturnType<RunOneFunction>> = await runOne({
    scenario: scenario,
    graph: newGraph,
    isOld: false,
  });

  return {
    old: before.outcome,
    new: after.outcome,
    oldTrace: before.trace,
    newTrace: after.trace,
    oldWorld: before.world,
    newWorld: after.world,
  };
};
