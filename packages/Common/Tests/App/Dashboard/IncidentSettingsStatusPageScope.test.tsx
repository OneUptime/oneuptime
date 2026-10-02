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
 * The incident's Settings tab: the 'Status Page Scope' card, where the status
 * pages an incident is limited to are changed after it was declared.
 *
 * Three parts:
 *   - the page: what the card reads, which fields its edit form has once the
 *     incident is loaded (the added-pages checkbox only when the 'created'
 *     notification can go out), and what the picker's footer warns about -
 *     removing pages that were already told, clearing the scope, and picking
 *     a page that lists none of the monitors - and nothing else: there is no
 *     banner explaining an empty picker any more (the card itself is stubbed
 *     and its props recorded);
 *   - the read-only view the card shows, including the deleted-pages warning;
 *   - the added-pages checkbox inside the real ModelForm: shown only while the
 *     edit adds a page, and sent as a misc data prop - never a column - only
 *     while ticked;
 *   - the whole edit form inside the real ModelForm for an incident member,
 *     who cannot read status pages: it opens, quietly, with an empty picker.
 */

// The removed banner's opening words, and its test id.
const REMOVED_BANNER_TEXT: RegExp = /No status pages to pick from/;
const REMOVED_BANNER_TEST_ID: string = "status-page-picker-no-access";

const recordedCards: Array<Record<string, unknown>> = [];
let loadedIncident: unknown = null;
let savedRequests: Array<{
  model: unknown;
  miscDataProps: Record<string, unknown> | undefined;
}> = [];

const countMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const listMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div", {
        "data-testid": `stub-card-${props["name"] as string}`,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/NextReminderCountdown",
  () => {
    return {
      __esModule: true,
      ReminderRuleScope: { Incident: "Incident" },
      default: (): ReactElement => {
        return React.createElement("div");
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        return loadedIncident;
      },
      getList: (...args: Array<unknown>): unknown => {
        return listMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getCommonHeaders: (): Record<string, unknown> => {
        return { tenantid: "project-1" };
      },
      createOrUpdate: async (request: {
        model: unknown;
        miscDataProps?: Record<string, unknown>;
      }): Promise<{ data: Record<string, unknown> }> => {
        savedRequests.push({
          model: request.model,
          miscDataProps: request.miscDataProps,
        });
        return { data: {} };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["IncidentMember"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["IncidentMember"] };
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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import IncidentSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Settings";
import { getIncidentScopeAddedPagesFormField } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentScopeAddedPagesFormField";
import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import IncidentStatusPageScopeView from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import IncidentSubscriberAudience from "../../../Types/StatusPage/IncidentSubscriberAudience";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";

const INCIDENT_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "c0000000-0000-4000-8000-000000000001";
const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_05: string = "b0000000-0000-4000-8000-000000000005";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/settings"),
  currentProject: null,
  hasPaymentMethod: false,
};

function page(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.name = name;
  return statusPage;
}

interface ScopeShape {
  statusPages?: Array<StatusPage> | undefined;
  isScoped?: boolean | undefined;
  // null: no record (told before the record existed, or never sent).
  notified?: Array<string> | null | undefined;
  status?: StatusPageSubscriberNotificationStatus | undefined;
  notifyOnCreate?: boolean | undefined;
  isVisible?: boolean | undefined;
  isPrivate?: boolean | undefined;
}

// An incident on one monitor, limited to Site 03 and Site 07, told on Site 03.
function buildIncident(shape: ScopeShape = {}): Incident {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(INCIDENT_ID);
  incident.statusPages = shape.statusPages ?? [
    page(SITE_03, "Site 03"),
    page(SITE_07, "Site 07"),
  ];
  incident.isScopedToStatusPages = shape.isScoped ?? true;
  incident.statusPagesNotifiedOnCreation = (
    shape.notified === undefined ? [SITE_03] : shape.notified
  ) as Array<string>;
  incident.subscriberNotificationStatusOnIncidentCreated =
    shape.status ?? StatusPageSubscriberNotificationStatus.Success;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
    shape.notifyOnCreate ?? true;
  incident.isVisibleOnStatusPage = shape.isVisible ?? true;
  incident.isPrivate = shape.isPrivate ?? false;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  incident.monitors = [monitor];

  return incident;
}

interface ScopeCardProps {
  cardProps: { title: string; description: string };
  editButtonText: string;
  formFields: Fields<Incident>;
  modelDetailProps: {
    fields: Array<{
      field: Record<string, unknown>;
      title: string;
      fieldType: FieldType;
      getElement: (item: Incident) => ReactElement;
    }>;
    selectMoreFields?: Record<string, unknown>;
    onItemLoaded?: (item: Incident) => void;
    modelId: ObjectID;
  };
}

function scopeCard(): ScopeCardProps {
  const cards: Array<Record<string, unknown>> = recordedCards.filter(
    (props: Record<string, unknown>): boolean => {
      return props["name"] === "Status Page Scope";
    },
  );

  expect(cards.length).toBeGreaterThan(0);
  return cards[cards.length - 1] as unknown as ScopeCardProps;
}

function fieldKeys(fields: Fields<Incident>): Array<string> {
  return fields.map((field: Fields<Incident>[number]): string => {
    return (
      field.overrideFieldKey || Object.keys(field.field || {})[0] || "unknown"
    );
  });
}

function pickerField(): Fields<Incident>[number] {
  return scopeCard().formFields[0]!;
}

async function renderSettings(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IncidentSettings {...pageProps} />
      </MemoryRouter>,
    );
  });
}

