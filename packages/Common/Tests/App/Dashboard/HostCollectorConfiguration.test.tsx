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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement, useState } from "react";
import HostSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import HostCollectorConfigOrder from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorConfigOrder";
import HostCollectorDefaultsCard from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorDefaultsCard";
import HostCollectorHostCount from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorHostCount";
import {
  HOST_COLLECTOR_CONFIG_ORDER_STEPS,
  HOST_COLLECTOR_CONFIG_ORDER_TITLE,
  HOST_COLLECTOR_DEFAULTS_DESCRIPTION,
  HOST_COLLECTOR_DEFAULT_SUMMARIES,
  HOST_OS_TYPE_VALUES,
  HostCollectorConfigOrderStep,
  HostCollectorHostCount as HostCount,
} from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorConfigFleet";
import { DEFAULT_CONFIG_NAMES } from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorStatus";
import {
  HostCollectorConfigHostCounts,
  useHostCollectorConfigHostCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/UseHostCollectorHostCounts";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";
import {
  HOST_COLLECTOR_INSTALLABLE_OS_TYPES,
  HostCollectorConfigStatus,
  HostCollectorOsType,
} from "../../../Types/HostCollector/HostCollector";
import { getHostCollectorDefaultConfig } from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID as MENU_PROJECT_ID,
  activeLinkTitles,
  currentEntries,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * "Collector config on the host section is a little hard to understand. Can
 * you please make the UI a lot simpler to understand ... Collector config
 * should basically be in its own side menu section as well. You can name
 * the side menu section as configuration" (the maintainer)
 *
 * What Hosts > Configuration > Collector Configs draws, rendered for real:
 *
 *   - the Hosts menu: Collector Configs is the one row of a Configuration
 *     section of its own, after the hosts; the section folds away on the
 *     hosts' pages and is open, with its row lit, on the list and on each
 *     config's page;
 *   - the three steps across the top of the list, in the order the server
 *     tries them;
 *   - a config's host count: "2 hosts", a red "1 failed" beside it, a dash
 *     while it is not known;
 *   - the card of OneUptime's defaults: what each collects, how many hosts
 *     run it (counted by the server), its config.yaml, and Create a config
 *     from it for whoever may;
 *   - the count of each config's hosts: one count for a config no host
 *     runs, and a slow answer from before a refresh never overwrites a
 *     newer one.
 *
 * Every word is looked up in the reader's language.
 */

jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: { value?: string; dataTestId?: string }): ReactElement => {
      return (
        <pre data-testid={props.dataTestId || "code-editor"}>
          {props.value || ""}
        </pre>
      );
    },
  };
});

// No unresolved states: the menus' badges never reach for a count.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(".json", "");
  })
  .sort();

const LOCALES: Record<string, Record<string, string>> = {};

function locale(language: string): Record<string, string> {
  if (!LOCALES[language]) {
    LOCALES[language] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }
  return LOCALES[language]!;
}

// The reader's words for an English key.
function say(language: string, key: string): string {
  return locale(language)[key] as string;
}

const PROJECT_ID: ObjectID = new ObjectID(MENU_PROJECT_ID);
const CONFIG_ID: string = "50000000-0000-4000-8000-000000000001";
const OTHER_CONFIG_ID: string = "50000000-0000-4000-8000-000000000002";

const HOST_HOME: string = `/dashboard/${MENU_PROJECT_ID}/host`;
const COLLECTOR_CONFIGS: string = `${HOST_HOME}/collector-configs`;

// A count the test answers by hand.
interface Deferred {
  promise: Promise<number>;
  resolve: (value: number) => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: (value: number) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise: Promise<number> = new Promise<number>(
    (yes: (value: number) => void, no: (error: Error) => void) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve, reject };
}

// Every count the components asked the server for, with its query.
let countQueries: Array<Record<string, unknown>> = [];
let answerCount: (query: Record<string, unknown>) => Promise<number> = () => {
  return Promise.resolve(0);
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};
  for (const language of LANGUAGES) {
    resources[language] = { translation: locale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  countQueries = [];
  answerCount = () => {
    return Promise.resolve(0);
  };
  setViewportWidth(DESKTOP_WIDTH);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "count").mockImplementation(((data: {
    query: Record<string, unknown>;
  }): Promise<number> => {
    countQueries.push(data.query);
    return answerCount(data.query);
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
  }) as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// Lets the answered counts reach the page.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((done: () => void) => {
      setTimeout(done, 0);
    });
  });
}

