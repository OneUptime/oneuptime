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
import { getTurnOffSloEvaluationConfirmation } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloEvaluationCard";
import SloEvaluationSwitchCopy, {
  SLO_EVALUATION_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloEvaluationSwitchCopy";
import { SLO_MULTI_MONITOR_MODE_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";
import { getSloBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/Breadcrumbs";
import UsedByApi from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByApi";
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
import {
  UsedByRecordKind,
  UsedByRelation,
  UsedByRowKind,
  UsedBySummary,
} from "../../../Types/UsedBy/UsedBy";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";

/*
 * Reads the page makes that these tests leave unanswered: refused at
 * once, as the network refused them, and taken as reads it could not
 * make (Tests/Helpers/RealNetworkRequests.ts). A Metric SLO's page reads
 * the kind of its metric's newest point, to say when a gauge has no events
 * to count (#10027): unread, it says nothing of it.
 */
refuseRequestsTo(["/monitor-status/get-list", "/metrics/get-list"]);

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
  "What It Measures",
  "Objective",
  "Compliance Period",
  "Downtime Calculation",
  "Evaluation",
];

const DETAIL_IDS: Array<string> = [
  "slo-settings-measures",
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
  test("stacks the five settings cards, then the archive card", async () => {
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
    /*
     * What still uses the SLO, which its Archive dialog says (#7437): two
     * burn-rate rules watch it.
     */
    const usedBy: UsedBySummary = {
      recordKind: UsedByRecordKind.Slo,
      recordId: MODEL_ID.toString(),
      groups: [
        {
          relation: UsedByRelation.SloBurnRateRules,
          rowKind: UsedByRowKind.SloBurnRateRule,
          count: 2,
          hiddenCount: 0,
          rows: [],
        },
      ],
    };
    const getUsedBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UsedByApi, "getSummary")
      .mockResolvedValue(usedBy);

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
    // Read for this SLO when the dialog opens, and said in it.
    expect(
      await within(dialog).findByTestId(
        "used-by-impact",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent("2 burn-rate rules watch this SLO.");
    expect(getUsedBy).toHaveBeenCalledWith({
      recordKind: UsedByRecordKind.Slo,
      recordId: MODEL_ID,
    });

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
   * A card's save can change what the banner says (a target out of range,
   * fixed on the Objective card); the banner must read the SLO again, or
   * the page contradicts itself until a reload.
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

    await userEvent.click(await findText("Edit Objective"));
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

/*
 * Edit Period and Edit Downtime Calculation asked with dropdowns whose one
 * description explained both modes ("Rolling suits ... Calendar Month suits
 * ..."), with each mode's meaning hidden in the closed list. The modes are
 * answers on the dialog now, each with one line, and the stored values are
 * the enum values they always were.
 */
describe("the period and the downtime as plain choices", () => {
  let createOrUpdate: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    createOrUpdate = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockResolvedValue({ data: {} } as unknown as Awaited<
        ReturnType<typeof ModelAPI.createOrUpdate>
      >);
  });

  async function openCardEdit(buttonName: string): Promise<HTMLElement> {
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: buttonName },
        { timeout: WAIT_TIMEOUT },
      ),
    );

    return await screen.findByTestId("modal", {}, { timeout: WAIT_TIMEOUT });
  }

  function lineOf(radio: HTMLElement): string {
    const id: string | null = radio.getAttribute("aria-describedby");

    return (document.getElementById(id || "")?.textContent || "").trim();
  }

  function savedModel(): Record<string, unknown> {
    return (
      createOrUpdate.mock.calls[0]![0] as { model: Record<string, unknown> }
    ).model;
  }

  test.each(["Edit Objective", "Edit Period", "Edit Downtime Calculation"])(
    "%s opens a dialog titled like its button, not 'Edit Service Level Objective'",
    async (buttonName: string) => {
      openSettings();
      const modal: HTMLElement = await openCardEdit(buttonName);

      expect(
        (within(modal).getByTestId("modal-title").textContent || "").trim(),
      ).toBe(buttonName);
      expect(
        within(modal).queryByText("Edit Service Level Objective"),
      ).toBeNull();
    },
  );

  test("Edit Period asks the window type as two answers, each with its line", async () => {
    openSettings();
    const modal: HTMLElement = await openCardEdit("Edit Period");

    const question: HTMLElement = await within(modal).findByRole(
      "radiogroup",
      { name: /^Window Type/ },
      { timeout: WAIT_TIMEOUT },
    );
    const rolling: HTMLElement = within(question).getByRole("radio", {
      name: "Rolling",
    });
    const calendar: HTMLElement = within(question).getByRole("radio", {
      name: "Calendar Month",
    });

    expect(rolling).toBeChecked();
    expect(calendar).not.toBeChecked();
    expect(lineOf(rolling)).toBe(
      "The last N days, always up to date. Suits services that must be reliable at every moment.",
    );
    expect(lineOf(calendar)).toBe(
      "Each month on its own, reset on the 1st. Suits targets reported or promised per month.",
    );
    expect(within(modal).queryByText(/Rolling suits services/)).toBeNull();
    expect(
      within(modal).queryByRole("combobox", { name: /^Window Type/ }),
    ).toBeNull();
  });

  test("picking Calendar Month swaps the days for the timezone, and saves the month", async () => {
    openSettings();
    const modal: HTMLElement = await openCardEdit("Edit Period");

    const question: HTMLElement = await within(modal).findByRole(
      "radiogroup",
      { name: /^Window Type/ },
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(modal).getByText("Window (Days)")).toBeInTheDocument();

    fireEvent.click(
      within(question).getByRole("radio", { name: "Calendar Month" }),
    );

    await waitFor(
      () => {
        expect(within(modal).queryByText("Window (Days)")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(within(modal).getByText("Timezone")).toBeInTheDocument();

    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(createOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(savedModel()["windowType"]).toBe(SloWindowType.CalendarMonth);
  });

  test("Edit Downtime Calculation asks the multi-monitor mode as two answers, each with its line", async () => {
    serveSlo({ multiMonitorMode: SloMultiMonitorMode.AnyDown });

    openSettings();
    const modal: HTMLElement = await openCardEdit("Edit Downtime Calculation");

    const question: HTMLElement = await within(modal).findByRole(
      "radiogroup",
      { name: /^Multi Monitor Mode/ },
      { timeout: WAIT_TIMEOUT },
    );
    const anyDown: HTMLElement = within(question).getByRole("radio", {
      name: SloMultiMonitorMode.AnyDown,
    });
    const average: HTMLElement = within(question).getByRole("radio", {
      name: SloMultiMonitorMode.MonitorSecondsAverage,
    });

    expect(anyDown).toBeChecked();
    expect(lineOf(anyDown)).toBe(
      "Down whenever any monitor is down. For monitors that must all be up.",
    );
    expect(lineOf(average)).toBe(
      "Downtime averaged across monitors. For replicas, where one down is a partial outage.",
    );
    expect(
      within(modal).getByText(
        "Only matters when this SLO measures more than one monitor.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(average);
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(createOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(savedModel()["multiMonitorMode"]).toBe(
      SloMultiMonitorMode.MonitorSecondsAverage,
    );
  });
});

/*
 * Evaluation is one switch, "Evaluate this SLO", saving the moment it is
 * flipped, with when the SLO was last evaluated as a line under it. It used
 * to be Edit Evaluation, flip "Enabled", Save. Turning it off asks first,
 * because it also resolves the SLO's open burn rate alerts and incidents;
 * the banner above it follows the switch, and its own "Turn evaluation on"
 * moves the switch.
 */
describe("the Evaluation switch", () => {
  function bannerFetchCount(): number {
    return getItemRequests().filter((request: GetItemRequest): boolean => {
      return (
        request.select?.["sloStatus"] === true &&
        request.select?.["isArchived"] === true
      );
    }).length;
  }

  async function findSwitch(): Promise<HTMLElement> {
    return await screen.findByTestId(
      SLO_EVALUATION_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
  }

  function evaluationCard(): HTMLElement {
    return cardOf(screen.getByTestId(SLO_EVALUATION_SWITCH_TEST_ID));
  }

  function saveSucceeds(): ReturnType<typeof jest.spyOn> {
    return jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
  }

  test("is one switch with no Edit button, and Last Evaluated under it", async () => {
    openSettings();

    const control: HTMLElement = await findSwitch();

    expect(
      screen.getByRole("switch", {
        name: SloEvaluationSwitchCopy.switchTitle,
      }),
    ).toBe(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Edit Evaluation")).toBeNull();

    const card: HTMLElement = evaluationCard();
    expect(
      within(card).getByText(SloEvaluationSwitchCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(SloEvaluationSwitchCopy.switchOnDescription),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(SloEvaluationSwitchCopy.lastEvaluatedTitle),
    ).toBeInTheDocument();
    expect(within(card).getByText(/ago$/)).toBeInTheDocument();
  });

  test("an SLO never evaluated says so under the switch", async () => {
    serveSlo({ lastEvaluatedAt: null });

    openSettings();
    await findSwitch();

    expect(
      within(evaluationCard()).getByText(
        SloEvaluationSwitchCopy.notEvaluatedYet,
      ),
    ).toBeInTheDocument();
    expect(
      within(evaluationCard()).getByText(
        SloEvaluationSwitchCopy.notEvaluatedYetDescription,
      ),
    ).toBeInTheDocument();
  });

  test("turning evaluation off asks first, and says it resolves what the burn rate rules have open", async () => {
    const update: ReturnType<typeof jest.spyOn> = saveSucceeds();

    openSettings();
    const control: HTMLElement = await findSwitch();

    fireEvent.click(control);

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName(
      SloEvaluationSwitchCopy.turnOffConfirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(SloEvaluationSwitchCopy.turnOffConfirmDescription);
    expect(update).not.toHaveBeenCalled();

    // From here on the server has the SLO disabled.
    serveSlo({ isEnabled: false });

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: SloEvaluationSwitchCopy.turnOffConfirmButton,
      }),
    );

    await waitFor(
      () => {
        expect(update).toHaveBeenCalledWith({
          modelType: ServiceLevelObjective,
          id: MODEL_ID,
          data: { isEnabled: false },
        });
      },
      { timeout: WAIT_TIMEOUT },
    );

    // The banner above hears the switch and says so, without a reload.
    expect(await findText("This SLO is disabled")).toBeInTheDocument();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      within(evaluationCard()).getByText(
        SloEvaluationSwitchCopy.switchOffDescription,
      ),
    ).toBeInTheDocument();
  });

  test("cancelled, evaluation stays on and nothing is saved", async () => {
    const update: ReturnType<typeof jest.spyOn> = saveSucceeds();

    openSettings();
    const control: HTMLElement = await findSwitch();

    fireEvent.click(control);

    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(update).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("turning a disabled SLO back on saves at once, and the banner goes", async () => {
    const update: ReturnType<typeof jest.spyOn> = saveSucceeds();

    serveSlo({ isEnabled: false });

    openSettings();

    await findText("This SLO is disabled");
    expect(bannerFetchCount()).toBe(1);

    const control: HTMLElement = await findSwitch();
    expect(control).toHaveAttribute("aria-checked", "false");

    // From here on the server has the SLO live again.
    serveSlo({});

    fireEvent.click(control);

    await waitFor(
      () => {
        expect(update).toHaveBeenCalledWith({
          modelType: ServiceLevelObjective,
          id: MODEL_ID,
          data: { isEnabled: true },
        });
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(
      () => {
        expect(bannerFetchCount()).toBe(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(screen.queryByText("This SLO is disabled")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("the banner's Turn evaluation on moves the switch below it", async () => {
    const update: ReturnType<typeof jest.spyOn> = saveSucceeds();

    serveSlo({ isEnabled: false });

    openSettings();

    const control: HTMLElement = await findSwitch();
    expect(control).toHaveAttribute("aria-checked", "false");

    serveSlo({});

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: SloEvaluationSwitchCopy.turnOnButton },
        { timeout: WAIT_TIMEOUT },
      ),
    );

    await waitFor(
      () => {
        expect(update).toHaveBeenCalledWith({
          modelType: ServiceLevelObjective,
          id: MODEL_ID,
          data: { isEnabled: true },
        });
      },
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(control).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(screen.queryByText("This SLO is disabled")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("the confirmation is for turning evaluation off only, as a danger", () => {
    expect(getTurnOffSloEvaluationConfirmation(true)).toBeUndefined();
    expect(getTurnOffSloEvaluationConfirmation(false)).toEqual({
      title: SloEvaluationSwitchCopy.turnOffConfirmTitle,
      description: SloEvaluationSwitchCopy.turnOffConfirmDescription,
      submitButtonText: SloEvaluationSwitchCopy.turnOffConfirmButton,
      submitButtonType: ButtonStyleType.DANGER,
    });
  });
});

/*
 * A request SLO's Settings: What It Measures names its SLI type, services
 * and threshold; its error budget is in requests; and it has no downtime to
 * calculate, so that card is not drawn at all.
 */
describe("SLO Settings page - a request SLO", () => {
  const REQUEST_SLO: SloFields = {
    sliType: SliType.RequestLatency,
    latencyThresholdInMilliseconds: 300,
    services: [
      { _id: "6c000000-0000-4000-8000-000000000001", name: "checkout" },
      { _id: "6c000000-0000-4000-8000-000000000002", name: "payments" },
    ],
  };

  test("names what it measures: the SLI type, its services and its threshold", async () => {
    serveSlo(REQUEST_SLO);
    openSettings();

    await findText("Request latency");
    await findText("checkout");
    await findText("payments");
    await findText("300 ms");
    await findText("A request served within this counts as fast enough.");
  });

  test("says its error budget in requests", async () => {
    serveSlo(REQUEST_SLO);
    openSettings();

    await findText("0.1% of requests: 1 bad request in every 1,000");
    await findText(
      "The bad requests this objective allows before it is breached.",
    );
    expect(
      screen.queryByText("43m 12s of downtime per 30-day window"),
    ).toBeNull();
  });

  test("has no Downtime Calculation card", async () => {
    serveSlo(REQUEST_SLO);
    openSettings();

    await findText("Archive SLO");
    await findText("checkout");

    const headings: Array<string> = Array.from(
      document.querySelectorAll('[data-testid="card-details-heading"]'),
    ).map((heading: Element): string => {
      return heading.textContent?.trim() || "";
    });

    expect(headings).toEqual([
      "What It Measures",
      "Objective",
      "Compliance Period",
      "Evaluation",
      "Archive SLO",
    ]);
  });

  test("a request SLO with no services says so", async () => {
    serveSlo({ ...REQUEST_SLO, services: [] });
    openSettings();

    await findText("No services chosen");
  });

  test("a Monitor Uptime SLO shows neither services nor a threshold", async () => {
    openSettings();

    await findText("Monitor uptime");
    await findText("Downtime Calculation");
    expect(screen.queryByText("No services chosen")).toBeNull();
    expect(
      screen.queryByText("A request served within this counts as fast enough."),
    ).toBeNull();
    // Nor a request filter (#8444).
    expect(screen.queryByText("Every request of its services")).toBeNull();
  });

  // Which of the services' requests count (#8444).
  test("names its request filter as written, and what it does", async () => {
    serveSlo({
      ...REQUEST_SLO,
      requestFilter: "@http.route:/checkout* -@http.route:/health",
    });
    openSettings();

    const code: HTMLElement = await screen.findByTestId(
      "slo-settings-request-filter",
    );

    expect(code.tagName).toBe("CODE");
    expect(code).toHaveTextContent(
      "@http.route:/checkout* -@http.route:/health",
    );
    await findText("Only the requests that match this traces search count.");
  });

  test("with no request filter, says it counts every request of its services", async () => {
    serveSlo(REQUEST_SLO);
    openSettings();

    await findText("Every request of its services");
    expect(screen.queryByTestId("slo-settings-request-filter")).toBeNull();
  });
  /*
   * A Metric SLO (#8445): its services, then its metric - the name, what
   * makes an event good and which of its series count, each under the
   * title the form asks it with, as written - and no downtime to calculate.
   */
  const METRIC_SLO: SloFields = {
    sliType: SliType.Metric,
    services: REQUEST_SLO["services"],
    metricQueryConfig: {
      metricName: "http.server.request.duration",
      kind: "Histogram",
      goodAtOrUnder: 0.3,
      filter: "-@http.route:/health",
    },
  };

  test("a Metric SLO names its metric, its value and its filter, in code", async () => {
    serveSlo(METRIC_SLO);
    openSettings();

    const name: HTMLElement = await screen.findByTestId(
      "slo-settings-metric-name",
    );

    expect(name.tagName).toBe("CODE");
    expect(name).toHaveTextContent("http.server.request.duration");
    expect(
      screen.getByTestId("slo-settings-metric-goodAtOrUnder"),
    ).toHaveTextContent("0.3");
    expect(screen.getByTestId("slo-settings-metric-filter")).toHaveTextContent(
      "-@http.route:/health",
    );
    await findText("Good At Or Under");
    await findText("Metric Filter");
    // Its services, as a request SLO's.
    await findText("checkout");
    // No request filter or downtime: those are a request's or a monitor's.
    expect(screen.queryByText("Every request of its services")).toBeNull();
    expect(screen.queryByText("Downtime Calculation")).toBeNull();
  });

  test("a Metric SLO's counter names its good condition", async () => {
    serveSlo({
      ...METRIC_SLO,
      metricQueryConfig: {
        metricName: "http_requests_total",
        kind: "Counter",
        goodFilter: "@http.response.status_code:<500",
      },
    });
    openSettings();

    expect(
      await screen.findByTestId("slo-settings-metric-goodFilter"),
    ).toHaveTextContent("@http.response.status_code:<500");
    await findText("Good When");
  });

  test("a Metric SLO with no metric says so", async () => {
    serveSlo({ ...METRIC_SLO, metricQueryConfig: null });
    openSettings();

    await findText("No metric chosen");
    expect(screen.queryByTestId("slo-settings-metric")).toBeNull();
  });

  test("a Metric SLO's error budget is in events", async () => {
    serveSlo({ ...METRIC_SLO, targetPercentage: 99.9 });
    openSettings();

    await findText("0.1% of events: 1 bad event in every 1,000");
    await findText(
      "The bad events this objective allows before it is breached.",
    );
  });
});
