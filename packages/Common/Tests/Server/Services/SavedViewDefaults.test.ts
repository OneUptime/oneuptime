import LogSavedViewService from "../../../Server/Services/LogSavedViewService";
import MetricSavedViewService from "../../../Server/Services/MetricSavedViewService";
import TraceSavedViewService from "../../../Server/Services/TraceSavedViewService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import TraceSavedView from "../../../Models/DatabaseModels/TraceSavedView";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

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
 */

type SavedViewModel = LogSavedView | MetricSavedView | TraceSavedView;

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
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(cases)(
  "$label default-view hooks",
  ({ service, buildModel }: ServiceCase) => {
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

          const result: OnCreate<SavedViewModel> =
            await service.onBeforeCreate({
              data: view(null, PROJECT_ID, isDefault),
            } as CreateBy<SavedViewModel>);

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
        expect(findArgs["query"]).toEqual({
          projectId: PROJECT_ID,
          isDefault: true,
        });
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

        await service.onUpdateSuccess(onUpdate({ isDefault: true }), [
          VIEW_ID,
        ]);

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

        await service.onUpdateSuccess(onUpdate({ isDefault: true }), [
          VIEW_ID,
        ]);

        expect(updateSpy).not.toHaveBeenCalled();
      });
    });
  },
);

describe("the three saved-view services", () => {
  test("are distinct services over distinct models", () => {
    const models: Array<string> = cases.map(({ buildModel }: ServiceCase) => {
      return (buildModel() as BaseModel).tableName as string;
    });
    expect(new Set(models).size).toBe(3);
    expect(
      new Set([
        LogSavedViewService,
        TraceSavedViewService,
        MetricSavedViewService,
      ]).size,
    ).toBe(3);
  });
});