function systemOf(query: Record<string, unknown>): HostCollectorOsType | null {
  const osType: unknown = query["osType"];
  if (!(osType instanceof Includes)) {
    return null;
  }
  for (const system of HOST_COLLECTOR_INSTALLABLE_OS_TYPES) {
    if (
      JSON.stringify(osType.values) ===
      JSON.stringify(HOST_OS_TYPE_VALUES[system])
    ) {
      return system;
    }
  }
  return null;
}

function stepTexts(): Array<string> {
  return HOST_COLLECTOR_CONFIG_ORDER_STEPS.map(
    (_step: HostCollectorConfigOrderStep, index: number): string => {
      return (
        screen.getByTestId(`host-collector-config-order-step-${index + 1}`)
          .textContent || ""
      );
    },
  );
}

describe("the Hosts menu: Collector Configs in a Configuration section of its own", () => {
  test("after the hosts: Hosts, Configuration, then Settings, Advanced and Developer", async () => {
    goTo(HOST_HOME);
    await renderMenu(<HostSideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "Hosts",
      "Configuration",
      "Settings",
      "Advanced",
      "Developer",
    ]);
  });

  test("the hosts' section is the hosts and their documentation; Configuration is Collector Configs", async () => {
    goTo(HOST_HOME);
    await renderMenu(<HostSideMenu />);

    expect(linksIn("Hosts")).toEqual([
      { title: "All Hosts", href: routeFor(PageMap.HOSTS) },
      { title: "Documentation", href: routeFor(PageMap.HOST_DOCUMENTATION) },
    ]);
    expect(linksIn("Configuration")).toEqual([
      {
        title: "Collector Configs",
        href: routeFor(PageMap.HOST_COLLECTOR_CONFIGS),
      },
    ]);
    expect(routeFor(PageMap.HOST_COLLECTOR_CONFIGS)).toBe(COLLECTOR_CONFIGS);
  });

  test("on the hosts' list, it folds away like the other rarely used sections", async () => {
    goTo(HOST_HOME);
    await renderMenu(<HostSideMenu />);

    expect(isExpanded("Hosts")).toBe(true);
    expect(isExpanded("Configuration")).toBe(false);
    // Folded away: no height, and out of reach of the keyboard.
    expect(sectionBody("Configuration")).toHaveClass("max-h-0", "invisible");
    expect(activeLinkTitles()).toEqual(["All Hosts"]);
  });

  test("opened by hand, its row is there to click", async () => {
    goTo(HOST_HOME);
    await renderMenu(<HostSideMenu />);

    const toggle: HTMLElement = screen.getByRole("button", {
      name: /Configuration/,
    });
    fireEvent.click(toggle);

    expect(isExpanded("Configuration")).toBe(true);
    expect(sectionBody("Configuration")).not.toHaveClass("invisible");
    expect(
      within(sectionBody("Configuration")).getByRole("link", {
        name: /Collector Configs/,
      }),
    ).toHaveAttribute("href", COLLECTOR_CONFIGS);
  });

  test("on Collector Configs, the section is open and its row is the page", async () => {
    goTo(COLLECTOR_CONFIGS);
    await renderMenu(<HostSideMenu />);

    expect(isExpanded("Configuration")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Collector Configs"]);
    expect(currentEntries()).toEqual([
      { title: "Collector Configs", current: "page" },
    ]);
  });

  test("on a config's own page, the section is open and its list is lit", async () => {
    goTo(`${COLLECTOR_CONFIGS}/${CONFIG_ID}`);
    await renderMenu(<HostSideMenu />);

    expect(isExpanded("Configuration")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Collector Configs"]);
    expect(currentEntries()).toEqual([
      { title: "Collector Configs", current: "true" },
    ]);
  });

  test("on a phone, the menu's button names the section and the page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`${COLLECTOR_CONFIGS}/${CONFIG_ID}`);
    await renderMenu(<HostSideMenu />);

    expect(mobileSummaryText()).toBe(
      "Navigate toConfiguration / Collector Configs",
    );
  });

  test("Collector Configs is in no other section", async () => {
    goTo(HOST_HOME);
    await renderMenu(<HostSideMenu />);

    const sectionsWithIt: Array<string> = sectionTitlesInOrder().filter(
      (title: string): boolean => {
        return linksIn(title).some((link: MenuLink): boolean => {
          return link.title === "Collector Configs";
        });
      },
    );
    expect(sectionsWithIt).toEqual(["Configuration"]);
  });
});

