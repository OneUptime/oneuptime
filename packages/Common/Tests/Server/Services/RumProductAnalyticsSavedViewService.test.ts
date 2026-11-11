import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Model from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import { Service as RumProductAnalyticsSavedViewServiceType } from "../../../Server/Services/RumProductAnalyticsSavedViewService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ProductAnalyticsEventField,
  ProductAnalyticsRetentionPeriod,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS,
  ProductAnalyticsSavedViewType,
} from "../../../Types/Rum/ProductAnalyticsSavedViews";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";

/*
 * Saved funnels and retention tables (issue #6630), as
 * RumProductAnalyticsSavedViewService keeps them. Whatever writes one - the
 * page, the API, Terraform, a script - it is kept only as the read routes
 * would take it, so a dashboard widget never meets a definition the read
 * refuses, and nothing a caller sent beside the definition's own fields
 * is stored. A name is kept trimmed and is never blank; a saved funnel
 * stays a funnel; an application keeps at most 100 of each kind. The RUM
 * application a saved view reads is its project's own, under either of its
 * names: another project's is answered as one that does not exist.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a300000-0000-4000-8000-000000000001",
);
const APPLICATION_ID: ObjectID = new ObjectID(
  "6a300000-0000-4000-8000-000000000002",
);
const SAVED_VIEW_ID: ObjectID = new ObjectID(
  "6a300000-0000-4000-8000-000000000003",
);
// An application of another project.
const FOREIGN_APPLICATION_ID: ObjectID = new ObjectID(
  "6a300000-0000-4000-8000-0000000000f1",
);
// An id no application has, in any project.
const MISSING_APPLICATION_ID: ObjectID = new ObjectID(
  "6a300000-0000-4000-8000-0000000000d1",
);

// How a refusal of the application reads: the words a missing one gets too.
function notInProject(applicationId: ObjectID): string {
  return `This saved product analytics view references records that are not in this project: RUM Application "${applicationId.toString()}". Please pick values from this project and try again.`;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

const FUNNEL: JSONObject = {
  steps: [
    { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
    { kind: ProductAnalyticsEventKind.Custom, name: "Purchased" },
  ],
  windowMs: 7 * DAY_MS,
  filters: [
    { field: ProductAnalyticsEventField.Property, key: "plan", value: "pro" },
  ],
};

const RETENTION: JSONObject = {
  startEvent: { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
  returnEvent: { kind: ProductAnalyticsEventKind.Session, name: "" },
  period: ProductAnalyticsRetentionPeriod.Week,
  filters: [],
};

type ServiceInternals = {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
};

/* Typed loosely, as the other hook suites do: the answers and the calls are all that is read. */
type Spy = {
  mockResolvedValue: (value: never) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

interface Harness {
  internals: ServiceInternals;
  countBy: Spy;
  rowsOfUpdate: Spy;
}

function buildService(existing: number = 0): Harness {
  const service: RumProductAnalyticsSavedViewServiceType =
    new RumProductAnalyticsSavedViewServiceType();

  const countBy: Spy = jest.spyOn(service, "countBy") as unknown as Spy;
  countBy.mockResolvedValue(new PositiveNumber(existing) as never);

  // The rows an update writes, read and held by the hook that checks them.
  const rowsOfUpdate: Spy = jest.spyOn(
    service,
    "findRowsAndHoldUpdateToThem",
  ) as unknown as Spy;
  rowsOfUpdate.mockResolvedValue([] as never);

  return {
    internals: service as unknown as ServiceInternals,
    countBy: countBy,
    rowsOfUpdate: rowsOfUpdate,
  };
}

function createBy(
  payload: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): CreateBy<Model> {
  return {
    data: Object.assign(new Model(), {
      projectId: PROJECT_ID,
      rumApplicationId: APPLICATION_ID,
      name: "Sign-up to first purchase",
      viewType: ProductAnalyticsSavedViewType.Funnel,
      definition: FUNNEL,
      ...payload,
    }) as Model,
    props: props || { tenantId: PROJECT_ID, userId: ObjectID.generate() },
  } as CreateBy<Model>;
}

function updateBy(
  payload: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): UpdateBy<Model> {
  return {
    query: { _id: SAVED_VIEW_ID.toString() },
    data: payload,
    props: props || { tenantId: PROJECT_ID, userId: ObjectID.generate() },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
  } as unknown as UpdateBy<Model>;
}

function savedRow(viewType: ProductAnalyticsSavedViewType): Model {
  const row: Model = new Model(ObjectID.generate());

  row.viewType = viewType;

  return row;
}

async function createRefusal(
  harness: Harness,
  request: CreateBy<Model>,
): Promise<string> {
  try {
    await harness.internals.onBeforeCreate(request);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadDataException);

    return (error as Error).message;
  }

  throw new Error("The create was not refused.");
}

