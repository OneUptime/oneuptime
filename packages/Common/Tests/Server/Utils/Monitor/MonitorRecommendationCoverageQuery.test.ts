import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorRecommendationCoverageQuery, {
  COVERAGE_CANDIDATES_PAGE_SIZE,
} from "../../../../Server/Utils/Monitor/MonitorRecommendationCoverageQuery";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendationCoverageQuestion,
  getCoverageQuestions,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import MonitorRecommendationUtil from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * WHICH OF A PROJECT'S MONITORS COVERS EACH RECOMMENDATION, DECIDED WITH A
 * QUERY (#11074).
 *
 * A fake MonitorService answers the reads as Postgres would: by project and
 * type, held to the monitors whose stored steps hold one of the texts the
 * query narrows by (textContainsAnyOf), by name then id, a page at a time.
 * The project has 10,050 Host monitors before the one that matters.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11074000-0000-4000-8000-000000000000",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11074000-0000-4000-8000-0000000000ff",
);
const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("11074000-0000-4000-8000-0000000000aa"),
  tenantId: PROJECT_ID,
};

const HOST: string = "db-host-7";

function argsOf(resourceIdentifier: string): MonitorRecommendationArgs {
  return {
    resourceIdentifier,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: resourceIdentifier,
  };
}

const RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getAllPossibleRecommendations(
    MonitorRecommendationResourceType.Host,
  );

function stepOf(
  recommendation: MonitorRecommendation,
  resourceIdentifier: string,
): MonitorStep {
  const args: MonitorRecommendationArgs = argsOf(resourceIdentifier);

  return recommendation.getMonitorStep({
    ...args,
    monitorName: MonitorRecommendationUtil.getTemplateMonitorName({
      recommendation,
      resourceDisplayName: args.monitorName,
    }),
  });
}

function monitorOf(data: {
  n: number;
  name: string;
  steps: Array<MonitorStep>;
  monitorType?: MonitorType | undefined;
  projectId?: ObjectID | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID(
    `11074000-0000-4000-8000-${String(data.n).padStart(12, "0")}`,
  );
  monitor.name = data.name;
  monitor.projectId = data.projectId || PROJECT_ID;
  monitor.monitorType = data.monitorType || MonitorType.Host;
  monitor.monitorSteps = new MonitorSteps();
  monitor.monitorSteps.data = {
    monitorStepsInstanceArray: data.steps,
    defaultMonitorStatusId: ObjectID.getZeroObjectID(),
  };
  return monitor;
}

function storedText(monitor: Monitor): string {
  return JSON.stringify(
    MonitorSteps.toDatabaseJSON(monitor.monitorSteps!.toJSON()),
  ).toLowerCase();
}

// The texts a textContainsAnyOf condition looks for: its bound patterns, as `%text%`.
function textsOf(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as FindOperator<unknown>).objectLiteralParameters || {};

  return ((Object.values(parameters)[0] as Array<string>) || []).map(
    (pattern: string): string => {
      return pattern.slice(1, -1).split("\\").join("");
    },
  );
}

interface Read {
  monitorType: unknown;
  texts: Array<string> | null;
  skip: number;
  limit: number;
  sort: unknown;
  props: unknown;
}

let monitors: Array<Monitor> = [];
let reads: Array<Read> = [];

