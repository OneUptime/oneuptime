import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AllAnalyticsModelTypes from "../../../Models/AnalyticsModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { describe, expect, it } from "@jest/globals";

/*
 * Registry-wide identity invariants.
 *
 * Every entity in the product is declared once, in a decorator block, and
 * added to Models/DatabaseModels/Index.ts by hand. New entities are almost
 * always written by copying the closest existing one, which makes the
 * failure mode here a very specific and very quiet kind: a value that was
 * meant to be changed during the copy and was not.
 *
 * What makes that worth a sweep rather than a review checklist is that the
 * two identity values below are read at runtime by machinery that has no way
 * to notice a collision:
 *
 *  - `tableName` is the Postgres table the entity is persisted to. Two models
 *    naming one table are two different shapes writing to the same rows.
 *  - `crudApiPath` is the route BaseAPI registers CRUD under. Two models
 *    naming one path means whichever registers second shadows the first, and
 *    an entire entity's API silently answers as another entity.
 *
 * Neither produces an error at startup. Both produce a product that is wrong
 * in a way that looks like a data bug from the outside.
 *
 * The remaining assertions cover the values the generated OpenAPI document
 * and the dashboard read off a model -- a documented model with no
 * description, or no display name, is a hole in the published API reference
 * rather than a crash, which is exactly why nobody notices it.
 *
 * Sweeping every model rather than asserting on a list is the point: a
 * mis-copied value in a model nobody is looking at fails here rather than in
 * production.
 */

