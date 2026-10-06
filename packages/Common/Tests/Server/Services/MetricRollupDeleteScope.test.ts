import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
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
 * and hourly baseline tables), but only for a delete that NAMES the
 * resources whose metrics it removes. The rollup delete keeps only the
 * project, metric name and resource of the original delete, so a delete
 * narrowed by exclusion - a deleter whose block with labels leaves some
 * resources out - must not reach the rollups: there it would remove every
 * other resource's rollups of the project.
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

// The delete as the deleter's permissions narrowed it.
async function deleteWithScopedQuery(scoped: Query<Metric>): Promise<void> {
  jest
    .spyOn(AnalyticsModelPermission, "checkDeletePermission")
    .mockResolvedValue(scoped as never);

  await service.deleteBy({
    query: { projectId, name: "http.server.duration" },
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

describe("deleting metrics clears their rollups only for named resources", () => {
  test("a delete naming its resources clears their rollups too", async () => {
    await deleteWithScopedQuery({
      projectId,
      name: "http.server.duration",
      primaryEntityId: new Includes([serviceA]),
    });

    expect(rollupDeletes()).toHaveLength(2);
    for (const statement of rollupDeletes()) {
      expect(Object.values(statement.query_params)).toContainEqual([serviceA]);
    }
  });

  test("a delete narrowed by a block with labels leaves every rollup alone", async () => {
    await deleteWithScopedQuery({
      projectId,
      name: "http.server.duration",
      primaryEntityId: new IncludesNone([serviceC]),
    });

    // The metrics themselves are deleted; the rollups are not touched.
    expect(statements).toHaveLength(1);
    expect(rollupDeletes()).toHaveLength(0);
  });

  test("a delete with another filter next to the scope leaves every rollup alone", async () => {
    await deleteWithScopedQuery({
      projectId,
      name: "http.server.duration",
      primaryEntityId: [
        new NotEqual(serviceA),
        new IncludesNone([serviceC]),
      ] as never,
    });

    expect(rollupDeletes()).toHaveLength(0);
  });

  test("a delete that names no resource leaves every rollup alone", async () => {
    await deleteWithScopedQuery({
      projectId,
      name: "http.server.duration",
    });

    expect(rollupDeletes()).toHaveLength(0);
  });
});