describe("how a host gets its config, across the top of the list", () => {
  test("three numbered steps, in the order the server tries them", () => {
    render(<HostCollectorConfigOrder />);

    const strip: HTMLElement = screen.getByTestId(
      "host-collector-config-order",
    );
    expect(
      within(strip).getByRole("heading", {
        name: HOST_COLLECTOR_CONFIG_ORDER_TITLE,
      }),
    ).toBeInTheDocument();
    // The strip is named by its heading, for a screen reader.
    expect(strip).toHaveAccessibleName(HOST_COLLECTOR_CONFIG_ORDER_TITLE);

    const steps: Array<HTMLElement> = within(strip).getAllByRole("listitem");
    expect(
      steps.map((step: HTMLElement): string | null => {
        return step.getAttribute("data-reason");
      }),
    ).toEqual(["pinned", "matched", "default"]);

    expect(stepTexts()).toEqual([
      "1Picked for the hostA config someone picked on the host's Collector page.",
      "2The first config that appliesChecked from the top of this list, by the host's system and labels.",
      "3OneUptime's defaultFor the host's system, when no config applies.",
    ]);
  });

  test("a chevron between two steps, none after the last, all hidden from a screen reader", () => {
    render(<HostCollectorConfigOrder />);

    const chevrons: Array<HTMLElement> = screen.getAllByTestId(
      "host-collector-config-order-then",
    );
    expect(chevrons).toHaveLength(HOST_COLLECTOR_CONFIG_ORDER_STEPS.length - 1);
    for (const chevron of chevrons) {
      expect(chevron).toHaveAttribute("aria-hidden", "true");
      // A phone reads the steps top to bottom: the numbers say the order.
      expect(chevron).toHaveClass("hidden", "md:block");
    }
    expect(
      within(
        screen.getByTestId(
          `host-collector-config-order-step-${HOST_COLLECTOR_CONFIG_ORDER_STEPS.length}`,
        ),
      ).queryByTestId("host-collector-config-order-then"),
    ).toBeNull();
  });

  test.each(["de", "ja", "ar"])(
    "%s: the title and every step in the reader's words",
    async (language: string) => {
      await inLanguage(language);
      render(<HostCollectorConfigOrder />);

      const strip: HTMLElement = screen.getByTestId(
        "host-collector-config-order",
      );
      expect(strip).toHaveTextContent(
        say(language, HOST_COLLECTOR_CONFIG_ORDER_TITLE),
      );

      HOST_COLLECTOR_CONFIG_ORDER_STEPS.forEach(
        (step: HostCollectorConfigOrderStep, index: number) => {
          const item: HTMLElement = screen.getByTestId(
            `host-collector-config-order-step-${index + 1}`,
          );
          expect(item).toHaveTextContent(say(language, step.title));
          expect(item).toHaveTextContent(say(language, step.description));
          expect(item).not.toHaveTextContent(step.title);
        },
      );
    },
  );
});

describe("a config's host count", () => {
  function renderCount(count: HostCount | undefined): HTMLElement {
    const { container } = render(
      <HostCollectorHostCount count={count} dataTestId="hosts" />,
    );
    return container;
  }

  test("not known yet: a dash, and no number", () => {
    renderCount(undefined);

    expect(screen.getByTestId("hosts-unknown")).toHaveTextContent("—");
    expect(screen.queryByTestId("hosts")).toBeNull();
  });

  test("no host runs it: 0 hosts, quietly", () => {
    renderCount({ hosts: 0, failed: 0 });

    const count: HTMLElement = screen.getByTestId("hosts");
    expect(count).toHaveTextContent("0 hosts");
    expect(count).toHaveAttribute("data-hosts", "0");
    expect(count.firstElementChild).toHaveClass("text-gray-500");
    expect(screen.queryByTestId("hosts-failed")).toBeNull();
  });

  test("one host: 1 host", () => {
    renderCount({ hosts: 1, failed: 0 });

    expect(screen.getByTestId("hosts")).toHaveTextContent(/^1 host$/);
  });

  test("it did not start on some: a red count of them beside the hosts", () => {
    renderCount({ hosts: 12, failed: 3 });

    const count: HTMLElement = screen.getByTestId("hosts");
    expect(count).toHaveAttribute("data-hosts", "12");
    expect(count).toHaveAttribute("data-failed", "3");
    expect(count).toHaveTextContent("12 hosts");
    expect(count.firstElementChild).toHaveClass("text-gray-700");
    expect(screen.getByTestId("hosts-failed")).toHaveTextContent("3 failed");
  });

  test("in German: the hosts and the failed count in German, one and many", async () => {
    await inLanguage("de");
    renderCount({ hosts: 1, failed: 1 });

    expect(screen.getByTestId("hosts")).toHaveTextContent(
      say("de", "{{count}} hosts_one").replace("{{count}}", "1"),
    );
    expect(screen.getByTestId("hosts-failed")).toHaveTextContent(
      say("de", "{{count}} failed_one").replace("{{count}}", "1"),
    );

    cleanup();
    renderCount({ hosts: 7, failed: 2 });
    expect(screen.getByTestId("hosts")).toHaveTextContent(
      say("de", "{{count}} hosts").replace("{{count}}", "7"),
    );
    expect(screen.getByTestId("hosts-failed")).toHaveTextContent(
      say("de", "{{count}} failed").replace("{{count}}", "2"),
    );
  });
});

