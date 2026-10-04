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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Scheduling maintenance suggests the status pages that show the affected
 * monitors, one click to add.
 *
 * Create Scheduled Maintenance Event is drawn for real - ModelForm,
 * BasicForm, the status page picker and the suggestions under it - with
 * only the network, the clock and the signed-in user stubbed. An event
 * started from a template that names a monitor:
 *
 *   - on Resources Affected, under "Show event on these status pages", the
 *     page that shows that monitor is suggested;
 *   - nothing is picked by itself: created as it is, the event is on no
 *     status page (#4291's rule: picking a page publishes the event there
 *     and tells its subscribers, so it takes a click);
 *   - one click puts the page in the picker, the suggestion goes, and the
 *     event is created on that page.
 *
 * The template forms are checked through their field list: the create form
 * suggests from its own monitors, and the template page's Edit - which
 * leaves the resources to their own card - from the template's.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

import ScheduledMaintenanceCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  getFormSteps,
  getTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";
import StatusPageSuggestions, {
  RecordStatusPageSuggestions,
  RecordStatusPageSuggestionsProps,
  StatusPageSuggestionsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSuggestions";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors from "../../../Types/StatusPage/StatusPagesListingMonitors";
import Timezone from "../../../Types/Timezone";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const NOW: Date = new Date("2026-10-03T09:20:00.000Z");
const TEMPLATE_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_ID: string = "33333333-3333-4333-8333-333333333333";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    "/dashboard/project/scheduled-maintenance-events/create",
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

let templateIdInUrl: string | null = null;
let postMock: MockFunction;

function listOf<T extends BaseModel>(
  items: Array<T>,
): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: items, count: items.length, skip: 0, limit: 100 };
}

function makeStatusPage(): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  statusPage.name = "Acme Public Status";
  return statusPage;
}

function makeTemplate(): ScheduledMaintenanceTemplate {
  const template: ScheduledMaintenanceTemplate =
    new ScheduledMaintenanceTemplate();
  template._id = TEMPLATE_ID;
  template.title = "Checkout API upgrade";

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = "Checkout API";
  template.monitors = [monitor];

  return template;
}

function form(): HTMLElement {
  return document.getElementById("create-scheduledMaintenance-form")!;
}

function currentStepTitle(): string {
  const current: Element | null = screen
    .getByRole("navigation", { name: "Progress" })
    .querySelector("[aria-current='step']");

  return (current?.textContent || "").trim();
}

function createButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Create Scheduled Maintenance Event",
  });
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <ScheduledMaintenanceCreate {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await screen.findByRole("navigation", { name: "Progress" });
  // The defaults land once the form has its fields.
  await waitFor(() => {
    expect(form().querySelector("input[type='datetime-local']")).not.toBeNull();
  });
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function goToResourcesAffected(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  await waitFor(() => {
    expect(currentStepTitle()).toBe("Resources Affected");
  });
}

function createdModel(): ScheduledMaintenance {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  const call: Array<unknown> = createOrUpdateMock.mock
    .calls[0] as Array<unknown>;

  return (call[0] as { model: ScheduledMaintenance }).model;
}

function statusPageIdsOf(model: ScheduledMaintenance): Array<string> {
  return (model.statusPages || []).map((statusPage: StatusPage): string => {
    return (statusPage._id || statusPage.id?.toString() || "").toString();
  });
}

beforeEach(() => {
  templateIdInUrl = null;
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return name === "scheduledMaintenanceTemplateId" ? templateIdInUrl : null;
    });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  getListMock.mockImplementation(
    async (args: unknown): Promise<ReturnType<typeof listOf>> => {
      const modelType: DatabaseBaseModelType = (
        args as { modelType: DatabaseBaseModelType }
      ).modelType;

      if (modelType === StatusPage) {
        return listOf([makeStatusPage()]);
      }

      return listOf([]);
    },
  );

  getItemMock.mockImplementation(async (): Promise<BaseModel | null> => {
    return makeTemplate();
  });

  createOrUpdateMock.mockImplementation(
    async (data: unknown): Promise<{ data: Record<string, unknown> }> => {
      return {
        data: {
          ...BaseModel.toJSON(
            (data as { model: ScheduledMaintenance }).model,
            ScheduledMaintenance,
          ),
          _id: "55555555-5555-4555-8555-555555555555",
        },
      };
    },
  );

  // The status pages that show the monitors: one, Acme Public Status.
  postMock = getJestMockFunction();
  postMock.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      StatusPagesListingMonitors.toJSON({
        statusPages: [
          { statusPageId: STATUS_PAGE_ID, name: "Acme Public Status" },
        ],
      }),
      {},
    );
  });
  jest.spyOn(API, "post").mockImplementation(postMock as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("Create Scheduled Maintenance Event suggests the status pages that show the affected monitors", () => {
  test("names the page that shows the template's monitor under the status page picker, and picks nothing", async () => {
    templateIdInUrl = TEMPLATE_ID;

    await renderPage();
    await goToResourcesAffected();

    const suggestions: HTMLElement = await screen.findByRole("group", {
      name: "Status pages that show the affected monitor:",
    });

    expect(
      within(suggestions).getByRole("button", {
        name: "Add Acme Public Status",
      }),
    ).toBeInTheDocument();

    // Asked about this monitor, for a maintenance event, with the tenant header.
    const request: Record<string, unknown> = postMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(String(request["url"])).toContain(
      StatusPagesListingMonitors.apiPath,
    );
    expect(request["data"]).toEqual({
      monitorIds: [MONITOR_ID],
      eventType: StatusPageEventType.ScheduledEvent,
    });
    expect(request["headers"]).toEqual({ tenantid: "project-1" });

    // The picker itself holds nothing.
    expect(
      screen.queryByRole("button", { name: "Remove Acme Public Status" }),
    ).toBeNull();

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    // Created as it was: on no status page.
    expect(statusPageIdsOf(createdModel())).toEqual([]);
  });

  test("one click puts the page in the picker, the suggestion goes, and the event is created on that page", async () => {
    templateIdInUrl = TEMPLATE_ID;

    await renderPage();
    await goToResourcesAffected();

    fireEvent.click(
      await screen.findByRole("button", { name: "Add Acme Public Status" }),
    );

    // The picker shows the page, as if it had been picked in it.
    expect(
      await screen.findByRole("button", { name: "Remove Acme Public Status" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("status-page-suggestions-line")).toBeNull();
    expect(
      screen.getByTestId("status-page-suggestions-status"),
    ).toHaveTextContent("Added Acme Public Status to the status pages.");

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(statusPageIdsOf(createdModel())).toEqual([STATUS_PAGE_ID]);
  });

  test("with no monitor affected, nothing is asked and nothing is suggested", async () => {
    await renderPage();

    const title: HTMLInputElement = within(form()).getByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement;

    fireEvent.change(title, { target: { value: "Database upgrade" } });
    await act(async () => {});

    await goToResourcesAffected();

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 600);
      });
    });

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("status-page-suggestions-line")).toBeNull();
  });
});

