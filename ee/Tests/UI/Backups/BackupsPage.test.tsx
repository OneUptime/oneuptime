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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Admin Dashboard > Settings > Backups, as a master admin sees it:
 *
 *   - before anything is set up: what backups do, Set up backups, the
 *     guide, and the destinations they work with;
 *   - the setup, for real: a recommended destination, its own fields, the
 *     test (POST /backup/test, nothing saved), the schedule and retention,
 *     then saved to back up on the schedule - and the new destination is
 *     searched for backups it already holds;
 *   - the status card: on, off, failing, running (a backup or a restore),
 *     Back up now, Cancel, Turn off and on, Find backups - and the page
 *     following a run live;
 *   - the license: without one that includes backups no new backup is
 *     made (the card and the buttons say so), and restoring and deleting
 *     still work;
 *   - the tables of backups and restores, through the Admin Dashboard's
 *     model API, each row's actions, and Delete's confirmation;
 *   - the page in the reader's language.
 *
 * The tables are stand-ins that record their props; the rest is real.
 * Transport is replaced: the model API reads rows of a fake instance
 * (BackupsFixtures), and /backup/... answers as the Enterprise server does.
 */

let mockTables: Record<string, Record<string, unknown>> = {};

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockTables[String(props["id"])] = props;
      return <div data-testid={`model-table-${String(props["id"])}`} />;
    },
  };
});

let mockLicenseMode: string = "editable";
let mockLicenseFeatures: Array<unknown> = [];

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (feature: unknown): string => {
        mockLicenseFeatures.push(feature);
        return mockLicenseMode;
      },
    };
  },
);

let mockLanguage: string = "en";
let mockDictionary: Record<string, unknown> = {};

jest.mock("react-i18next", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-i18next",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useTranslation: () => {
      return {
        t: (value: string): string => {
          const translated: unknown = mockDictionary[value];
          return typeof translated === "string" ? translated : value;
        },
        i18n: { language: mockLanguage },
      };
    },
  };
});

import BackupsSettingsPage from "../../../AdminDashboard/Backups/BackupsSettingsPage";
import {
  ACTIVE_RUN_POLL_INTERVAL_IN_MS,
  IDLE_POLL_INTERVAL_IN_MS,
} from "../../../AdminDashboard/Backups/BackupsView";
import {
  BACKUP_RUNS_TABLE_ID,
  BackupsCopy,
  RESTORE_RUNS_TABLE_ID,
} from "../../../AdminDashboard/Backups/BackupsCopy";
import { formatBackupDateTime } from "../../../AdminDashboard/Backups/BackupFormat";
import {
  backupRun,
  bodyOf,
  emptyOverview,
  matchesQuery,
  minutesAgo,
  overviewOf,
  savedSetting,
  SETTING_ID,
  sortRuns,
  step,
} from "./BackupsFixtures";
import { BackupsOverview } from "../../../AdminDashboard/Backups/BackupsApi";
import { LicensedFeature } from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import {
  BackupProvider,
  BackupProviderCatalog,
  BackupProviderDefinition,
} from "Common/Types/Backup/BackupDestinationCatalog";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import { BackupFrequency } from "Common/Types/Backup/BackupSchedule";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import splitActionButtons, {
  IndexedActionButton,
  SplitActionButtonsResult,
} from "Common/UI/Components/ActionButton/SplitActionButtons";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";

const SUCCEEDED_ID: string = "11111111-1111-4111-8111-111111111111";
const OLDER_ID: string = "22222222-2222-4222-8222-222222222222";
const FAILED_ID: string = "33333333-3333-4333-8333-333333333333";
const RUNNING_ID: string = "44444444-4444-4444-8444-444444444444";
const RESTORE_ID: string = "55555555-5555-4555-8555-555555555555";
const ELSEWHERE_ID: string = "66666666-6666-4666-8666-666666666666";

// The real form draws every destination's fields: slower than the rest under a full run.
const FORM_TEST_TIMEOUT_IN_MS: number = 30000;
const FORM_WAIT_IN_MS: number = 10000;

// Every wait in this file may take that long: a loaded CI runner draws the form slowly.
configure({ asyncUtilTimeout: FORM_WAIT_IN_MS });

const LICENSE_REASON: string =
  "Needs a valid Enterprise license that includes backups.";

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

// The fake instance the model API and /backup/... answer from.
let setting: BackupSetting | null = null;
let runs: Array<BackupRun> = [];
let overview: BackupsOverview = emptyOverview();
let overviewFailure: string | null = null;
let posts: Array<{ route: string; body: JSONObject }> = [];
let answers: Record<
  string,
  (body: JSONObject) => JSONObject | HTTPErrorResponse
> = {};

type ActionButton = ActionButtonSchema<BackupRun>;

type Column = {
  title: string;
  getElement?: (item: BackupRun) => ReactElement;
};

function table(id: string = BACKUP_RUNS_TABLE_ID): Record<string, unknown> {
  return mockTables[id]!;
}

function actions(id: string = BACKUP_RUNS_TABLE_ID): Array<ActionButton> {
  return table(id)["actionButtons"] as Array<ActionButton>;
}

function action(
  title: string,
  id: string = BACKUP_RUNS_TABLE_ID,
): ActionButton {
  return actions(id).find((button: ActionButton): boolean => {
    return button.title === title;
  })!;
}

function column(title: string, id: string = BACKUP_RUNS_TABLE_ID): Column {
  return (table(id)["columns"] as Array<Column>).find(
    (candidate: Column): boolean => {
      return candidate.title === title;
    },
  )!;
}

// What the table draws for a row: its one button, and its ⋯ menu.
function rowActions(
  item: BackupRun,
  id: string = BACKUP_RUNS_TABLE_ID,
): [string, Array<string>] {
  const result: SplitActionButtonsResult<BackupRun> =
    splitActionButtons<BackupRun>({ actionButtons: actions(id), item });

  return [
    result.primary?.button.title || "",
    result.moreMenu.map((entry: IndexedActionButton<BackupRun>): string => {
      return entry.button.title;
    }),
  ];
}

function postsTo(route: string): Array<JSONObject> {
  return posts
    .filter((post: { route: string }): boolean => {
      return post.route === route;
    })
    .map((post: { body: JSONObject }): JSONObject => {
      return post.body;
    });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function renderPage(readyTestId: string = "backups-view"): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <BackupsSettingsPage />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId(readyTestId)).toBeInTheDocument();
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function openStatusMenu(): Promise<void> {
  await click(screen.getByTestId("backups-status-more"));
}

async function next(): Promise<void> {
  await click(within(dialog()).getByRole("button", { name: "Next" }));
}