describe("OneUptime's defaults, under the list", () => {
  // Linux: 4 hosts; Windows: none; macOS: the count fails.
  function answerDefaults(counts: {
    [HostCollectorOsType.Linux]?: number;
    [HostCollectorOsType.Windows]?: number;
    [HostCollectorOsType.MacOS]?: number;
  }): void {
    answerCount = (query: Record<string, unknown>): Promise<number> => {
      const system: HostCollectorOsType | null = systemOf(query);
      const count: number | undefined = system
        ? counts[system as keyof typeof counts]
        : undefined;
      return count === undefined
        ? Promise.reject(new Error("Could not count"))
        : Promise.resolve(count);
    };
  }

  test("one row per system, in the guide's order: its name, what it collects, how many hosts run it", async () => {
    answerDefaults({
      [HostCollectorOsType.Linux]: 4,
      [HostCollectorOsType.Windows]: 0,
    });
    render(<HostCollectorDefaultsCard />);
    await settle();

    expect(screen.getByText("OneUptime defaults")).toBeInTheDocument();
    expect(
      screen.getByText(HOST_COLLECTOR_DEFAULTS_DESCRIPTION),
    ).toBeInTheDocument();

    const rows: Array<HTMLElement> = within(
      screen.getByTestId("host-collector-defaults"),
    ).getAllByRole("listitem");
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-testid");
      }),
    ).toEqual([
      "host-collector-default-row-linux",
      "host-collector-default-row-windows",
      "host-collector-default-row-darwin",
    ]);

    for (const system of HOST_COLLECTOR_INSTALLABLE_OS_TYPES) {
      const row: HTMLElement = screen.getByTestId(
        `host-collector-default-row-${system}`,
      );
      expect(row).toHaveTextContent(DEFAULT_CONFIG_NAMES[system]);
      expect(
        screen.getByTestId(`host-collector-default-summary-${system}`),
      ).toHaveTextContent(HOST_COLLECTOR_DEFAULT_SUMMARIES[system]);
    }

    expect(
      screen.getByTestId("host-collector-default-hosts-linux"),
    ).toHaveTextContent("4 hosts");
    expect(
      screen.getByTestId("host-collector-default-hosts-windows"),
    ).toHaveTextContent("0 hosts");
    // A count that could not be read is a dash, and the rest of the card stands.
    expect(
      screen.getByTestId("host-collector-default-hosts-darwin-unknown"),
    ).toHaveTextContent("—");
    // A default never fails on its own: no red count.
    expect(
      screen.queryByTestId("host-collector-default-hosts-linux-failed"),
    ).toBeNull();
  });

  test("each system's hosts are counted by the server: managed by OneUptime, on no config, of that system", async () => {
    render(<HostCollectorDefaultsCard />);
    await settle();

    expect(countQueries).toHaveLength(
      HOST_COLLECTOR_INSTALLABLE_OS_TYPES.length,
    );
    expect(countQueries.map(systemOf)).toEqual([
      HostCollectorOsType.Linux,
      HostCollectorOsType.Windows,
      HostCollectorOsType.MacOS,
    ]);
    for (const query of countQueries) {
      expect(query["projectId"]).toEqual(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
      expect(query["collectorInstanceUid"]).toBeInstanceOf(NotNull);
      expect(query["collectorConfigId"]).toBeInstanceOf(IsNull);
    }
  });

  test("counted again when the list is refreshed, and only then", async () => {
    answerDefaults({ [HostCollectorOsType.Linux]: 4 });
    const { rerender } = render(<HostCollectorDefaultsCard refreshToken={0} />);
    await settle();
    expect(countQueries).toHaveLength(3);

    rerender(<HostCollectorDefaultsCard refreshToken={0} />);
    await settle();
    expect(countQueries).toHaveLength(3);

    // A config was deleted: 6 Linux hosts are back on the default.
    answerDefaults({ [HostCollectorOsType.Linux]: 6 });
    rerender(<HostCollectorDefaultsCard refreshToken={1} />);
    await settle();

    expect(countQueries).toHaveLength(6);
    expect(
      screen.getByTestId("host-collector-default-hosts-linux"),
    ).toHaveTextContent("6 hosts");
  });

  test("View config shows the default's config.yaml, read only, and Close puts it away", async () => {
    render(<HostCollectorDefaultsCard />);
    await settle();

    fireEvent.click(screen.getByTestId("host-collector-default-windows"));

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      DEFAULT_CONFIG_NAMES[HostCollectorOsType.Windows],
    );
    expect(screen.getByTestId("host-collector-default-yaml").textContent).toBe(
      getHostCollectorDefaultConfig(HostCollectorOsType.Windows),
    );

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    await waitFor(() => {
      expect(screen.queryByTestId("host-collector-default-yaml")).toBeNull();
    });
  });

  test("whoever may create a config: Create a config from it starts one on that system", async () => {
    const created: Array<HostCollectorOsType> = [];
    render(
      <HostCollectorDefaultsCard
        onCreateFromDefault={(osType: HostCollectorOsType) => {
          created.push(osType);
        }}
      />,
    );
    await settle();

    fireEvent.click(screen.getByTestId("host-collector-default-darwin"));
    expect(
      screen.getByTestId("host-collector-default-yaml").textContent,
    ).toContain("/var/log/install.log");

    const create: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );
    expect(create).toHaveTextContent("Create a config from it");
    fireEvent.click(create);

    expect(created).toEqual([HostCollectorOsType.MacOS]);
    // The dialog makes way for the list's Create form.
    await waitFor(() => {
      expect(screen.queryByTestId("host-collector-default-yaml")).toBeNull();
    });
  });

  test("whoever may not: the dialog only shows the config", async () => {
    render(<HostCollectorDefaultsCard />);
    await settle();

    fireEvent.click(screen.getByTestId("host-collector-default-linux"));

    expect(
      screen.getByTestId("host-collector-default-yaml"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
    expect(screen.queryByText("Create a config from it")).toBeNull();
  });

  test.each(["de", "fr", "zh-CN"])(
    "%s: the card, each row and the dialog's button in the reader's words",
    async (language: string) => {
      answerDefaults({
        [HostCollectorOsType.Linux]: 1,
        [HostCollectorOsType.Windows]: 2,
        [HostCollectorOsType.MacOS]: 0,
      });
      await inLanguage(language);
      render(<HostCollectorDefaultsCard onCreateFromDefault={() => {}} />);
      await settle();

      expect(
        screen.getByText(say(language, HOST_COLLECTOR_DEFAULTS_DESCRIPTION)),
      ).toBeInTheDocument();

      for (const system of HOST_COLLECTOR_INSTALLABLE_OS_TYPES) {
        expect(
          screen.getByTestId(`host-collector-default-row-${system}`),
        ).toHaveTextContent(say(language, DEFAULT_CONFIG_NAMES[system]));
        expect(
          screen.getByTestId(`host-collector-default-summary-${system}`),
        ).toHaveTextContent(
          say(language, HOST_COLLECTOR_DEFAULT_SUMMARIES[system]),
        );
      }
      expect(
        screen.getByTestId("host-collector-default-hosts-windows"),
      ).toHaveTextContent(
        say(language, "{{count}} hosts").replace("{{count}}", "2"),
      );

      fireEvent.click(screen.getByTestId("host-collector-default-linux"));
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(say(language, "Create a config from it"));
    },
  );
});

