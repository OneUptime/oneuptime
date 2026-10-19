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

import SettingsGlobalRunners from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalRunners/Index";
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

const RUNNER_ID: string = "99999999-0000-4000-8000-000000000001";
const RUNNER_KEY: string = "global-runner-key";

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
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