async function updateRefusal(
  harness: Harness,
  request: UpdateBy<Model>,
): Promise<string> {
  try {
    await harness.internals.onBeforeUpdate(request);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadDataException);

    return (error as Error).message;
  }

  throw new Error("The update was not refused.");
}

let directory: ProjectDirectoryStub;

beforeEach(() => {
  jest.restoreAllMocks();

  // The project's applications; the foreign one is another project's.
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      RumApplication: [APPLICATION_ID.toString()],
    },
    elsewhere: [FOREIGN_APPLICATION_ID.toString()],
  });
});

// What a hook threw, or null when it went through.
async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }

  return null;
}

describe("saving a funnel or a retention table", () => {
  test("keeps the name trimmed and the definition as the reads take it, nothing else", async () => {
    const harness: Harness = buildService();
    const result: OnCreate<Model> = await harness.internals.onBeforeCreate(
      createBy({
        name: "   Sign-up to first purchase  ",
        definition: {
          ...FUNNEL,
          steps: [
            { kind: "custom", name: "Signed up", people: 400 },
            {
              kind: "page",
              name: "https://shop.example.com/checkout?card=4242",
            },
          ],
          startTime: "2026-01-01T00:00:00Z",
          query: "SELECT * FROM RumSession",
        },
      }),
    );

    expect(result.createBy.data.name).toBe("Sign-up to first purchase");
    expect(result.createBy.data.definition).toEqual({
      steps: [
        { kind: "custom", name: "Signed up" },
        { kind: "page", name: "/checkout" },
      ],
      windowMs: 7 * DAY_MS,
      filters: [{ field: "property", key: "plan", value: "pro" }],
    });
  });

  test("fills what the reads would default: a day to finish a funnel, a week for a retention table", async () => {
    const funnel: OnCreate<Model> =
      await buildService().internals.onBeforeCreate(
        createBy({ definition: { steps: FUNNEL["steps"] } }),
      );

    expect(funnel.createBy.data.definition).toEqual({
      steps: FUNNEL["steps"],
      windowMs: DAY_MS,
      filters: [],
    });

    const retention: OnCreate<Model> =
      await buildService().internals.onBeforeCreate(
        createBy({
          viewType: ProductAnalyticsSavedViewType.Retention,
          definition: {
            startEvent: RETENTION["startEvent"],
            returnEvent: RETENTION["returnEvent"],
          },
        }),
      );

    expect(retention.createBy.data.definition).toEqual({
      startEvent: RETENTION["startEvent"],
      returnEvent: RETENTION["returnEvent"],
      period: ProductAnalyticsRetentionPeriod.Week,
      filters: [],
    });
  });

  test("refuses a blank or an over-long name, before anything is counted", async () => {
    for (const name of ["", "   ", undefined, null, 12]) {
      const harness: Harness = buildService();

      expect(await createRefusal(harness, createBy({ name: name }))).toBe(
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.name,
      );
      expect(harness.countBy.mock.calls).toHaveLength(0);
    }

    expect(
      await createRefusal(buildService(), createBy({ name: "n".repeat(101) })),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.nameTooLong);
  });

  test("refuses a kind it does not know", async () => {
    for (const viewType of [undefined, null, "", "Funnel", "paths", 1]) {
      expect(
        await createRefusal(buildService(), createBy({ viewType: viewType })),
      ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewType);
    }
  });

  test("refuses a missing definition, and one the reads would refuse, in the reads' words", async () => {
    for (const definition of [undefined, null]) {
      expect(
        await createRefusal(
          buildService(),
          createBy({ definition: definition }),
        ),
      ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.definition);
    }

    expect(
      await createRefusal(
        buildService(),
        createBy({
          definition: {
            ...FUNNEL,
            steps: [{ kind: "custom", name: "Signed up" }, { kind: "click" }],
          },
        }),
      ),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.step);
    expect(
      await createRefusal(
        buildService(),
        createBy({ definition: { ...FUNNEL, windowMs: 3 * DAY_MS } }),
      ),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.window);
    expect(
      await createRefusal(buildService(), createBy({ definition: "funnel" })),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.notAnObject);

    // A retention table's definition, saved as a funnel, and the other way.
    expect(
      await createRefusal(buildService(), createBy({ definition: RETENTION })),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps);
    expect(
      await createRefusal(
        buildService(),
        createBy({
          viewType: ProductAnalyticsSavedViewType.Retention,
          definition: FUNNEL,
        }),
      ),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.startEvent);
  });

  test("counts the application's saved views of that kind, as root", async () => {
    const harness: Harness = buildService(99);

    await harness.internals.onBeforeCreate(
      createBy({
        viewType: ProductAnalyticsSavedViewType.Retention,
        definition: RETENTION,
      }),
    );

    expect(harness.countBy.mock.calls).toHaveLength(1);

    const count: JSONObject = harness.countBy.mock.calls[0]![0] as JSONObject;
    const query: JSONObject = count["query"] as JSONObject;

    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((query["rumApplicationId"] as ObjectID).toString()).toBe(
      APPLICATION_ID.toString(),
    );
    expect(query["viewType"]).toBe(ProductAnalyticsSavedViewType.Retention);
    expect(count["props"]).toEqual({ isRoot: true });
  });

  test("refuses the 101st of a kind: the pages read the whole list", async () => {
    expect(await createRefusal(buildService(100), createBy({}))).toBe(
      PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.tooMany,
    );
    expect(await createRefusal(buildService(250), createBy({}))).toBe(
      PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.tooMany,
    );
  });

  test("counts in the caller's project when the row names none yet", async () => {
    const harness: Harness = buildService();

    await harness.internals.onBeforeCreate(createBy({ projectId: undefined }));

    const count: JSONObject = harness.countBy.mock.calls[0]![0] as JSONObject;

    expect(
      ((count["query"] as JSONObject)["projectId"] as ObjectID).toString(),
    ).toBe(PROJECT_ID.toString());
  });
});

