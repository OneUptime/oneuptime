import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { HERO_ICON_BUTTON_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHeroButton";
import MonitorChangeStatusMenu, {
  ComponentProps,
  getMonitorStatusChoices,
  MONITOR_CHANGE_STATUS_FALLBACK_TEST_ID,
  MONITOR_CHANGE_STATUS_LOADING_TEST_ID,
  MONITOR_CHANGE_STATUS_MENU_TEST_ID,
  MONITOR_CHANGE_STATUS_OPTION_TEST_ID,
  MonitorStatusChoice,
  toMonitorStatusChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorChangeStatusMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * The manual monitor's More actions (⋯) menu on the overview's hero: "Please
 * move the change status button near the refresh button, and it should be
 * hidden behind the more button (three dots)."
 *
 * It lists the project's statuses but the current one under "Change status
 * to", each with its colour; picking one asks once, then records a status
 * event that starts now and tells the page. A locked reader sees why; a
 * menu with nothing to offer falls back to the Status Timeline page, where
 * "Change status" used to send everyone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);

const OPERATIONAL_ID: string = "22222222-2222-4222-8222-222222222222";
const DEGRADED_ID: string = "33333333-3333-4333-8333-333333333333";
const OFFLINE_ID: string = "44444444-4444-4444-8444-444444444444";

const LOCKED_REASON: string =
  "You do not have permission to create this Monitor Status Event. You need one of these permissions: Project Owner, Project Admin, Project Member, Monitor Admin, Monitor Member.";

function statusRow(id: string, name: string, color: string): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = id;
  status.name = name;
  status.color = new Color(color);
  return status;
}

// The project's statuses, by priority, as the API answers the menu's read.
const PROJECT_STATUSES: Array<MonitorStatus> = [
  statusRow(OPERATIONAL_ID, "Operational", "#10b981"),
  statusRow(DEGRADED_ID, "Degraded", "#f59e0b"),
  statusRow(OFFLINE_ID, "Offline", "#ef4444"),
];

interface ListCall {
  modelType: unknown;
  query: JSONObject;
  select: JSONObject;
  sort: JSONObject;
  limit: number;
  skip: number;
}

let getListMock: ReturnType<typeof getJestSpyOn>;
let createMock: ReturnType<typeof getJestSpyOn>;
let navigateMock: ReturnType<typeof getJestSpyOn>;
let gate: PermissionGateResult = { isAllowed: true };
let gateCalls: Array<{ modelName: string; action: ModelAction }> = [];

beforeEach(() => {
  gate = { isAllowed: true };
  gateCalls = [];

  getJestSpyOn(PermissionGate, "check").mockImplementation(((
    model: { tableName?: string | null },
    action: ModelAction,
  ): PermissionGateResult => {
    gateCalls.push({ modelName: String(model.tableName), action: action });
    return gate;
  }) as never);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListMock = getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return {
        data: PROJECT_STATUSES,
        count: PROJECT_STATUSES.length,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      };
    },
  );

  createMock = getJestSpyOn(ModelAPI, "create").mockImplementation(
    async (): Promise<unknown> => {
      return {};
    },
  );

  navigateMock = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
};

function renderMenu(overrides?: Partial<ComponentProps>): RenderResult {
  const props: ComponentProps = {
    monitorId: MONITOR_ID,
    currentStatusId: OPERATIONAL_ID,
    onStatusChanged: (): void => {},
    ...overrides,
  };

  return render(<MonitorChangeStatusMenu {...props} />);
}

async function renderLoaded(
  overrides?: Partial<ComponentProps>,
): Promise<RenderResult> {
  const view: RenderResult = renderMenu(overrides);
  await flush();
  return view;
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "More actions" });
}

function openMenu(): HTMLElement {
  fireEvent.click(trigger());
  return screen.getByRole("menu");
}

function itemTexts(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function pick(name: string): void {
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: name }),
  );
}

function statusTimelineRoute(monitorId: ObjectID): string {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route,
    { modelId: monitorId },
  ).toString();
}

