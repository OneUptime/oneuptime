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
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import SloSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Settings";
import {
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloArchiveCopy";
import { SLO_MULTI_MONITOR_MODE_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";
import { getSloBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/Breadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

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

/*
 * The SLO Settings page renders for real on its real route, with only the
 * API and permissions stubbed. It is where everything the create wizard
 * stopped asking now lives, so these pin that each card shows its setting
 * in words (not a raw enum), reads the sibling columns it needs, refreshes
 * the notice banner when saved, and archives with SLO copy instead of the
 * telemetry wording the shared archive card uses by default.
 */

/*
 * These render real components that fetch, so give the waits room to
 * survive a loaded CI box - the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const MODEL_ID: ObjectID = new ObjectID("33333333-0000-4000-8000-000000000002");
const SETTINGS_PATH: string = `/dashboard/${PROJECT_ID}/slos/${MODEL_ID.toString()}/settings`;

const CARD_TITLES_IN_ORDER: Array<string> = [
  "Objective",
  "Compliance Period",
  "Downtime Calculation",
  "Evaluation",
];

const DETAIL_IDS: Array<string> = [
  "slo-settings-objective",
  "slo-settings-period",
  "slo-settings-downtime",
  "slo-settings-evaluation",
];

type SloFields = Record<string, unknown>;

function makeStatus(
  name: string,
  priority: number,
  color: string,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = ObjectID.generate().toString();
  status.name = name;
  status.priority = priority;
  status.color = new Color(color);
  return status;
}

const HEALTHY_SLO: SloFields = {
  _id: MODEL_ID.toString(),
  name: "API Availability",
  isArchived: false,
  isEnabled: true,
  sloStatus: SloStatus.Healthy,
  sliType: SliType.MonitorUptime,
  targetPercentage: 99.9,
  atRiskThresholdPercentage: 20,
  windowType: SloWindowType.Rolling,
  windowDays: 30,
  timezone: null,
  multiMonitorMode: SloMultiMonitorMode.AnyDown,
  // Deliberately out of priority order: the card must sort them.
  downtimeMonitorStatuses: [
    makeStatus("Offline", 3, "#dc2626"),
    makeStatus("Degraded", 2, "#f59e0b"),
  ],
  lastEvaluatedAt: new Date(),
  monitors: [],
};

function makeSlo(fields: SloFields): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const writable: Record<string, unknown> = slo as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return slo;
}

let getItemSpy: ReturnType<typeof jest.spyOn>;

/*
 * Every card, the banner and the archive card read the same row, each with
 * its own select; hand every one of them a fresh copy of the same SLO.
 */
function serveSlo(fields: SloFields): void {
  getItemSpy.mockImplementation(async (): Promise<ServiceLevelObjective> => {
    return makeSlo({ ...HEALTHY_SLO, ...fields });
  });
}

interface GetItemRequest {
  select?: Record<string, unknown> | undefined;
}

function getItemRequests(): Array<GetItemRequest> {
  return getItemSpy.mock.calls.map((call: Array<unknown>): GetItemRequest => {
    return (call[0] || {}) as GetItemRequest;
  });
}

function openSettings(): void {
  goTo(SETTINGS_PATH);

  render(
    <MemoryRouter initialEntries={[SETTINGS_PATH]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.SLO_VIEW_SETTINGS])}
          element={
            <SloSettings
              pageRoute={RouteMap[PageMap.SLO_VIEW_SETTINGS] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findText(text: string): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

function cardOf(element: HTMLElement): HTMLElement {
  const card: HTMLElement | null = element.closest('[data-testid="card"]');

  if (!card) {
    throw new Error("Element is not inside a card.");
  }

  return card;
}

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });

  /*
   * ModelDetail renders only the rows the viewer can read, and the edit form
   * only the fields the viewer can write - with no permissions every card
   * would load its SLO and still show an empty body. Give the viewer what a
   * project owner has.
   */
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(OWNER_PERMISSIONS);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);

  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  serveSlo({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SLO Settings page", () => {
  test("stacks the four settings cards, then the archive card", async () => {
    openSettings();

    await findText("Archive SLO");
    await findText("43m 12s of downtime per 30-day window");

    const headings: Array<string> = Array.from(
      document.querySelectorAll('[data-testid="card-details-heading"]'),
    ).map((heading: Element): string => {
      return heading.textContent?.trim() || "";
    });

    expect(headings).toEqual([...CARD_TITLES_IN_ORDER, "Archive SLO"]);
  });

  /*
   * Several StatusPage settings cards once shared one detail id, so every
   * card here gets its own, and each id stays inside its own card.
   */
  test("gives every card its own detail id", async () => {
    openSettings();

    await findText("43m 12s of downtime per 30-day window");
    await findText("Degraded");

    const cards: Set<HTMLElement> = new Set<HTMLElement>();

    for (const id of DETAIL_IDS) {
      const elements: Array<HTMLElement> = Array.from(
        document.querySelectorAll(`[id="${id}"]`),
      ) as Array<HTMLElement>;

      expect({ id: id, found: elements.length > 0 }).toEqual({
        id: id,
        found: true,
      });

      const cardsForId: Set<HTMLElement> = new Set<HTMLElement>(
        elements.map(cardOf),
      );

      expect(cardsForId.size).toBe(1);
      cards.add(Array.from(cardsForId)[0]!);
    }

    expect(cards.size).toBe(DETAIL_IDS.length);
  });

  test("shows the objective with the downtime it allows", async () => {
    openSettings();

    expect(await findText("99.9%")).toBeInTheDocument();
    expect(
      screen.getByText("20% of error budget remaining"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("43m 12s of downtime per 30-day window"),
    ).toBeInTheDocument();
  });

  /*
   * ModelDetail selects only the keys of each row's `field`. The Error
   * Budget row also needs the window, and the status chips need each
   * status's colour and order.
   */
  test("reads the sibling columns its summaries depend on", async () => {
    openSettings();

    await findText("43m 12s of downtime per 30-day window");
    await findText("Degraded");

    const objectiveRequest: GetItemRequest | undefined = getItemRequests().find(
      (request: GetItemRequest): boolean => {
        return request.select?.["atRiskThresholdPercentage"] === true;
      },
    );

    expect(objectiveRequest?.select).toEqual(
      expect.objectContaining({
        targetPercentage: true,
        windowType: true,
        windowDays: true,
      }),
    );

    const downtimeRequest: GetItemRequest | undefined = getItemRequests().find(
      (request: GetItemRequest): boolean => {
        return Boolean(request.select?.["downtimeMonitorStatuses"]);
      },
    );

    expect(downtimeRequest?.select?.["downtimeMonitorStatuses"]).toEqual({
      name: true,
      color: true,
      priority: true,
    });
  });

  test("describes a rolling period and hides the timezone that does not apply", async () => {
    openSettings();

    expect(await findText("Rolling 30-day window")).toBeInTheDocument();
    expect(screen.queryByText("Timezone")).toBeNull();
  });

  test("describes a calendar-month period by its timezone and its budget as a share of the month", async () => {
    serveSlo({
      windowType: SloWindowType.CalendarMonth,
      timezone: "Europe/Berlin",
    });

    openSettings();

    expect(
      await findText("Calendar month (Europe/Berlin)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Timezone")).toBeInTheDocument();
    expect(
      screen.getByText("Months start and end at midnight in this timezone."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "0.1% of each month: 43m 12s of downtime in a 30-day month",
      ),
    ).toBeInTheDocument();
  });

  test("explains the multi-monitor mode in plain language", async () => {
    serveSlo({ multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage });

    openSettings();

    expect(await findText("Monitor Seconds Average")).toBeInTheDocument();
    expect(
      screen.getByText(
        SLO_MULTI_MONITOR_MODE_DESCRIPTIONS[
          SloMultiMonitorMode.MonitorSecondsAverage
        ],
      ),
    ).toBeInTheDocument();
  });

  test("lists downtime statuses by name and colour, in the project's order", async () => {
    openSettings();

    await findText("Degraded");

    const list: HTMLElement = screen.getByRole("list", {
      name: "Statuses that count as downtime",
    });
    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent?.trim() || "";
      }),
    ).toEqual(["Degraded", "Offline"]);

    const degradedDot: HTMLElement | null = items[0]!.querySelector(
      'span[aria-hidden="true"]',
    );

    expect(degradedDot).toHaveStyle({ backgroundColor: "#f59e0b" });
  });

  test("names the default when no downtime statuses are chosen", async () => {
    serveSlo({ downtimeMonitorStatuses: [] });

    openSettings();

    expect(await findText("Every non-operational status")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("tells the user a disabled SLO is disabled, without a link to the page they are on", async () => {
    serveSlo({ isEnabled: false });

    openSettings();

    expect(await findText("This SLO is disabled")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Settings" })).toBeNull();
  });

  test("offers to archive the SLO with SLO wording, not telemetry wording", async () => {
    openSettings();

    await findText("Archive SLO");

    expect(screen.getByText(SLO_ARCHIVE_CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(/telemetry/)).toBeNull();
  });

  test("archives the SLO and returns to the SLO list", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    openSettings();

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Archive" },
        { timeout: WAIT_TIMEOUT },
      ),
    );

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName("Archive SLO");
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(SLO_ARCHIVE_CONFIRM_MESSAGE);

    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor((): void => {
      expect(update).toHaveBeenCalledWith({
        modelType: ServiceLevelObjective,
        id: MODEL_ID,
        data: { isArchived: true },
      });
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/slos`,
    );
  });

  test("offers to unarchive an archived SLO and says it is archived", async () => {
    serveSlo({ isArchived: true });

    openSettings();

    expect(await findText("Unarchive SLO")).toBeInTheDocument();
    expect(screen.getByText("This SLO is archived")).toBeInTheDocument();
    expect(
      screen.getByText(SLO_UNARCHIVE_CARD_DESCRIPTION),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));

    /*
     * Archive and enabled are separate flags, so the confirmation says a
     * disabled SLO stays disabled rather than promising it pages again.
     */
    expect(
      within(screen.getByRole("dialog")).getByTestId(
        "confirm-modal-description",
      ),
    ).toHaveTextContent(SLO_UNARCHIVE_CONFIRM_MESSAGE);
  });

  test("has breadcrumbs back to the SLO and the SLO list", () => {
    goTo(SETTINGS_PATH);

    const breadcrumbs: Array<Link> | undefined = getSloBreadcrumbs(
      RouteUtil.getRouteString(PageMap.SLO_VIEW_SETTINGS),
    );

    expect(
      breadcrumbs?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "SLOs", "View SLO", "Settings"]);
  });
});

describe("saving an SLO settings card", () => {
  function bannerFetchCount(): number {
    return getItemRequests().filter((request: GetItemRequest): boolean => {
      return (
        request.select?.["sloStatus"] === true &&
        request.select?.["isArchived"] === true
      );
    }).length;
  }

  /*
   * The banner says "This SLO is disabled" right above the Evaluation card;
   * saving that card must make the banner re-read the SLO, or the page
   * contradicts itself until a reload.
   */
  test("re-reads the notice banner after a card saves", async () => {
    const createOrUpdate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockResolvedValue({ data: {} } as unknown as Awaited<
        ReturnType<typeof ModelAPI.createOrUpdate>
      >);

    serveSlo({ isEnabled: false });

    openSettings();

    await findText("This SLO is disabled");
    expect(bannerFetchCount()).toBe(1);

    await userEvent.click(await findText("Edit Evaluation"));
    await userEvent.click(await findText("Save Changes"));

    await waitFor(
      () => {
        expect(createOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(bannerFetchCount()).toBe(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  /*
   * Unarchiving keeps the user on Settings, under a banner that said "This
   * SLO is archived" a moment ago; it has to re-read the SLO or it keeps
   * saying so until a reload.
   */
  test("re-reads the notice banner after the SLO is unarchived", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    serveSlo({ isArchived: true });

    openSettings();

    await findText("This SLO is archived");
    expect(bannerFetchCount()).toBe(1);

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Unarchive" },
        { timeout: WAIT_TIMEOUT },
      ),
    );

    // From here on the server has the SLO live again.
    serveSlo({});

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Unarchive",
      }),
    );

    await waitFor(
      () => {
        expect(update).toHaveBeenCalledWith({
          modelType: ServiceLevelObjective,
          id: MODEL_ID,
          data: { isArchived: false },
        });
      },
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(bannerFetchCount()).toBe(2);
      },
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(screen.queryByText("This SLO is archived")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