function useLocale(language: string): void {
  mockLanguage = language;
  mockDictionary = JSON.parse(
    fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function setUpInstance(): void {
  setting = savedSetting();
  overview = overviewOf();
  runs = [
    backupRun(SUCCEEDED_ID, { startedAt: minutesAgo(120) }),
    backupRun(OLDER_ID, { startedAt: minutesAgo(26 * 60) }),
  ];
}

beforeEach(() => {
  mockTables = {};
  mockLicenseMode = "editable";
  mockLicenseFeatures = [];
  mockLanguage = "en";
  mockDictionary = {};
  setting = null;
  runs = [];
  overview = emptyOverview();
  overviewFailure = null;
  posts = [];
  answers = {
    "/test": (): JSONObject => {
      return {
        isSuccessful: true,
        checks: [
          {
            key: "storage",
            isSuccessful: true,
            message:
              "Wrote, read, listed and deleted a test file in oneuptime-backups/prod/.",
          },
          {
            key: "postgres",
            isSuccessful: true,
            message: "pg_dump 16.4 can back up PostgreSQL 16.4.",
          },
          {
            key: "clickhouse",
            isSuccessful: true,
            message:
              "ClickHouse wrote a test backup of its tables' definitions.",
          },
        ],
      } as unknown as JSONObject;
    },
    "/find": (): JSONObject => {
      return { found: 0, added: 0, updated: 0, removed: 0 };
    },
    "/run-now": (): JSONObject => {
      runs.push(
        backupRun(RUNNING_ID, {
          trigger: BackupRunTrigger.Manual,
          status: BackupRunStatus.Queued,
          startedAt: undefined,
          finishedAt: undefined,
          createdAt: new Date(),
          steps: [] as unknown as JSONArray,
        }),
      );
      return { backupRunId: RUNNING_ID };
    },
    "/cancel": (): JSONObject => {
      return {};
    },
    "/delete": (body: JSONObject): JSONObject => {
      runs = runs.filter((run: BackupRun): boolean => {
        return run.id?.toString() !== body["backupRunId"];
      });
      return {};
    },
  };

  jest.spyOn(AdminModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
    query: Record<string, unknown>;
    limit: number;
    sort: Record<string, unknown>;
  }) => {
    if (data.modelType === BackupSetting) {
      return {
        data: setting ? [setting] : [],
        count: setting ? 1 : 0,
        skip: 0,
        limit: data.limit,
      };
    }

    const found: Array<BackupRun> = sortRuns(
      runs.filter((run: BackupRun): boolean => {
        return matchesQuery(run, data.query);
      }),
      data.sort,
    );

    return {
      data: found.slice(0, data.limit),
      count: found.length,
      skip: 0,
      limit: data.limit,
    };
  }) as never);

  jest.spyOn(AdminModelAPI, "count").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    return runs.filter((run: BackupRun): boolean => {
      return matchesQuery(run, data.query);
    }).length;
  }) as never);

  jest.spyOn(AdminModelAPI, "getItem").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    return (
      runs.find((run: BackupRun): boolean => {
        return run.id?.toString() === data.id.toString();
      }) || null
    );
  }) as never);

  jest.spyOn(AdminModelAPI, "updateById").mockImplementation((async (data: {
    data: JSONObject;
  }) => {
    // Turn on and Turn off write the switch alone.
    if (setting && "isEnabled" in data.data) {
      setting = savedSetting({ isEnabled: data.data["isEnabled"] === true });
    }
    return new HTTPResponse(200, {}, {});
  }) as never);

  jest.spyOn(AdminModelAPI, "create").mockImplementation((async (data: {
    model: BackupSetting;
  }) => {
    // Saved: the instance now has its setting, and its destination.
    setting = savedSetting({
      destinationType: data.model.destinationType,
      destinationProvider: data.model.destinationProvider,
      config: data.model.config,
    });
    overview = overviewOf();
    return new HTTPResponse(200, {}, {});
  }) as never);

  jest.spyOn(API, "get").mockImplementation((async (options: {
    url: { toString: () => string };
  }) => {
    if (!options.url.toString().endsWith("/backup/overview")) {
      throw new Error(`Not answered: GET ${options.url.toString()}`);
    }

    if (overviewFailure) {
      throw new Error(overviewFailure);
    }

    return new HTTPResponse(200, overview as unknown as JSONObject, {});
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    const url: string = options.url.toString();
    const route: string = url.slice(url.lastIndexOf("/backup/") + 7);
    posts.push({ route, body: bodyOf(options.data) });

    const answer: JSONObject | HTTPErrorResponse = answers[route]
      ? answers[route]!(bodyOf(options.data))
      : {};

    return answer instanceof HTTPErrorResponse
      ? answer
      : new HTTPResponse(200, answer, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("before backups are set up", () => {
  test("says what backups do, with one button that sets them up, and the storage they work with", async () => {
    await renderPage();

    const hero: HTMLElement = screen.getByTestId("backups-hero");

    expect(hero).toHaveTextContent("Back up OneUptime");
    expect(hero).toHaveTextContent("On a schedule");
    expect(hero).toHaveTextContent("Kept as long as you say");
    expect(hero).toHaveTextContent("Restored safely");
    expect(screen.getByTestId("backups-set-up")).toBeEnabled();

    // Every recommended destination the setup offers.
    const destinations: HTMLElement = screen.getByTestId(
      "backups-recommended-destinations",
    );

    expect(within(destinations).getAllByRole("listitem")).toHaveLength(
      BackupProviderCatalog.length,
    );
    for (const provider of BackupProviderCatalog as Array<BackupProviderDefinition>) {
      expect(destinations).toHaveTextContent(provider.title);
    }

    // Nothing to show of backups that do not exist.
    expect(screen.queryByTestId("backups-status")).toBeNull();
    expect(mockTables[BACKUP_RUNS_TABLE_ID]).toBeUndefined();
    // The page asks the license about backups, not another feature.
    expect(mockLicenseFeatures).toContain(LicensedFeature.Backups);
  });

  test("How backups work opens the guide in a new tab", async () => {
    jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);

    await renderPage();
    await click(screen.getByTestId("backups-docs"));

    expect(String(jest.mocked(Navigation.navigate).mock.calls[0]![0])).toBe(
      "/docs/installation/backups",
    );
    expect(jest.mocked(Navigation.navigate).mock.calls[0]![1]).toEqual({
      openInNewTab: true,
    });
  });

  test("a license that leaves backups out says so, and setting them up waits for one", async () => {
    mockLicenseMode = "not-included";
    overview = emptyOverview({ isAvailable: false });

    await renderPage();

    expect(
      screen.getByTestId("backups-license-not-included"),
    ).toHaveTextContent(
      "Your Enterprise license does not include backups: no new backups are made.",
    );
    expect(screen.getByTestId("backups-set-up")).toBeDisabled();
    expect(screen.getByTestId("backups-set-up-note")).toHaveTextContent(
      LICENSE_REASON,
    );
  });

  test("a license in its grace period warns, and changes nothing yet", async () => {
    mockLicenseMode = "grace";

    await renderPage();

    expect(screen.getByTestId("backups-license-grace")).toBeInTheDocument();
    expect(screen.getByTestId("backups-set-up")).toBeEnabled();
  });

  test("a page that could not be read says so, and reads again on Refresh", async () => {
    overviewFailure = "The server could not be reached.";

    await renderPage("backups-load-error");

    expect(screen.getByTestId("backups-load-error")).toHaveTextContent(
      "Backups could not be loaded. The server could not be reached.",
    );

    overviewFailure = null;
    await click(
      within(screen.getByTestId("backups-load-error")).getByText(/Refresh/),
    );

    await waitFor(() => {
      expect(screen.getByTestId("backups-hero")).toBeInTheDocument();
    });
  });
});

describe("setting backups up, through the real form", () => {
  async function openSetup(): Promise<void> {
    await renderPage();
    await click(screen.getByTestId("backups-set-up"));
    await waitFor(
      () => {
        expect(
          within(dialog()).getByRole("navigation", { name: "Progress" }),
        ).toBeInTheDocument();
      },
      { timeout: FORM_WAIT_IN_MS },
    );
  }

  async function pickMinio(): Promise<void> {
    await click(within(dialog()).getByRole("radio", { name: /^MinIO/ }));
    await next();
  }

  async function fillMinio(): Promise<void> {
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Endpoint/), {
        target: { value: "https://minio.acme.internal:9000" },
      });
      fireEvent.change(screen.getByLabelText(/^Bucket/), {
        target: { value: "oneuptime-backups" },
      });
      fireEvent.change(screen.getByLabelText(/^Access key ID/), {
        target: { value: "backup-writer" },
      });
      fireEvent.change(screen.getByLabelText(/^Secret access key/), {
        target: { value: "minio-secret-9f8e7d6c5b4a" },
      });
    });
  }

  test(
    "MinIO: its own fields, tested as typed, then saved to back up on the schedule",
    async () => {
      answers["/find"] = (): JSONObject => {
        return { found: 2, added: 2, updated: 0, removed: 0 };
      };

      await openSetup();

      // Every recommended destination is a card to pick.
      for (const provider of BackupProviderCatalog as Array<BackupProviderDefinition>) {
        expect(
          within(dialog()).getByRole("radio", {
            name: new RegExp(`^${escapeRegExp(provider.title)}`),
          }),
        ).toBeInTheDocument();
      }

      await pickMinio();

      // MinIO's endpoint field says what MinIO's address is.
      expect(dialog()).toHaveTextContent(
        "Your MinIO server's S3 API address. OneUptime and ClickHouse must both reach it.",
      );
      // The test waits for what it needs, and says what.
      expect(
        screen.getByTestId("backup-destination-test-button"),
      ).toBeDisabled();
      expect(
        screen.getByTestId("backup-destination-test-hint"),
      ).toHaveTextContent("Fill in the settings above to test them.");

      await fillMinio();

      expect(
        screen.getByTestId("backup-destination-test-hint"),
      ).toHaveTextContent(BackupsCopy.testHint);

      await click(screen.getByTestId("backup-destination-test-button"));

      const result: HTMLElement = await screen.findByTestId(
        "backup-test-result",
        {},
        { timeout: FORM_WAIT_IN_MS },
      );

      expect(result).toHaveAttribute("data-successful", "true");
      expect(result).toHaveTextContent("Everything a backup needs works.");
      expect(
        screen.getByTestId("backup-test-check-clickhouse"),
      ).toHaveTextContent("ClickHouse can write here");
      expect(postsTo("/test")).toEqual([
        {
          destinationType: BackupDestinationType.S3Compatible,
          destinationProvider: BackupProvider.MinIO,
          config: {
            endpoint: "https://minio.acme.internal:9000",
            bucket: "oneuptime-backups",
            accessKeyId: "backup-writer",
          },
          secrets: { secretAccessKey: "minio-secret-9f8e7d6c5b4a" },
          includesClickhouse: true,
        },
      ]);
      // Testing saved nothing.
      expect(AdminModelAPI.create).not.toHaveBeenCalled();

      await next();

      // The schedule: kept 30 days, ClickHouse included, unless changed.
      expect(screen.getByLabelText(/^Keep backups for \(days\)/)).toHaveValue(
        30,
      );

      await act(async () => {
        fireEvent.change(screen.getByLabelText(/^Keep backups for \(days\)/), {
          target: { value: "14" },
        });
      });

      await click(
        within(dialog()).getByRole("button", { name: "Start backing up" }),
      );

      await waitFor(() => {
        expect(AdminModelAPI.create).toHaveBeenCalledTimes(1);
      });

      const saved: BackupSetting = (
        jest.mocked(AdminModelAPI.create).mock.calls[0]![0] as unknown as {
          model: BackupSetting;
        }
      ).model;

      expect(saved.destinationType).toBe(BackupDestinationType.S3Compatible);
      expect(saved.destinationProvider).toBe(BackupProvider.MinIO);
      expect(saved.config).toEqual({
        endpoint: "https://minio.acme.internal:9000",
        bucket: "oneuptime-backups",
        accessKeyId: "backup-writer",
      });
      expect(JSON.parse(saved.secrets!)).toEqual({
        secretAccessKey: "minio-secret-9f8e7d6c5b4a",
      });
      expect(saved.frequency).toBe(BackupFrequency.Daily);
      expect(saved.timeOfDay).toBe("02:00");
      expect(saved.retentionInDays).toBe(14);
      expect(saved.includesClickhouse).toBe(true);
      // Set up to back up on the schedule: that is what it is for.
      expect(saved.isEnabled).toBe(true);

      // The page now shows the backups, and the destination's own backups are found.
      await waitFor(() => {
        expect(screen.getByTestId("backups-status")).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(postsTo("/find")).toHaveLength(1);
      });
      expect(await screen.findByTestId("backups-notice")).toHaveTextContent(
        "Found 2 backups at the destination. Added 2 to the list.",
      );
    },
    FORM_TEST_TIMEOUT_IN_MS,
  );

  test(
    "a destination that fails a check says which, and what to change; a new key hides the answer",
    async () => {
      answers["/test"] = (): JSONObject => {
        return {
          isSuccessful: false,
          checks: [
            {
              key: "storage",
              isSuccessful: true,
              message: "Wrote, read, listed and deleted a test file.",
            },
            {
              key: "clickhouse",
              isSuccessful: false,
              message:
                "ClickHouse could not reach https://minio.acme.internal:9000. OneUptime reaches it, so allow ClickHouse's network to reach it too.",
            },
          ],
        } as unknown as JSONObject;
      };

      await openSetup();
      await pickMinio();
      await fillMinio();
      await click(screen.getByTestId("backup-destination-test-button"));

      const result: HTMLElement = await screen.findByTestId(
        "backup-test-result",
        {},
        { timeout: FORM_WAIT_IN_MS },
      );

      expect(result).toHaveAttribute("data-successful", "false");
      expect(result).toHaveTextContent(
        "Something a backup needs does not work yet.",
      );
      expect(screen.getByTestId("backup-test-check-storage")).toHaveAttribute(
        "data-successful",
        "true",
      );
      expect(
        screen.getByTestId("backup-test-check-clickhouse"),
      ).toHaveTextContent("allow ClickHouse's network to reach it too.");

      await act(async () => {
        fireEvent.change(screen.getByLabelText(/^Secret access key/), {
          target: { value: "another-secret" },
        });
      });

      expect(screen.queryByTestId("backup-test-result")).toBeNull();
    },
    FORM_TEST_TIMEOUT_IN_MS,
  );

  test(
    "a test the server refuses before any check says why",
    async () => {
      answers["/test"] = (): HTTPErrorResponse => {
        return new HTTPErrorResponse(
          400,
          {
            message: "Needs a valid Enterprise license that includes backups.",
          },
          {},
        );
      };

      await openSetup();
      await pickMinio();
      await fillMinio();
      await click(screen.getByTestId("backup-destination-test-button"));

      const result: HTMLElement = await screen.findByTestId(
        "backup-test-result",
        {},
        { timeout: FORM_WAIT_IN_MS },
      );

      expect(result).toHaveAttribute("data-successful", "false");
      expect(result).toHaveTextContent(LICENSE_REASON);
    },
    FORM_TEST_TIMEOUT_IN_MS,
  );

  test(
    "editing: the saved destination and schedule, credentials left as they are",
    async () => {
      setUpInstance();

      await renderPage();
      await click(
        within(screen.getByTestId("backups-view")).getByRole("button", {
          name: "Edit",
        }),
      );

      await waitFor(
        () => {
          expect(screen.getByRole("dialog")).toHaveTextContent(
            "Edit backup settings",
          );
        },
        { timeout: FORM_WAIT_IN_MS },
      );

      // MinIO is picked; the next step holds its saved settings.
      expect(
        within(dialog()).getByRole("radio", { name: /^MinIO/ }),
      ).toBeChecked();

      await next();

      expect(screen.getByLabelText(/^Endpoint/)).toHaveValue(
        "https://minio.acme.internal:9000",
      );
      expect(screen.getByLabelText(/^Secret access key/)).toHaveValue("");
      expect(screen.getByLabelText(/^Secret access key/)).toHaveAttribute(
        "placeholder",
        "Unchanged",
      );

      // The stored key is tested: nothing has to be pasted.
      await click(screen.getByTestId("backup-destination-test-button"));

      expect(postsTo("/test")[0]).toMatchObject({
        settingId: SETTING_ID,
        secrets: {},
      });

      await next();
      await click(
        within(dialog()).getByRole("button", { name: "Save changes" }),
      );

      await waitFor(() => {
        expect(AdminModelAPI.updateById).toHaveBeenCalledTimes(1);
      });

      const update: { id: ObjectID; data: JSONObject } = jest.mocked(
        AdminModelAPI.updateById,
      ).mock.calls[0]![0] as unknown as { id: ObjectID; data: JSONObject };

      expect(update.id.toString()).toBe(SETTING_ID);
      expect(update.data).not.toHaveProperty("secrets");
      expect(update.data).toMatchObject({
        destinationProvider: BackupProvider.MinIO,
        frequency: BackupFrequency.Daily,
        retentionInDays: 30,
      });
      // The same destination: nothing new to look for.
      expect(postsTo("/find")).toHaveLength(0);
    },
    FORM_TEST_TIMEOUT_IN_MS,
  );
});

