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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An announcement asks which status pages show it, as a maintenance event
 * does, and suggests the same way: once monitors are picked under Monitors
 * Affected, the pages that show them are named under the status page
 * picker, one click to add - never picked by themselves.
 *
 * Every announcement form takes its fields from AnnouncementFormFields
 * (Create, the details card Edit, and a template's Create and Edit); each
 * one's status page picker carries the suggestions, for announcements. And
 * the real Create Announcement page, opened from a template that names a
 * monitor, suggests the page that shows it and saves it once clicked.
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

import AnnouncementCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/AnnouncementCreate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { AnnouncementFormKind } from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import {
  getAnnouncementFormFields,
  getAnnouncementTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementFormFields";
import StatusPageSuggestions, {
  StatusPageSuggestionsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSuggestions";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors from "../../../Types/StatusPage/StatusPagesListingMonitors";
import Timezone from "../../../Types/Timezone";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const NOW: Date = new Date("2026-10-03T09:20:00.000Z");
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project/status-pages/announcements/create"),
  currentProject: null,
  hasPaymentMethod: true,
};

let queryInUrl: Record<string, string> = {};
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

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = "Checkout API";
  return monitor;
}

function makeTemplate(): StatusPageAnnouncementTemplate {
  const template: StatusPageAnnouncementTemplate =
    new StatusPageAnnouncementTemplate();
  template._id = TEMPLATE_ID;
  template.title = "Checkout API maintenance";
  template.description = "Checkout may be slow on Sunday.";
  template.statusPages = [];
  template.monitors = [makeMonitor()];
  return template;
}

function form(): HTMLElement {
  return document.getElementById("create-announcement-form")!;
}

function currentStepTitle(): string {
  const current: Element | null = screen
    .getByRole("navigation", { name: "Progress" })
    .querySelector("[aria-current='step']");

  return (current?.textContent || "").trim();
}

function createdModel(): StatusPageAnnouncement {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  const call: Array<unknown> = createOrUpdateMock.mock
    .calls[0] as Array<unknown>;

  return (call[0] as { model: StatusPageAnnouncement }).model;
}

beforeEach(() => {
  queryInUrl = {};
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryInUrl[name] || null;
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

      if (modelType === Monitor) {
        return listOf([makeMonitor()]);
      }

      return listOf([]);
    },
  );

  getItemMock.mockImplementation(
    async (args: unknown): Promise<BaseModel | null> => {
      const modelType: DatabaseBaseModelType = (
        args as { modelType: DatabaseBaseModelType }
      ).modelType;

      return modelType === StatusPageAnnouncementTemplate
        ? makeTemplate()
        : null;
    },
  );

  createOrUpdateMock.mockImplementation(
    async (data: unknown): Promise<{ data: Record<string, unknown> }> => {
      return {
        data: {
          ...BaseModel.toJSON(
            (data as { model: StatusPageAnnouncement }).model,
            StatusPageAnnouncement,
          ),
          _id: "55555555-5555-4555-8555-555555555555",
        },
      };
    },
  );

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

describe("every announcement form suggests the status pages that show its monitors", () => {
  type Form = {
    name: string;
    fields: Array<ModelField<StatusPageAnnouncement>>;
  };

  const forms: Array<Form> = [
    {
      name: "Create Announcement",
      fields: getAnnouncementFormFields(AnnouncementFormKind.Create),
    },
    {
      name: "the announcement's Edit",
      fields: getAnnouncementFormFields(AnnouncementFormKind.Edit),
    },
    {
      name: "an announcement template's Create and Edit",
      fields: getAnnouncementTemplateFormFields() as unknown as Array<
        ModelField<StatusPageAnnouncement>
      >,
    },
  ];

  test.each(forms)(
    "$name: the status page picker suggests, for announcements, from the monitors picked",
    (data: Form) => {
      const field: ModelField<StatusPageAnnouncement> | undefined =
        data.fields.find(
          (candidate: ModelField<StatusPageAnnouncement>): boolean => {
            return Object.keys(candidate.field || {})[0] === "statusPages";
          },
        );

      expect(field?.getFooterElement).toBeDefined();

      const setValue: MockFunction = getJestMockFunction();

      const footer: ReactElement | undefined = field!.getFooterElement!(
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

      expect(props.eventType).toBe(StatusPageEventType.Announcement);
      expect(props.monitorIds).toEqual([MONITOR_ID]);

      props.onChange([STATUS_PAGE_ID]);
      expect(setValue).toHaveBeenCalledWith([STATUS_PAGE_ID]);
    },
  );
});

describe("Create Announcement from a template that names a monitor", () => {
  test("suggests the page that shows the monitor, picks nothing by itself, and saves the page once clicked", async () => {
    queryInUrl = { announcementTemplateId: TEMPLATE_ID };

    render(
      <MemoryRouter>
        <AnnouncementCreate {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByRole("navigation", { name: "Progress" });
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(currentStepTitle()).toBe("Status Pages");
    });

    const add: HTMLElement = await screen.findByRole("button", {
      name: "Add Acme Public Status",
    });

    expect(
      screen.getByRole("group", {
        name: "Status pages that show the affected monitor:",
      }),
    ).toContainElement(add);

    const request: Record<string, unknown> = postMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["data"]).toEqual({
      monitorIds: [MONITOR_ID],
      eventType: StatusPageEventType.Announcement,
    });

    // Not picked by itself: the required picker is still empty.
    expect(
      screen.queryByRole("button", { name: "Remove Acme Public Status" }),
    ).toBeNull();

    fireEvent.click(add);

    expect(
      await screen.findByRole("button", { name: "Remove Acme Public Status" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("status-page-suggestions-line")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Create Announcement" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(
      (createdModel().statusPages || []).map((statusPage: StatusPage) => {
        return (statusPage._id || statusPage.id?.toString() || "").toString();
      }),
    ).toEqual([STATUS_PAGE_ID]);
    expect(form()).toBeTruthy();
  });
});
