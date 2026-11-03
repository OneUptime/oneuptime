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
import React, { ReactElement, ReactNode } from "react";
import fs from "fs";
import path from "path";
import englishLocale from "../../../../App/FeatureSet/AdminDashboard/src/Locales/en.json";

/*
 * Admin Dashboard -> Settings -> Global Runners: the Runners OneUptime runs
 * for every project, which only a master admin creates.
 *
 * The page lists the global Runners only (no project owns one), creates a
 * Runner as global, says whether each is connected, and - behind Show ID
 * and Key, never the row's button - gives the id, key and the one command
 * that starts it. Rendered with the real ModelTable; only the network, the
 * page chrome and the side menu are stubbed.
 *
 * Core only: this must pass with ee/ deleted.
 */

type LocaleValue = string | { [key: string]: LocaleValue };

// The English copy, so the assertions read what an admin reads.
const translate: (key: string) => string = (key: string): string => {
  let node: LocaleValue | undefined = englishLocale as LocaleValue;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return key;
    }

    node = node[segment];
  }

  return typeof node === "string" ? node : key;
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return translate(key);
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="settings-page">{props.children}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav data-testid="settings-side-menu" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: () => {
        return Promise.resolve(undefined);
      },
      post: () => {
        return Promise.resolve(undefined);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

import SettingsGlobalRunners, {
  GLOBAL_RUNNER_CODE_FIXES_COPY,
  GLOBAL_RUNNER_STATUS_COLUMN_MAX_WIDTH_CLASS_NAME,
  GLOBAL_RUNNER_STATUS_COLUMN_MIN_WIDTH_CLASS_NAME,
  GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalRunners/Index";
import { RUNNER_CODE_FIXES_OFF_SETTING } from "../../../Types/Runner/RunnerCodeFixes";
import { RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID } from "../../../UI/Components/Runner/RunnerCodeFixesOffSetting";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import { ADMIN_GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersCopy";
import { RUNNER_IMAGE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerImage";
import Runner from "../../../Models/DatabaseModels/Runner";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  GLOBAL_RUNNER_CONTAINER_NAME,
  RUNNER_IMAGE_NAME,
  getGlobalRunnerDockerCommand,
} from "../../../Types/Runner/RunnerContainer";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Version from "../../../Types/Version";

const RUNNER_ID: string = "99999999-0000-4000-8000-000000000001";
const RUNNER_KEY: string = "global-runner-key";

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

let rows: Array<Runner> = [];
let listCalls: Array<ListCall> = [];
let created: Array<Runner> = [];

function globalRunner(lastAlive?: Date): Runner {
  return Object.assign(new Runner(), {
    _id: RUNNER_ID,
    name: "global-eu",
    description: "Runs JavaScript steps for every project.",
    key: RUNNER_KEY,
    isGlobalRunner: true,
    ...(lastAlive ? { lastAlive } : {}),
  });
}

beforeEach(() => {
  // Everyone in the admin dashboard is a master admin.
  localStorage.setItem("is_master_admin", "true");
  rows = [globalRunner()];
  listCalls = [];
  created = [];

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
      listCalls.push(args as ListCall);
      return {
        data: rows as Array<never>,
        count: rows.length,
        skip: 0,
        limit: 10,
      };
    });

  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const model: Runner = (args as { model: Runner }).model;
      created.push(model);
      return { data: model } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

async function renderPage(): Promise<void> {
  render(<SettingsGlobalRunners />);

  await waitFor(() => {
    expect(listCalls.length).toBeGreaterThan(0);
  });
}

describe("Admin Dashboard -> Settings -> Global Runners", () => {
  test("lives at /admin/settings/global-runners, the address the Dashboard's Runners page links to", () => {
    expect(RouteMap[PageMap.SETTINGS_GLOBAL_RUNNERS]?.toString()).toBe(
      `/admin${ADMIN_GLOBAL_RUNNERS_ROUTE}`,
    );
  });

  test("lists the global Runners only: no project's Runner, whatever it is called", async () => {
    await renderPage();

    for (const call of listCalls) {
      expect(call.modelType).toBe(Runner);
      expect(call.query["isGlobalRunner"]).toBe(true);
      expect(call.query["projectId"]).toBeInstanceOf(IsNull);
    }

    expect(
      await screen.findByText(
        translate("pages.settings.globalRunners.cardTitle"),
      ),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      translate("pages.settings.globalRunners.cardDescription"),
    );
  });

  test("a Runner nobody has started yet reads Never connected, in grey; a live one, Connected", async () => {
    await renderPage();

    expect(
      await screen.findByText(
        translate("pages.settings.globalRunners.neverConnected"),
      ),
    ).toBeInTheDocument();
    cleanup();

    rows = [globalRunner(new Date())];
    listCalls = [];
    await renderPage();

    expect(
      await screen.findByText(translate("common.connected")),
    ).toBeInTheDocument();
  });

  /*
   * A project whose repositories are on the Global Runner is told when no
   * global Runner online takes AI code fixes, and to ask its administrator:
   * this is where the administrator sees which global Runner takes none,
   * and why - an older release, or a host that turned them off.
   */
  describe("a global Runner that takes no AI code fixes says so under its status", () => {
    function withCodeFixes(data: {
      takesCodeFixes?: boolean | undefined;
      agentVersion: string;
      lastAlive?: Date | undefined;
    }): Runner {
      const runner: Runner = globalRunner(data.lastAlive);
      runner.agentVersion = new Version(data.agentVersion);
      if (data.takesCodeFixes !== undefined) {
        runner.takesCodeFixes = data.takesCodeFixes;
      }
      return runner;
    }

    test("reads what each said, and its release", async () => {
      await renderPage();

      expect(listCalls[0]!.select).toEqual(
        expect.objectContaining({ takesCodeFixes: true, agentVersion: true }),
      );
    });

    test("one whose host turned them off: the setting that does it", async () => {
      rows = [
        withCodeFixes({
          takesCodeFixes: false,
          agentVersion: "14.0.102",
          lastAlive: new Date(),
        }),
      ];

      await renderPage();

      const line: HTMLElement = await screen.findByTestId(
        GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID,
      );

      // What to do, with the setting where its {{setting}} stands.
      expect(line).toHaveTextContent(
        "Takes no AI code fixes: remove ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false from its host and restart it.",
      );
      expect(line).toHaveTextContent(
        GLOBAL_RUNNER_CODE_FIXES_COPY.turnedOff.replace(
          "{{setting}}",
          RUNNER_CODE_FIXES_OFF_SETTING,
        ),
      );

      // Drawn as code, breaking only after its underscores.
      const setting: HTMLElement = within(line).getByTestId(
        RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID,
      );
      expect(setting.tagName).toBe("CODE");
      expect(setting.textContent).toBe(RUNNER_CODE_FIXES_OFF_SETTING);
      expect(setting.querySelectorAll("wbr")).toHaveLength(4);

      expect(line.className).toContain("text-amber-700");
      // Still connected: it runs JavaScript steps.
      expect(document.body).toHaveTextContent(translate("common.connected"));
    });

    /*
     * The Status cell is a sentence now, not one word: a cell that never
     * wraps (every table cell's default) cut the line off behind the row's
     * buttons at every desktop width. It wraps, between a floor that keeps
     * the setting from breaking onto four lines and a cap that keeps it a
     * status.
     */
    test("its line wraps inside the Status column, never cut off behind the row's buttons", async () => {
      rows = [
        withCodeFixes({
          takesCodeFixes: false,
          agentVersion: "14.0.102",
          lastAlive: new Date(),
        }),
      ];

      await renderPage();

      const line: HTMLElement = await screen.findByTestId(
        GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID,
      );
      const cell: HTMLElement | null = line.closest("td");

      expect(cell).not.toBeNull();
      expect(cell!.className).toContain("whitespace-normal");
      expect(cell!.className).not.toContain("whitespace-nowrap");

      // The cell's content box, between the line and the cell.
      const boxes: Array<HTMLElement> = [];
      let element: HTMLElement | null = line.parentElement;
      while (element && element !== cell) {
        boxes.push(element);
        element = element.parentElement;
      }
      const content: HTMLElement | undefined = boxes.find(
        (box: HTMLElement): boolean => {
          return box.className
            .split(" ")
            .includes(GLOBAL_RUNNER_STATUS_COLUMN_MAX_WIDTH_CLASS_NAME);
        },
      );

      expect(content).toBeDefined();
      expect(content!.className.split(" ")).toContain(
        GLOBAL_RUNNER_STATUS_COLUMN_MIN_WIDTH_CLASS_NAME,
      );
      // Not the one-line cell's ellipsis, which hid the rest.
      for (const box of boxes) {
        expect(box.className).not.toContain("text-ellipsis");
      }
    });

    test("one of a release from before global Runners took them: update it", async () => {
      rows = [
        withCodeFixes({ agentVersion: "14.0.93", lastAlive: new Date() }),
      ];

      await renderPage();

      const line: HTMLElement = await screen.findByTestId(
        GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID,
      );

      expect(line).toHaveTextContent(
        GLOBAL_RUNNER_CODE_FIXES_COPY.olderRelease,
      );
      expect(line).toHaveTextContent(
        "Takes no AI code fixes: update it to this server's version.",
      );
      // No setting to remove: its release is what turns them off.
      expect(
        within(line).queryByTestId(RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID),
      ).toBeNull();
    });

    test("one that takes them, one of a release that does and says nothing, and one never started: nothing more", async () => {
      rows = [
        withCodeFixes({
          takesCodeFixes: true,
          agentVersion: "14.0.102",
          lastAlive: new Date(),
        }),
      ];
      await renderPage();
      await screen.findByText(translate("common.connected"));
      expect(
        screen.queryByTestId(GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID),
      ).toBeNull();
      cleanup();

      rows = [
        withCodeFixes({ agentVersion: "14.0.94", lastAlive: new Date() }),
      ];
      listCalls = [];
      await renderPage();
      await screen.findByText(translate("common.connected"));
      expect(
        screen.queryByTestId(GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID),
      ).toBeNull();
      cleanup();

      // Its 1.0.0 is the new row's placeholder, not a release.
      rows = [withCodeFixes({ agentVersion: "1.0.0" })];
      listCalls = [];
      await renderPage();
      await screen.findByText(
        translate("pages.settings.globalRunners.neverConnected"),
      );
      expect(
        screen.queryByTestId(GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID),
      ).toBeNull();
    });
  });

  /*
   * Both lines are whole sentences each Admin Dashboard locale words, as
   * English keys - the setting a value no translation writes out.
   */
  describe("the lines, in every language the Admin Dashboard speaks", () => {
    const LOCALES: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/AdminDashboard/src/Locales",
    );
    const LANGUAGES: Array<string> = fs
      .readdirSync(LOCALES)
      .filter((name: string): boolean => {
        return name.endsWith(".json");
      })
      .map((name: string): string => {
        return name.replace(".json", "");
      });

    function read(language: string): Record<string, unknown> {
      return JSON.parse(
        fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;
    }

    test("there are seventeen", () => {
      expect(LANGUAGES).toHaveLength(17);
    });

    test.each(LANGUAGES)(
      "%s words both, the setting as its value",
      (language: string) => {
        const words: Record<string, unknown> = read(language);

        for (const sentence of Object.values(GLOBAL_RUNNER_CODE_FIXES_COPY)) {
          const worded: unknown = words[sentence];

          expect(typeof worded).toBe("string");

          if (language === "en") {
            expect(worded).toBe(sentence);
          } else {
            expect(worded).not.toBe(sentence);
          }

          expect((worded as string).split("{{setting}}").length).toBe(
            sentence.split("{{setting}}").length,
          );
          expect(worded as string).not.toContain(RUNNER_CODE_FIXES_OFF_SETTING);
        }

        // The keys the lines had before are gone.
        const runners: Record<string, unknown> = (
          (words["pages"] as Record<string, unknown>)["settings"] as Record<
            string,
            unknown
          >
        )["globalRunners"] as Record<string, unknown>;

        expect(runners["takesNoCodeFixesOlderRelease"]).toBeUndefined();
        expect(runners["takesNoCodeFixesTurnedOff"]).toBeUndefined();
      },
    );
  });

  test("Show ID and Key is in the row's menu, and gives the ID, the key and the one command that starts it", async () => {
    await renderPage();

    const rowActions: HTMLElement = await screen.findByTestId("row-actions");

    expect(within(rowActions).queryByText("Show ID and Key")).toBeNull();

    fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: translate("pages.settings.globalRunners.showIdKey"),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        translate("pages.settings.globalRunners.keyModalTitle"),
      );
    });

    const description: HTMLElement = screen.getByTestId(
      "global-runner-key-details",
    );

    /*
     * As wide as a project's Runner setup dialog, so the command's lines
     * are read whole, not cut off behind its copy button.
     */
    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-3xl");
    expect(description).toHaveTextContent(RUNNER_ID);
    expect(description).toHaveTextContent(RUNNER_KEY);
    expect(description).toHaveTextContent(
      translate("pages.settings.globalRunners.keyModalDescription"),
    );
    expect(description.textContent || "").toContain(
      `-e ONEUPTIME_RUNNER_ID=${RUNNER_ID}`,
    );
    expect(description.textContent || "").toContain(
      `-e ONEUPTIME_RUNNER_KEY=${RUNNER_KEY}`,
    );
    expect(description.textContent || "").toContain(RUNNER_IMAGE_NAME);
  });

  test("Create makes a global Runner, from a name and a description", async () => {
    await renderPage();

    fireEvent.click(
      (await screen.findAllByText("Create Runner"))[0] as HTMLElement,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    fireEvent.change(
      await within(dialog).findByPlaceholderText("global-runner-eu"),
      {
        target: { value: "global-us" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Runner" }),
    );

    await waitFor(() => {
      expect(created).toHaveLength(1);
    });

    expect(created[0]!.isGlobalRunner).toBe(true);
    expect(created[0]!.name).toBe("global-us");
    // Nobody picks a project for it: no project owns a global Runner.
    expect(created[0]!.projectId).toBeUndefined();
  });

  test("with none yet, a short heading says to add one, and the line under it how to start it", async () => {
    rows = [];

    await renderPage();

    const noItems: string = translate("pages.settings.globalRunners.noItems");
    const [heading, ...rest] = noItems.split(". ");
    const empty: HTMLElement = await screen.findByTestId(
      "global-runners-table-no-items",
    );

    expect(heading).toBe("Add a global Runner");
    expect(
      within(empty).getByTestId("table-empty-state-title"),
    ).toHaveTextContent(heading!);
    expect(empty).toHaveTextContent(rest.join(". "));
    expect(empty).toHaveTextContent(
      translate("pages.settings.globalRunners.showIdKey"),
    );
  });

  test("the card never says one runs with this server: an empty list would say otherwise", async () => {
    rows = [];

    await renderPage();
    await screen.findByTestId("global-runners-table-no-items");

    const description: string = translate(
      "pages.settings.globalRunners.cardDescription",
    );

    expect(description.toLowerCase()).not.toContain("with this server");
    expect(document.body).toHaveTextContent(description);
  });
});

describe("the command that starts a global Runner", () => {
  test("runs the same image as a project's Runner, under a name of its own", () => {
    expect(RUNNER_IMAGE_NAME).toBe(RUNNER_IMAGE);
    expect(GLOBAL_RUNNER_CONTAINER_NAME).toBe("oneuptime-global-runner");
  });

  test("passes the id, the key and the address, and restarts with the host", () => {
    const command: string = getGlobalRunnerDockerCommand({
      runnerId: RUNNER_ID,
      runnerKey: RUNNER_KEY,
      oneuptimeUrl: "https://oneuptime.example.com",
    });

    expect(command).toBe(
      [
        "docker run --name oneuptime-global-runner --restart unless-stopped \\",
        `  -e ONEUPTIME_RUNNER_ID=${RUNNER_ID} \\`,
        `  -e ONEUPTIME_RUNNER_KEY=${RUNNER_KEY} \\`,
        "  -e ONEUPTIME_URL=https://oneuptime.example.com \\",
        "  -d oneuptime/runner:release",
      ].join("\n"),
    );
  });
});
