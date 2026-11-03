import LogSavedViewService from "../../../Server/Services/LogSavedViewService";
import MetricSavedViewService from "../../../Server/Services/MetricSavedViewService";
import TraceSavedViewService from "../../../Server/Services/TraceSavedViewService";
import ExceptionSavedViewService from "../../../Server/Services/ExceptionSavedViewService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import TraceSavedView from "../../../Models/DatabaseModels/TraceSavedView";
import ExceptionSavedView from "../../../Models/DatabaseModels/ExceptionSavedView";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import {
  EXPLORER_SAVED_VIEW_SCOPE,
  SavedViewScopeKind,
  buildSavedViewScope,
} from "../../../Utils/Telemetry/SavedViewScope";
import { afterEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Telemetry saved views (logs, traces and metrics) each promise a project
 * exactly one default: the first view a project saves becomes its default, and
 * marking another one default clears whichever view held it. Three services
 * carry the same hooks, so the suite runs against all three -- a change made
 * to one of them and not the others shows up here rather than as a project
 * whose telemetry page opens two default views, or none.
 *
 * onBeforeCreate only decides the new view's flag. Clearing the other views
 * happens once the view is saved (onCreateSuccess) or the update has been
 * made (onUpdateSuccess), so a create or update that is refused or fails
 * changes no other view. The whole create and update, permission checks
 * included, is driven in ProjectDefaultRowWrites.test.ts.
 *
 * A saved log view is the default of the page it was saved on rather than of
 * the whole project (issue #5549): the Logs page has a default, and so has
 * each resource's Logs tab. The views with no scope are the Logs page's, so
 * the cases below - none of which has a scope - read for logs as they always
 * did, with the Logs page's condition (IS NULL) beside the project's; the
 * pages are driven at the end.
 */

type SavedViewModel =
  | LogSavedView
  | MetricSavedView
  | TraceSavedView
  | ExceptionSavedView;

/*
 * The hooks under test, reached past `protected`. Typed over the union of the
 * three models so one set of cases can drive all three services.
 */
type SavedViewService = {
  onBeforeCreate: (
    createBy: CreateBy<SavedViewModel>,
  ) => Promise<OnCreate<SavedViewModel>>;
  onCreateSuccess: (
    onCreate: OnCreate<SavedViewModel>,
    createdItem: SavedViewModel,
  ) => Promise<SavedViewModel>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<SavedViewModel>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<SavedViewModel>>;
};

type ServiceCase = {
  label: string;
  service: SavedViewService;
  buildModel: () => SavedViewModel;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const VIEW_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SECOND_VIEW_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const cases: Array<ServiceCase> = [
  {
    label: "LogSavedViewService",
    service: LogSavedViewService as unknown as SavedViewService,
    buildModel: (): SavedViewModel => {
      return new LogSavedView();
    },
  },
  {
    label: "TraceSavedViewService",
    service: TraceSavedViewService as unknown as SavedViewService,
    buildModel: (): SavedViewModel => {
      return new TraceSavedView();
    },
  },
  {
    label: "MetricSavedViewService",
    service: MetricSavedViewService as unknown as SavedViewService,
    buildModel: (): SavedViewModel => {
      return new MetricSavedView();
    },
  },
  // The exceptions list keeps its views apart from the traces explorer.
  {
    label: "ExceptionSavedViewService",
    service: ExceptionSavedViewService as unknown as SavedViewService,
    buildModel: (): SavedViewModel => {
      return new ExceptionSavedView();
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

const LOG_SERVICE_LABEL: string = "LogSavedViewService";

// The SQL of a Raw condition such as QueryHelper.isNull(), read for alias "c".
function sqlOf(condition: unknown): string {
  expect(condition).toBeInstanceOf(FindOperator);

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return operator.getSql ? operator.getSql("c") : "";
}

describe.each(cases)(
  "$label default-view hooks",
  ({ label, service, buildModel }: ServiceCase) => {
    function mockFindOneBy(existing: SavedViewModel | null): jest.SpyInstance {
      return jest
        .spyOn(service as never, "findOneBy")
        .mockResolvedValue(existing as never);
    }

    function mockFindBy(items: Array<SavedViewModel>): jest.SpyInstance {
      return jest
        .spyOn(service as never, "findBy")
        .mockResolvedValue(items as never);
    }

    function mockUpdateBy(): jest.SpyInstance {
      return jest
        .spyOn(service as never, "updateBy")
        .mockResolvedValue(undefined as never);
    }

    function view(
      id: ObjectID | null,
      projectId: ObjectID | null,
      isDefault?: boolean,
    ): SavedViewModel {
      const item: SavedViewModel = buildModel();

      if (id) {
        item._id = id.toString();
      }

      if (projectId) {
        item.projectId = projectId;
      }

      if (isDefault !== undefined) {
        item.isDefault = isDefault;
      }

      return item;
    }

    // The one sweep that clears the other default views of a project.
    function expectSweep(
      call: Array<unknown> | undefined,
      projectId: ObjectID,
      keepIds: Array<ObjectID>,
    ): void {
      const updateArgs: Record<string, unknown> = call?.[0] as Record<
        string,
        unknown
      >;
      const query: Record<string, unknown> = updateArgs["query"] as Record<
        string,
        unknown
      >;

      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect(query["isDefault"]).toBe(true);
      // The views just made the default keep it.
      for (const keepId of keepIds) {
        expect(JSON.stringify(query["_id"])).toContain(keepId.toString());
      }
      expect(updateArgs["data"]).toEqual({ isDefault: false });
      /*
       * The sweep runs as root: a member may only see their own views, and
       * leaving the others default would break the one-default promise.
       */
      expect(updateArgs["props"]).toEqual({ isRoot: true });
      /*
       * A log view with no scope is the Logs page's: only the Logs page's
       * other views give up the default. Every other kind sweeps its project.
       */
      if (label === LOG_SERVICE_LABEL) {
        expect(sqlOf(query["scope"])).toBe("(c IS NULL)");
      } else {
        expect(query).not.toHaveProperty("scope");
      }
    }

    describe("onBeforeCreate", () => {
      test("the first view a project saves becomes its default", async () => {
        mockFindOneBy(null);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view(null, PROJECT_ID),
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBe(true);
        // Decided here; no other view is changed before this one is saved.
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("a later view is not made default while one already exists", async () => {
        mockFindOneBy(view(VIEW_ID, PROJECT_ID, true));
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view(null, PROJECT_ID),
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test.each([true, false])(
        "an explicit isDefault=%s is kept, without looking, and changes nothing yet",
        async (isDefault: boolean) => {
          const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
          const updateSpy: jest.SpyInstance = mockUpdateBy();

          const result: OnCreate<SavedViewModel> = await service.onBeforeCreate(
            {
              data: view(null, PROJECT_ID, isDefault),
            } as CreateBy<SavedViewModel>,
          );

          expect(result.createBy.data.isDefault).toBe(isDefault);
          // The caller said so, so the service does not go looking.
          expect(findOneSpy).not.toHaveBeenCalled();
          expect(updateSpy).not.toHaveBeenCalled();
        },
      );

      test("a view with no project is left alone", async () => {
        const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view(null, null),
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBeUndefined();
        expect(findOneSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("the lookup for an existing default is scoped to the same project", async () => {
        const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
        mockUpdateBy();

        await service.onBeforeCreate({
          data: view(null, PROJECT_ID),
        } as CreateBy<SavedViewModel>);

        const findArgs: Record<string, unknown> = findOneSpy.mock
          .calls[0]?.[0] as Record<string, unknown>;
        const { scope, ...query } = findArgs["query"] as Record<
          string,
          unknown
        >;
        expect(query).toEqual({
          projectId: PROJECT_ID,
          isDefault: true,
        });

        // For logs, the page's: a view with no scope is the Logs page's.
        if (label === LOG_SERVICE_LABEL) {
          expect(sqlOf(scope)).toBe("(c IS NULL)");
        } else {
          expect(scope).toBeUndefined();
        }
      });
    });

    describe("onCreateSuccess", () => {
      test("a view saved as the default clears whichever view of its project held it", async () => {
        const updateSpy: jest.SpyInstance = mockUpdateBy();
        const created: SavedViewModel = view(VIEW_ID, PROJECT_ID, true);

        const result: SavedViewModel = await service.onCreateSuccess(
          { createBy: { data: created }, carryForward: null } as never,
          created,
        );

        expect(result).toBe(created);
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expectSweep(updateSpy.mock.calls[0], PROJECT_ID, [VIEW_ID]);
      });

      test("a view saved as not the default clears nothing", async () => {
        const updateSpy: jest.SpyInstance = mockUpdateBy();
        const created: SavedViewModel = view(VIEW_ID, PROJECT_ID, false);

        await service.onCreateSuccess(
          { createBy: { data: created }, carryForward: null } as never,
          created,
        );

        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("a view saved with no project clears nothing rather than sweeping globally", async () => {
        const updateSpy: jest.SpyInstance = mockUpdateBy();
        const created: SavedViewModel = view(VIEW_ID, null, true);

        await service.onCreateSuccess(
          { createBy: { data: created }, carryForward: null } as never,
          created,
        );

        expect(updateSpy).not.toHaveBeenCalled();
      });
    });

    describe("onUpdateSuccess", () => {
      function onUpdate(
        data: Partial<SavedViewModel>,
      ): OnUpdate<SavedViewModel> {
        return {
          updateBy: {
            query: { _id: VIEW_ID.toString() },
            data: data,
          } as unknown as UpdateBy<SavedViewModel>,
          carryForward: null,
        };
      }

      test("promoting a view to default demotes the others, but not itself", async () => {
        const findSpy: jest.SpyInstance = mockFindBy([
          view(VIEW_ID, PROJECT_ID),
        ]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onUpdateSuccess(onUpdate({ isDefault: true }), [VIEW_ID]);

        // The view's project is read by the id the update wrote.
        const findArgs: Record<string, unknown> = findSpy.mock
          .calls[0]?.[0] as Record<string, unknown>;
        expect(
          JSON.stringify((findArgs["query"] as Record<string, unknown>)["_id"]),
        ).toContain(VIEW_ID.toString());
        expect(findArgs["props"]).toEqual({ isRoot: true });

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expectSweep(updateSpy.mock.calls[0], PROJECT_ID, [VIEW_ID]);
      });

      test("an update that does not set isDefault=true touches nothing", async () => {
        const findSpy: jest.SpyInstance = mockFindBy([]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        for (const data of [{ name: "Renamed" }, { isDefault: false }] as Array<
          Partial<SavedViewModel>
        >) {
          await service.onUpdateSuccess(onUpdate(data), [VIEW_ID]);
        }

        expect(findSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("an update that wrote no view touches nothing", async () => {
        const findSpy: jest.SpyInstance = mockFindBy([]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onUpdateSuccess(onUpdate({ isDefault: true }), []);

        expect(findSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("a bulk promotion demotes the others in each affected project", async () => {
        mockFindBy([
          view(VIEW_ID, PROJECT_ID),
          view(SECOND_VIEW_ID, OTHER_PROJECT_ID),
        ]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onUpdateSuccess(onUpdate({ isDefault: true }), [
          VIEW_ID,
          SECOND_VIEW_ID,
        ]);

        expect(updateSpy).toHaveBeenCalledTimes(2);
        expectSweep(updateSpy.mock.calls[0], PROJECT_ID, [VIEW_ID]);
        expectSweep(updateSpy.mock.calls[1], OTHER_PROJECT_ID, [
          SECOND_VIEW_ID,
        ]);
      });

      test("a matched view with no project is skipped rather than swept globally", async () => {
        mockFindBy([view(VIEW_ID, null)]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onUpdateSuccess(onUpdate({ isDefault: true }), [VIEW_ID]);

        expect(updateSpy).not.toHaveBeenCalled();
      });
    });
  },
);

describe("the four saved-view services", () => {
  test("are distinct services over distinct models", () => {
    const models: Array<string> = cases.map(({ buildModel }: ServiceCase) => {
      return (buildModel() as BaseModel).tableName as string;
    });
    expect(new Set(models).size).toBe(4);
    expect(
      new Set([
        LogSavedViewService,
        TraceSavedViewService,
        MetricSavedViewService,
        ExceptionSavedViewService,
      ]).size,
    ).toBe(4);
  });
});

/*
 * EACH PAGE HAS A DEFAULT OF ITS OWN (issue #5549).
 *
 * A saved log view belongs to the page it was saved on, its `scope`: none for
 * the Logs page, "kubernetes-cluster:<id>" for a cluster's Logs tab. The
 * first view saved on a page becomes that page's default, and making a view
 * the default takes it from the other views of its page only - so a cluster
 * tab's default never takes the Logs page's away, nor another cluster's.
 */
describe("LogSavedViewService: a view is the default of its own page", () => {
  type LogService = SavedViewService;
  const logService: LogService =
    LogSavedViewService as unknown as SavedViewService;

  const CLUSTER_SCOPE: string = buildSavedViewScope(
    SavedViewScopeKind.KubernetesCluster,
    "7b3a4c2e-9f1d-4e8a-b5c6-1d2e3f4a5b6c",
  );
  const OTHER_CLUSTER_SCOPE: string = buildSavedViewScope(
    SavedViewScopeKind.KubernetesCluster,
    "8c4b5d3f-0a2e-4f9b-a6d7-2e3f4a5b6c7d",
  );

  function logView(data: {
    id?: ObjectID | undefined;
    projectId?: ObjectID | undefined;
    scope?: string | undefined;
    isDefault?: boolean | undefined;
  }): LogSavedView {
    const item: LogSavedView = new LogSavedView();

    if (data.id) {
      item._id = data.id.toString();
    }

    if (data.projectId) {
      item.projectId = data.projectId;
    }

    if (data.scope !== undefined) {
      item.scope = data.scope;
    }

    if (data.isDefault !== undefined) {
      item.isDefault = data.isDefault;
    }

    return item;
  }

  function lookupQuery(findOneSpy: jest.SpyInstance): Record<string, unknown> {
    return (findOneSpy.mock.calls[0]?.[0] as Record<string, unknown>)[
      "query"
    ] as Record<string, unknown>;
  }

  function sweepQuery(
    updateSpy: jest.SpyInstance,
    call: number,
  ): Record<string, unknown> {
    return (updateSpy.mock.calls[call]?.[0] as Record<string, unknown>)[
      "query"
    ] as Record<string, unknown>;
  }

  describe("onBeforeCreate", () => {
    test("the first view saved on a cluster's tab becomes that tab's default, looking at that tab only", async () => {
      const findOneSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "findOneBy")
        .mockResolvedValue(null as never);

      const result: OnCreate<SavedViewModel> = await logService.onBeforeCreate({
        data: logView({ projectId: PROJECT_ID, scope: CLUSTER_SCOPE }),
      } as CreateBy<SavedViewModel>);

      expect(result.createBy.data.isDefault).toBe(true);
      expect((result.createBy.data as LogSavedView).scope).toBe(CLUSTER_SCOPE);
      expect(lookupQuery(findOneSpy)).toEqual({
        projectId: PROJECT_ID,
        scope: CLUSTER_SCOPE,
        isDefault: true,
      });
    });

    test("a tab that already has a default keeps it: the next view saved there is not the default", async () => {
      jest.spyOn(logService as never, "findOneBy").mockResolvedValue(
        logView({
          id: VIEW_ID,
          projectId: PROJECT_ID,
          scope: CLUSTER_SCOPE,
          isDefault: true,
        }) as never,
      );

      const result: OnCreate<SavedViewModel> = await logService.onBeforeCreate({
        data: logView({ projectId: PROJECT_ID, scope: CLUSTER_SCOPE }),
      } as CreateBy<SavedViewModel>);

      expect(result.createBy.data.isDefault).toBe(false);
    });

    test.each([
      ["the Logs page's own name", EXPLORER_SAVED_VIEW_SCOPE],
      ["an empty string", ""],
      ["spaces", "   "],
    ])(
      "a view sent with %s as its scope is the Logs page's: stored with none, and looked up among the views with none",
      async (_label: string, scope: string) => {
        const findOneSpy: jest.SpyInstance = jest
          .spyOn(logService as never, "findOneBy")
          .mockResolvedValue(null as never);

        const result: OnCreate<SavedViewModel> =
          await logService.onBeforeCreate({
            data: logView({ projectId: PROJECT_ID, scope }),
          } as CreateBy<SavedViewModel>);

        const created: LogSavedView = result.createBy.data as LogSavedView;

        expect(created.scope).toBeUndefined();
        expect(Object.keys(created)).not.toContain("scope");
        expect(sqlOf(lookupQuery(findOneSpy)["scope"])).toBe("(c IS NULL)");
      },
    );

    test("a scope with spaces around it is stored, and looked up, without them", async () => {
      const findOneSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "findOneBy")
        .mockResolvedValue(null as never);

      const result: OnCreate<SavedViewModel> = await logService.onBeforeCreate({
        data: logView({ projectId: PROJECT_ID, scope: `  ${CLUSTER_SCOPE}\n` }),
      } as CreateBy<SavedViewModel>);

      expect((result.createBy.data as LogSavedView).scope).toBe(CLUSTER_SCOPE);
      expect(lookupQuery(findOneSpy)["scope"]).toBe(CLUSTER_SCOPE);
    });

    test("a view that says whether it is the default has its scope tidied all the same, without a lookup", async () => {
      const findOneSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "findOneBy")
        .mockResolvedValue(null as never);

      const explorerView: OnCreate<SavedViewModel> =
        await logService.onBeforeCreate({
          data: logView({
            projectId: PROJECT_ID,
            scope: EXPLORER_SAVED_VIEW_SCOPE,
            isDefault: true,
          }),
        } as CreateBy<SavedViewModel>);
      const clusterView: OnCreate<SavedViewModel> =
        await logService.onBeforeCreate({
          data: logView({
            projectId: PROJECT_ID,
            scope: ` ${CLUSTER_SCOPE} `,
            isDefault: false,
          }),
        } as CreateBy<SavedViewModel>);

      expect(
        (explorerView.createBy.data as LogSavedView).scope,
      ).toBeUndefined();
      expect(explorerView.createBy.data.isDefault).toBe(true);
      expect((clusterView.createBy.data as LogSavedView).scope).toBe(
        CLUSTER_SCOPE,
      );
      expect(clusterView.createBy.data.isDefault).toBe(false);
      expect(findOneSpy).not.toHaveBeenCalled();
    });
  });

  describe("onCreateSuccess", () => {
    test("a cluster tab's new default takes the default from that tab's views only", async () => {
      const updateSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);
      const created: LogSavedView = logView({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        scope: CLUSTER_SCOPE,
        isDefault: true,
      });

      await logService.onCreateSuccess(
        { createBy: { data: created }, carryForward: null } as never,
        created,
      );

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const query: Record<string, unknown> = sweepQuery(updateSpy, 0);
      expect(query["scope"]).toBe(CLUSTER_SCOPE);
      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["isDefault"]).toBe(true);
      expect(JSON.stringify(query["_id"])).toContain(VIEW_ID.toString());
    });

    test("the Logs page's new default takes it from the Logs page's views only, never a tab's", async () => {
      const updateSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);
      const created: LogSavedView = logView({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        isDefault: true,
      });

      await logService.onCreateSuccess(
        { createBy: { data: created }, carryForward: null } as never,
        created,
      );

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(sqlOf(sweepQuery(updateSpy, 0)["scope"])).toBe("(c IS NULL)");
    });
  });

  describe("onUpdateSuccess", () => {
    function onUpdate(): OnUpdate<SavedViewModel> {
      return {
        updateBy: {
          query: { _id: VIEW_ID.toString() },
          data: { isDefault: true },
        } as unknown as UpdateBy<SavedViewModel>,
        carryForward: null,
      };
    }

    test("reads each view's page with its project, as root", async () => {
      const findSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "findBy")
        .mockResolvedValue([
          logView({ id: VIEW_ID, projectId: PROJECT_ID, scope: CLUSTER_SCOPE }),
        ] as never);
      jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);

      await logService.onUpdateSuccess(onUpdate(), [VIEW_ID]);

      const findArgs: Record<string, unknown> = findSpy.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArgs["select"]).toEqual({
        _id: true,
        projectId: true,
        scope: true,
      });
      expect(findArgs["props"]).toEqual({ isRoot: true });
    });

    test("views of two pages made the default at once each keep their page's default", async () => {
      jest.spyOn(logService as never, "findBy").mockResolvedValue([
        logView({ id: VIEW_ID, projectId: PROJECT_ID, scope: CLUSTER_SCOPE }),
        logView({
          id: SECOND_VIEW_ID,
          projectId: PROJECT_ID,
          scope: OTHER_CLUSTER_SCOPE,
        }),
      ] as never);
      const updateSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);

      await logService.onUpdateSuccess(onUpdate(), [VIEW_ID, SECOND_VIEW_ID]);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(sweepQuery(updateSpy, 0)["scope"]).toBe(CLUSTER_SCOPE);
      expect(JSON.stringify(sweepQuery(updateSpy, 0)["_id"])).toContain(
        VIEW_ID.toString(),
      );
      expect(sweepQuery(updateSpy, 1)["scope"]).toBe(OTHER_CLUSTER_SCOPE);
      expect(JSON.stringify(sweepQuery(updateSpy, 1)["_id"])).toContain(
        SECOND_VIEW_ID.toString(),
      );
    });

    test("a Logs page view and a tab's view made the default at once are two pages", async () => {
      jest.spyOn(logService as never, "findBy").mockResolvedValue([
        logView({ id: VIEW_ID, projectId: PROJECT_ID }),
        logView({
          id: SECOND_VIEW_ID,
          projectId: PROJECT_ID,
          scope: CLUSTER_SCOPE,
        }),
      ] as never);
      const updateSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);

      await logService.onUpdateSuccess(onUpdate(), [VIEW_ID, SECOND_VIEW_ID]);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(sqlOf(sweepQuery(updateSpy, 0)["scope"])).toBe("(c IS NULL)");
      expect(sweepQuery(updateSpy, 1)["scope"]).toBe(CLUSTER_SCOPE);
    });

    test("two views of one page made the default at once are swept once, both kept", async () => {
      jest.spyOn(logService as never, "findBy").mockResolvedValue([
        logView({ id: VIEW_ID, projectId: PROJECT_ID, scope: CLUSTER_SCOPE }),
        logView({
          id: SECOND_VIEW_ID,
          projectId: PROJECT_ID,
          scope: CLUSTER_SCOPE,
        }),
      ] as never);
      const updateSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);

      await logService.onUpdateSuccess(onUpdate(), [VIEW_ID, SECOND_VIEW_ID]);

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const kept: string = JSON.stringify(sweepQuery(updateSpy, 0)["_id"]);
      expect(kept).toContain(VIEW_ID.toString());
      expect(kept).toContain(SECOND_VIEW_ID.toString());
    });

    test("the same page in two projects is two sweeps, each in its own project", async () => {
      jest.spyOn(logService as never, "findBy").mockResolvedValue([
        logView({ id: VIEW_ID, projectId: PROJECT_ID, scope: CLUSTER_SCOPE }),
        logView({
          id: SECOND_VIEW_ID,
          projectId: OTHER_PROJECT_ID,
          scope: CLUSTER_SCOPE,
        }),
      ] as never);
      const updateSpy: jest.SpyInstance = jest
        .spyOn(logService as never, "updateBy")
        .mockResolvedValue(undefined as never);

      await logService.onUpdateSuccess(onUpdate(), [VIEW_ID, SECOND_VIEW_ID]);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(
        (sweepQuery(updateSpy, 0)["projectId"] as ObjectID).toString(),
      ).toBe(PROJECT_ID.toString());
      expect(
        (sweepQuery(updateSpy, 1)["projectId"] as ObjectID).toString(),
      ).toBe(OTHER_PROJECT_ID.toString());
    });
  });
});

/*
 * The traces, metrics and exceptions explorers keep their saved views to the
 * explorer itself (a resource's Traces tab offers none), so each of them
 * still has one default for the whole project: their sweeps name no page.
 */
describe.each(
  cases.filter(({ label }: ServiceCase): boolean => {
    return label !== LOG_SERVICE_LABEL;
  }),
)(
  "$label keeps one default for the whole project",
  ({ service, buildModel }: ServiceCase) => {
    test("its update reads only each view's id and project", async () => {
      const view: SavedViewModel = buildModel();
      view._id = VIEW_ID.toString();
      view.projectId = PROJECT_ID;

      const findSpy: jest.SpyInstance = jest
        .spyOn(service as never, "findBy")
        .mockResolvedValue([view] as never);
      jest
        .spyOn(service as never, "updateBy")
        .mockResolvedValue(undefined as never);

      await service.onUpdateSuccess(
        {
          updateBy: {
            query: { _id: VIEW_ID.toString() },
            data: { isDefault: true },
          } as unknown as UpdateBy<SavedViewModel>,
          carryForward: null,
        },
        [VIEW_ID],
      );

      expect(
        (findSpy.mock.calls[0]?.[0] as Record<string, unknown>)["select"],
      ).toEqual({ _id: true, projectId: true });
    });
  },
);
