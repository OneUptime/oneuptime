import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declaring an incident limited to some status pages: the Create page's
 * status page picker, the warnings it raises with the fields it interacts
 * with, the audience summary on the last step, and the template prefill.
 *
 * ModelForm is stubbed to capture the fields it is handed (as
 * IncidentCreateFromAlerts.test.tsx does); each field's footer and summary
 * are then rendered with the form values a person would have entered.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

type CapturedField = {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  placeholder?: string;
  stepId?: string;
  fieldType?: string;
  dropdownModal?: { type: unknown; labelField: string; valueField: string };
  getFooterElement?: (values: Record<string, unknown>) => unknown;
  getSummaryElement?: (values: Record<string, unknown>) => unknown;
};

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  fields: Array<CapturedField>;
};

let capturedForms: Array<CapturedFormProps> = [];

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForms.push(props);
      return <div data-testid="model-form" />;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
      create: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { SUBSCRIBER_AUDIENCE_DEBOUNCE_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/useSubscriberAudience";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import IncidentSubscriberAudience from "../../../Types/StatusPage/IncidentSubscriberAudience";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "66666666-6666-4666-8666-000000000001";
const MONITOR_ID: string = "c0000000-0000-4000-8000-000000000001";
const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";
const MONITOR_STATUS_ID: string = "d0000000-0000-4000-8000-000000000001";

function page(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.name = name;
  return statusPage;
}

function audienceResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    IncidentSubscriberAudience.toJSON({
      hasMonitors: true,
      isScoped: true,
      isHiddenFromStatusPages: false,
      statusPages: [
        {
          statusPageId: SITE_03,
          name: "Site 03",
          subscriberCounts: {
            ...IncidentSubscriberAudience.getEmptyCounts(),
            email: 41,
          },
        },
      ],
      hiddenStatusPageCount: 0,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: [
        { statusPageId: SITE_07, name: "Site 07" },
      ],
    }),
    {},
  );
}

let queryString: Record<string, string> = {};

async function renderCreate(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <IncidentCreate
          pageRoute={new Route("/incidents/create")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(capturedForms.length).toBeGreaterThan(0);
  });
}

function lastForm(): CapturedFormProps {
  return capturedForms[capturedForms.length - 1]!;
}

function fieldFor(key: string): CapturedField {
  const field: CapturedField | undefined = lastForm().fields.find(
    (candidate: CapturedField): boolean => {
      return Boolean(candidate.field && key in candidate.field);
    },
  );

  expect(field).toBeDefined();
  return field!;
}

function indexOfField(key: string): number {
  return lastForm().fields.findIndex((candidate: CapturedField): boolean => {
    return Boolean(candidate.field && key in candidate.field);
  });
}

async function renderElement(element: unknown): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>{(element as React.ReactElement) || <></>}</MemoryRouter>,
    );
  });
}

beforeEach(() => {
  capturedForms = [];
  queryString = {};

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryString[name] || null;
    });

  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(null);
  countMock.mockReset();
  countMock.mockResolvedValue(4);
  postMock.mockReset();
  postMock.mockResolvedValue(audienceResponse());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the status page picker on the Create page", () => {
  test("sits in the resources step, right after the monitors", async () => {
    await renderCreate();

    const picker: CapturedField = fieldFor("statusPages");

    expect(picker.stepId).toBe("resources-affected");
    expect(indexOfField("statusPages")).toBe(indexOfField("monitors") + 1);
  });

  test("is a status page multi-select, which gives it the Labels tab", async () => {
    await renderCreate();

    const picker: CapturedField = fieldFor("statusPages");

    expect(picker.fieldType).toBe("MultiSelectDropdown");
    expect(picker.dropdownModal).toEqual({
      type: StatusPage,
      labelField: "name",
      valueField: "_id",
    });
    expect(picker.title).toBe(IncidentStatusPageScopeCopy.pickerTitle);
    expect(picker.description).toBe(
      IncidentStatusPageScopeCopy.pickerDescription,
    );
    expect(picker.placeholder).toBe(
      IncidentStatusPageScopeCopy.pickerPlaceholder,
    );
  });

  test("says why it is empty when the person cannot read status pages", async () => {
    countMock.mockRejectedValue(new Error("Not allowed"));

    await renderCreate();
    await renderElement(
      fieldFor("statusPages").getFooterElement!({ statusPages: [] }),
    );

    expect(
      screen.getByTestId("status-page-picker-no-access"),
    ).toHaveTextContent(IncidentStatusPageScopeCopy.pickerNoAccessHint);
  });

  test("no hint when there are status pages to pick", async () => {
    await renderCreate();
    await renderElement(
      fieldFor("statusPages").getFooterElement!({ statusPages: [] }),
    );

    expect(screen.queryByTestId("status-page-picker-no-access")).toBeNull();
  });

  test("warns about a picked page that lists none of the chosen monitors", async () => {
    await renderCreate();
    await renderElement(
      fieldFor("statusPages").getFooterElement!({
        monitors: [{ _id: MONITOR_ID, name: "API" }],
        statusPages: [SITE_03, SITE_07],
      }),
    );

    expect(
      await screen.findByTestId(
        "status-pages-not-listing-monitors",
        undefined,
        {
          timeout: SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 1000,
        },
      ),
    ).toHaveTextContent(
      formatScopeText(IncidentStatusPageScopeCopy.notListingMonitorsWarning, {
        names: "Site 07",
      }),
    );
  });

  test("the summary step names the pages, or says it is not limited", async () => {
    await renderCreate();

    await renderElement(
      fieldFor("statusPages").getSummaryElement!({ statusPages: [] }),
    );

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.noScopeSummary),
    ).toBeInTheDocument();
  });
});

