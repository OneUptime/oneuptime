import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import RumSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryRetentionConfig from "../../../Types/Telemetry/TelemetryRetentionConfig";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Session Replay retention on a RUM application's Settings page, rendered on
 * its real route with the real CardModelDetail -> ModelForm -> BasicForm
 * stack. Only transport, permissions and the unrelated archive card are
 * replaced.
 *
 * Session Replay retention is part of every edition, so this runs on the
 * Community Edition (the jest config resolves the Enterprise plugin to the
 * empty Community stub, and billing is pinned off). The page's retention
 * overrides are Enterprise: their shell is pinned in
 * TelemetryRetentionShells.test.tsx, and the cards themselves in
 * ee/Tests/UI/TelemetryRetention/TelemetryRetentionSettingsPages.test.tsx.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return false;
    },
  });

  return mocked;
});

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

interface ItemReadObservation {
  request: {
    modelType: unknown;
    id: ObjectID;
    select?: Record<string, unknown> | undefined;
  };
  returnedModel: BaseModel;
  returnedRetentionInDays: number | undefined;
}

const itemReadObservations: Array<ItemReadObservation> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.ProjectOwner] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/* Archiving has its own real-page suite; it is deliberately outside scope. */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="archive-resource-card" />;
      },
    };
  },
);

const MODEL_ID: ObjectID = new ObjectID("22222222-0000-4000-8000-000000000001");
const WAIT_TIMEOUT: number = 20000;

interface TelemetryRetentionResourceModel extends BaseModel {
  retainTelemetryDataForDays?: number | undefined;
  telemetryRetentionConfig?: TelemetryRetentionConfig | undefined;
}

interface ResourceSettingsCase<
  TModel extends
    TelemetryRetentionResourceModel = TelemetryRetentionResourceModel,
> {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  modelType: { new (): TModel };
  settingsKey: PageMap;
  detailIdPrefix: string;
  hasSessionReplayRetention: boolean;
}

const RESOURCES: Array<ResourceSettingsCase> = [
  {
    name: "RUM application",
    Page: RumSettings,
    modelType: RumApplication,
    settingsKey: PageMap.RUM_APPLICATION_VIEW_SETTINGS,
    detailIdPrefix: "rum-application",
    hasSessionReplayRetention: true,
  },
];

let storedModel: BaseModel;

function resourcePath(resource: ResourceSettingsCase): string {
  return RouteUtil.populateRouteParams(
    RouteMap[resource.settingsKey] as Route,
    { modelId: MODEL_ID },
  ).toString();
}

function modelFor<TModel extends TelemetryRetentionResourceModel>(
  resource: ResourceSettingsCase<TModel>,
  data?: Partial<TModel>,
): TModel {
  const model: TModel = new resource.modelType();
  model.id = MODEL_ID;
  Object.assign(model, data || {});
  return model;
}

async function renderSettings<TModel extends TelemetryRetentionResourceModel>(
  resource: ResourceSettingsCase<TModel>,
  initialModel: TModel,
): Promise<UserEvent> {
  storedModel = initialModel;
  const path: string = resourcePath(resource);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[resource.settingsKey])}
          element={
            <resource.Page
              pageRoute={RouteMap[resource.settingsKey] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole(
    "heading",
    { name: "Session Replay Retention" },
    { timeout: WAIT_TIMEOUT },
  );
  await waitFor(
    () => {
      expect(
        document.getElementById("rum-application-session-replay-retention"),
      ).toBeInTheDocument();
    },
    { timeout: WAIT_TIMEOUT },
  );

  return userEvent.setup({ delay: null });
}

function callsSelecting(field: string): Array<Array<unknown>> {
  return getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
    const request: {
      select?: Record<string, unknown> | undefined;
    } = call[0] as { select?: Record<string, unknown> | undefined };
    return request.select?.[field] === true;
  });
}

function expectReadFor(resource: ResourceSettingsCase, field: string): void {
  const calls: Array<Array<unknown>> = callsSelecting(field);
  expect(calls.length).toBeGreaterThan(0);

  for (const call of calls) {
    const request: {
      modelType: unknown;
      id: ObjectID;
    } = call[0] as {
      modelType: unknown;
      id: ObjectID;
    };

    expect(request.modelType).toBe(resource.modelType);
    expect(request.id.toString()).toBe(MODEL_ID.toString());
  }
}