async function loadIncident(shape: ScopeShape = {}): Promise<void> {
  await act(async (): Promise<void> => {
    scopeCard().modelDetailProps.onItemLoaded!(buildIncident(shape));
  });
}

// What the picker's footer says for these form values.
async function renderFooter(statusPages: unknown): Promise<HTMLElement> {
  const footer: ReactElement | undefined = pickerField().getFooterElement!({
    statusPages: statusPages,
  } as FormValues<Incident>);

  const container: HTMLElement = document.createElement("div");
  document.body.appendChild(container);

  await act(async (): Promise<void> => {
    render(<MemoryRouter>{footer}</MemoryRouter>, { container: container });
  });

  return container;
}

// The page's requests to count status pages.
function statusPageCountRequests(): Array<unknown> {
  return countMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { modelType?: unknown }).modelType === StatusPage;
  });
}

function audienceResponse(
  notListing: Array<{ statusPageId: string; name: string }> = [],
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    IncidentSubscriberAudience.toJSON({
      hasMonitors: true,
      isScoped: true,
      isHiddenFromStatusPages: false,
      statusPages: [],
      hiddenStatusPageCount: 0,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: notListing,
    }),
    {},
  );
}

beforeEach(() => {
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(INCIDENT_ID);
    });

  countMock.mockReset();
  countMock.mockResolvedValue(3 as never);
  listMock.mockReset();
  listMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  postMock.mockReset();
  postMock.mockResolvedValue(audienceResponse() as never);
});

afterEach(() => {
  cleanup();
  recordedCards.length = 0;
  loadedIncident = null;
  savedRequests = [];
  jest.restoreAllMocks();
});