describe("the status card", () => {
  test("backups on: when the last one ran, how big and how long, and when the next runs", async () => {
    setUpInstance();

    await renderPage();

    expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
      "Backups are on",
    );
    // The card's title is a heading, as every card's is.
    expect(
      screen.getByRole("heading", { level: 2, name: "Backups are on" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("backups-status-last")).toHaveTextContent(
      "Last backup 2 hours ago · 43 MB in 4 minutes",
    );
    expect(screen.getByTestId("backups-status-next")).toHaveTextContent(
      "(in 14 hours)",
    );
    expect(screen.getByTestId("backups-back-up-now")).toBeEnabled();
    // On: Turn on is not offered.
    expect(screen.queryByTestId("backups-turn-on")).toBeNull();

    // What it is set to.
    expect(
      screen.getByTestId("backups-settings-destination"),
    ).toHaveTextContent("MinIO");
    expect(screen.getByTestId("backups-settings-location")).toHaveTextContent(
      "s3://oneuptime-backups/prod/",
    );
    // An address reads left to right, on a right-to-left page too.
    expect(screen.getByTestId("backups-settings-location")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(screen.getByTestId("backups-settings-schedule")).toHaveTextContent(
      "Every day at 02:00 UTC",
    );
    expect(screen.getByTestId("backups-settings-retention")).toHaveTextContent(
      "30 days",
    );
    // Each database on a line of its own, with what it holds and its size now.
    expect(
      screen.getByTestId("backups-settings-contents-postgres"),
    ).toHaveTextContent(
      "PostgreSQL · projects, monitors, incidents, users · 41 MB now",
    );
    expect(
      screen.getByTestId("backups-settings-contents-clickhouse"),
    ).toHaveTextContent("ClickHouse · logs, traces, metrics · 2.2 GB now");
    // On: the schedule is not said to be off.
    expect(screen.queryByTestId("backups-settings-schedule-off")).toBeNull();
  });

  test("settings that leave ClickHouse out say it is not backed up", async () => {
    setUpInstance();
    setting!.includesClickhouse = false;

    await renderPage();

    expect(
      screen.getByTestId("backups-settings-contents-clickhouse"),
    ).toHaveTextContent("ClickHouse · Not backed up");
    expect(
      screen.getByTestId("backups-settings-contents"),
    ).not.toHaveTextContent("logs, traces, metrics");
  });

  test("no backup yet says so", async () => {
    setUpInstance();
    runs = [];

    await renderPage();

    expect(screen.getByTestId("backups-status-none")).toHaveTextContent(
      "No backup yet",
    );
  });

  test("Back up now starts one, and the card follows it", async () => {
    setUpInstance();

    await renderPage();
    await click(screen.getByTestId("backups-back-up-now"));

    expect(postsTo("/run-now")).toHaveLength(1);

    await waitFor(() => {
      expect(screen.getByTestId("backups-status-running")).toHaveTextContent(
        "Backing up",
      );
    });
    expect(screen.getByTestId("backups-status-step")).toHaveTextContent(
      "Starts within a minute.",
    );
    // Waiting to start: nothing has run yet to say how long.
    expect(screen.queryByTestId("backups-status-elapsed")).toBeNull();
    // A run going on: Back up now gives way to its steps and Cancel.
    expect(screen.queryByTestId("backups-back-up-now")).toBeNull();
    expect(screen.getByTestId("backups-active-cancel")).toBeEnabled();
  });

  test("a refused Back up now says why above the card", async () => {
    setUpInstance();
    answers["/run-now"] = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        { message: "A backup or a restore is already running." },
        {},
      );
    };

    await renderPage();
    await click(screen.getByTestId("backups-back-up-now"));

    expect(await screen.findByTestId("backups-notice")).toHaveTextContent(
      "A backup or a restore is already running.",
    );
  });

  test("Turn off, in the ⋯ menu, stops the schedule only; Turn on brings it back", async () => {
    setUpInstance();

    await renderPage();
    await openStatusMenu();
    await click(
      screen.getByRole("menuitem", { name: "Turn off scheduled backups" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
        "Scheduled backups are off",
      );
    });

    expect(
      (
        jest.mocked(AdminModelAPI.updateById).mock.calls[0]![0] as unknown as {
          data: JSONObject;
        }
      ).data,
    ).toEqual({ isEnabled: false });
    expect(screen.getByTestId("backups-status-next")).toHaveTextContent(
      "Nothing runs until they are turned on again.",
    );
    // The settings say the schedule they keep is off.
    expect(screen.getByTestId("backups-settings-schedule")).toHaveTextContent(
      "Every day at 02:00 UTC · Off",
    );
    // Back up now still works while the schedule is off.
    expect(screen.getByTestId("backups-back-up-now")).toBeEnabled();
    /*
     * One primary action: turning the schedule back on, first; Back up now
     * steps back to a plain button beside it.
     */
    const actions: Array<string> = Array.from(
      screen
        .getByTestId("backups-status-actions")
        .querySelectorAll("button[data-testid]"),
    ).map((button: Element): string => {
      return button.getAttribute("data-testid") || "";
    });

    expect(actions).toEqual(["backups-turn-on", "backups-back-up-now"]);
    expect(screen.getByTestId("backups-turn-on").className).toContain(
      "bg-indigo-600",
    );
    expect(screen.getByTestId("backups-back-up-now").className).not.toContain(
      "bg-indigo-600",
    );

    await click(screen.getByTestId("backups-turn-on"));

    await waitFor(() => {
      expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
        "Backups are on",
      );
    });
    expect(
      (
        jest.mocked(AdminModelAPI.updateById).mock.calls[1]![0] as unknown as {
          data: JSONObject;
        }
      ).data,
    ).toEqual({ isEnabled: true });
  });

  test("the last backup failed: when, why, and its steps one click away", async () => {
    setUpInstance();
    runs.push(
      backupRun(FAILED_ID, {
        status: BackupRunStatus.Failed,
        startedAt: minutesAgo(30),
        error:
          "ClickHouse could not write to the destination: Access Denied. Allow s3:PutObject on oneuptime-backups/prod/*.",
        steps: [
          step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
          step(BackupStepKey.BackUpPostgres, BackupStepStatus.Succeeded),
          step(BackupStepKey.BackUpClickhouse, BackupStepStatus.Failed, {
            message:
              "ClickHouse could not write to the destination: Access Denied. Allow s3:PutObject on oneuptime-backups/prod/*.",
          }),
        ] as unknown as JSONArray,
      }),
    );

    await renderPage();

    expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
      "The last backup failed",
    );
    // When, and the newest backup there still is to go back to.
    expect(screen.getByTestId("backups-status-last")).toHaveTextContent(
      "Last backup 30 minutes ago · Last good backup 2 hours ago",
    );
    expect(screen.getByTestId("backups-status-failed")).toHaveTextContent(
      "ClickHouse could not write to the destination",
    );
    /*
     * The server's sentence takes the direction of its first letter, so on
     * a right-to-left page an English error still ends with its full stop.
     */
    expect(
      screen.getByTestId("backups-status-failed").querySelector("[dir=auto]")
        ?.textContent,
    ).toBe(
      "ClickHouse could not write to the destination: Access Denied. Allow s3:PutObject on oneuptime-backups/prod/*.",
    );

    await click(screen.getByTestId("backups-failed-view-steps"));

    expect(
      screen.getByTestId(`backup-run-step-${BackupStepKey.BackUpClickhouse}`),
    ).toHaveAttribute("data-status", BackupStepStatus.Failed);
    expect(
      screen.getByTestId(
        `backup-run-step-message-${BackupStepKey.BackUpClickhouse}`,
      ),
    ).toHaveAttribute("dir", "auto");
  });

  test("a first backup that failed says there is nothing to restore yet", async () => {
    setUpInstance();
    runs = [
      backupRun(FAILED_ID, {
        status: BackupRunStatus.Failed,
        startedAt: minutesAgo(10),
        error: "The bucket oneuptime-backups does not exist.",
      }),
    ];

    await renderPage();

    expect(screen.getByTestId("backups-status-last")).toHaveTextContent(
      "Last backup 10 minutes ago · No backup to restore yet",
    );
    expect(screen.getByTestId("backups-status-failed")).toHaveTextContent(
      "The bucket oneuptime-backups does not exist.",
    );
  });

  test("a backup that failed without a message shows no empty error box", async () => {
    setUpInstance();
    runs.push(
      backupRun(FAILED_ID, {
        status: BackupRunStatus.Failed,
        startedAt: minutesAgo(5),
        error: undefined,
      }),
    );

    await renderPage();

    expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
      "The last backup failed",
    );
    expect(screen.queryByTestId("backups-status-failed")).toBeNull();
    expect(screen.getByTestId("backups-failed-view-steps")).toBeInTheDocument();
  });

  test("a backup running: its step, what it wrote, Cancel and View steps", async () => {
    setUpInstance();
    runs.push(
      backupRun(RUNNING_ID, {
        status: BackupRunStatus.Running,
        startedAt: minutesAgo(2),
        finishedAt: undefined,
        steps: [
          step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
          step(BackupStepKey.BackUpPostgres, BackupStepStatus.Running, {
            progress: { doneBytes: 12 * 1024 ** 2, totalBytes: 41 * 1024 ** 2 },
          }),
          step(BackupStepKey.BackUpClickhouse, BackupStepStatus.Pending),
          step(BackupStepKey.VerifyBackup, BackupStepStatus.Pending),
          step(BackupStepKey.DeleteOldBackups, BackupStepStatus.Pending),
        ] as unknown as JSONArray,
      }),
    );

    await renderPage();

    expect(screen.getByTestId("backups-status-step")).toHaveTextContent(
      "Step 2 of 5: Back up PostgreSQL · 12 MB written",
    );
    // How long it has been going, so a stuck one shows.
    expect(screen.getByTestId("backups-status-elapsed")).toHaveTextContent(
      "Running for 2 minutes",
    );
    // A dump's size is not known before it ends: no bar that would lie.
    expect(
      within(screen.getByTestId("backups-status")).queryByRole("progressbar"),
    ).toBeNull();

    await click(screen.getByTestId("backups-active-cancel"));

    expect(postsTo("/cancel")).toEqual([{ backupRunId: RUNNING_ID }]);

    await click(screen.getByTestId("backups-active-view-steps"));

    expect(screen.getByTestId("backup-run-steps")).toBeInTheDocument();
  });

  test("a restore running: which backup, how far, and that OneUptime keeps working meanwhile", async () => {
    setUpInstance();
    const backupStartedAt: Date = minutesAgo(26 * 60);

    runs.push(
      backupRun(RESTORE_ID, {
        kind: BackupRunKind.Restore,
        trigger: BackupRunTrigger.Manual,
        status: BackupRunStatus.Running,
        startedAt: minutesAgo(1),
        finishedAt: undefined,
        manifest: { startedAt: backupStartedAt.toISOString() },
        steps: [
          step(BackupStepKey.CheckBackup, BackupStepStatus.Succeeded),
          step(BackupStepKey.BackUpCurrentData, BackupStepStatus.Skipped),
          step(BackupStepKey.RestorePostgres, BackupStepStatus.Running, {
            progress: { doneBytes: 10 * 1024 ** 2, totalBytes: 40 * 1024 ** 2 },
          }),
          step(BackupStepKey.SwitchOver, BackupStepStatus.Pending),
          step(BackupStepKey.UpgradeRestoredData, BackupStepStatus.Pending),
          step(BackupStepKey.CleanUp, BackupStepStatus.Pending),
        ] as unknown as JSONArray,
      }),
    );

    await renderPage();

    const card: HTMLElement = screen.getByTestId("backups-status-running");

    expect(card).toHaveTextContent(
      `Restoring the backup of ${formatBackupDateTime(
        backupStartedAt,
        getFeedClock({ language: "en" }),
      )}`,
    );
    // The skipped step is not counted.
    expect(screen.getByTestId("backups-status-step")).toHaveTextContent(
      "Step 2 of 5: Restore PostgreSQL · 10 MB of 40 MB",
    );
    expect(within(card).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    // The bar is named by the step it measures.
    expect(
      within(card).getByRole("progressbar", { name: "Restore PostgreSQL" }),
    ).toBeInTheDocument();
    // A heading, as every card's title is.
    expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Restoring the backup of",
    );
    expect(card).toHaveTextContent(
      "OneUptime keeps working on the current data until the switch-over",
    );
  });

  test("Find backups looks at the destination and says what it found", async () => {
    setUpInstance();
    answers["/find"] = (): JSONObject => {
      return { found: 3, added: 1, updated: 2, removed: 0 };
    };

    await renderPage();
    await openStatusMenu();
    await click(screen.getByRole("menuitem", { name: "Find backups" }));

    expect(postsTo("/find")).toHaveLength(1);
    expect(await screen.findByTestId("backups-notice")).toHaveTextContent(
      "Found 3 backups at the destination. Added 1 to the list.",
    );
  });

  test("Find backups at an empty destination says it found none", async () => {
    setUpInstance();

    await renderPage();
    await openStatusMenu();
    await click(screen.getByRole("menuitem", { name: "Find backups" }));

    expect(await screen.findByTestId("backups-notice")).toHaveTextContent(
      "Found no backups at the destination.",
    );
  });

  test("a destination that stopped working is said at the top of the page", async () => {
    setUpInstance();
    overview = overviewOf({
      destinationError:
        "The secret access key could not be decrypted: ENCRYPTION_SECRET changed. Paste the key again in Edit.",
    });

    await renderPage();

    const alert: HTMLElement = screen.getByTestId("backups-destination-error");

    expect(alert).toHaveTextContent("The backup settings need attention");
    expect(alert).toHaveTextContent("Paste the key again in Edit.");
  });

  test("a database user that may not create databases is said, with the one command that fixes it", async () => {
    setUpInstance();
    overview = overviewOf({
      postgres: { canRestore: false, user: "oneuptime", sizeInBytes: 1024 },
    });

    await renderPage();

    expect(screen.getByTestId("backups-cannot-restore")).toHaveTextContent(
      "Run ALTER USER oneuptime CREATEDB; on PostgreSQL. Backups work as they are.",
    );
  });
});