type ModelType = { new (): BaseModel };
type AnalyticsModelType = { new (): AnalyticsBaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const ANALYTICS_MODEL_TYPES: Array<AnalyticsModelType> =
  AllAnalyticsModelTypes as unknown as Array<AnalyticsModelType>;

/*
 * A flat snapshot of the declarations, NOT the model instances.
 *
 * The first version of this file kept all 416 constructed models alive for the
 * lifetime of the file, which is a large object graph resident in a Jest
 * worker whose heap ceiling is deliberately tight (see the note in
 * .github/workflows/test.common.yaml: 2 workers x 4 GB, live set peaking near
 * 3.5 GB). This file shares a shard with the isolated-vm SSRF suite, which
 * needs CPU and memory of its own and reports starvation as a script timeout
 * rather than as an out-of-memory.
 *
 * Every assertion below is about scalar declarations, so the instances exist
 * only long enough to read those off and are collectable immediately after.
 */
interface RegisteredModel {
  className: string;
  tableName: string | null;
  crudApiPath: string | null;
  singularName: string | null;
  pluralName: string | null;
  enableDocumentation: boolean;
  tableDescription: string | null;
  slugifyColumn: string | null;
  saveSlugToColumn: string | null;
  columns: Array<string>;
}

const REGISTERED_MODELS: Array<RegisteredModel> = MODEL_TYPES.map(
  (ModelClass: ModelType): RegisteredModel => {
    const model: BaseModel = new ModelClass();

    return {
      className: ModelClass.name,
      tableName: model.tableName,
      crudApiPath: model.crudApiPath ? model.crudApiPath.toString() : null,
      singularName: model.singularName,
      pluralName: model.pluralName,
      enableDocumentation: Boolean(model.enableDocumentation),
      tableDescription: model.tableDescription,
      slugifyColumn: model.slugifyColumn,
      saveSlugToColumn: model.saveSlugToColumn,
      columns: model.getTableColumns().columns,
    };
  },
);

/*
 * Collect every class name that claims `key`, so a failure names both sides of
 * the collision rather than only reporting that a count was wrong.
 */
const groupBy: (
  keyOf: (entry: RegisteredModel) => string | null,
) => Array<string> = (
  keyOf: (entry: RegisteredModel) => string | null,
): Array<string> => {
  const claimants: Map<string, Array<string>> = new Map();

  for (const entry of REGISTERED_MODELS) {
    const key: string | null = keyOf(entry);

    if (!key) {
      continue;
    }

    claimants.set(key, [...(claimants.get(key) || []), entry.className]);
  }

  return Array.from(claimants.entries())
    .filter((pair: [string, Array<string>]) => {
      return pair[1].length > 1;
    })
    .map((pair: [string, Array<string>]) => {
      return `${pair[0]}: ${pair[1].join(", ")}`;
    })
    .sort();
};

describe("Database model registry", () => {
  it("registers at least one model", () => {
    /*
     * Guards every sweep below. An Index.ts that resolved to an empty array
     * would make each of them pass vacuously.
     */
    expect(REGISTERED_MODELS.length).toBeGreaterThan(0);
  });

  it("gives every model a table name", () => {
    const missing: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return !entry.tableName;
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(missing).toEqual([]);
  });

  /*
   * The collision that persists two different shapes into one set of rows.
   */
  it("gives every model its own table", () => {
    expect(
      groupBy((entry: RegisteredModel) => {
        return entry.tableName;
      }),
    ).toEqual([]);
  });

  /*
   * The collision where one entity's whole API answers as another's, because
   * BaseAPI registers both under the same route and the second wins.
   */
  it("gives every model its own CRUD path", () => {
    expect(
      groupBy((entry: RegisteredModel) => {
        return entry.crudApiPath;
      }),
    ).toEqual([]);
  });

  it("gives every model a singular and a plural display name", () => {
    const missing: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return !entry.singularName || !entry.pluralName;
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(missing).toEqual([]);
  });

  /*
   * The description is what the generated OpenAPI document publishes as the
   * tag description for the entity. A documented model without one ships a
   * section of the public API reference with no explanation of what it is.
   */
  it("describes every model it publishes documentation for", () => {
    const undescribed: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return entry.enableDocumentation && !entry.tableDescription;
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(undescribed).toEqual([]);
  });

  /*
   * `enableDocumentation` alone publishes nothing: OpenAPIUtil skips any model
   * with no `crudApiPath`, so the pair disagreeing is a model that believes it
   * is documented and is absent from the document.
   */
  it("gives every documented model a CRUD path to document", () => {
    const undocumentable: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return entry.enableDocumentation && !entry.crudApiPath;
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(undocumentable).toEqual([]);
  });

  /*
   * Slug generation reads the source column and writes the destination one BY
   * NAME at save time (DatabaseService.generateSlug), off an object rather
   * than through the schema -- so a name that matches no declared column is a
   * silent misfire rather than an error.
   *
   * Both halves misfire differently:
   *
   *  - A source that does not exist reads `undefined`, and Slug.getSlug(null)
   *    answers with a slug built from Faker.generateName(). The row still gets
   *    a unique, non-null slug, so nothing fails -- the slug is simply a
   *    random pair of words instead of the object's own name. Incident was the
   *    clearest case: it slugified "name" while its title column is `title`,
   *    and its own slug column documents the example
   *    "database-connection-failure-in-production", which is a slugified
   *    TITLE. Every incident created before the fix carries a random name.
   *
   *  - A destination that does not exist has the slug assigned to a property
   *    the table has no column for, and TypeORM drops it on insert. The whole
   *    decorator is dead configuration.
   *
   * Fourteen models were recorded here as a baseline and have all since been
   * fixed, so the list is empty. It is kept, rather than deleted along with
   * its last entry, because the pair of tests below it is the ratchet: the
   * first fails on a new misfire, the second fails on an entry left behind
   * after a fix.
   *
   * Where each of the fourteen went, and why:
   *
   *  - The four event models (Incident, ScheduledMaintenance and the two
   *    templates) had a real slug column and a source naming a column they do
   *    not have, so the slug landed and was random. Their intended sources
   *    are pinned in EXPECTED_SLUG_SOURCES below and asserted behaviourally
   *    in Tests/Server/Services/DatabaseServiceGenerateSlug.test.ts.
   *
   *  - Domain, likewise, but its identity is the `domain` column.
   *
   *  - The nine with no slug column had their decorator deleted rather than a
   *    column added. Nothing in the product reads any of these slugs -- the
   *    only slug consumed anywhere is Monitor's, as a template variable --
   *    and the alternative was adding a NOT NULL column to a live table with
   *    a backfill, for a value with no reader.
   *
   * THIS LIST MUST ONLY EVER SHRINK. A new entry means a new misfire; a stale
   * entry means somebody fixed one and this test says so.
   */
  const KNOWN_SLUG_MISFIRES: Array<string> = [];

  const findSlugMisfires: () => Array<string> = (): Array<string> => {
    const dangling: Array<string> = [];

    for (const entry of REGISTERED_MODELS) {
      const columns: Array<string> = entry.columns;

      const source: string | null = entry.slugifyColumn;
      const destination: string | null = entry.saveSlugToColumn;

      if (source && !columns.includes(source)) {
        dangling.push(`${entry.className}.slugifyColumn = ${source}`);
      }

      if (destination && !columns.includes(destination)) {
        dangling.push(`${entry.className}.saveSlugToColumn = ${destination}`);
      }
    }

    return dangling.sort();
  };

  it("introduces no new slug column that does not exist", () => {
    const unexpected: Array<string> = findSlugMisfires().filter(
      (misfire: string) => {
        return !KNOWN_SLUG_MISFIRES.includes(misfire);
      },
    );

    expect(unexpected).toEqual([]);
  });

  /*
   * The other direction, so the baseline cannot rot: once a misfire is fixed
   * its entry has to come out of the list above.
   */
  it("keeps no stale entry in the known slug misfire list", () => {
    const found: Array<string> = findSlugMisfires();

    const stale: Array<string> = KNOWN_SLUG_MISFIRES.filter(
      (misfire: string) => {
        return !found.includes(misfire);
      },
    );

    expect(stale).toEqual([]);
  });

  /*
   * The sweep above only proves a slug source names a column that EXISTS. It
   * cannot see the other half of the same mistake: a decorator naming a real
   * column that is not the one the model means. Incident, before the fix,
   * would have passed such a sweep the moment "name" were changed to
   * "description".
   *
   * So the models whose source was corrected are pinned by name, with the
   * evidence for each choice. Behaviour is asserted separately in
   * Tests/Server/Services/DatabaseServiceGenerateSlug.test.ts; this is the
   * declaration.
   */
  const EXPECTED_SLUG_SOURCES: Record<string, string> = {
    /*
     * The slug column's documented example is
     * "database-connection-failure-in-production" -- the title column's
     * example, slugified.
     */
    Incident: "title",
    ScheduledMaintenance: "title",

    /*
     * Both template models carry a title AND a templateName, so this is a
     * choice between two real columns rather than the only one available.
     * They mean templateName: each documents a slug example that is its
     * templateName example slugified ("Server Outage Template" ->
     * "server-outage-template", "Database Upgrade Template" ->
     * "database-upgrade-template"), and the title is the incident or event
     * the template produces rather than anything unique to the template.
     */
    IncidentTemplate: "templateName",
    ScheduledMaintenanceTemplate: "templateName",

    /* Domain has neither a name nor a title; the domain is its identity. */
    Domain: "domain",
  };

  it("slugifies the column each model actually means", () => {
    const declared: Record<string, string | null> = {};

    for (const className of Object.keys(EXPECTED_SLUG_SOURCES)) {
      const entry: RegisteredModel | undefined = REGISTERED_MODELS.find(
        (candidate: RegisteredModel) => {
          return candidate.className === className;
        },
      );

      /*
       * A renamed or unregistered model shows up as a null rather than as a
       * silently skipped expectation.
       */
      declared[className] = entry ? entry.slugifyColumn : null;
    }

    expect(declared).toEqual(EXPECTED_SLUG_SOURCES);
  });

  /*
   * The nine models whose decorator named columns they do not have at all.
   * Deleting the decorator is what fixed them, so a copy-paste that puts one
   * back has to fail here as well as in the sweep above.
   */
  const MODELS_WITH_NO_SLUG: Array<string> = [
    "AlertState",
    "MetricType",
    "MonitorStatusTimeline",
    "MonitorTest",
    "StatusPageAnnouncement",
    "StatusPageAnnouncementTemplate",
    "StatusPagePrivateUser",
    "StatusPageResource",
    "StatusPageSubscriber",
  ];

  it("leaves the models with no slug column unslugified", () => {
    const configured: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return (
          MODELS_WITH_NO_SLUG.includes(entry.className) &&
          Boolean(entry.slugifyColumn || entry.saveSlugToColumn)
        );
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(configured).toEqual([]);
  });

  /*
   * A model that slugifies a column must have somewhere to put the result.
   * Only the pair together produces a slug; either one alone is dead
   * configuration.
   */
  it("pairs a slug source with a slug destination", () => {
    const unpaired: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return Boolean(entry.slugifyColumn) !== Boolean(entry.saveSlugToColumn);
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(unpaired).toEqual([]);
  });

  it("declares at least one column on every model", () => {
    const empty: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        return entry.columns.length === 0;
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(empty).toEqual([]);
  });

  it("starts every CRUD path with a slash", () => {
    const malformed: Array<string> = REGISTERED_MODELS.filter(
      (entry: RegisteredModel) => {
        const path: string | null = entry.crudApiPath;

        return path !== null && !path.startsWith("/");
      },
    ).map((entry: RegisteredModel) => {
      return entry.className;
    });

    expect(malformed).toEqual([]);
  });
});

describe("Analytics model registry", () => {
  /* Flattened for the same reason as the database models above. */
  interface RegisteredAnalyticsModel {
    className: string;
    tableName: string | null;
    crudApiPath: string | null;
    columnCount: number;
  }

  const REGISTERED: Array<RegisteredAnalyticsModel> = ANALYTICS_MODEL_TYPES.map(
    (ModelClass: AnalyticsModelType): RegisteredAnalyticsModel => {
      const model: AnalyticsBaseModel = new ModelClass();

      return {
        className: ModelClass.name,
        tableName: model.tableName,
        crudApiPath: model.crudApiPath ? model.crudApiPath.toString() : null,
        columnCount: (model.tableColumns || []).length,
      };
    },
  );

  it("registers at least one analytics model", () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
  });

  it("gives every analytics model a table name", () => {
    const missing: Array<string> = REGISTERED.filter(
      (entry: RegisteredAnalyticsModel) => {
        return !entry.tableName;
      },
    ).map((entry: RegisteredAnalyticsModel) => {
      return entry.className;
    });

    expect(missing).toEqual([]);
  });

  /*
   * The ClickHouse equivalent of the Postgres collision above: two models
   * writing rows of different shapes into one table.
   */
  it("gives every analytics model its own table", () => {
    const claimants: Map<string, Array<string>> = new Map();

    for (const entry of REGISTERED) {
      const key: string | null = entry.tableName;

      if (!key) {
        continue;
      }

      claimants.set(key, [...(claimants.get(key) || []), entry.className]);
    }

    const collisions: Array<string> = Array.from(claimants.entries())
      .filter((pair: [string, Array<string>]) => {
        return pair[1].length > 1;
      })
      .map((pair: [string, Array<string>]) => {
        return `${pair[0]}: ${pair[1].join(", ")}`;
      });

    expect(collisions).toEqual([]);
  });

  it("gives every analytics model its own CRUD path", () => {
    const claimants: Map<string, Array<string>> = new Map();

    for (const entry of REGISTERED) {
      const key: string | null = entry.crudApiPath;

      if (!key) {
        continue;
      }

      claimants.set(key, [...(claimants.get(key) || []), entry.className]);
    }

    const collisions: Array<string> = Array.from(claimants.entries())
      .filter((pair: [string, Array<string>]) => {
        return pair[1].length > 1;
      })
      .map((pair: [string, Array<string>]) => {
        return `${pair[0]}: ${pair[1].join(", ")}`;
      });

    expect(collisions).toEqual([]);
  });

  it("declares at least one column on every analytics model", () => {
    const empty: Array<string> = REGISTERED.filter(
      (entry: RegisteredAnalyticsModel) => {
        return entry.columnCount === 0;
      },
    ).map((entry: RegisteredAnalyticsModel) => {
      return entry.className;
    });

    expect(empty).toEqual([]);
  });
});