describe("incident Settings tab: the 'Status Page Scope' card", () => {
  test("titled from the shared copy, beside the other settings cards", async () => {
    await renderSettings();

    expect(scopeCard().cardProps.title).toBe(
      IncidentStatusPageScopeCopy.settingsCardTitle,
    );
    expect(scopeCard().cardProps.description).toBe(
      IncidentStatusPageScopeCopy.settingsCardDescription,
    );
    expect(scopeCard().editButtonText).toBe(
      IncidentStatusPageScopeCopy.settingsEditButton,
    );
    expect(scopeCard().modelDetailProps.modelId.toString()).toBe(INCIDENT_ID);

    const names: Array<string> = recordedCards.map(
      (props: Record<string, unknown>): string => {
        return props["name"] as string;
      },
    );
    expect(names.indexOf("Status Page Scope")).toBe(
      names.indexOf("Incident Settings") + 1,
    );
  });

  test("reads what its warnings and checkbox need with the card's own item", async () => {
    await renderSettings();

    expect(scopeCard().modelDetailProps.selectMoreFields).toEqual({
      isScopedToStatusPages: true,
      statusPagesNotifiedOnCreation: true,
      subscriberNotificationStatusOnIncidentCreated: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      isVisibleOnStatusPage: true,
      isPrivate: true,
      monitors: { _id: true },
    });
    expect(scopeCard().modelDetailProps.fields[0]!.field).toEqual({
      statusPages: { _id: true, name: true },
    });
  });

  test("the picker is a status page multi-select from the shared copy", async () => {
    await renderSettings();

    const picker: Fields<Incident>[number] = pickerField();

    expect(picker.field).toEqual({ statusPages: true });
    expect(picker.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
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
    expect(picker.required).toBe(false);
  });

  test("before the incident loads, only the picker", async () => {
    await renderSettings();

    expect(fieldKeys(scopeCard().formFields)).toEqual(["statusPages"]);
  });

  test("offers the added-pages checkbox when the 'created' notification can go out", async () => {
    await renderSettings();
    await loadIncident();

    expect(fieldKeys(scopeCard().formFields)).toEqual([
      "statusPages",
      IncidentScopeAddedPagesNotification.miscDataKey,
    ]);

    const checkbox: Fields<Incident>[number] = scopeCard().formFields[1]!;
    expect(checkbox.defaultValue).toBe(true);
    expect(checkbox.title).toBe(
      IncidentScopeAddedPagesNotification.formFieldTitle,
    );
  });

  /*
   * The box is offered exactly when ticking it would send something (the
   * server's own rule), so for these it never shows, even for an edit that
   * adds a page that was never told.
   */
  test.each([
    ["notifying subscribers on creation is off", { notifyOnCreate: false }],
    ["the incident is hidden from status pages", { isVisible: false }],
    ["the incident is private", { isPrivate: true }],
    [
      "the incident was told before the record of told pages existed",
      { notified: null },
    ],
    [
      "the incident was told before the record existed, even after a failure",
      { notified: null, status: StatusPageSubscriberNotificationStatus.Failed },
    ],
    [
      "the notification is queued: it reaches the added page anyway",
      { status: StatusPageSubscriberNotificationStatus.Pending },
    ],
    [
      "the notification is being sent: it reaches the added page anyway",
      { status: StatusPageSubscriberNotificationStatus.InProgress },
    ],
  ] as Array<[string, ScopeShape]>)(
    "does not offer it when %s",
    async (_label: string, shape: ScopeShape) => {
      await renderSettings();
      await loadIncident(shape);

      const checkbox: Fields<Incident>[number] | undefined =
        scopeCard().formFields[1];

      expect(
        checkbox?.showIf?.({
          statusPages: [SITE_03, SITE_07, SITE_05],
        } as FormValues<Incident>) ?? false,
      ).toBe(false);
    },
  );

  test("offers it for an incident that was never announced, for the pages added", async () => {
    await renderSettings();
    await loadIncident({
      notified: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    });

    expect(
      scopeCard().formFields[1]!.showIf!({
        statusPages: [SITE_03, SITE_07, SITE_05],
      } as FormValues<Incident>),
    ).toBe(true);
  });

  test("does not offer it when every added page was told already", async () => {
    // Narrowed to Site 03 after Site 07 was told; adding Site 07 back.
    await renderSettings();
    await loadIncident({
      statusPages: [page(SITE_03, "Site 03")],
      notified: [SITE_03, SITE_07],
    });

    expect(
      scopeCard().formFields[1]!.showIf!({
        statusPages: [SITE_03, SITE_07],
      } as FormValues<Incident>),
    ).toBe(false);
  });

  test("the checkbox compares the form against the pages the card loaded", async () => {
    await renderSettings();
    await loadIncident();

    const checkbox: Fields<Incident>[number] = scopeCard().formFields[1]!;

    expect(
      checkbox.showIf!({
        statusPages: [SITE_03, SITE_07],
      } as FormValues<Incident>),
    ).toBe(false);
    expect(
      checkbox.showIf!({
        statusPages: [SITE_03, SITE_07, SITE_05],
      } as FormValues<Incident>),
    ).toBe(true);
    expect(
      checkbox.showIf!({ statusPages: [SITE_03] } as FormValues<Incident>),
    ).toBe(false);
  });
});

describe("the two settings cards keep each other current", () => {
  function latestCard(name: string): Record<string, unknown> {
    const cards: Array<Record<string, unknown>> = recordedCards.filter(
      (props: Record<string, unknown>): boolean => {
        return props["name"] === name;
      },
    );

    return cards[cards.length - 1]!;
  }

  test("saving the scope reloads the visibility card, whose offer depends on the 'created' notification", async () => {
    await renderSettings();

    const before: unknown = latestCard("Incident Settings")["refresher"];

    await act(async (): Promise<void> => {
      (
        latestCard("Status Page Scope")["onSaveSuccess"] as (
          item: Incident,
        ) => void
      )(buildIncident());
    });

    expect(latestCard("Incident Settings")["refresher"]).toBe(!before);
  });

  test("publishing in the visibility card reloads the scope card, whose checkbox depends on it", async () => {
    await renderSettings();

    const before: unknown = latestCard("Status Page Scope")["refresher"];

    await act(async (): Promise<void> => {
      (
        latestCard("Incident Settings")["onSaveSuccess"] as (
          item: Incident,
        ) => void
      )(buildIncident());
    });

    expect(latestCard("Status Page Scope")["refresher"]).toBe(!before);
  });
});

describe("the picker's warnings", () => {
  test("removing a page that was already told warns it hears nothing more", async () => {
    await renderSettings();
    await loadIncident();

    await renderFooter([SITE_07]);

    expect(
      screen.getByTestId("incident-scope-removing-notified-pages"),
    ).toHaveTextContent(
      formatScopeText(
        IncidentStatusPageScopeCopy.removingNotifiedPagesWarning,
        { names: "Site 03" },
      ),
    );
  });

  test("removing a page that was never told needs no warning", async () => {
    await renderSettings();
    await loadIncident();

    await renderFooter([SITE_03]);

    expect(
      screen.queryByTestId("incident-scope-removing-notified-pages"),
    ).toBeNull();
    expect(screen.queryByTestId("incident-scope-clearing")).toBeNull();
  });

  test("clearing the scope warns the incident reaches every page again", async () => {
    await renderSettings();
    await loadIncident({ notified: [] });

    await renderFooter([]);

    expect(screen.getByTestId("incident-scope-clearing")).toHaveTextContent(
      IncidentStatusPageScopeCopy.clearingScopeWarning,
    );
    expect(
      screen.queryByTestId("incident-scope-removing-notified-pages"),
    ).toBeNull();
  });

  /*
   * An incident its monitors created is not limited, so it told every page
   * that lists them - an internal 'All Sites' page next to the site pages,
   * say. Limiting it to Site 03 drops All Sites, which then hears nothing
   * more, not even that it was resolved; that page is in no list the card
   * loaded, so its name is read for the warning.
   */
  test("limiting an unscoped incident warns about the told pages it leaves out", async () => {
    const ALL_SITES: string = "b0000000-0000-4000-8000-0000000000aa";
    listMock.mockResolvedValue({
      data: [page(ALL_SITES, "All Sites")],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    await renderSettings();
    await loadIncident({
      isScoped: false,
      statusPages: [],
      notified: [ALL_SITES, SITE_03],
    });

    // The told pages' names, read by id.
    expect(listMock).toHaveBeenCalledTimes(1);
    const request: { modelType: unknown; select: Record<string, unknown> } =
      listMock.mock.calls[0]![0] as {
        modelType: unknown;
        select: Record<string, unknown>;
      };
    expect(request.modelType).toBe(StatusPage);
    expect(request.select).toEqual({ _id: true, name: true });

    await renderFooter([SITE_03]);

    expect(
      screen.getByTestId("incident-scope-removing-notified-pages"),
    ).toHaveTextContent(
      formatScopeText(
        IncidentStatusPageScopeCopy.removingNotifiedPagesWarning,
        { names: "All Sites" },
      ),
    );
  });

  test("limiting an unscoped incident to every page it told needs no warning", async () => {
    listMock.mockResolvedValue({
      data: [page(SITE_03, "Site 03")],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    await renderSettings();
    await loadIncident({
      isScoped: false,
      statusPages: [],
      notified: [SITE_03],
    });

    await renderFooter([SITE_03, SITE_07]);

    expect(
      screen.queryByTestId("incident-scope-removing-notified-pages"),
    ).toBeNull();
  });

  test("an unscoped incident left unscoped drops no told page", async () => {
    listMock.mockResolvedValue({
      data: [page(SITE_03, "Site 03")],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    await renderSettings();
    await loadIncident({
      isScoped: false,
      statusPages: [],
      notified: [SITE_03],
    });

    await renderFooter([]);

    expect(
      screen.queryByTestId("incident-scope-removing-notified-pages"),
    ).toBeNull();
  });

  test("an unscoped incident that told nobody reads no names", async () => {
    await renderSettings();
    await loadIncident({ isScoped: false, statusPages: [], notified: [] });

    expect(listMock).not.toHaveBeenCalled();
  });

  test("an unscoped incident left unscoped says nothing", async () => {
    await renderSettings();
    await loadIncident({ isScoped: false, statusPages: [], notified: [] });

    await renderFooter([]);

    expect(screen.queryByTestId("incident-scope-clearing")).toBeNull();
  });

  test("a picked page that lists none of the monitors is named, as the server says", async () => {
    postMock.mockResolvedValue(
      audienceResponse([{ statusPageId: SITE_05, name: "Site 05" }]) as never,
    );

    await renderSettings();
    await loadIncident();

    await renderFooter([SITE_03, SITE_05]);

    expect(
      await screen.findByTestId("status-pages-not-listing-monitors"),
    ).toHaveTextContent(
      formatScopeText(IncidentStatusPageScopeCopy.notListingMonitorsWarning, {
        names: "Site 05",
      }),
    );

    // Asked with the incident's monitors and the pages on the form.
    const body: JSONObject = (
      postMock.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(body).toEqual({
      monitorIds: [MONITOR_ID],
      statusPageIds: [SITE_03, SITE_05],
    });
  });

  test("no page picked: nothing to check against the monitors", async () => {
    await renderSettings();
    await loadIncident({ isScoped: false, statusPages: [], notified: [] });

    await renderFooter([]);
    await new Promise((r: (value: unknown) => void) => {
      setTimeout(r, 450);
    });

    expect(postMock).not.toHaveBeenCalled();
  });

  /*
   * Someone with no status page to pick from - an incident role cannot read
   * status pages - used to get an information banner under the picker. It
   * is gone: the picker is simply empty, and the footer only ever warns.
   */
  test("someone who cannot read status pages gets no banner under the picker", async () => {
    countMock.mockRejectedValue(
      new Error("You do not have permissions to read Status Page.") as never,
    );

    await renderSettings();
    await loadIncident();

    // The pages it is limited to, unchanged: nothing to warn about either.
    const footer: HTMLElement = await renderFooter([SITE_03, SITE_07]);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    expect(footer).toBeEmptyDOMElement();
    expect(screen.queryByTestId(REMOVED_BANNER_TEST_ID)).toBeNull();
    expect(screen.queryByText(REMOVED_BANNER_TEXT)).toBeNull();
  });

  test("a project with no status pages gets no banner either", async () => {
    countMock.mockResolvedValue(0 as never);

    await renderSettings();
    await loadIncident({ isScoped: false, statusPages: [], notified: [] });

    const footer: HTMLElement = await renderFooter([]);

    expect(footer).toBeEmptyDOMElement();
    expect(screen.queryByRole("note")).toBeNull();
  });

  test("a warning stands alone: no banner beside it", async () => {
    countMock.mockRejectedValue(
      new Error("You do not have permissions to read Status Page.") as never,
    );

    await renderSettings();
    await loadIncident({ notified: [] });
    await renderFooter([]);

    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note")).toHaveAttribute(
      "data-testid",
      "incident-scope-clearing",
    );
    expect(screen.queryByText(REMOVED_BANNER_TEXT)).toBeNull();
  });

  test("the card never asks how many status pages the person can read", async () => {
    await renderSettings();
    await loadIncident();
    await renderFooter([SITE_03]);

    expect(statusPageCountRequests()).toEqual([]);
  });

  test("the picker has no fixed footer of its own", async () => {
    await renderSettings();
    await loadIncident();

    expect(pickerField().footerElement).toBeUndefined();
  });
});

/*
 * The whole edit form in the real ModelForm, as an incident member sees it.
 * Incident roles cannot read status pages, so the picker's list is refused
 * (422, as the API answers a NotAuthorizedException). The form opens all the
 * same, without an error, with the picker there and empty - and nothing
 * under it explaining why.
 */
describe("the Status Page Scope form for someone who cannot read status pages", () => {
  const REFUSED_MESSAGE: string =
    "You do not have permissions to read Status Page. You need one of these permissions: Project Owner, Project Admin, Status Page Viewer.";

  async function renderScopeForm(): Promise<void> {
    listMock.mockImplementation((async (request: {
      modelType: unknown;
    }): Promise<unknown> => {
      if (request.modelType === StatusPage) {
        throw new HTTPErrorResponse(422, { message: REFUSED_MESSAGE }, {});
      }

      return { data: [], count: 0, skip: 0, limit: 0 };
    }) as never);
    countMock.mockRejectedValue(new Error(REFUSED_MESSAGE) as never);

    await renderSettings();
    await loadIncident();

    // What the form reads back for the edit: the pages the card loaded.
    loadedIncident = buildIncident();

    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <ModelForm<Incident>
            id="incident-status-page-scope-form"
            name="Status Page Scope"
            modelType={Incident}
            formType={FormType.Update}
            modelIdToEdit={new ObjectID(INCIDENT_ID)}
            fields={scopeCard().formFields}
            submitButtonText="Save"
          />
        </MemoryRouter>,
      );
    });

    await screen.findByRole("button", { name: "Save" });
  }

  test("opens with the picker, and no banner, hint or error under it", async () => {
    await renderScopeForm();

    // The picker's list was asked for, and refused.
    await waitFor(() => {
      expect(
        listMock.mock.calls.some((call: Array<unknown>): boolean => {
          return (call[0] as { modelType?: unknown }).modelType === StatusPage;
        }),
      ).toBe(true);
    });

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.pickerTitle),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(REMOVED_BANNER_TEST_ID)).toBeNull();
    expect(screen.queryByText(REMOVED_BANNER_TEXT)).toBeNull();
    expect(screen.queryByText(/Ask a project admin/)).toBeNull();
    expect(screen.queryByText(REFUSED_MESSAGE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(statusPageCountRequests()).toEqual([]);
  });

  test("can still be saved", async () => {
    await renderScopeForm();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(savedRequests).toHaveLength(1);
    });
  });
});

describe("the scope, read only", () => {
  async function renderView(element: ReactElement): Promise<void> {
    await act(async (): Promise<void> => {
      render(<MemoryRouter>{element}</MemoryRouter>);
    });
  }

  test("the card shows the pages the incident is limited to", async () => {
    await renderSettings();

    const element: ReactElement =
      scopeCard().modelDetailProps.fields[0]!.getElement(buildIncident());

    await renderView(element);

    expect(screen.getByText("Site 03")).toBeInTheDocument();
    expect(screen.getByText("Site 07")).toBeInTheDocument();
    expect(screen.getByTestId("incident-status-page-scope")).toHaveAttribute(
      "data-state",
      "scoped",
    );
  });

  test("an unscoped incident reaches every page that lists its monitors", async () => {
    await renderView(
      <IncidentStatusPageScopeView
        isScopedToStatusPages={false}
        statusPages={[]}
      />,
    );

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.noScopeSummary),
    ).toBeInTheDocument();
  });

  test("an incident whose pages were all deleted is hidden everywhere, and says so", async () => {
    await renderView(
      <IncidentStatusPageScopeView
        isScopedToStatusPages={true}
        statusPages={[]}
      />,
    );

    expect(
      screen.getByTestId("incident-scoped-to-deleted-pages"),
    ).toHaveTextContent(
      IncidentStatusPageScopeCopy.scopedToDeletedPagesWarning,
    );
  });

  test("given only the incident, reads its pages itself, and only when it is scoped", async () => {
    loadedIncident = buildIncident();

    await renderView(
      <IncidentStatusPageScopeView
        isScopedToStatusPages={true}
        incidentId={new ObjectID(INCIDENT_ID)}
        editRoute={new Route("/incidents/1/settings")}
      />,
    );

    expect(await screen.findByText("Site 03")).toBeInTheDocument();
    expect(
      screen
        .getByText(IncidentStatusPageScopeCopy.overviewEditLink)
        .closest("a"),
    ).toHaveAttribute("href", "/incidents/1/settings");
  });
});

