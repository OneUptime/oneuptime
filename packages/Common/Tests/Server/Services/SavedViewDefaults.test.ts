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
 */

type SavedViewModel = LogSavedView | MetricSavedView | TraceSavedView;

/*
 * The two hooks under test, reached past `protected`. Typed over the union of
 * the three models so one set of cases can drive all three services.
 */
type SavedViewService = {
  onBeforeCreate: (
    createBy: CreateBy<SavedViewModel>,
  ) => Promise<OnCreate<SavedViewModel>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SavedViewModel>,
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
const VIEW_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

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

    describe("onBeforeCreate", () => {
      test("the first view a project saves becomes its default", async () => {
        mockFindOneBy(null);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const view: SavedViewModel = buildModel();
        view.projectId = PROJECT_ID;

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view,
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBe(true);
        /*
         * Nothing else held the default, but the sweep still runs and is a no-op
         * against an empty project.
         */
        expect(updateSpy).toHaveBeenCalledTimes(1);
      });

      test("a later view is not made default while one already exists", async () => {
        const existing: SavedViewModel = buildModel();
        existing._id = VIEW_ID.toString();
        mockFindOneBy(existing);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const view: SavedViewModel = buildModel();
        view.projectId = PROJECT_ID;

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view,
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBe(false);
        // Not default, so nothing is unset.
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("an explicit isDefault=true clears whichever view held it", async () => {
        const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const view: SavedViewModel = buildModel();
        view.projectId = PROJECT_ID;
        view.isDefault = true;

        await service.onBeforeCreate({
          data: view,
        } as CreateBy<SavedViewModel>);

        // The caller said so, so the service does not go looking.
        expect(findOneSpy).not.toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledTimes(1);
        const updateArgs: Record<string, unknown> = updateSpy.mock
          .calls[0]?.[0] as Record<string, unknown>;
        const query: Record<string, unknown> = updateArgs["query"] as Record<
          string,
          unknown
        >;
        expect(query["projectId"]).toBe(PROJECT_ID);
        expect(query["isDefault"]).toBe(true);
        expect(updateArgs["data"]).toEqual({ isDefault: false });
        /*
         * The sweep runs as root: a member may only see their own views, and
         * leaving the others default would break the one-default promise.
         */
        expect(updateArgs["props"]).toEqual({ isRoot: true });
      });

      test("an explicit isDefault=false is kept, and unsets nothing", async () => {
        const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const view: SavedViewModel = buildModel();
        view.projectId = PROJECT_ID;
        view.isDefault = false;

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view,
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBe(false);
        expect(findOneSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("a view with no project is left alone", async () => {
        const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        const view: SavedViewModel = buildModel();

        const result: OnCreate<SavedViewModel> = await service.onBeforeCreate({
          data: view,
        } as CreateBy<SavedViewModel>);

        expect(result.createBy.data.isDefault).toBeUndefined();
        expect(findOneSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("the lookup for an existing default is scoped to the same project", async () => {
        const findOneSpy: jest.SpyInstance = mockFindOneBy(null);
        mockUpdateBy();

        const view: SavedViewModel = buildModel();
        view.projectId = PROJECT_ID;

        await service.onBeforeCreate({
          data: view,
        } as CreateBy<SavedViewModel>);

        const findArgs: Record<string, unknown> = findOneSpy.mock
          .calls[0]?.[0] as Record<string, unknown>;
        expect(findArgs["query"]).toEqual({
          projectId: PROJECT_ID,
          isDefault: true,
        });
      });
    });

    describe("onBeforeUpdate", () => {
      test("promoting a view to default demotes the others, but not itself", async () => {
        const item: SavedViewModel = buildModel();
        item._id = VIEW_ID.toString();
        item.projectId = PROJECT_ID;
        mockFindBy([item]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onBeforeUpdate({
          query: { _id: VIEW_ID.toString() },
          data: { isDefault: true },
        } as unknown as UpdateBy<SavedViewModel>);

        expect(updateSpy).toHaveBeenCalledTimes(1);
        const query: Record<string, unknown> = (
          updateSpy.mock.calls[0]?.[0] as Record<string, unknown>
        )["query"] as Record<string, unknown>;
        expect(query["projectId"]).toBe(PROJECT_ID);
        expect(query["isDefault"]).toBe(true);
        /*
         * The view being promoted is excluded, so the same statement cannot
         * demote it again.
         */
        expect(query["_id"]).toBeDefined();
      });

      test("an update that does not set isDefault=true touches nothing", async () => {
        const findSpy: jest.SpyInstance = mockFindBy([]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        for (const data of [{ name: "Renamed" }, { isDefault: false }] as Array<
          Partial<SavedViewModel>
        >) {
          await service.onBeforeUpdate({
            query: { _id: VIEW_ID.toString() },
            data: data,
          } as unknown as UpdateBy<SavedViewModel>);
        }

        expect(findSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      });

      test("a bulk promotion demotes the others in each affected project", async () => {
        const otherProjectId: ObjectID = new ObjectID(
          "33333333-3333-4333-8333-333333333333",
        );
        const first: SavedViewModel = buildModel();
        first._id = VIEW_ID.toString();
        first.projectId = PROJECT_ID;
        const second: SavedViewModel = buildModel();
        second._id = "44444444-4444-4444-8444-444444444444";
        second.projectId = otherProjectId;
        mockFindBy([first, second]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onBeforeUpdate({
          query: { isDefault: false },
          data: { isDefault: true },
        } as unknown as UpdateBy<SavedViewModel>);

        expect(updateSpy).toHaveBeenCalledTimes(2);
        const projectIds: Array<unknown> = updateSpy.mock.calls.map(
          (call: Array<unknown>) => {
            return (
              (call[0] as Record<string, unknown>)["query"] as Record<
                string,
                unknown
              >
            )["projectId"];
          },
        );
        expect(projectIds).toEqual([PROJECT_ID, otherProjectId]);
      });

      test("a matched view with no project is skipped rather than swept globally", async () => {
        const orphan: SavedViewModel = buildModel();
        orphan._id = VIEW_ID.toString();
        mockFindBy([orphan]);
        const updateSpy: jest.SpyInstance = mockUpdateBy();

        await service.onBeforeUpdate({
          query: { _id: VIEW_ID.toString() },
          data: { isDefault: true },
        } as unknown as UpdateBy<SavedViewModel>);

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
