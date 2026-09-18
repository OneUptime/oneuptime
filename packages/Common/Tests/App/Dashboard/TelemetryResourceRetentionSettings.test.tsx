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
import CloudSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import RumSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import ServerlessSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Settings";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryRetentionConfig from "../../../Types/Telemetry/TelemetryRetentionConfig";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * These are integration tests for the Settings surfaces, not a source-text
 * inventory. They render each real page on its real route and keep the real
 * CardModelDetail -> ModelForm -> BasicForm stack. Only transport,
 * permissions and the unrelated archive card are replaced.
 *
 * That distinction matters for retention. A field can be present in JSX yet
 * still update the wrong resource, disappear after permission filtering,
 * accept zero days, lose a CustomComponent value before submit, or display a
 * shape that is different from the one the API persists. Each of those bugs
 * can turn into either unexpected data loss or data kept longer than the
 * customer selected.
 */

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
  {
    name: "cloud resource",
    Page: CloudSettings,
    modelType: CloudResource,
    settingsKey: PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
    detailIdPrefix: "cloud-resource",
    hasSessionReplayRetention: false,
  },
  {
    name: "serverless function",
    Page: ServerlessSettings,
    modelType: ServerlessFunction,
    settingsKey: PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS,
    detailIdPrefix: "serverless-function",
    hasSessionReplayRetention: false,
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
    { name: "Telemetry Data Retention" },
    { timeout: WAIT_TIMEOUT },
  );
  await screen.findByRole(
    "heading",
    { name: "Retention by Telemetry Type" },
    { timeout: WAIT_TIMEOUT },
  );
  await waitFor(
    () => {
      expect(
        document.getElementById(
          `${resource.detailIdPrefix}-telemetry-retention`,
        ),
      ).toBeInTheDocument();
      expect(
        document.getElementById(
          `${resource.detailIdPrefix}-telemetry-retention-overrides`,
        ),
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

describe.each(RESOURCES)(
  "$name telemetry-retention Settings",
  (resource: ResourceSettingsCase) => {
    test("binds both cards to the routed resource and exposes replay retention only where supported", async () => {
      await renderSettings(resource, modelFor(resource));

      expect(
        document.getElementById(
          `${resource.detailIdPrefix}-telemetry-retention`,
        ),
      ).toBeInTheDocument();
      expect(
        document.getElementById(
          `${resource.detailIdPrefix}-telemetry-retention-overrides`,
        ),
      ).toBeInTheDocument();

      expectReadFor(resource, "retainTelemetryDataForDays");
      expectReadFor(resource, "telemetryRetentionConfig");

      if (resource.hasSessionReplayRetention) {
        expect(
          await screen.findByRole("heading", {
            name: "Session Replay Retention",
          }),
        ).toBeInTheDocument();
        expect(
          document.getElementById("rum-application-session-replay-retention"),
        ).toBeInTheDocument();
        expectReadFor(resource, "sessionReplayRetentionInDays");
      } else {
        expect(
          screen.queryByRole("heading", {
            name: "Session Replay Retention",
          }),
        ).not.toBeInTheDocument();
        expect(callsSelecting("sessionReplayRetentionInDays")).toHaveLength(0);
      }
    });

    test("rejects a zero-day default and persists a valid default on the correct model", async () => {
      const user: UserEvent = await renderSettings(
        resource,
        modelFor(resource, { retainTelemetryDataForDays: 30 }),
      );

      /*
       * The RUM page mounts three independent detail cards. Wait for this
       * card's own read to settle before opening its editor so the test
       * exercises the loaded page state, not the brief mount-time shell.
       */
      await waitFor(
        () => {
          expect(
            document.getElementById(
              `${resource.detailIdPrefix}-telemetry-retention`,
            ),
          ).toHaveTextContent("30");
        },
        { timeout: WAIT_TIMEOUT },
      );

      const readsBeforeEdit: number = itemReadObservations.length;
      const dialog: HTMLElement = await openEditor(
        resource,
        user,
        "Edit Retention",
      );
      const modalRead: ItemReadObservation = await waitFor(
        () => {
          const observation: ItemReadObservation | undefined =
            itemReadObservations
              .slice(readsBeforeEdit)
              .find((entry: ItemReadObservation): boolean => {
                return (
                  entry.request.select?.["retainTelemetryDataForDays"] ===
                    true && entry.request.select?.["_id"] !== true
                );
              });

          expect(observation).toBeDefined();
          return observation as ItemReadObservation;
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(modalRead.request.select).toEqual({
        retainTelemetryDataForDays: true,
      });
      expect(modalRead.request.modelType).toBe(resource.modelType);
      expect(modalRead.request.id.toString()).toBe(MODEL_ID.toString());
      expect(modalRead.returnedModel).toBeInstanceOf(resource.modelType);
      expect(modalRead.returnedRetentionInDays).toBe(30);

      await waitFor(
        () => {
          expect(
            within(editDialog(resource)).getByRole("spinbutton", {
              name: /^Retain Telemetry Data For \(Days\)/,
            }),
          ).toHaveValue(30);
        },
        { timeout: WAIT_TIMEOUT },
      );
      const input: HTMLElement = within(dialog).getByRole("spinbutton", {
        name: /^Retain Telemetry Data For \(Days\)/,
      });

      await user.clear(input);
      await user.type(input, "0");
      await user.click(
        within(dialog).getByRole("button", { name: "Save Changes" }),
      );

      expect(
        await within(dialog).findByText(
          "Retain Telemetry Data For (Days) should not be less than 1.",
        ),
      ).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();

      await user.clear(input);
      await user.type(input, "45");
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
      const submitted: BaseModel & {
        retainTelemetryDataForDays?: number | undefined;
      } = submittedModel();

      expect(request.modelType).toBe(resource.modelType);
      expect(submitted).toBeInstanceOf(resource.modelType);
      expect(submitted._id).toBe(MODEL_ID.toString());
      expect(submitted.retainTelemetryDataForDays).toBe(45);

      await waitFor(
        () => {
          expect(
            document.getElementById(
              `${resource.detailIdPrefix}-telemetry-retention`,
            ),
          ).toHaveTextContent("45");
        },
        { timeout: WAIT_TIMEOUT },
      );
    });
  },
);

describe("per-telemetry-type retention editor", () => {
  const resource: ResourceSettingsCase<CloudResource> =
    RESOURCES[1] as ResourceSettingsCase<CloudResource>;

  const configured: TelemetryRetentionConfig = {
    logs: {
      default: 30,
      bySeverity: { [LogSeverity.Error]: 90 },
    },
    traces: {
      default: 14,
      byStatus: { [SpanStatus.Error]: 60 },
    },
    metrics: { default: 15 },
    profiles: { default: 7 },
  };

  test("renders every pillar and its specific overrides in the summary", async () => {
    await renderSettings(
      resource,
      modelFor(resource, { telemetryRetentionConfig: configured }),
    );

    const detail: HTMLElement = document.getElementById(
      "cloud-resource-telemetry-retention-overrides",
    ) as HTMLElement;

    const expected: Array<{
      name: string;
      defaultDays: number;
      specific?: string | undefined;
    }> = [
      { name: "Logs", defaultDays: 30, specific: "90 days" },
      { name: "Traces", defaultDays: 14, specific: "60 days" },
      { name: "Metrics", defaultDays: 15 },
      { name: "Profiles", defaultDays: 7 },
    ];

    for (const pillar of expected) {
      const heading: HTMLElement = within(detail).getByRole("heading", {
        name: pillar.name,
      });
      const card: HTMLElement = heading.closest(".rounded-lg") as HTMLElement;

      expect(card).toHaveTextContent(`${pillar.defaultDays} days`);
      expect(card).toHaveTextContent("Custom");
      if (pillar.specific) {
        expect(card).toHaveTextContent("Specific overrides");
        expect(card).toHaveTextContent(pillar.specific);
      }
    }

    expect(
      within(
        within(detail)
          .getByRole("heading", { name: "Logs" })
          .closest(".rounded-lg") as HTMLElement,
      ).getByText("Error"),
    ).toBeInTheDocument();
    expect(
      within(
        within(detail)
          .getByRole("heading", { name: "Traces" })
          .closest(".rounded-lg") as HTMLElement,
      ).getByText("Error"),
    ).toBeInTheDocument();
  });

  test("loads the stored shape into the real form and collapses fully-cleared overrides to null", async () => {
    const user: UserEvent = await renderSettings(
      resource,
      modelFor(resource, { telemetryRetentionConfig: configured }),
    );
    const dialog: HTMLElement = await openEditor(
      resource,
      user,
      "Edit Overrides",
    );

    await waitFor(
      () => {
        const inputs: Array<HTMLElement> = within(
          editDialog(resource),
        ).getAllByPlaceholderText("Use default retention");
        expect(inputs).toHaveLength(4);
        expect(inputs[0]).toHaveValue(30);
        expect(inputs[1]).toHaveValue(14);
        expect(inputs[2]).toHaveValue(15);
        expect(inputs[3]).toHaveValue(7);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const pillarInputs: Array<HTMLElement> = within(
      dialog,
    ).getAllByPlaceholderText("Use default retention");
    const severityInputs: Array<HTMLElement> =
      within(dialog).getAllByPlaceholderText("Use logs default");
    const statusInputs: Array<HTMLElement> =
      within(dialog).getAllByPlaceholderText("Use traces default");

    expect(pillarInputs).toHaveLength(4);
    expect(severityInputs).toHaveLength(7);
    expect(severityInputs[1]).toHaveValue(90);
    expect(statusInputs).toHaveLength(3);
    expect(statusInputs[0]).toHaveValue(60);

    /* Fatal precedes Error; trace statuses begin with Error. */
    fireEvent.change(severityInputs[1] as HTMLElement, {
      target: { value: "" },
    });
    fireEvent.change(statusInputs[0] as HTMLElement, {
      target: { value: "" },
    });
    for (const input of pillarInputs) {
      fireEvent.change(input, { target: { value: "" } });
    }

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: CloudResource = submittedModel<CloudResource>();
    expect(submitted._id).toBe(MODEL_ID.toString());
    expect(submitted.telemetryRetentionConfig).toBeNull();

    await waitFor(
      () => {
        const refreshedDetail: HTMLElement = document.getElementById(
          "cloud-resource-telemetry-retention-overrides",
        ) as HTMLElement;
        expect(
          within(refreshedDetail).getByText("No overrides set."),
        ).toBeVisible();
      },
      { timeout: WAIT_TIMEOUT },
    );
    const detail: HTMLElement = document.getElementById(
      "cloud-resource-telemetry-retention-overrides",
    ) as HTMLElement;
    expect(within(detail).getAllByText("Default")).toHaveLength(4);
    expect(within(detail).getAllByText(/Uses default/)).toHaveLength(4);
  });
});

describe("RUM session replay retention", () => {
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