describe("without a license that includes backups", () => {
  test("new backups are paused, and the card says so; restoring and deleting still work", async () => {
    setUpInstance();
    mockLicenseMode = "read-only";
    overview = overviewOf({ isAvailable: false });

    await renderPage();

    expect(screen.getByTestId("backups-license-lapsed")).toHaveTextContent(
      "Enterprise license required: no new backups are made.",
    );
    expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
      "New backups are paused",
    );
    /*
     * Never a next backup it will not make - and not the license's reason
     * again under the notice that just said it.
     */
    expect(screen.queryByTestId("backups-status-next")).toBeNull();
    expect(screen.getByTestId("backups-status")).not.toHaveTextContent(
      "They need a license that includes backups.",
    );
    expect(screen.getByTestId("backups-back-up-now")).toBeDisabled();
    expect(
      within(screen.getByTestId("backups-view")).getByRole("button", {
        name: "Edit",
      }),
    ).toBeDisabled();

    // The backups are still there to restore and to delete.
    const backup: BackupRun = runs[0]!;

    expect(rowActions(backup)).toEqual(["Restore", ["View steps", "Delete"]]);
    expect(action("Restore").disabled).toBe(false);
  });
});

describe("new backups paused where the page shows no license notice", () => {
  test("the card says why itself, once", async () => {
    setUpInstance();
    // The license reads as usable here, while the server pauses new backups.
    mockLicenseMode = "editable";
    overview = overviewOf({ isAvailable: false });

    await renderPage();

    expect(screen.queryByTestId("backups-license-lapsed")).toBeNull();
    expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
      "New backups are paused",
    );
    expect(screen.getByTestId("backups-status-next")).toHaveTextContent(
      "They need a license that includes backups. Restoring and deleting backups still work.",
    );
  });

  test("a license without backups: the notice says it, the card does not again", async () => {
    setUpInstance();
    mockLicenseMode = "not-included";
    overview = overviewOf({ isAvailable: false });

    await renderPage();

    expect(
      screen.getByTestId("backups-license-not-included"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("backups-status-next")).toBeNull();
  });
});