describe("warnings where the scope meets other fields", () => {
  test("changing monitor status on a scoped incident: it shows on every page", async () => {
    await renderCreate();

    await renderElement(
      fieldFor("changeMonitorStatusTo").getFooterElement!({
        statusPages: [SITE_03],
        changeMonitorStatusTo: MONITOR_STATUS_ID,
      }),
    );

    expect(
      screen.getByTestId("incident-create-monitor-status-scope-warning"),
    ).toHaveTextContent(IncidentStatusPageScopeCopy.changeMonitorStatusWarning);
  });

  test.each([
    ["no status page is picked", { changeMonitorStatusTo: MONITOR_STATUS_ID }],
    ["the monitor status is left alone", { statusPages: [SITE_03] }],
  ])(
    "no monitor status warning when %s",
    async (_label: string, values: Record<string, unknown>) => {
      await renderCreate();

      expect(
        fieldFor("changeMonitorStatusTo").getFooterElement!(values),
      ).toBeUndefined();
    },
  );

  test("a private incident with a scope: private wins, and says so", async () => {
    await renderCreate();

    await renderElement(
      fieldFor("isPrivate").getFooterElement!({
        isPrivate: true,
        statusPages: [SITE_03],
      }),
    );

    expect(
      screen.getByTestId("incident-create-private-scope-warning"),
    ).toHaveTextContent(IncidentStatusPageScopeCopy.privateIncidentWarning);
  });

  test.each([
    [
      "the incident is not private",
      { isPrivate: false, statusPages: [SITE_03] },
    ],
    ["no status page is picked", { isPrivate: true, statusPages: [] }],
  ])(
    "no private warning when %s",
    async (_label: string, values: Record<string, unknown>) => {
      await renderCreate();

      expect(fieldFor("isPrivate").getFooterElement!(values)).toBeUndefined();
    },
  );
});

describe("the audience on the last step", () => {
  const NOTIFY_FIELD: string =
    "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated";

  test("under the notify box: who the incident will reach, from its monitors and pages", async () => {
    await renderCreate();

    await renderElement(
      fieldFor(NOTIFY_FIELD).getFooterElement!({
        monitors: [{ _id: MONITOR_ID, name: "API" }],
        statusPages: [SITE_03],
        [NOTIFY_FIELD]: true,
      }),
    );

    expect(
      await screen.findByText("Site 03 (up to 41 email)", undefined, {
        timeout: SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 1000,
      }),
    ).toBeInTheDocument();

    const body: JSONObject = (
      postMock.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(body).toEqual({
      monitorIds: [MONITOR_ID],
      statusPageIds: [SITE_03],
    });
  });

  test("in the summary step too", async () => {
    await renderCreate();

    await renderElement(
      fieldFor(NOTIFY_FIELD).getSummaryElement!({
        monitors: [MONITOR_ID],
        statusPages: [],
        [NOTIFY_FIELD]: true,
      }),
    );

    expect(
      screen.getByTestId("incident-create-subscriber-audience"),
    ).toBeInTheDocument();
  });

  test("with notifying off it says nobody will be told, and asks nothing", async () => {
    await renderCreate();

    await renderElement(
      fieldFor(NOTIFY_FIELD).getFooterElement!({
        monitors: [MONITOR_ID],
        statusPages: [SITE_03],
        [NOTIFY_FIELD]: false,
      }),
    );

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.audienceNotifyOff),
    ).toBeInTheDocument();

    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, SUBSCRIBER_AUDIENCE_DEBOUNCE_MS + 50);
    });

    expect(postMock).not.toHaveBeenCalled();
  });

  test("a private incident says nothing will be sent", async () => {
    await renderCreate();

    await renderElement(
      fieldFor(NOTIFY_FIELD).getFooterElement!({
        monitors: [MONITOR_ID],
        statusPages: [SITE_03],
        [NOTIFY_FIELD]: true,
        isPrivate: true,
      }),
    );

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.audiencePrivateIncident),
    ).toBeInTheDocument();
  });
});

