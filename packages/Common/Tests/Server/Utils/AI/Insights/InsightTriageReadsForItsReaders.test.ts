import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import InsightTriageRunner from "../../../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner";
import logger from "../../../../../Server/Utils/Logger";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";
import {
  ModelReadingMonitors,
  modelReadsMonitors,
  OPEN_MONITOR_NAME,
  readersOfAProject,
  SET_APART_MONITOR_NAME,
} from "../../../../Helpers/RunReadersHarness";

/*
 * AN AI INSIGHT'S TRIAGE READS ONLY WHAT EVERYONE WHO MAY SEE THE INSIGHT
 * MAY READ (#9612).
 *
 * The triage is written on the insight, and everyone who may see the
 * insight reads it: who may read the service it is about, or the whole
 * project for an insight about none (AIInsight's @OwnedThrough). So the
 * triage reads as nobody in particular may - everything of a kind no role
 * reads only by owner or label, and otherwise none an owner or a label
 * sets apart - beside the insight's own service (ReadAudienceReader,
 * subject: the insight).
 *
 * The engine runs for real, and its model reads the project's monitors
 * through the props it is handed (RunReadersHarness): payroll-db, set apart
 * by a label where a team reads every kind only for some labels, never
 * reaches the triage; checkout-api does. Before #9612 a triage read the
 * whole project as OneUptime, and these fail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "16161616-1616-4161-8161-161616161616",
);
const RUN_ID: ObjectID = new ObjectID("17171717-1717-4171-8171-171717171717");
const INSIGHT_ID: ObjectID = new ObjectID(
  "18181818-1818-4181-8181-181818181818",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "19191919-1919-4191-8191-191919191919",
);

// What the triage writes on the insight.
let written: Array<Record<string, unknown>>;

function narrowedReaders(named: Dictionary<Array<string>>): ReadAudience {
  return readAudienceOf({
    projectId: PROJECT_ID,
    labelledPermissions: [Permission.ProjectMember],
    named: { AIInsight: [INSIGHT_ID.toString()], ...named },
  });
}

// An insight about `serviceId`, or about none.
function theInsight(serviceId: ObjectID | undefined): void {
  const row: AIInsight = new AIInsight(INSIGHT_ID);
  row.projectId = PROJECT_ID;
  row.insightType = AIInsightType.TraceLatencyRegression;
  row.severity = AIInsightSeverity.Medium;
  row.status = AIInsightStatus.ActionRequired;
  row.title = "checkout p99 doubled";
  row.serviceName = "checkout";
  if (serviceId) {
    row.telemetryServiceId = serviceId;
  }

  jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(row as never);
  jest.spyOn(AIInsightService, "findOneBy").mockResolvedValue(row as never);
}

beforeEach(() => {
  written = [];

  for (const level of ["debug", "warn", "error", "info"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableInsightFixTasks: false,
  } as unknown as Project as never);
  jest
    .spyOn(AIInsightService, "updateOneById")
    .mockImplementation((async (update: {
      data: Record<string, unknown>;
    }): Promise<void> => {
      written.push(update.data);
    }) as never);
  jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(0 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function triage(): Promise<void> {
  await InsightTriageRunner.executeTriage({
    aiRunId: RUN_ID,
    projectId: PROJECT_ID,
    sentinelInsightId: INSIGHT_ID,
    attemptCount: 1,
  });
}

const ANSWER_TAIL: string = "Classification: unknown";

describe("an AI insight's triage, read for everyone who may see the insight", () => {
  test("its tools read as nobody in particular may, beside the insight's own service", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theInsight(SERVICE_ID);
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: ANSWER_TAIL,
    });

    await triage();

    expect(model.toolProps).toEqual([
      readAudienceProps(narrowedReaders({ Service: [SERVICE_ID.toString()] })),
    ]);
  });

  test("a monitor set apart never reaches the triage on the insight; one nobody set apart does", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theInsight(SERVICE_ID);
    modelReadsMonitors({ answerTail: ANSWER_TAIL });

    await triage();

    expect(written).toHaveLength(1);
    expect(written[0]!["triageSummaryMarkdown"]).toContain(OPEN_MONITOR_NAME);
    expect(JSON.stringify(written)).not.toContain(SET_APART_MONITOR_NAME);
  });

  test("an insight about no service is read across the project: still as nobody in particular may read it", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theInsight(undefined);
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: ANSWER_TAIL,
    });

    await triage();

    expect(model.toolProps).toEqual([readAudienceProps(narrowedReaders({}))]);
    expect(JSON.stringify(written)).not.toContain(SET_APART_MONITOR_NAME);
  });

  test("a project whose roles narrow nobody reads every monitor, as before", async () => {
    readersOfAProject({ narrowedByLabels: false });
    theInsight(SERVICE_ID);
    modelReadsMonitors({ answerTail: ANSWER_TAIL });

    await triage();

    expect(JSON.stringify(written)).toContain(SET_APART_MONITOR_NAME);
    expect(JSON.stringify(written)).toContain(OPEN_MONITOR_NAME);
  });

  /*
   * Unlike a security case's triage (#9632), an insight's counts every
   * row: Project Member reads insights, and an investigation reads its
   * summary again (query_ai_insights) for an incident's readers.
   */
  test("a team that reads every kind only for some labels narrows it though none of its members may read security cases", async () => {
    readersOfAProject({
      narrowedByLabels: true,
      narrowedTeamReadsSecurityCases: false,
    });
    theInsight(SERVICE_ID);
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: ANSWER_TAIL,
    });

    await triage();

    expect(model.toolProps).toEqual([
      readAudienceProps(narrowedReaders({ Service: [SERVICE_ID.toString()] })),
    ]);
    expect(JSON.stringify(written)).not.toContain(SET_APART_MONITOR_NAME);
  });
});