describe("the backups table", () => {
  test("lists the instance's backups through the Admin Dashboard's model API, newest first", async () => {
    setUpInstance();

    await renderPage();

    expect(table()["modelAPI"]).toBe(AdminModelAPI);
    expect(table()["query"]).toEqual({ kind: BackupRunKind.Backup });
    expect(table()["sortBy"]).toBe("startedAt");
    expect(table()["sortOrder"]).toBe(SortOrder.Descending);
    // Every move on a row is the page's own (Delete asks, then deletes at the destination).
    expect(table()["isDeleteable"]).toBe(false);
    expect(table()["isCreateable"]).toBe(false);
    expect(table()["isEditable"]).toBe(false);
    expect(
      (table()["cardProps"] as { title: string; description: string }).title,
    ).toBe("Backups");
    expect(
      (table()["columns"] as Array<Column>).map((candidate: Column) => {
        return candidate.title;
      }),
    ).toEqual(["Backup", "Contents", "Took", "Status"]);
    // No restore yet: no table of them.
    expect(mockTables[RESTORE_RUNS_TABLE_ID]).toBeUndefined();
  });

  test("each row's one button is the move its state calls for, the rest in its menu", async () => {
    setUpInstance();

    await renderPage();

    // Succeeded, here: restore it.
    expect(rowActions(runs[0]!)).toEqual(["Restore", ["View steps", "Delete"]]);
    // Failed: why.
    expect(
      rowActions(
        backupRun(FAILED_ID, {
          status: BackupRunStatus.Failed,
          error: "Access Denied",
        }),
      ),
    ).toEqual(["View steps", ["Delete"]]);
    // Running: stop it; it cannot be deleted while it runs.
    expect(
      rowActions(
        backupRun(RUNNING_ID, {
          status: BackupRunStatus.Running,
          finishedAt: undefined,
        }),
      ),
    ).toEqual(["Cancel", ["View steps"]]);
    // Cancelling already: nothing to press twice.
    expect(
      rowActions(
        backupRun(RUNNING_ID, {
          status: BackupRunStatus.Running,
          cancelRequestedAt: new Date(),
        }),
      ),
    ).toEqual(["View steps", []]);
    // At a previous destination: only deleting it from the list.
    expect(
      rowActions(
        backupRun(ELSEWHERE_ID, { destinationFingerprint: "s3:old-bucket/" }),
      ),
    ).toEqual(["View steps", ["Delete"]]);
    // Found at the destination: no steps of this installation's to view.
    expect(
      rowActions(
        backupRun(ELSEWHERE_ID, {
          trigger: BackupRunTrigger.FoundAtDestination,
          steps: [] as unknown as JSONArray,
        }),
      ),
    ).toEqual(["Restore", ["Delete"]]);
  });

  test("while a backup or a restore runs, Restore waits", async () => {
    setUpInstance();
    runs.push(
      backupRun(RUNNING_ID, {
        status: BackupRunStatus.Running,
        finishedAt: undefined,
      }),
    );

    await renderPage();

    expect(action("Restore").disabled).toBe(true);
    // The row's button is what can be done now.
    expect(rowActions(runs[0]!)[0]).toBe("View steps");
  });

  test("each row says when, what started it, what it holds, how long it took and how it went", async () => {
    setUpInstance();

    await renderPage();

    const backup: BackupRun = runs[0]!;
    const { unmount } = render(
      <MemoryRouter>
        <div>
          {column("Backup").getElement!(backup)}
          {column("Contents").getElement!(backup)}
          {column("Took").getElement!(backup)}
          {column("Status").getElement!(backup)}
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("backup-run-when")).toHaveTextContent(
      formatBackupDateTime(backup.startedAt!, getFeedClock({ language: "en" })),
    );
    expect(screen.getByTestId("backup-run-when")).toHaveTextContent(
      "Scheduled",
    );
    expect(screen.getByTestId("backup-run-contents")).toHaveTextContent(
      "PostgreSQL · 41 MB",
    );
    expect(screen.getByTestId("backup-run-contents")).toHaveTextContent(
      "ClickHouse · 2 MB",
    );
    expect(screen.getByText("4 minutes")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    unmount();

    // A failed one names the step it stopped on, and why on hover.
    render(
      <MemoryRouter>
        {column("Status").getElement!(
          backupRun(FAILED_ID, {
            status: BackupRunStatus.Failed,
            error: "Access Denied",
            steps: [
              step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
              step(BackupStepKey.BackUpPostgres, BackupStepStatus.Failed, {
                message: "Access Denied",
              }),
            ] as unknown as JSONArray,
          }),
        )}
      </MemoryRouter>,
    );

    expect(screen.getByTestId("backup-run-failed-step")).toHaveTextContent(
      "Back up PostgreSQL",
    );
    expect(screen.getByTestId("backup-run-failed-step")).toHaveAttribute(
      "title",
      "Access Denied",
    );
  });

  test("a backup at a previous destination says so under its time", async () => {
    setUpInstance();

    await renderPage();

    render(
      <MemoryRouter>
        {column("Backup").getElement!(
          backupRun(ELSEWHERE_ID, { destinationFingerprint: "s3:old-bucket/" }),
        )}
      </MemoryRouter>,
    );

    expect(screen.getByTestId("backup-run-when")).toHaveTextContent(
      "At a previous destination",
    );
  });

  test("the restores have a table of their own once there is one - and nothing in it to delete", async () => {
    setUpInstance();
    runs.push(
      backupRun(RESTORE_ID, {
        kind: BackupRunKind.Restore,
        trigger: BackupRunTrigger.Manual,
        restoredBackupRunId: new ObjectID(OLDER_ID),
        manifest: { startedAt: runs[1]!.startedAt!.toISOString() },
      }),
    );

    await renderPage();

    const restores: Record<string, unknown> = table(RESTORE_RUNS_TABLE_ID);

    expect(restores["query"]).toEqual({ kind: BackupRunKind.Restore });
    expect((restores["cardProps"] as { title: string }).title).toBe("Restores");
    expect(
      (restores["columns"] as Array<Column>).map((candidate: Column) => {
        return candidate.title;
      }),
    ).toEqual(["Restore", "Backup restored", "Contents", "Took", "Status"]);
    expect(rowActions(runs[2]!, RESTORE_RUNS_TABLE_ID)).toEqual([
      "View steps",
      [],
    ]);

    render(
      <MemoryRouter>
        {column("Backup restored", RESTORE_RUNS_TABLE_ID).getElement!(runs[2]!)}
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        formatBackupDateTime(
          runs[1]!.startedAt!,
          getFeedClock({ language: "en" }),
        ),
      ),
    ).toBeInTheDocument();
  });
});