describe("the statuses it offers", () => {
  const choices: Array<MonitorStatusChoice> = [
    { id: OPERATIONAL_ID, name: "Operational", color: "#10b981" },
    { id: DEGRADED_ID, name: "Degraded", color: "#f59e0b" },
    { id: OFFLINE_ID, name: "Offline", color: "#ef4444" },
  ];

  test("every status but the current one, in the order they were read", () => {
    expect(
      getMonitorStatusChoices({
        statuses: choices,
        currentStatusId: DEGRADED_ID,
      }).map((choice: MonitorStatusChoice): string => {
        return choice.name;
      }),
    ).toEqual(["Operational", "Offline"]);
  });

  test("the current status is matched whatever the id's case", () => {
    expect(
      getMonitorStatusChoices({
        statuses: choices,
        currentStatusId: OFFLINE_ID.toUpperCase(),
      }).map((choice: MonitorStatusChoice): string => {
        return choice.id;
      }),
    ).toEqual([OPERATIONAL_ID, DEGRADED_ID]);
  });

  test("a monitor with no status recorded yet is offered every status", () => {
    expect(
      getMonitorStatusChoices({
        statuses: choices,
        currentStatusId: undefined,
      }),
    ).toEqual(choices);
    expect(
      getMonitorStatusChoices({ statuses: choices, currentStatusId: "" }),
    ).toEqual(choices);
  });

  test("a status row becomes a choice with its colour, and a row without an id or a name is dropped", () => {
    expect(toMonitorStatusChoice(PROJECT_STATUSES[2]!)).toEqual({
      id: OFFLINE_ID,
      name: "Offline",
      color: "#ef4444",
    });

    const unnamed: MonitorStatus = statusRow(OFFLINE_ID, "  ", "#ef4444");
    expect(toMonitorStatusChoice(unnamed)).toBeNull();

    const noId: MonitorStatus = new MonitorStatus();
    noId.name = "Offline";
    expect(toMonitorStatusChoice(noId)).toBeNull();

    const colourless: MonitorStatus = new MonitorStatus();
    colourless._id = DEGRADED_ID;
    colourless.name = "Degraded";
    expect(toMonitorStatusChoice(colourless)).toEqual({
      id: DEGRADED_ID,
      name: "Degraded",
      color: undefined,
    });
  });

  test("a colour that is not one is dropped, never passed to a style", () => {
    const status: MonitorStatus = statusRow(OFFLINE_ID, "Offline", "#ef4444");
    (status as unknown as { color: string }).color = "url(javascript:alert(1))";

    expect(toMonitorStatusChoice(status)).toEqual({
      id: OFFLINE_ID,
      name: "Offline",
      color: undefined,
    });
  });
});