describe("the count of each config's hosts", () => {
  /*
   * The list's Hosts column, as a probe: Load counts the configs' hosts,
   * and each config's count is drawn as the column draws it.
   */
  let loadCounts: (configIds: Array<string>) => void = () => {};

  function CountsProbe(props: { configIds: Array<string> }): ReactElement {
    const hostCounts: HostCollectorConfigHostCounts =
      useHostCollectorConfigHostCounts();
    const [, setLoads] = useState<number>(0);
    loadCounts = (configIds: Array<string>) => {
      hostCounts.load(configIds);
      setLoads((loads: number): number => {
        return loads + 1;
      });
    };

    return (
      <div>
        {props.configIds.map((configId: string): ReactElement => {
          return (
            <HostCollectorHostCount
              key={configId}
              count={hostCounts.counts[configId]}
              dataTestId={`count-${configId}`}
            />
          );
        })}
      </div>
    );
  }

  function isFailingQuery(query: Record<string, unknown>): boolean {
    return query["collectorConfigStatus"] === HostCollectorConfigStatus.Failed;
  }

  function configOf(query: Record<string, unknown>): string {
    return (query["collectorConfigId"] as ObjectID).toString();
  }

  test("a config's hosts, and those it failed on, from the server; one count for a config no host runs", async () => {
    answerCount = (query: Record<string, unknown>): Promise<number> => {
      if (configOf(query) === CONFIG_ID) {
        return Promise.resolve(isFailingQuery(query) ? 1 : 3);
      }
      return Promise.resolve(0);
    };
    render(<CountsProbe configIds={[CONFIG_ID, OTHER_CONFIG_ID]} />);

    // Nothing counted yet: dashes.
    expect(
      screen.getByTestId(`count-${CONFIG_ID}-unknown`),
    ).toBeInTheDocument();

    act(() => {
      loadCounts([CONFIG_ID, OTHER_CONFIG_ID]);
    });
    await settle();

    expect(screen.getByTestId(`count-${CONFIG_ID}`)).toHaveTextContent(
      "3 hosts",
    );
    expect(screen.getByTestId(`count-${CONFIG_ID}-failed`)).toHaveTextContent(
      "1 failed",
    );
    expect(screen.getByTestId(`count-${OTHER_CONFIG_ID}`)).toHaveTextContent(
      "0 hosts",
    );

    // Three counts: both configs' hosts, and the failed of the one with hosts.
    expect(
      countQueries.map((query: Record<string, unknown>): string => {
        return `${configOf(query)}:${isFailingQuery(query) ? "failed" : "hosts"}`;
      }),
    ).toEqual([
      `${CONFIG_ID}:hosts`,
      `${OTHER_CONFIG_ID}:hosts`,
      `${CONFIG_ID}:failed`,
    ]);
    for (const query of countQueries) {
      expect(query["projectId"]).toEqual(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
    }
  });

  test("a slow answer from before the list was refreshed never overwrites the newer one", async () => {
    const slow: Deferred = deferred();
    let calls: number = 0;
    answerCount = (): Promise<number> => {
      calls += 1;
      // The first load's count is slow; the refreshed list's is quick.
      return calls === 1 ? slow.promise : Promise.resolve(5);
    };
    render(<CountsProbe configIds={[CONFIG_ID]} />);

    act(() => {
      loadCounts([CONFIG_ID]);
    });
    act(() => {
      loadCounts([CONFIG_ID]);
    });
    await settle();
    expect(screen.getByTestId(`count-${CONFIG_ID}`)).toHaveTextContent(
      "5 hosts",
    );

    // The first answer comes in late, from before the refresh: dropped.
    await act(async () => {
      slow.resolve(0);
      await slow.promise;
    });
    await settle();
    expect(screen.getByTestId(`count-${CONFIG_ID}`)).toHaveTextContent(
      "5 hosts",
    );
  });

  test("a count that cannot be read stays a dash, and the others are drawn", async () => {
    answerCount = (query: Record<string, unknown>): Promise<number> => {
      return configOf(query) === CONFIG_ID
        ? Promise.reject(new Error("Could not count"))
        : Promise.resolve(2);
    };
    render(<CountsProbe configIds={[CONFIG_ID, OTHER_CONFIG_ID]} />);

    act(() => {
      loadCounts([CONFIG_ID, OTHER_CONFIG_ID]);
    });
    await settle();

    expect(screen.getByTestId(`count-${CONFIG_ID}-unknown`)).toHaveTextContent(
      "—",
    );
    expect(screen.getByTestId(`count-${OTHER_CONFIG_ID}`)).toHaveTextContent(
      "2 hosts",
    );
  });

  test("an answer after the page was left is dropped, without a warning", async () => {
    const slow: Deferred = deferred();
    answerCount = (): Promise<number> => {
      return slow.promise;
    };
    const errors: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { unmount } = render(<CountsProbe configIds={[CONFIG_ID]} />);

    act(() => {
      loadCounts([CONFIG_ID]);
    });
    unmount();

    await act(async () => {
      slow.resolve(4);
      await slow.promise;
    });
    await settle();

    expect(errors).not.toHaveBeenCalled();
  });
});