describe("changing a saved funnel or retention table", () => {
  test("a rename is checked as a name, and reads no rows", async () => {
    const harness: Harness = buildService();
    const request: UpdateBy<Model> = updateBy({ name: "  Weekly return  " });

    const result: OnUpdate<Model> =
      await harness.internals.onBeforeUpdate(request);

    expect((result.updateBy.data as JSONObject)["name"]).toBe("Weekly return");
    expect(harness.rowsOfUpdate.mock.calls).toHaveLength(0);

    expect(await updateRefusal(buildService(), updateBy({ name: "  " }))).toBe(
      PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.name,
    );
    expect(
      await updateRefusal(buildService(), updateBy({ name: "x".repeat(101) })),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.nameTooLong);
  });

  test("a new definition is read as the kind the saved view is, from the rows the update writes", async () => {
    const harness: Harness = buildService();

    harness.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Retention),
    ] as never);

    const request: UpdateBy<Model> = updateBy({
      definition: {
        ...RETENTION,
        period: ProductAnalyticsRetentionPeriod.Month,
        cohorts: "not kept",
      },
    });
    const result: OnUpdate<Model> =
      await harness.internals.onBeforeUpdate(request);

    expect((result.updateBy.data as JSONObject)["definition"]).toEqual({
      ...RETENTION,
      period: ProductAnalyticsRetentionPeriod.Month,
    });

    // Read and held: the rows checked are the rows written.
    expect(harness.rowsOfUpdate.mock.calls).toHaveLength(1);
    expect(harness.rowsOfUpdate.mock.calls[0]![0]).toBe(request);
    expect(harness.rowsOfUpdate.mock.calls[0]![1]).toEqual({
      _id: true,
      viewType: true,
    });
  });

  test("refuses a definition of the other kind, or one the reads refuse", async () => {
    const funnelRow: Harness = buildService();

    funnelRow.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Funnel),
    ] as never);

    expect(
      await updateRefusal(funnelRow, updateBy({ definition: RETENTION })),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps);

    const retentionRow: Harness = buildService();

    retentionRow.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Retention),
    ] as never);

    expect(
      await updateRefusal(
        retentionRow,
        updateBy({ definition: { ...RETENTION, period: "year" } }),
      ),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.period);
  });

  test("refuses taking the definition away", async () => {
    expect(
      await updateRefusal(buildService(), updateBy({ definition: null })),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.definition);
  });

  test("a saved funnel stays a funnel: an update may name the kind each row is, and no other", async () => {
    const harness: Harness = buildService();

    harness.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Funnel),
    ] as never);

    expect(
      await updateRefusal(
        harness,
        updateBy({
          viewType: ProductAnalyticsSavedViewType.Retention,
          definition: RETENTION,
        }),
      ),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewTypeFixed);

    const same: Harness = buildService();

    same.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Funnel),
    ] as never);

    const result: OnUpdate<Model> = await same.internals.onBeforeUpdate(
      updateBy({ viewType: ProductAnalyticsSavedViewType.Funnel }),
    );

    expect((result.updateBy.data as JSONObject)["viewType"]).toBe(
      ProductAnalyticsSavedViewType.Funnel,
    );
  });

  test("one definition is not written over funnels and retention tables at once", async () => {
    const harness: Harness = buildService();

    harness.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Funnel),
      savedRow(ProductAnalyticsSavedViewType.Retention),
    ] as never);

    expect(await updateRefusal(harness, updateBy({ definition: FUNNEL }))).toBe(
      PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.oneKindAtATime,
    );
  });

  test("several funnels at once take one funnel's definition", async () => {
    const harness: Harness = buildService();

    harness.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Funnel),
      savedRow(ProductAnalyticsSavedViewType.Funnel),
    ] as never);

    const result: OnUpdate<Model> = await harness.internals.onBeforeUpdate(
      updateBy({ definition: { steps: FUNNEL["steps"] } }),
    );

    expect((result.updateBy.data as JSONObject)["definition"]).toEqual({
      steps: FUNNEL["steps"],
      windowMs: DAY_MS,
      filters: [],
    });
  });

  test("an update that reaches no row writes nothing, and is not refused", async () => {
    const harness: Harness = buildService();

    await expect(
      harness.internals.onBeforeUpdate(updateBy({ definition: FUNNEL })),
    ).resolves.toBeDefined();
    expect(harness.rowsOfUpdate.mock.calls).toHaveLength(1);
  });
});