describe("deleting a backup", () => {
  async function deleteRow(run: BackupRun): Promise<void> {
    await act(async () => {
      action("Delete").onClick(
        run,
        () => {},
        () => {},
      );
    });
  }

  test("asks first, naming the backup's time, then deletes it at the destination", async () => {
    setUpInstance();

    await renderPage();

    const older: BackupRun = runs[1]!;

    await deleteRow(older);

    expect(dialog()).toHaveTextContent(
      `Delete the backup of ${formatBackupDateTime(
        older.startedAt!,
        getFeedClock({ language: "en" }),
      )}?`,
    );
    expect(dialog()).toHaveTextContent(
      "Its files are deleted from the destination. It cannot be restored afterwards.",
    );
    // Not the newest that succeeded: nothing to warn about.
    expect(screen.queryByTestId("backups-delete-newest")).toBeNull();

    const toggleBefore: unknown = table()["refreshToggle"];

    await click(
      within(dialog()).getByRole("button", { name: "Delete backup" }),
    );

    expect(postsTo("/delete")).toEqual([{ backupRunId: OLDER_ID }]);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(table()["refreshToggle"]).not.toBe(toggleBefore);
  });

  test("the newest backup that succeeded warns that nothing newer is left to restore", async () => {
    setUpInstance();

    await renderPage();
    await deleteRow(runs[0]!);

    expect(screen.getByTestId("backups-delete-newest")).toHaveTextContent(
      "This is the newest backup that succeeded",
    );
  });

  test("a backup at a previous destination is removed from the list; its files stay", async () => {
    setUpInstance();

    await renderPage();
    await deleteRow(
      backupRun(ELSEWHERE_ID, { destinationFingerprint: "s3:old-bucket/" }),
    );

    expect(dialog()).toHaveTextContent(
      "It is removed from this list. Its files stay at the previous destination.",
    );
  });

  test("a refused delete says why, in the dialog", async () => {
    setUpInstance();
    answers["/delete"] = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        { message: "The destination refused the delete: Access Denied." },
        {},
      );
    };

    await renderPage();
    await deleteRow(runs[1]!);
    await click(
      within(dialog()).getByRole("button", { name: "Delete backup" }),
    );

    await waitFor(() => {
      expect(dialog()).toHaveTextContent(
        "The destination refused the delete: Access Denied.",
      );
    });
  });
});

