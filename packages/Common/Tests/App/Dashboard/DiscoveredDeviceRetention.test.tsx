import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import DiscoveredDeviceRetentionCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCard";
import DiscoveredDeviceRetentionCopy, {
  DISCOVERED_DEVICE_RETENTION_CARD_TEST_ID,
  DISCOVERED_DEVICE_RETENTION_LINE,
  DISCOVERED_DEVICE_RETENTION_PLACE,
  DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID,
  DISCOVERED_DEVICES_MORE_SETTINGS_TEST_ID,
  DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCopy";
import DiscoveredDevicesTable from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable";
import NetworkEndpoints from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Endpoints";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import DiscoveryImportFakeServer from "./DiscoveryImportFakeServer";
import DiscoveredDevicesFakeServer, {
  FAKE_DISCOVERED_DEVICE_ROUTES,
  FakeDiscoveredDevice,
} from "./DiscoveredDevicesFakeServer";

/*
 * UNSEEN DEVICES, RENDERED (OneUptime issue #6389).
 *
 * Discovered devices nothing has seen for a while are removed from the
 * list; how long they stay is the project's Discovered Device Retention.
 * The real list, the real Unseen Devices card and the real Discovered
 * Devices page, over an in-memory list API (DiscoveredDevicesFakeServer)
 * and the project read and write stood in for. What these pin is what a
 * person sees and what is saved:
 *
 *   - one quiet line under the list says how long devices stay - Never
 *     included - only once there is a device to say it of, with Change for
 *     a Project Owner or Admin, to the setting's place, from a site's list
 *     too; in the reader's language and digits;
 *   - the card reads the project's setting and saves a pick at once,
 *     says Saved, goes back with the reason when refused, is locked for
 *     anyone else, and says when the project cannot be read, with Try
 *     again;
 *   - on the page, the card is folded under More settings, whose header
 *     says the setting while it is not the default; a link to its place
 *     opens the fold at it; a save reaches the line at once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a1f0c3e-2b4d-4e5f-8a9b-0c1d2e3f4a5b",
);
const SITE_ID: string = "6b000000-0000-4000-8000-000000000001";
const SWITCH_ID: string = "6c000000-0000-4000-8000-000000000001";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, string>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const GERMAN: Locale = readLocale("de");
const PERSIAN: Locale = readLocale("fa");

const NOW: number = Date.now();

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function shopDevices(): Array<FakeDiscoveredDevice> {
  return [
    {
      id: "6d000000-0000-4000-8000-000000000001",
      name: "Front register",
      macAddress: "00:1a:2b:3c:4d:01",
      ipAddress: "10.20.0.11",
      seenOn: { id: SWITCH_ID, name: "Access switch 1" },
      lastSeenAt: minutesAgo(2),
      isSeenRecently: true,
      isFromController: false,
      isHidden: false,
      siteId: SITE_ID,
    },
    {
      id: "6d000000-0000-4000-8000-000000000002",
      name: "Guest phone",
      macAddress: "00:1a:2b:3c:4d:02",
      ipAddress: "10.20.0.12",
      seenOn: { id: SWITCH_ID, name: "Access switch 1" },
      lastSeenAt: minutesAgo(60 * 24 * 12),
      isSeenRecently: false,
      isFromController: false,
      isHidden: false,
      siteId: SITE_ID,
    },
  ];
}

const CHANGE_HREF: string = `/dashboard/${PROJECT_ID.toString()}/network-devices/endpoints#${DISCOVERED_DEVICE_RETENTION_PLACE}`;

let devicesServer: DiscoveredDevicesFakeServer;
let getItemSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
// What the project holds, as the card reads it; undefined for no value.
let storedRetention: number | undefined;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function projectWith(retentionInDays: number | undefined): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  if (retentionInDays !== undefined) {
    project.discoveredDeviceRetentionInDays = retentionInDays;
  }

  return project;
}

async function setLanguage(code: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(code);
  });
}

async function renderList(
  props: { siteId?: string; retentionInDays?: number } = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveredDevicesTable
          siteId={props.siteId}
          retentionInDays={props.retentionInDays}
        />
      </MemoryRouter>,
    );
  });

  await screen.findByText("Front register", { selector: "p" });
  await flush();
}

async function renderEmptyList(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveredDevicesTable />
      </MemoryRouter>,
    );
  });

  await screen.findByTestId("discovered-devices-empty");
  await flush();
}

function retentionLine(): HTMLElement | null {
  return screen.queryByTestId(DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID);
}

function changeLink(): HTMLElement | null {
  return screen.queryByTestId(
    `${DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID}-change`,
  );
}

function listRequests(): number {
  return devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.list).length;
}

async function renderCard(
  onRetentionChange?: (retentionInDays: number) => void,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveredDeviceRetentionCard
          projectId={PROJECT_ID}
          onRetentionChange={onRetentionChange}
        />
      </MemoryRouter>,
    );
  });
  await flush();
}

function removeAfter(): HTMLElement {
  return screen.getByRole("combobox", {
    name: DiscoveredDeviceRetentionCopy.label,
  });
}

// What the pick shows: react-select's single value beside its input.
function picked(): string {
  return (
    within(
      screen.getByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID),
    ).queryByText(/days?$|^Never$/)?.textContent || ""
  );
}

async function pick(optionText: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(removeAfter());
    fireEvent.keyDown(removeAfter(), { key: "ArrowDown", keyCode: 40 });
  });

  const option: HTMLElement = await screen.findByRole("option", {
    name: optionText,
  });

  await act(async () => {
    fireEvent.click(option);
  });
  await flush();
  await flush();
}

function settingDescription(): string {
  return (
    screen.getByTestId(
      `${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-description`,
    ).textContent || ""
  );
}

function moreSettings(): HTMLElement {
  return screen.getByTestId(DISCOVERED_DEVICES_MORE_SETTINGS_TEST_ID);
}

function moreSettingsHeader(): HTMLElement {
  return within(moreSettings()).getByRole("button", {
    name: MORE_SETTINGS_SECTION_TITLE,
  });
}

async function renderPage(): Promise<void> {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard"),
    currentProject: null,
    hasPaymentMethod: true,
  };

  await act(async () => {
    render(
      <MemoryRouter>
        <NetworkEndpoints {...props} />
      </MemoryRouter>,
    );
  });

  await screen.findByText("Front register", { selector: "p" });
  await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);
  await flush();
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: GERMAN },
      fa: { translation: PERSIAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PermissionUtil, "getProjectPermissions")
    .mockReturnValue(null as never);
  grant([Permission.ProjectOwner]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as { message?: string }).message || String(err);
    });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  storedRetention = 30;
  getItemSpy = jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return projectWith(storedRetention);
  }) as never);
  updateSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      storedRetention = data.data["discoveredDeviceRetentionInDays"] as number;
      return undefined;
    }) as never);

  devicesServer = new DiscoveredDevicesFakeServer(shopDevices());
  devicesServer.retentionInDays = 30;
  new DiscoveryImportFakeServer().install({
    post: (route: string, body: JSONObject) => {
      return devicesServer.answer(route, body) as never;
    },
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
  window.history.replaceState(null, "", "/");
});

describe("the line under the list", () => {
  test("says how long devices stay, with Change to the setting's place for a Project Owner", async () => {
    await renderList();

    expect(retentionLine()).toHaveTextContent(
      "Devices not seen for 30 days are removed, unless they are monitored or classified. Change",
    );
    expect(changeLink()).toHaveAttribute("href", CHANGE_HREF);
    expect(changeLink()).toHaveTextContent(/^Change$/);
  });

  test("says every device stays when the project keeps them all", async () => {
    devicesServer.retentionInDays = 0;

    await renderList();

    expect(retentionLine()).toHaveTextContent(
      "Devices stay on this list however long ago they were last seen. Change",
    );
  });

  test.each([7, 14, 60, 90, 180, 365])(
    "says %p days as it is set",
    async (days: number) => {
      devicesServer.retentionInDays = days;

      await renderList();

      expect(retentionLine()).toHaveTextContent(
        `Devices not seen for ${days} days are removed, unless they are monitored or classified.`,
      );
    },
  );

  test("a Project Admin may change it too", async () => {
    grant([Permission.ProjectAdmin]);

    await renderList();

    expect(changeLink()).toHaveAttribute("href", CHANGE_HREF);
  });

  test("anyone else reads the line without Change", async () => {
    grant([Permission.ProjectMember, Permission.ReadNetworkEndpoint]);

    await renderList();

    expect(retentionLine()).toHaveTextContent(
      /^Devices not seen for 30 days are removed, unless they are monitored or classified\.$/,
    );
    expect(changeLink()).toBeNull();
  });

  test("says nothing while the list has no device", async () => {
    devicesServer = new DiscoveredDevicesFakeServer([]);
    devicesServer.retentionInDays = 30;
    new DiscoveryImportFakeServer().install({
      post: (route: string, body: JSONObject) => {
        return devicesServer.answer(route, body) as never;
      },
    });

    await renderEmptyList();

    expect(retentionLine()).toBeNull();
  });

  test("says nothing when the server did not say, rather than guess", async () => {
    devicesServer.retentionInDays = undefined;

    await renderList();

    expect(retentionLine()).toBeNull();
  });

  test("a later read that does not say keeps what the list said", async () => {
    await renderList();

    devicesServer.retentionInDays = undefined;

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: "Show" })).getByRole(
          "radio",
          { name: /^All/ },
        ),
      );
    });
    await flush();

    await waitFor(() => {
      expect(listRequests()).toBe(2);
    });
    expect(retentionLine()).toHaveTextContent(
      "Devices not seen for 30 days are removed",
    );
  });

  test("the page's value is said over the list's last read", async () => {
    await renderList({ retentionInDays: 180 });

    expect(retentionLine()).toHaveTextContent(
      "Devices not seen for 180 days are removed",
    );
  });

  test("a site's list says the project's setting, and Change goes to the project's page", async () => {
    await renderList({ siteId: SITE_ID });

    expect(retentionLine()).toHaveTextContent(
      "Devices not seen for 30 days are removed, unless they are monitored or classified.",
    );
    expect(changeLink()).toHaveAttribute("href", CHANGE_HREF);
  });

  test("the list's own description no longer says nothing ages out", async () => {
    await renderList();

    expect(document.body.textContent).not.toContain(
      "Nothing is removed on its own",
    );
  });
});

describe("the line in the reader's language", () => {
  test("in German, the sentence and Change are German", async () => {
    await setLanguage("de");
    await renderList();

    const sentence: string = GERMAN[DISCOVERED_DEVICE_RETENTION_LINE.other]!;

    expect(sentence).toBeTruthy();
    expect(sentence).not.toBe(DISCOVERED_DEVICE_RETENTION_LINE.other);
    expect(withoutIsolateMarks(retentionLine()!.textContent || "")).toBe(
      `${sentence.replace("{{count}}", "30")} ${GERMAN["Change"]}`,
    );
  });

  test("in German, Never is said as German", async () => {
    devicesServer.retentionInDays = 0;

    await setLanguage("de");
    await renderList();

    expect(withoutIsolateMarks(retentionLine()!.textContent || "")).toContain(
      GERMAN[DiscoveredDeviceRetentionCopy.keptLine]!,
    );
  });

  test("in Persian, the days are written in Persian digits", async () => {
    await setLanguage("fa");
    await renderList();

    const sentence: string = PERSIAN[DISCOVERED_DEVICE_RETENTION_LINE.other]!;
    const persianThirty: string = new Intl.NumberFormat("fa").format(30);

    expect(persianThirty).toBe("۳۰");
    expect(withoutIsolateMarks(retentionLine()!.textContent || "")).toContain(
      sentence.replace("{{count}}", persianThirty),
    );
    expect(retentionLine()!.textContent).not.toContain("30");
  });
});

describe("the Unseen Devices card", () => {
  test("reads the project's setting, and says what it means", async () => {
    storedRetention = 90;
    const told: Array<number> = [];

    await renderCard((days: number) => {
      told.push(days);
    });

    await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);

    expect(getItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: Project,
        id: PROJECT_ID,
        select: { discoveredDeviceRetentionInDays: true },
      }),
    );
    expect(picked()).toBe("90 days");
    expect(settingDescription()).toBe(
      DiscoveredDeviceRetentionCopy.onDescription,
    );
    expect(told).toEqual([90]);
    expect(
      screen.getByTestId(DISCOVERED_DEVICE_RETENTION_CARD_TEST_ID),
    ).toBeInTheDocument();
    expect(
      document.getElementById(DISCOVERED_DEVICE_RETENTION_PLACE),
    ).not.toBeNull();
    expect(
      screen.getByText(DiscoveredDeviceRetentionCopy.cardTitle),
    ).toBeInTheDocument();
  });

  test("offers every length, shortest first, then Never", async () => {
    await renderCard();
    await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);

    await act(async () => {
      fireEvent.focus(removeAfter());
      fireEvent.keyDown(removeAfter(), { key: "ArrowDown", keyCode: 40 });
    });

    const options: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return option.textContent || "";
      },
    );

    expect(options).toEqual([
      "7 days",
      "14 days",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "365 days",
      "Never",
    ]);
  });

  test("a pick is saved at once, says Saved, and tells the page", async () => {
    const told: Array<number> = [];

    await renderCard((days: number) => {
      told.push(days);
    });
    await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);

    await pick("Never");

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      modelType: Project,
      id: PROJECT_ID,
      data: { discoveredDeviceRetentionInDays: 0 },
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-status`,
        ),
      ).toHaveTextContent("Saved");
    });
    expect(picked()).toBe("Never");
    expect(settingDescription()).toBe(
      DiscoveredDeviceRetentionCopy.offDescription,
    );
    expect(told).toEqual([30, 0]);
  });

  test("a pick the server refuses goes back to what the project has, with the reason", async () => {
    const told: Array<number> = [];

    updateSpy.mockImplementation((async () => {
      throw new Error("You may not change this project's settings.");
    }) as never);

    await renderCard((days: number) => {
      told.push(days);
    });
    await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);

    await pick("7 days");

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-error`,
        ),
      ).toHaveTextContent("You may not change this project's settings.");
    });
    expect(picked()).toBe("30 days");
    expect(told).toEqual([30]);
  });

  test("is locked for anyone but a Project Owner or Admin, and saves nothing", async () => {
    grant([Permission.ProjectMember, Permission.EditProject]);

    await renderCard();
    await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);

    /*
     * react-select hides a disabled control's input (and so its name); the
     * value still shows, and the input stays labelled by the pick's label.
     */
    const locked: HTMLElement = within(
      screen.getByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID),
    ).getByRole("combobox", { hidden: true });

    expect(locked).toBeDisabled();
    expect(
      document.getElementById(locked.getAttribute("aria-labelledby") || ""),
    ).toHaveTextContent(DiscoveredDeviceRetentionCopy.label);
    expect(picked()).toBe("30 days");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a project read before the setting existed shows the default", async () => {
    storedRetention = undefined;

    await renderCard();
    await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID);

    expect(picked()).toBe("30 days");
  });

  test("a failed read says why, and Try again reads again", async () => {
    getItemSpy.mockImplementationOnce((async () => {
      throw new Error("Network error. Please check your connection.");
    }) as never);

    await renderCard();

    expect(
      await screen.findByText("Network error. Please check your connection."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Try again|Refresh/i }),
      );
    });

    expect(
      await screen.findByTestId(DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID),
    ).toBeInTheDocument();
    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });

  test("a project it cannot find says so", async () => {
    getItemSpy.mockImplementation((async () => {
      return null;
    }) as never);

    await renderCard();

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });
});