describe("the added-pages field", () => {
  const field: ModelField<Incident> = getIncidentScopeAddedPagesFormField({
    loadedIncident: {
      statusPages: [page(SITE_03, "Site 03")],
      statusPagesNotifiedOnCreation: [SITE_03],
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Success,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      isVisibleOnStatusPage: true,
      isPrivate: false,
    },
  });

  test("is sent as the misc data prop the server reads, not as a column", () => {
    expect(field.overrideFieldKey).toBe(
      IncidentScopeAddedPagesNotification.miscDataKey,
    );
    expect(field.overrideField).toEqual({
      [IncidentScopeAddedPagesNotification.miscDataKey]: true,
    });
    expect(field.field).toBeUndefined();
    expect(new Incident().getTableColumns().columns).not.toContain(
      IncidentScopeAddedPagesNotification.miscDataKey,
    );
  });

  test("an optional checkbox, ticked, on edit only, with no column permission to check", () => {
    expect(field.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(field.required).toBe(false);
    expect(field.defaultValue).toBe(true);
    expect(field.doNotShowWhenCreating).toBe(true);
    expect(field.showEvenIfPermissionDoesNotExist).toBe(true);
    expect(field.description).toBe(
      IncidentScopeAddedPagesNotification.formFieldDescription,
    );
  });

  test.each([
    [[SITE_03], false],
    [[SITE_03, SITE_05], true],
    [[SITE_05], true],
    [[], false],
    [undefined, false],
  ] as Array<[Array<string> | undefined, boolean]>)(
    "shows for form pages %j: %s",
    (statusPages: Array<string> | undefined, shown: boolean) => {
      const values: FormValues<Incident> = {
        statusPages: statusPages,
      } as FormValues<Incident>;

      expect(field.showIf!(values)).toBe(shown);
    },
  );
});

/*
 * The checkbox inside the real ModelForm, editing an incident whose card
 * loaded it limited to Site 03. The form's own read of the incident is what
 * the edit starts from, so a form that reads Site 03 and Site 05 is an edit
 * that added Site 05. The picker is registered hidden: driving the entity
 * dropdown is not what this is about.
 */
describe("the added-pages checkbox in the edit form", () => {
  function checkbox(): HTMLInputElement | null {
    return screen.queryByRole("checkbox", {
      name: new RegExp(IncidentScopeAddedPagesNotification.formFieldTitle),
    }) as HTMLInputElement | null;
  }

  async function renderForm(formStatusPages: Array<string>): Promise<void> {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(INCIDENT_ID);
    incident.statusPages = formStatusPages.map((id: string): StatusPage => {
      return page(id, id);
    });
    loadedIncident = incident;

    const fields: Fields<Incident> = [
      {
        field: { statusPages: true },
        title: IncidentStatusPageScopeCopy.pickerTitle,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        required: false,
        showIf: (): boolean => {
          return false;
        },
      },
      getIncidentScopeAddedPagesFormField({
        loadedIncident: buildIncident({
          statusPages: [page(SITE_03, "Site 03")],
          notified: [SITE_03],
        }),
      }),
    ];

    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <ModelForm<Incident>
            id="incident-status-page-scope-form"
            name="Status Page Scope"
            modelType={Incident}
            formType={FormType.Update}
            modelIdToEdit={new ObjectID(INCIDENT_ID)}
            fields={fields}
            submitButtonText="Save"
          />
        </MemoryRouter>,
      );
    });

    await screen.findByRole("button", { name: "Save" });
  }

  async function save(): Promise<{
    model: Record<string, unknown>;
    miscDataProps: Record<string, unknown>;
  }> {
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(savedRequests).toHaveLength(1);
    });

    return {
      model: savedRequests[0]!.model as Record<string, unknown>,
      miscDataProps: savedRequests[0]!.miscDataProps || {},
    };
  }

  test("an edit that adds a page shows it, ticked, and asks the server to tell the added page", async () => {
    await renderForm([SITE_03, SITE_05]);

    expect(checkbox()).not.toBeNull();
    expect(checkbox()).toBeChecked();

    const { model, miscDataProps } = await save();

    expect(miscDataProps).toEqual(
      expect.objectContaining({
        [IncidentScopeAddedPagesNotification.miscDataKey]: true,
      }),
    );
    // Never written as a column.
    expect(
      model[IncidentScopeAddedPagesNotification.miscDataKey],
    ).toBeUndefined();
  });

  test("unticked, it asks for nothing", async () => {
    await renderForm([SITE_03, SITE_05]);

    await act(async (): Promise<void> => {
      fireEvent.click(checkbox()!);
    });

    expect(checkbox()).not.toBeChecked();

    const { miscDataProps } = await save();

    expect(
      miscDataProps[IncidentScopeAddedPagesNotification.miscDataKey],
    ).toBeUndefined();
  });

  test("an edit that adds no page does not show it", async () => {
    await renderForm([SITE_03]);

    expect(checkbox()).toBeNull();
  });
});