describe("restoring from the table", () => {
  test("Restore opens the dialog for that backup, which checks it first", async () => {
    setUpInstance();
    answers["/restore-preview"] = (body: JSONObject): JSONObject => {
      return {
        backup: {
          id: body["backupRunId"],
          name: "oneuptime-backup-11111111",
          startedAt: runs[0]!.startedAt!.toISOString(),
          oneuptimeVersion: "14.0.88",
          postgres: {
            sizeInBytes: 1024,
            serverVersion: "16.4",
            counts: { projects: 3 },
          },
          clickhouse: { sizeInBytes: 2048, serverVersion: "25.3" },
        },
        current: {
          oneuptimeVersion: "14.0.88",
          postgres: {
            database: "oneuptimedb",
            sizeInBytes: 2048,
            counts: { projects: 4 },
          },
          clickhouse: { database: "oneuptime", sizeInBytes: 4096 },
        },
        problems: [],
        warnings: [],
      } as unknown as JSONObject;
    };

    await renderPage();

    await act(async () => {
      action("Restore").onClick(
        runs[0]!,
        () => {},
        () => {},
      );
    });

    await waitFor(() => {
      expect(postsTo("/restore-preview")).toEqual([
        {
          backupRunId: SUCCEEDED_ID,
          includesPostgres: true,
          includesClickhouse: true,
        },
      ]);
    });
    expect(screen.getByTestId("restore-backup-dialog")).toBeInTheDocument();
  });
});