beforeEach(() => {
  monitors = [];
  reads = [];

  jest.spyOn(MonitorService, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
    skip: number;
    limit: number;
    sort: unknown;
    props: unknown;
  }): Promise<Array<Monitor>> => {
    const texts: Array<string> | null =
      args.query["monitorSteps"] instanceof FindOperator
        ? textsOf(args.query["monitorSteps"])
        : null;

    reads.push({
      monitorType: args.query["monitorType"],
      texts,
      skip: args.skip,
      limit: args.limit,
      sort: args.sort,
      props: args.props,
    });

    return monitors
      .filter((monitor: Monitor): boolean => {
        return (
          monitor.projectId!.toString() ===
            (args.query["projectId"] as ObjectID).toString() &&
          monitor.monitorType === args.query["monitorType"] &&
          (!texts ||
            texts.some((text: string): boolean => {
              return storedText(monitor).includes(text.toLowerCase());
            }))
        );
      })
      .sort((left: Monitor, right: Monitor): number => {
        return (
          left.name!.localeCompare(right.name!) ||
          left.id!.toString().localeCompare(right.id!.toString())
        );
      })
      .slice(args.skip, args.skip + args.limit);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function ask(
  questions: Array<MonitorRecommendationCoverageQuestion>,
): Promise<Map<string, ObjectID>> {
  return await MonitorRecommendationCoverageQuery.findCoveringMonitors({
    projectId: PROJECT_ID,
    props: PROPS,
    questions,
  });
}

function questionsFor(
  resourceIdentifier: string,
): Array<MonitorRecommendationCoverageQuestion> {
  return getCoverageQuestions({
    recommendations: RECOMMENDATIONS,
    args: argsOf(resourceIdentifier),
  });
}

describe("which monitor covers each recommendation", () => {
  test("a monitor past the project's first 10,000 that covers one is found - only the ones that mention the resource are read", async () => {
    const recommendation: MonitorRecommendation = RECOMMENDATIONS[0]!;

    monitors = [
      // 10,050 Host monitors of other hosts, named to sort first.
      ...Array.from({ length: 10050 }, (_: unknown, index: number) => {
        return monitorOf({
          n: index + 1,
          name: `a-${String(index).padStart(5, "0")}`,
          steps: [stepOf(recommendation, `other-host-${index}`)],
        });
      }),
      monitorOf({
        n: 20000,
        name: "zz-db-host-7",
        steps: [stepOf(recommendation, HOST)],
      }),
    ];

    const covered: Map<string, ObjectID> = await ask(questionsFor(HOST));

    expect(covered.get(recommendation.recommendationId)?.toString()).toBe(
      monitors[monitors.length - 1]!.id!.toString(),
    );
    // One read: the host's own monitors only, never the 10,050 others.
    expect(reads).toHaveLength(1);
    expect(reads[0]!.texts).toEqual([HOST]);
  });

  test("read under the reader's own permissions, by name then id, a page at a time", async () => {
    await ask(questionsFor(HOST));

    expect(reads[0]).toMatchObject({
      monitorType: MonitorType.Host,
      skip: 0,
      limit: COVERAGE_CANDIDATES_PAGE_SIZE,
      sort: { name: SortOrder.Ascending, _id: SortOrder.Ascending },
      props: PROPS,
    });
  });

  test("many candidates are read page by page until the last", async () => {
    const recommendation: MonitorRecommendation = RECOMMENDATIONS[0]!;
    const other: MonitorRecommendation = RECOMMENDATIONS[1]!;

    // 1,200 monitors of this host, none of them the second recommendation's.
    monitors = Array.from({ length: 1200 }, (_: unknown, index: number) => {
      return monitorOf({
        n: index + 1,
        name: `host-${String(index).padStart(5, "0")}`,
        steps: [stepOf(recommendation, HOST)],
      });
    });
    monitors.push(
      monitorOf({ n: 5000, name: "zzz", steps: [stepOf(other, HOST)] }),
    );

    const covered: Map<string, ObjectID> = await ask(questionsFor(HOST));

    // The first by name covers the first recommendation, as the list by name did.
    expect(covered.get(recommendation.recommendationId)?.toString()).toBe(
      monitors[0]!.id!.toString(),
    );
    expect(covered.get(other.recommendationId)?.toString()).toBe(
      monitors[monitors.length - 1]!.id!.toString(),
    );
    expect(
      reads.map((read: Read): number => {
        return read.skip;
      }),
    ).toEqual([0, 500, 1000]);
  });

  test("once every fingerprint asked about has its monitor, nothing more is read", async () => {
    const recommendation: MonitorRecommendation = RECOMMENDATIONS[0]!;

    monitors = Array.from({ length: 1200 }, (_: unknown, index: number) => {
      return monitorOf({
        n: index + 1,
        name: `host-${String(index).padStart(5, "0")}`,
        steps: [stepOf(recommendation, HOST)],
      });
    });

    const [first]: Array<MonitorRecommendationCoverageQuestion> =
      questionsFor(HOST);

    await ask([{ ...first!, fingerprints: first!.fingerprints.slice(0, 1) }]);

    expect(reads).toHaveLength(1);
  });

  test("a monitor of another host, another type or another project covers nothing here", async () => {
    const recommendation: MonitorRecommendation = RECOMMENDATIONS[0]!;

    monitors = [
      monitorOf({ n: 1, name: "a", steps: [stepOf(recommendation, "web-1")] }),
      monitorOf({
        n: 2,
        name: "b",
        steps: [stepOf(recommendation, HOST)],
        monitorType: MonitorType.Metrics,
      }),
      monitorOf({
        n: 3,
        name: "c",
        steps: [stepOf(recommendation, HOST)],
        projectId: OTHER_PROJECT_ID,
      }),
    ];

    expect((await ask(questionsFor(HOST))).size).toBe(0);
  });

  test("a monitor whose steps merely mention the host covers nothing: a mention is a candidate, never a match", async () => {
    const recommendation: MonitorRecommendation = RECOMMENDATIONS[0]!;
    const other: MonitorRecommendation = RECOMMENDATIONS[1]!;

    // Made from the second recommendation: it mentions the host, and is read.
    monitors = [monitorOf({ n: 1, name: "a", steps: [stepOf(other, HOST)] })];

    const covered: Map<string, ObjectID> = await ask(questionsFor(HOST));

    expect(covered.has(recommendation.recommendationId)).toBe(false);
    expect(covered.has(other.recommendationId)).toBe(true);
  });

  test("each type asked about is read on its own", async () => {
    const hostQuestions: Array<MonitorRecommendationCoverageQuestion> =
      questionsFor(HOST);

    await ask([
      ...hostQuestions,
      {
        ...hostQuestions[0]!,
        key: "as-metrics",
        monitorType: MonitorType.Metrics,
      },
    ]);

    expect(
      reads.map((read: Read): unknown => {
        return read.monitorType;
      }),
    ).toEqual([MonitorType.Host, MonitorType.Metrics]);
  });

  test("a fingerprint that names nothing to narrow by reads every monitor of the type", async () => {
    const nameless: string = MonitorRecommendationUtil.serializeFingerprint({
      resourceIdentifier: "",
      configKind: "hostMonitor",
      metricNames: [],
      formulas: [],
      metricAliases: [],
      queryAttributes: [],
      criteriaFilters: [],
      configValues: [],
    });

    await ask([
      { key: "k", monitorType: MonitorType.Host, fingerprints: [nameless] },
    ]);

    expect(reads[0]!.texts).toBeNull();
  });

  test("no question, no read", async () => {
    expect((await ask([])).size).toBe(0);
    expect(reads).toEqual([]);
  });
});