describe("the Discovered Devices page", () => {
  test("folds the card under More settings, named, with no value while it is the default", async () => {
    await renderPage();

    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(moreSettings()).getByTestId("folded-section-contents"),
    ).toHaveTextContent(/^Unseen Devices$/);
  });

  test("the folded header says the setting while it is not the default", async () => {
    storedRetention = 0;
    devicesServer.retentionInDays = 0;

    await renderPage();

    await waitFor(() => {
      expect(
        within(moreSettings()).getByTestId("folded-section-contents"),
      ).toHaveTextContent("Unseen Devices");
    });
    expect(
      within(moreSettings()).getByTestId("folded-section-contents"),
    ).toHaveTextContent("Never");
  });

  test("a link to the card's place opens the fold at it", async () => {
    window.history.replaceState(
      null,
      "",
      `#${DISCOVERED_DEVICE_RETENTION_PLACE}`,
    );

    await renderPage();

    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(moreSettings()).getByTestId(
        DISCOVERED_DEVICE_RETENTION_CARD_TEST_ID,
      ),
    ).toBeVisible();
  });

  test("a save reaches the line at once, without reading the list again", async () => {
    await renderPage();

    expect(retentionLine()).toHaveTextContent(
      "Devices not seen for 30 days are removed",
    );

    const requestsBefore: number = listRequests();

    await act(async () => {
      fireEvent.click(moreSettingsHeader());
    });
    await pick("90 days");

    await waitFor(() => {
      expect(retentionLine()).toHaveTextContent(
        "Devices not seen for 90 days are removed",
      );
    });
    expect(listRequests()).toBe(requestsBefore);

    await pick("Never");

    await waitFor(() => {
      expect(retentionLine()).toHaveTextContent(
        "Devices stay on this list however long ago they were last seen.",
      );
    });
    expect(storedRetention).toBe(0);
  });
});