describe("the ⋯ button", () => {
  test("is named More actions, says it opens a menu, and is drawn like Refresh beside it", async () => {
    await renderLoaded();

    const button: HTMLElement = trigger();

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute(
      "data-testid",
      MONITOR_CHANGE_STATUS_MENU_TEST_ID,
    );

    for (const token of HERO_ICON_BUTTON_CLASS_NAME.split(" ")) {
      expect(button).toHaveClass(token);
    }

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  test("is gated on creating a status event, the write a status change is", async () => {
    await renderLoaded();

    expect(gateCalls.length).toBeGreaterThan(0);
    for (const call of gateCalls) {
      expect(call).toEqual({
        modelName: new MonitorStatusTimeline().tableName,
        action: ModelAction.Create,
      });
    }
  });

  test("while the permission snapshot has not landed it offers nothing at all", async () => {
    gate = { isAllowed: false };

    const view: RenderResult = await renderLoaded();

    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(view.container).toBeEmptyDOMElement();
  });
});

describe("reading the statuses", () => {
  test("reads the project's statuses once, by priority, with only what the menu shows", async () => {
    await renderLoaded();

    expect(getListMock).toHaveBeenCalledTimes(1);

    const call: ListCall = getListMock.mock.calls[0]![0] as ListCall;

    expect(call.modelType).toBe(MonitorStatus);
    expect(call.query).toEqual({ projectId: PROJECT_ID });
    expect(call.select).toEqual({ _id: true, name: true, color: true });
    expect(call.sort).toEqual({ priority: SortOrder.Ascending });
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
  });

  test("a new current status (the page re-read the monitor) does not read them again", async () => {
    const view: RenderResult = await renderLoaded();

    view.rerender(
      <MonitorChangeStatusMenu
        monitorId={MONITOR_ID}
        currentStatusId={OFFLINE_ID}
      />,
    );
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(itemTexts(openMenu())).toEqual(["Operational", "Degraded"]);
  });

  test("another monitor reads them again", async () => {
    const view: RenderResult = await renderLoaded();

    view.rerender(
      <MonitorChangeStatusMenu
        monitorId={OTHER_MONITOR_ID}
        currentStatusId={OPERATIONAL_ID}
      />,
    );
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("while they load, the menu says so and offers nothing to press", async () => {
    getListMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>(() => {});
    });

    renderMenu();
    await flush();

    const menu: HTMLElement = openMenu();
    const loading: HTMLElement = within(menu).getByTestId(
      MONITOR_CHANGE_STATUS_LOADING_TEST_ID,
    );

    expect(loading).toHaveTextContent("Loading…");
    expect(loading).toBeDisabled();
    expect(
      within(menu).queryAllByTestId(MONITOR_CHANGE_STATUS_OPTION_TEST_ID),
    ).toHaveLength(0);

    fireEvent.click(loading);
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});

describe("the menu", () => {
  test("lists every status but the current one under Change status to, by priority", async () => {
    await renderLoaded({ currentStatusId: OPERATIONAL_ID });

    const menu: HTMLElement = openMenu();

    expect(menu).toHaveTextContent("CHANGE STATUS TO");
    expect(itemTexts(menu)).toEqual(["Degraded", "Offline"]);
    expect(
      within(menu).getAllByTestId(MONITOR_CHANGE_STATUS_OPTION_TEST_ID),
    ).toHaveLength(2);
  });

  test("each status wears its own colour, as the status pickers draw it", async () => {
    await renderLoaded({ currentStatusId: OPERATIONAL_ID });

    const dots: Array<string> = within(openMenu())
      .getAllByTestId("more-menu-item-color")
      .map((dot: HTMLElement): string => {
        return (dot.firstElementChild as HTMLElement).style.backgroundColor;
      });

    expect(dots).toEqual(["rgb(245, 158, 11)", "rgb(239, 68, 68)"]);
  });

  test("a monitor with no status recorded yet is offered all of them", async () => {
    await renderLoaded({ currentStatusId: undefined });

    expect(itemTexts(openMenu())).toEqual([
      "Operational",
      "Degraded",
      "Offline",
    ]);
  });

  test("the keyboard opens it, walks it and picks from it", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await renderLoaded({ currentStatusId: OPERATIONAL_ID });

    await act(async () => {
      trigger().focus();
      await user.keyboard("{Enter}");
    });

    const menu: HTMLElement = screen.getByRole("menu");
    const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

    // The first status takes the focus as the menu opens.
    await waitFor(() => {
      expect(document.activeElement).toBe(items[0]);
    });

    await act(async () => {
      await user.keyboard("{ArrowDown}");
    });
    expect(document.activeElement).toBe(items[1]);

    await act(async () => {
      await user.keyboard("{Enter}");
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Change status to Offline?",
    );
  });

  test("Escape closes it and gives the focus back to the ⋯", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await renderLoaded();

    await act(async () => {
      trigger().focus();
      await user.keyboard("{Enter}");
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await act(async () => {
      await user.keyboard("{Escape}");
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});

describe("changing the status", () => {
  test("picking a status asks first, saying what will change", async () => {
    await renderLoaded();

    openMenu();
    pick("Offline");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Change status to Offline?",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "The monitor shows Offline from now on, here and on every status page that lists it.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Change status",
    );
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Cancel",
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  test("Cancel changes nothing", async () => {
    const onStatusChanged: MockFunction = getJestMockFunction();
    await renderLoaded({ onStatusChanged });

    openMenu();
    pick("Degraded");
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
    expect(onStatusChanged).not.toHaveBeenCalled();
  });

  test("confirming records a status event for this monitor that starts now, and tells the page", async () => {
    const onStatusChanged: MockFunction = getJestMockFunction();
    await renderLoaded({ onStatusChanged });

    openMenu();
    pick("Offline");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);

    const call: { model: MonitorStatusTimeline; modelType: unknown } =
      createMock.mock.calls[0]![0] as {
        model: MonitorStatusTimeline;
        modelType: unknown;
      };

    expect(call.modelType).toBe(MonitorStatusTimeline);
    expect(call.model).toBeInstanceOf(MonitorStatusTimeline);
    expect(call.model.monitorId?.toString()).toBe(MONITOR_ID.toString());
    expect(call.model.monitorStatusId?.toString()).toBe(OFFLINE_ID);
    expect(call.model.projectId?.toString()).toBe(PROJECT_ID.toString());
    // The server starts it at its own now, as for a change sent by the API.
    expect(call.model.startsAt).toBeUndefined();

    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("it saves once however fast it is confirmed, and is busy while it saves", async () => {
    let finish: () => void = (): void => {};
    createMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    const onStatusChanged: MockFunction = getJestMockFunction();
    await renderLoaded({ onStatusChanged });

    openMenu();
    pick("Offline");

    const submit: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );
    fireEvent.click(submit);
    fireEvent.click(submit);
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    // Cancel cannot drop a save that is already out.
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(screen.getByTestId("modal")).toBeInTheDocument();

    await act(async () => {
      finish();
    });
    await flush();

    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("a refused change says why in the dialog, tells the page nothing, and can be tried again", async () => {
    createMock.mockImplementationOnce(async (): Promise<unknown> => {
      throw new Error("Monitor Status cannot be same as previous status.");
    });

    const onStatusChanged: MockFunction = getJestMockFunction();
    await renderLoaded({ onStatusChanged });

    openMenu();
    pick("Degraded");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await flush();

    expect(screen.getByTestId("modal-error")).toHaveTextContent(
      "Monitor Status cannot be same as previous status.",
    );
    expect(onStatusChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await flush();

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("the error of one attempt is gone when another status is picked", async () => {
    createMock.mockImplementationOnce(async (): Promise<unknown> => {
      throw new Error("The server is restarting.");
    });

    await renderLoaded();

    openMenu();
    pick("Degraded");
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await flush();
    expect(screen.getByTestId("modal-error")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    openMenu();
    pick("Offline");

    expect(screen.queryByTestId("modal-error")).toBeNull();
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Change status to Offline?",
    );
  });

  test("works without a page to tell", async () => {
    await renderLoaded({ onStatusChanged: undefined });

    openMenu();
    pick("Offline");
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});

describe("someone who may not change it", () => {
  test("sees the statuses locked, each saying why, and picking one opens nothing", async () => {
    gate = { isAllowed: false, disabledReason: LOCKED_REASON };

    await renderLoaded();

    const menu: HTMLElement = openMenu();
    const items: Array<HTMLElement> = within(menu).getAllByTestId(
      MONITOR_CHANGE_STATUS_OPTION_TEST_ID,
    );

    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item).toHaveAttribute("aria-disabled", "true");
      // Still reachable, so the reason can be read from the keyboard.
      expect(item).not.toBeDisabled();
      const describedBy: string = item.getAttribute("aria-describedby") || "";
      expect(document.getElementById(describedBy)).toHaveTextContent(
        LOCKED_REASON,
      );
    }

    fireEvent.click(items[0]!);

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("with nothing to offer it falls back to the Status Timeline", () => {
  test("when the statuses cannot be read", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to read Monitor Status.");
    });

    await renderLoaded();

    const menu: HTMLElement = openMenu();

    expect(itemTexts(menu)).toEqual(["Change status"]);

    fireEvent.click(
      within(menu).getByTestId(MONITOR_CHANGE_STATUS_FALLBACK_TEST_ID),
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      statusTimelineRoute(MONITOR_ID),
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  test("locked, saying why, for someone who may not change the status", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The server is restarting.");
    });
    gate = { isAllowed: false, disabledReason: LOCKED_REASON };

    await renderLoaded();

    const fallback: HTMLElement = within(openMenu()).getByTestId(
      MONITOR_CHANGE_STATUS_FALLBACK_TEST_ID,
    );

    expect(fallback).toHaveAttribute("aria-disabled", "true");
    expect(
      document.getElementById(fallback.getAttribute("aria-describedby") || ""),
    ).toHaveTextContent(LOCKED_REASON);

    fireEvent.click(fallback);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("when the current status is the only one the project has", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      return {
        data: [PROJECT_STATUSES[0]!],
        count: 1,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      };
    });

    await renderLoaded({ currentStatusId: OPERATIONAL_ID });

    const menu: HTMLElement = openMenu();

    expect(menu).not.toHaveTextContent("CHANGE STATUS TO");
    expect(
      within(menu).getByTestId(MONITOR_CHANGE_STATUS_FALLBACK_TEST_ID),
    ).toHaveTextContent("Change status");
  });
});

describe("in German", () => {
  const german: i18n = createInstance();

  // The Dashboard's own German file, so a missing translation fails here.
  const GERMAN: JSONObject = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "de.json",
      ),
      "utf8",
    ),
  ) as JSONObject;

  function inGerman(key: string): string {
    const value: unknown = GERMAN[key];

    if (typeof value !== "string" || value === key) {
      throw new Error(`"${key}" has no German translation.`);
    }

    return value;
  }

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: { de: { translation: GERMAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  function renderGerman(): ReactElement {
    return (
      <I18nextProvider i18n={german}>
        <MonitorChangeStatusMenu
          monitorId={MONITOR_ID}
          currentStatusId={OPERATIONAL_ID}
        />
      </I18nextProvider>
    );
  }

  test("names the ⋯, the section and the statuses in German", async () => {
    render(renderGerman());
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: inGerman("More actions") }),
    );

    const menu: HTMLElement = screen.getByRole("menu");
    expect(menu).toHaveTextContent(inGerman("Change status to").toUpperCase());
    expect(itemTexts(menu)).toEqual([inGerman("Degraded"), "Offline"]);
  });

  test("asks in German", async () => {
    render(renderGerman());
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: inGerman("More actions") }),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: inGerman("Degraded"),
      }),
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      inGerman("Change status to {{status}}?").replace(
        "{{status}}",
        inGerman("Degraded"),
      ),
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      inGerman(
        "The monitor shows {{status}} from now on, here and on every status page that lists it.",
      ).replace("{{status}}", inGerman("Degraded")),
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      inGerman("Change status"),
    );
  });
});