function submittedModel<TModel extends BaseModel>(): TModel {
  const request: { model: TModel } = createOrUpdateMock.mock.calls[0]?.[0] as {
    model: TModel;
  };
  return request.model;
}

function editDialog(resource: ResourceSettingsCase): HTMLElement {
  const singularName: string = new resource.modelType().singularName || "item";
  return screen.getByRole("dialog", { name: `Edit ${singularName}` });
}

async function openEditor(
  resource: ResourceSettingsCase,
  user: UserEvent,
  buttonName: string,
): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole(
      "button",
      { name: buttonName },
      { timeout: WAIT_TIMEOUT },
    ),
  );

  await waitFor(
    () => {
      expect(editDialog(resource)).toBeVisible();
    },
    { timeout: WAIT_TIMEOUT },
  );

  return editDialog(resource);
}

beforeEach(() => {
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  itemReadObservations.length = 0;

  getItemMock.mockImplementation(
    async (request: ItemReadObservation["request"]): Promise<BaseModel> => {
      const returnedModel: BaseModel = storedModel;
      itemReadObservations.push({
        request,
        returnedModel,
        returnedRetentionInDays: (
          returnedModel as TelemetryRetentionResourceModel
        ).retainTelemetryDataForDays,
      });
      return returnedModel;
    },
  );

  createOrUpdateMock.mockImplementation(
    async (request: { model: BaseModel }): Promise<{ data: JSONObject }> => {
      storedModel = request.model;
      return { data: {} };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("RUM session replay retention", () => {
  test("is on the Community Edition page, next to the retention overrides upsell", async () => {
    const resource: ResourceSettingsCase = RESOURCES[0]!;

    await renderSettings(resource, modelFor(resource));

    expect(
      screen.getByRole("heading", { name: "Retention Overrides", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Retention by Telemetry Type" }),
    ).not.toBeInTheDocument();
    expect(callsSelecting("telemetryRetentionConfig")).toHaveLength(0);
    expect(callsSelecting("retainTelemetryDataForDays")).toHaveLength(0);
    expectReadFor(resource, "sessionReplayRetentionInDays");
  });

  const resource: ResourceSettingsCase<RumApplication> =
    RESOURCES[0] as ResourceSettingsCase<RumApplication>;

  test("defaults an unset policy to seven days and persists that default unchanged", async () => {
    const user: UserEvent = await renderSettings(resource, modelFor(resource));
    const detail: HTMLElement = document.getElementById(
      "rum-application-session-replay-retention",
    ) as HTMLElement;

    expect(detail).toHaveTextContent("not set (defaults to 7 days)");

    const dialog: HTMLElement = await openEditor(
      resource,
      user,
      "Edit Replay Retention",
    );

    expect(
      await within(dialog).findByText(
        "7 days (default)",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: RumApplication = submittedModel<RumApplication>();
    expect(submitted._id).toBe(MODEL_ID.toString());
    expect(submitted.sessionReplayRetentionInDays).toBe(7);
  });

  test("offers exactly the supported windows and persists the selected policy", async () => {
    const user: UserEvent = await renderSettings(
      resource,
      modelFor(resource, { sessionReplayRetentionInDays: 7 }),
    );
    const dialog: HTMLElement = await openEditor(
      resource,
      user,
      "Edit Replay Retention",
    );
    const dropdown: HTMLElement = await within(dialog).findByRole(
      "combobox",
      {
        name: /^Retain Session Replays For/,
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });

    const options: Array<HTMLElement> = await screen.findAllByRole("option");
    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(["1 day", "7 days (default)", "14 days", "30 days", "90 days"]);

    await user.click(screen.getByRole("option", { name: "30 days" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const request: { modelType: unknown } = createOrUpdateMock.mock
      .calls[0]?.[0] as { modelType: unknown };
    const submitted: RumApplication = submittedModel<RumApplication>();
    expect(request.modelType).toBe(RumApplication);
    expect(submitted._id).toBe(MODEL_ID.toString());
    expect(submitted.sessionReplayRetentionInDays).toBe(30);

    await waitFor(
      () => {
        expect(
          document.getElementById("rum-application-session-replay-retention"),
        ).toHaveTextContent("30 days");
      },
      { timeout: WAIT_TIMEOUT },
    );
  });
});