describe("following a run live", () => {
  function intervalOf(ms: number): () => void {
    const call: Array<unknown> | undefined = jest
      .mocked(window.setInterval)
      .mock.calls.filter((candidate: Array<unknown>): boolean => {
        return candidate[1] === ms;
      })
      .pop();

    if (!call) {
      throw new Error(`No timer every ${ms} ms`);
    }

    return call[0] as () => void;
  }

  test("idle, it looks for a new backup every 20 seconds, and shows one that started", async () => {
    setUpInstance();
    jest.spyOn(window, "setInterval");

    await renderPage();

    const poll: () => void = intervalOf(IDLE_POLL_INTERVAL_IN_MS);

    // A scheduled backup starts on the server.
    runs.push(
      backupRun(RUNNING_ID, {
        status: BackupRunStatus.Running,
        startedAt: new Date(),
        finishedAt: undefined,
        steps: [
          step(BackupStepKey.CheckDestination, BackupStepStatus.Running),
        ] as unknown as JSONArray,
      }),
    );

    await act(async () => {
      poll();
    });

    await waitFor(() => {
      expect(screen.getByTestId("backups-status-running")).toBeInTheDocument();
    });
  });

  test("while one runs, it reads that run every 3 seconds, and the tables again once it ends", async () => {
    setUpInstance();
    runs.push(
      backupRun(RUNNING_ID, {
        status: BackupRunStatus.Running,
        startedAt: minutesAgo(1),
        finishedAt: undefined,
        steps: [
          step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
          step(BackupStepKey.BackUpPostgres, BackupStepStatus.Running),
        ] as unknown as JSONArray,
      }),
    );
    jest.spyOn(window, "setInterval");

    await renderPage();

    const toggleBefore: unknown = table()["refreshToggle"];
    const poll: () => void = intervalOf(ACTIVE_RUN_POLL_INTERVAL_IN_MS);

    // The next step starts.
    runs[2]!.steps = [
      step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
      step(BackupStepKey.BackUpPostgres, BackupStepStatus.Succeeded),
      step(BackupStepKey.BackUpClickhouse, BackupStepStatus.Running),
    ] as unknown as JSONArray;

    await act(async () => {
      poll();
    });

    await waitFor(() => {
      expect(screen.getByTestId("backups-status-step")).toHaveTextContent(
        "Step 3 of 3: Back up ClickHouse",
      );
    });
    expect(AdminModelAPI.getItem).toHaveBeenCalled();
    // The tables wait for the run to end.
    expect(table()["refreshToggle"]).toBe(toggleBefore);

    // It ends.
    runs[2]!.status = BackupRunStatus.Succeeded;
    runs[2]!.finishedAt = new Date();

    await act(async () => {
      poll();
    });

    await waitFor(() => {
      expect(screen.getByTestId("backups-status-idle")).toBeInTheDocument();
    });
    expect(table()["refreshToggle"]).not.toBe(toggleBefore);
  });
});

describe("in the reader's language", () => {
  test("German: the card, the settings and the schedule read in German", async () => {
    setUpInstance();
    useLocale("de");

    await renderPage();

    const german: Record<string, unknown> = mockDictionary;

    expect(screen.getByTestId("backups-status-title")).toHaveTextContent(
      german[BackupsCopy.statusOn] as string,
    );
    expect(screen.getByTestId("backups-status-title")).not.toHaveTextContent(
      BackupsCopy.statusOn,
    );
    expect(
      screen.getByTestId("backups-settings-schedule"),
    ).not.toHaveTextContent("Every day");
    expect(screen.getByTestId("backups-settings-retention")).toHaveTextContent(
      "30",
    );
    expect(
      screen.getByTestId("backups-settings-retention"),
    ).not.toHaveTextContent("days");
  });

  test("Japanese: the hero reads in Japanese", async () => {
    useLocale("ja");

    await renderPage();

    expect(screen.getByTestId("backups-hero")).toHaveTextContent(
      mockDictionary[BackupsCopy.heroTitle] as string,
    );
    expect(screen.getByTestId("backups-hero")).not.toHaveTextContent(
      "Back up OneUptime",
    );
  });
});

describe("the settings the page reads", () => {
  test("never ask for the stored credentials", async () => {
    setUpInstance();

    await renderPage();

    const settingReads: Array<unknown> = jest
      .mocked(AdminModelAPI.getList)
      .mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === BackupSetting;
      });

    expect(settingReads.length).toBeGreaterThan(0);

    for (const call of settingReads) {
      expect(
        Object.keys((call as Array<{ select: JSONObject }>)[0]!.select),
      ).not.toContain("secrets");
    }
  });
});