describe("declaring from a template", () => {
  test("reads the template's status pages and starts the picker with them", async () => {
    queryString = { incidentTemplateId: TEMPLATE_ID };

    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Region East outage";
    template.statusPages = [page(SITE_03, "Site 03"), page(SITE_07, "Site 07")];
    getItemMock.mockResolvedValue(template);

    await renderCreate();

    const templateRequest: { modelType: unknown; select: JSONObject } =
      getItemMock.mock.calls.find((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === IncidentTemplate
        );
      })![0] as { modelType: unknown; select: JSONObject };

    expect(templateRequest.select["statusPages"]).toBe(true);
    expect(lastForm().initialValues["statusPages"]).toEqual([SITE_03, SITE_07]);
  });

  test("a template without status pages leaves the incident unscoped", async () => {
    queryString = { incidentTemplateId: TEMPLATE_ID };

    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Site outage";
    getItemMock.mockResolvedValue(template);

    await renderCreate();

    expect(lastForm().initialValues["statusPages"]).toBeUndefined();
  });

  test("declaring without a template starts with no status pages", async () => {
    await renderCreate();

    expect(lastForm().initialValues["statusPages"]).toBeUndefined();
  });

  test("reads whether the template is limited to status pages at all", async () => {
    queryString = { incidentTemplateId: TEMPLATE_ID };

    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    getItemMock.mockResolvedValue(template);

    await renderCreate();

    const templateRequest: { select: JSONObject } = getItemMock.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === IncidentTemplate
        );
      },
    )![0] as { select: JSONObject };

    expect(templateRequest.select["isScopedToStatusPages"]).toBe(true);
  });

  describe("a template whose status pages were all deleted", () => {
    function scopedTemplateWithoutPages(): IncidentTemplate {
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.title = "Region East outage";
      template.isScopedToStatusPages = true;
      template.statusPages = [];
      return template;
    }

    test("the picker asks for the pages this incident is for", async () => {
      queryString = { incidentTemplateId: TEMPLATE_ID };
      getItemMock.mockResolvedValue(scopedTemplateWithoutPages());

      await renderCreate();
      await renderElement(
        fieldFor("statusPages").getFooterElement!({ statusPages: [] }),
      );

      expect(
        screen.getByTestId("incident-create-template-scoped-to-deleted-pages"),
      ).toHaveTextContent(
        IncidentStatusPageScopeCopy.declaringFromTemplateScopedToDeletedPagesWarning,
      );
    });

    test("the warning goes once pages are picked", async () => {
      queryString = { incidentTemplateId: TEMPLATE_ID };
      getItemMock.mockResolvedValue(scopedTemplateWithoutPages());

      await renderCreate();
      await renderElement(
        fieldFor("statusPages").getFooterElement!({ statusPages: [SITE_03] }),
      );

      expect(
        screen.queryByTestId(
          "incident-create-template-scoped-to-deleted-pages",
        ),
      ).toBeNull();
    });

    test("no warning for a template that was never limited", async () => {
      queryString = { incidentTemplateId: TEMPLATE_ID };

      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.isScopedToStatusPages = false;
      template.statusPages = [];
      getItemMock.mockResolvedValue(template);

      await renderCreate();
      await renderElement(
        fieldFor("statusPages").getFooterElement!({ statusPages: [] }),
      );

      expect(
        screen.queryByTestId(
          "incident-create-template-scoped-to-deleted-pages",
        ),
      ).toBeNull();
    });
  });
});
