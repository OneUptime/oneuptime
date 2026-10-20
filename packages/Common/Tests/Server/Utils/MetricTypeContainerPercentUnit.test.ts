import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import MetricTypeService from "../../../Server/Services/MetricTypeService";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The metric catalog's unit for the container stats receivers' percents.
 *
 * The catalog keeps one unit per metric name and project, and every chart
 * and generic monitor reads it. Ingest now records docker_stats'
 * container.cpu.utilization and container.memory.percent as "%" (they are
 * 0-100, declared "1"), so:
 *
 *   - a project whose rows still say "1" (written by agents before the fix)
 *     moves to "%" with its next batch - and its stored memory percents,
 *     which were always right, read right again;
 *   - a project that runs OneUptime's Kubernetes agent too gets
 *     container.cpu.utilization from both: cores declared "1" from
 *     Kubernetes, a percent declared "%" from Docker. The "%" stays, rather
 *     than flipping - with a write - on every other batch.
 *
 * Everything external is mocked: no Postgres, no Redis.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const METRIC_TYPE_ID: ObjectID = ObjectID.generate();

type ScalarUpdate = { id: ObjectID; data: Record<string, unknown> };

let cache: Map<string, string>;
let scalarUpdates: Array<ScalarUpdate>;
let creates: Array<MetricType>;
let existingRow: MetricType | null;

function storedRow(name: string, unit: string): MetricType {
  const row: MetricType = new MetricType();
  row.id = METRIC_TYPE_ID;
  row._id = METRIC_TYPE_ID.toString();
  row.name = name;
  row.description = "";
  row.unit = unit;
  row.services = [];
  return row;
}

// One batch's view of a metric, as MetricCatalog builds it.
function batch(name: string, unit: string): Dictionary<MetricType> {
  const metric: MetricType = new MetricType();
  metric.name = name;
  metric.unit = unit;
  metric.services = [];
  return { [name]: metric };
}

async function ingest(name: string, unit: string): Promise<void> {
  await TelemetryUtil.indexMetricNameServiceNameMap({
    projectId: PROJECT_ID,
    metricNameServiceNameMap: batch(name, unit),
  });
}

/*
 * What the row says after the updates so far - the mocked findOneBy hands
 * back the same object, so apply each update to it as Postgres would.
 */
function applyUpdates(): void {
  for (const update of scalarUpdates.splice(0)) {
    Object.assign(existingRow!, update.data);
    appliedUpdates.push(update);
  }
}

let appliedUpdates: Array<ScalarUpdate>;

beforeEach(() => {
  cache = new Map<string, string>();
  scalarUpdates = [];
  appliedUpdates = [];
  creates = [];
  existingRow = null;

  jest
    .spyOn(GlobalCache, "setStringIfChanged")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        const full: string = `${namespace}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);

  jest.spyOn(MetricTypeService, "findOneBy").mockImplementation(async () => {
    return existingRow;
  });
  jest
    .spyOn(MetricTypeService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
      scalarUpdates.push({
        id: input.id,
        data: { ...(input.data as Record<string, unknown>) },
      });
    });
  jest.spyOn(MetricTypeService, "attachServices").mockResolvedValue(undefined);
  jest
    .spyOn(MetricTypeService, "create")
    .mockImplementation(async (input: { data: MetricType }) => {
      creates.push(input.data);
      return input.data;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("projects whose rows were written by agents before the fix", () => {
  test.each(["container.cpu.utilization", "container.memory.percent"])(
    "regression: a stored '1' for %s becomes '%' with the first batch after the fix",
    async (name: string) => {
      existingRow = storedRow(name, "1");

      await ingest(name, "%");
      applyUpdates();

      expect(appliedUpdates).toHaveLength(1);
      expect(appliedUpdates[0]!.data).toEqual({ unit: "%" });
      expect(existingRow!.unit).toBe("%");
    },
  );

  test("a project's first container metric is created with '%'", async () => {
    existingRow = null;

    await ingest("container.memory.percent", "%");

    expect(creates).toHaveLength(1);
    expect(creates[0]!.unit).toBe("%");
  });
});

describe("a project running the Kubernetes agent and a Docker agent", () => {
  test("container.cpu.utilization settles on '%' and stays there, with one write, however the batches interleave", async () => {
    existingRow = storedRow("container.cpu.utilization", "1");

    // Kubernetes (cores, "1") and Docker ("%") batches, interleaved.
    for (let round: number = 0; round < 10; round++) {
      await ingest("container.cpu.utilization", "1");
      applyUpdates();
      await ingest("container.cpu.utilization", "%");
      applyUpdates();
    }

    expect(existingRow!.unit).toBe("%");
    expect(appliedUpdates).toHaveLength(1);
    expect(appliedUpdates[0]!.data).toEqual({ unit: "%" });
  });

  test("a Kubernetes batch after the Docker one does not take the unit back", async () => {
    existingRow = storedRow("container.cpu.utilization", "%");

    await ingest("container.cpu.utilization", "1");
    applyUpdates();

    expect(appliedUpdates).toHaveLength(0);
    expect(existingRow!.unit).toBe("%");
  });

  test("a Kubernetes-only project keeps '1' for its cores", async () => {
    existingRow = storedRow("container.cpu.utilization", "1");

    for (let round: number = 0; round < 3; round++) {
      await ingest("container.cpu.utilization", "1");
      applyUpdates();
    }

    expect(appliedUpdates).toHaveLength(0);
    expect(existingRow!.unit).toBe("1");
  });
});

describe("every other metric's unit changes as it always did", () => {
  test.each<[string, string, string]>([
    ["system.cpu.utilization", "%", "1"],
    ["http.server.duration", "ms", "s"],
    ["container.memory.usage.total", "By", "MiBy"],
    // A container percent moving to a unit that is not "1" goes through.
    ["container.cpu.utilization", "%", "ns"],
  ])(
    "%s: stored %s, incoming %s is written",
    async (name: string, stored: string, incoming: string) => {
      existingRow = storedRow(name, stored);

      await ingest(name, incoming);
      applyUpdates();

      expect(appliedUpdates).toHaveLength(1);
      expect(appliedUpdates[0]!.data).toEqual({ unit: incoming });
    },
  );
});