/*
 * Saved under another project's application, a view would show that
 * application's name back through the relation, which a read joins without
 * asking whose it is. So the application is the project's own, whichever of
 * its two names a write uses, and another project's is answered exactly as
 * one that does not exist - before anything else the create reads.
 */
describe("the RUM application a saved view reads is its project's own", () => {
  test("another project's is refused, naming it, before the name, the definition or the count", async () => {
    const harness: Harness = buildService();

    const thrown: unknown = await refusalOf(
      harness.internals.onBeforeCreate(
        createBy({
          rumApplicationId: FOREIGN_APPLICATION_ID,
          name: "  ",
          definition: undefined,
        }),
      ),
    );

    expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
    expect((thrown as Error).message).toBe(
      notInProject(FOREIGN_APPLICATION_ID),
    );
    expect(harness.countBy.mock.calls).toHaveLength(0);
  });

  test("named by the relation alone, another project's is refused all the same", async () => {
    const harness: Harness = buildService();

    const thrown: unknown = await refusalOf(
      harness.internals.onBeforeCreate(
        createBy({
          rumApplicationId: undefined,
          rumApplication: { _id: FOREIGN_APPLICATION_ID.toString() },
        }),
      ),
    );

    expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
    expect((thrown as Error).message).toBe(
      notInProject(FOREIGN_APPLICATION_ID),
    );
    expect(harness.countBy.mock.calls).toHaveLength(0);
  });

  test("one that does not exist is answered word for word as another project's", async () => {
    const foreign: unknown = await refusalOf(
      buildService().internals.onBeforeCreate(
        createBy({ rumApplicationId: FOREIGN_APPLICATION_ID }),
      ),
    );
    const missing: unknown = await refusalOf(
      buildService().internals.onBeforeCreate(
        createBy({ rumApplicationId: MISSING_APPLICATION_ID }),
      ),
    );

    expect(foreign).toBeInstanceOf(ProjectScopedReferenceException);
    expect(missing).toBeInstanceOf(ProjectScopedReferenceException);
    expect((foreign as Error).message).toBe(
      notInProject(FOREIGN_APPLICATION_ID),
    );
    expect((missing as Error).message).toBe(
      notInProject(MISSING_APPLICATION_ID),
    );
  });

  test("OneUptime's own creates, in the project or with none on the request, are held to the project too", async () => {
    const rootWrites: Array<DatabaseCommonInteractionProps> = [
      { isRoot: true, tenantId: PROJECT_ID },
      { isRoot: true },
    ];

    for (const props of rootWrites) {
      const harness: Harness = buildService();

      const thrown: unknown = await refusalOf(
        harness.internals.onBeforeCreate(
          createBy({ rumApplicationId: FOREIGN_APPLICATION_ID }, props),
        ),
      );

      expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
      expect(harness.countBy.mock.calls).toHaveLength(0);
    }
  });

  test("an update that points a saved view at another project's application is refused, a teammate's or OneUptime's own", async () => {
    const teammate: Harness = buildService();

    const byTeammate: unknown = await refusalOf(
      teammate.internals.onBeforeUpdate(
        updateBy({ rumApplicationId: FOREIGN_APPLICATION_ID }),
      ),
    );

    expect(byTeammate).toBeInstanceOf(ProjectScopedReferenceException);
    expect((byTeammate as Error).message).toBe(
      notInProject(FOREIGN_APPLICATION_ID),
    );

    // A row of the project, saved under one of the project's applications.
    const server: Harness = buildService();
    const row: Model = new Model(SAVED_VIEW_ID);

    row.projectId = PROJECT_ID;
    row.rumApplication = new RumApplication(APPLICATION_ID);
    server.rowsOfUpdate.mockResolvedValue([row] as never);

    const byServer: unknown = await refusalOf(
      server.internals.onBeforeUpdate(
        updateBy(
          { rumApplicationId: FOREIGN_APPLICATION_ID },
          { isRoot: true },
        ),
      ),
    );

    expect(byServer).toBeInstanceOf(ProjectScopedReferenceException);
    expect((byServer as Error).message).toBe(
      notInProject(FOREIGN_APPLICATION_ID),
    );
  });

  test("a rename or a new definition names no application, and looks nothing up", async () => {
    const harness: Harness = buildService();

    harness.rowsOfUpdate.mockResolvedValue([
      savedRow(ProductAnalyticsSavedViewType.Funnel),
    ] as never);

    await harness.internals.onBeforeUpdate(
      updateBy({ name: "Weekly return", definition: FUNNEL }),
    );

    expect(directory.recordLookups).toEqual([]);
  });
});