describe("the scheduled maintenance template forms suggest the same way", () => {
  type TemplateField = ModelField<ScheduledMaintenanceTemplate>;

  function statusPagesField(fields: Array<TemplateField>): TemplateField {
    const field: TemplateField | undefined = fields.find(
      (candidate: TemplateField): boolean => {
        return Object.keys(candidate.field || {})[0] === "statusPages";
      },
    );

    expect(field).toBeDefined();
    expect(field!.getFooterElement).toBeDefined();

    return field!;
  }

  test("the template's create form suggests from the monitors it is given", () => {
    const setValue: MockFunction = getJestMockFunction();

    const footer: ReactElement | undefined = statusPagesField(
      getTemplateFormFields({ isViewPage: false }),
    ).getFooterElement!(
      {
        monitors: [MONITOR_ID] as never,
        statusPages: [] as never,
      },
      undefined,
      { setValue: setValue as unknown as (value: unknown) => void },
    );

    expect(footer!.type).toBe(StatusPageSuggestions);

    const props: StatusPageSuggestionsProps = footer!
      .props as StatusPageSuggestionsProps;

    expect(props.monitorIds).toEqual([MONITOR_ID]);
    expect(props.eventType).toBe(StatusPageEventType.ScheduledEvent);

    props.onChange([STATUS_PAGE_ID]);
    expect(setValue).toHaveBeenCalledWith([STATUS_PAGE_ID]);
  });

  test("the template page's Edit, which leaves the resources to their own card, suggests from the template's monitors", () => {
    const footer: ReactElement | undefined = statusPagesField(
      getTemplateFormFields({
        isViewPage: true,
        excludeAffectedResources: true,
        templateId: new ObjectID(TEMPLATE_ID),
      }),
    ).getFooterElement!({ statusPages: [] as never }, undefined, {
      setValue: () => {},
    });

    expect(footer!.type).toBe(RecordStatusPageSuggestions);

    const props: RecordStatusPageSuggestionsProps = footer!
      .props as RecordStatusPageSuggestionsProps;

    expect(props.modelType).toBe(ScheduledMaintenanceTemplate);
    expect(props.modelId.toString()).toBe(TEMPLATE_ID);
    expect(props.eventType).toBe(StatusPageEventType.ScheduledEvent);
  });

  test("the steps are as before: the suggestions add no step and no row", () => {
    expect(
      getFormSteps({ isViewPage: false }).map(
        (step: { id: string }): string => {
          return step.id;
        },
      ),
    ).toEqual(["template-info", "event", "resources-affected", "recurring"]);
  });
});
