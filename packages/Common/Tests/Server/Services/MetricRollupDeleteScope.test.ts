import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
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
 * Deleting metrics also clears the rollups built from them (the per-minute
 * and hourly baseline tables), but only for a delete whose CALLER names the
 * resources whose metrics it removes. The rollup delete keeps only the
 * project, metric name and resource of the delete, so a delete the caller
 * did not aim at resources - one limited by time or attributes - must not
 * reach the rollups, even when the deleter's scope (a label or Owned grant,
 * a block with labels) narrows it to some resources: there it would remove
 * every rollup of those resources, of every time. The rollups that do go
 * are those of the resources the delete reached.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceA: string = ObjectID.generate().toString();
const serviceC: string = ObjectID.generate().toString();

let service: MetricService;
let statements: Array<Statement>;

beforeEach(() => {
  service = new MetricService();
  statements = [];

  (service as unknown as { database: unknown }).database = {
    getDatasourceOptions: () => {
      return { database: "oneuptime" };
    },
  };

  jest.spyOn(service, "execute").mockImplementation((async (
    statement: Statement,
  ) => {
    statements.push(statement);
    return {};
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A delete as the caller asked for it, and as the deleter's permissions narrowed it.
async function deleteMetrics(data: {
  requested: Query<Metric>;
  scoped: Query<Metric>;
}): Promise<void> {
  jest
    .spyOn(AnalyticsModelPermission, "checkDeletePermission")
    .mockResolvedValue(data.scoped as never);

  await service.deleteBy({
    query: data.requested,
    props: { tenantId: projectId, userId: ObjectID.generate() },
  });
}

// The statements that delete from a rollup table (named as a bound identifier).
function rollupDeletes(): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    const text: string = `${statement.query} ${JSON.stringify(
      statement.query_params,
    )}`;
    return (
      text.includes("MetricItemAggMV1m") ||
      text.includes("MetricBaselineHourly")
    );
  });
}

describe("deleting metrics clears their rollups only for the resources the caller named", () => {
  test("a delete naming its resources clears the rollups of those the deleter may reach", async () => {
    await deleteMetrics({
      requested: {
        projectId,
        name: "http.server.duration",
        primaryEntityId: new Includes([serviceA, serviceC]),
      },
      scoped: {
        projectId,
        name: "http.server.duration",
        primaryEntityId: new Includes([serviceA]),
      },
    });

    expect(rollupDeletes()).toHaveLength(2);
    for (const statement of rollupDeletes()) {
      expect(Object.values(statement.query_params)).toContainEqual([serviceA]);
      expect(JSON.stringify(statement.query_params)).not.toContain(serviceC);
    }
  });

  test("a delete naming one resource by id clears that resource's rollups", async () => {
    await deleteMetrics({
      requested: { projectId, primaryEntityId: serviceA },
      scoped: { projectId, primaryEntityId: serviceA },
    });

    expect(rollupDeletes()).toHaveLength(2);
  });

  test("a delete limited by time leaves every rollup alone, though the deleter's scope names resources", async () => {
    const lastHour: InBetween<Date> = new InBetween<Date>(
      new Date(Date.now() - 60 * 60 * 1000),
      new Date(),
    );

    await deleteMetrics({
      requested: { projectId, name: "cpu", time: lastHour },
      scoped: {
        projectId,
        name: "cpu",
        time: lastHour,
        primaryEntityId: new Includes([serviceA]),
      },
    });

    // The metrics themselves are deleted; the rollups are not touched.
    expect(statements).toHaveLength(1);
    expect(rollupDeletes()).toHaveLength(0);
  });

  test("a delete narrowed by a block with labels leaves every rollup alone", async () => {
    await deleteMetrics({
      requested: { projectId, name: "http.server.duration" },
      scoped: {
        projectId,
        name: "http.server.duration",
        primaryEntityId: new IncludesNone([serviceC]),
      },
    });

    expect(statements).toHaveLength(1);
    expect(rollupDeletes()).toHaveLength(0);
  });

  test("a delete filtering resources by an operator leaves every rollup alone", async () => {
    await deleteMetrics({
      requested: {
        projectId,
        name: "http.server.duration",
        primaryEntityId: new NotEqual(serviceA),
      },
      scoped: {
        projectId,
        name: "http.server.duration",
        primaryEntityId: [
          new NotEqual(serviceA),
          new IncludesNone([serviceC]),
        ] as never,
      },
    });

    expect(rollupDeletes()).toHaveLength(0);
  });

  test("a delete that names no resource leaves every rollup alone", async () => {
    await deleteMetrics({
      requested: { projectId, name: "http.server.duration" },
      scoped: { projectId, name: "http.server.duration" },
    });

    expect(rollupDeletes()).toHaveLength(0);
  });
});
