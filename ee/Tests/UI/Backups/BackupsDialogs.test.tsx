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
  within,
} from "@testing-library/react";
import React from "react";

/*
 * The two dialogs the Backups page opens over a run:
 *
 *   Restore - the one move that replaces data. Before anything happens it
 *   says what goes back to when (PostgreSQL's records, with the counts the
 *   backup holds and today's; ClickHouse's telemetry), backs the current
 *   data up first unless that is unticked (and then says it cannot be
 *   undone), says what OneUptime does meanwhile, and waits for "restore" to
 *   be typed. A problem the server's check finds keeps it locked, in words.
 *
 *   View steps - each step and how it went, with the run's error said once,
 *   and the run read again every few seconds while it goes on.
 */

jest.mock("react-i18next", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-i18next",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import RestoreBackupModal, {
  describeRestoreIssue,
  RESTORE_CONFIRMATION_WORD,
} from "../../../AdminDashboard/Backups/RestoreBackupModal";
import BackupRunStepsModal, {
  BACKUP_STEPS_POLL_INTERVAL_IN_MS,
} from "../../../AdminDashboard/Backups/BackupRunStepsModal";
import { RESTORE_ISSUE_COPY } from "../../../AdminDashboard/Backups/BackupsCopy";
import {
  RestoreIssue,
  RestorePreview,
} from "../../../AdminDashboard/Backups/BackupsApi";
import { formatBackupDateTime } from "../../../AdminDashboard/Backups/BackupFormat";
import { backupRun, bodyOf, minutesAgo, step } from "./BackupsFixtures";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import { createTranslator } from "Common/UI/Utils/TranslateTemplate";
import API from "Common/UI/Utils/API/API";

const BACKUP_ID: string = "11111111-1111-4111-8111-111111111111";
const RESTORE_RUN_ID: string = "99999999-9999-4999-8999-999999999999";

let posts: Array<{ route: string; body: JSONObject }> = [];
let preview: (body: JSONObject) => RestorePreview | HTTPErrorResponse;
let restoreAnswer: () => JSONObject | HTTPErrorResponse;

function previewOf(fields: Partial<RestorePreview> = {}): RestorePreview {
  return {
    backup: {
      id: BACKUP_ID,
      name: "oneuptime-backup-11111111",
      startedAt: minutesAgo(120).toISOString(),
      oneuptimeVersion: "14.0.88",
      postgres: {
        sizeInBytes: 41 * 1024 ** 2,
        serverVersion: "16.4",
        counts: { projects: 3, users: 12, monitors: 140 },
      },
      clickhouse: { sizeInBytes: 2.2 * 1024 ** 3, serverVersion: "25.3" },
    },
    current: {
      oneuptimeVersion: "14.0.88",
      postgres: {
        database: "oneuptimedb",
        sizeInBytes: 45 * 1024 ** 2,
        counts: { projects: 4, users: 15, monitors: 150 },
      },
      clickhouse: { database: "oneuptime", sizeInBytes: 3 * 1024 ** 3 },
    },
    problems: [],
    warnings: [],
    ...fields,
  };
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

function submit(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(
      screen.getByTestId("delete-confirmation-type-to-confirm-input"),
      { target: { value: text } },
    );
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

beforeEach(() => {
  posts = [];
  preview = (): RestorePreview => {
    return previewOf();
  };
  restoreAnswer = (): JSONObject => {
    return { backupRunId: RESTORE_RUN_ID };
  };

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    const url: string = options.url.toString();
    const route: string = url.slice(url.lastIndexOf("/backup/") + 7);
    const body: JSONObject = bodyOf(options.data);

    posts.push({ route, body });

    const answer: unknown =
      route === "/restore-preview"
        ? preview(body)
        : route === "/restore"
          ? restoreAnswer()
          : {};

    return answer instanceof HTTPErrorResponse
      ? answer
      : new HTTPResponse(200, answer as JSONObject, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the restore dialog", () => {
  async function openRestore(
    backup: BackupRun = backupRun(BACKUP_ID),
    onStarted: (id: string) => void = () => {},
    onClose: () => void = () => {},
  ): Promise<void> {
    await act(async () => {
      render(
        <RestoreBackupModal
          backup={backup}
          onClose={onClose}
          onStarted={onStarted}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId("restore-backup-checking")).toBeNull();
    });
  }

  test("says what is replaced, back to when, with what the backup holds and what there is now", async () => {
    const backup: BackupRun = backupRun(BACKUP_ID);

    await openRestore(backup);

    const time: string = formatBackupDateTime(
      backup.startedAt!,
      getFeedClock({ language: "en" }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      `Restore the backup of ${time}?`,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "What you restore replaces the current data. Everything changed since this backup is lost.",
    );

    const postgres: HTMLElement = screen.getByTestId("restore-backup-postgres");

    expect(postgres).toHaveTextContent(
      `Every setting and record goes back to ${time}.`,
    );
    expect(postgres).toHaveTextContent(
      "The backup holds 3 projects, 12 users, and 140 monitors.",
    );
    expect(postgres).toHaveTextContent(
      "Now: 4 projects, 15 users, and 150 monitors.",
    );
    expect(screen.getByTestId("restore-backup-clickhouse")).toHaveTextContent(
      "2.2 GB of telemetry. Telemetry received since the backup is lost, and none is stored while it restores.",
    );
    // What OneUptime does meanwhile, and that a sign-in may be needed after.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "OneUptime keeps running on the current data, then switches to the restored data in a moment.",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "sign in with an account that is in the backup.",
    );
    // Both are chosen: everything the backup holds.
    expect(postsTo("/restore-preview")).toEqual([
      {
        backupRunId: BACKUP_ID,
        includesPostgres: true,
        includesClickhouse: true,
      },
    ]);
  });

  test("Restore waits for the word to be typed exactly, then starts with what was chosen", async () => {
    const started: Array<string> = [];

    await openRestore(backupRun(BACKUP_ID), (id: string) => {
      started.push(id);
    });

    expect(submit()).toBeDisabled();
    expect(
      screen.getByTestId("delete-confirmation-type-to-confirm-name"),
    ).toHaveTextContent(RESTORE_CONFIRMATION_WORD);

    await type("Restore");
    expect(submit()).toBeDisabled();

    await type("restor");
    expect(submit()).toBeDisabled();

    // Spaces around it are forgiven, as pasting brings them.
    await type(" restore ");
    expect(submit()).toBeEnabled();

    await click(submit());

    await waitFor(() => {
      expect(started).toEqual([RESTORE_RUN_ID]);
    });
    expect(postsTo("/restore")).toEqual([
      {
        backupRunId: BACKUP_ID,
        includesPostgres: true,
        includesClickhouse: true,
        takeBackupFirst: true,
        confirmation: "restore",
      },
    ]);
  });

  test("Enter in the box starts it too, once the word is there", async () => {
    await openRestore();

    await type("restore");

    await act(async () => {
      fireEvent.keyDown(
        screen.getByTestId("delete-confirmation-type-to-confirm-input"),
        { key: "Enter", code: "Enter" },
      );
    });

    await waitFor(() => {
      expect(postsTo("/restore")).toHaveLength(1);
    });
  });

  test("the current data is backed up first unless unticked - and then it says the restore cannot be undone", async () => {
    await openRestore();

    const first: HTMLElement = screen.getByTestId(
      "restore-backup-first-checkbox",
    );

    expect(first).toBeChecked();
    expect(screen.queryByTestId("restore-backup-without-backup")).toBeNull();

    await click(first);

    expect(first).not.toBeChecked();
    expect(
      screen.getByTestId("restore-backup-without-backup"),
    ).toHaveTextContent(
      "Without a backup first, this restore cannot be undone.",
    );

    await type("restore");
    await click(submit());

    await waitFor(() => {
      expect(postsTo("/restore")).toHaveLength(1);
    });
    expect(postsTo("/restore")[0]!["takeBackupFirst"]).toBe(false);
  });

  test("choosing only ClickHouse checks again; choosing nothing says to choose, and locks Restore", async () => {
    await openRestore();

    await click(screen.getByTestId("restore-backup-postgres-checkbox"));

    await waitFor(() => {
      expect(postsTo("/restore-preview")).toHaveLength(2);
    });
    expect(postsTo("/restore-preview")[1]).toEqual({
      backupRunId: BACKUP_ID,
      includesPostgres: false,
      includesClickhouse: true,
    });
    // No sign-in note: PostgreSQL's users stay as they are.
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "You may be signed out afterwards",
    );

    await click(screen.getByTestId("restore-backup-clickhouse-checkbox"));

    expect(
      screen.getByTestId("restore-backup-choose-something"),
    ).toHaveTextContent("Choose what to restore.");
    // Nothing to check.
    expect(postsTo("/restore-preview")).toHaveLength(2);

    await type("restore");
    expect(submit()).toBeDisabled();
  });

  test("a backup without ClickHouse offers only PostgreSQL", async () => {
    await openRestore(backupRun(BACKUP_ID, { includesClickhouse: false }));

    const clickhouse: HTMLElement = screen.getByTestId(
      "restore-backup-clickhouse",
    );

    expect(clickhouse).toHaveAttribute("data-checked", "false");
    expect(clickhouse).toHaveTextContent("Not in this backup.");
    expect(
      screen.getByTestId("restore-backup-clickhouse-checkbox"),
    ).toBeDisabled();
    expect(postsTo("/restore-preview")[0]!["includesClickhouse"]).toBe(false);
  });

  test("a problem the server finds is said in words, and Restore stays locked whatever is typed", async () => {
    preview = (): RestorePreview => {
      return previewOf({
        problems: [
          {
            code: "newer-version",
            message: "OneUptime 15.0.0 made this backup; this is 14.0.88.",
          },
        ],
      });
    };

    await openRestore();

    expect(screen.getByTestId("restore-backup-problems")).toHaveTextContent(
      "A newer version of OneUptime made this backup. Update OneUptime first, then restore it.",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This backup cannot be restored",
    );

    await type("restore");
    expect(submit()).toBeDisabled();
  });

  test("the tools' problem keeps the server's own sentence, which names the versions", async () => {
    preview = (): RestorePreview => {
      return previewOf({
        problems: [
          {
            code: "tools-missing",
            message:
              "pg_restore 15.8 cannot read a dump from pg_dump 17.2. Install postgresql17-client, or set BACKUP_POSTGRES_BIN_DIR.",
          },
        ],
      });
    };

    await openRestore();

    const problems: HTMLElement = screen.getByTestId("restore-backup-problems");

    expect(problems).toHaveTextContent(
      "This server cannot restore PostgreSQL yet. The details below say why.",
    );
    expect(problems).toHaveTextContent("Install postgresql17-client");
  });

  test("a warning is said, and Restore still works once confirmed", async () => {
    preview = (): RestorePreview => {
      return previewOf({
        warnings: [
          {
            code: "encryption-secret-differs",
            message: "Another ENCRYPTION_SECRET.",
          },
        ],
      });
    };

    await openRestore();

    expect(screen.getByTestId("restore-backup-warnings")).toHaveTextContent(
      "This backup was made with another ENCRYPTION_SECRET.",
    );

    await type("restore");
    expect(submit()).toBeEnabled();
  });

  test("a check the server cannot make says why, and Restore waits", async () => {
    preview = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "The backup's manifest at the destination could not be read: Access Denied.",
        },
        {},
      );
    };

    await openRestore();

    expect(
      screen.getByTestId("restore-backup-preview-error"),
    ).toHaveTextContent("Access Denied.");

    await type("restore");
    expect(submit()).toBeDisabled();
  });

  test("a restore the server refuses says why, and the dialog stays open", async () => {
    const started: Array<string> = [];

    restoreAnswer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        { message: "A backup or a restore is already running." },
        {},
      );
    };

    await openRestore(backupRun(BACKUP_ID), (id: string) => {
      started.push(id);
    });
    await type("restore");
    await click(submit());

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "A backup or a restore is already running.",
      );
    });
    expect(started).toEqual([]);
  });

  test("an issue's code is said in the reader's words; one the page does not know, in the server's", () => {
    const translator: ReturnType<typeof createTranslator> = createTranslator(
      undefined,
      "en",
    );

    for (const code of Object.keys(RESTORE_ISSUE_COPY)) {
      const issue: RestoreIssue = { code, message: "the server's sentence" };

      expect(describeRestoreIssue({ issue, translator })).toEqual({
        text: RESTORE_ISSUE_COPY[code],
        detail: code === "tools-missing" ? "the server's sentence" : null,
      });
    }

    expect(
      describeRestoreIssue({
        issue: { code: "disk-full", message: "The disk is full." },
        translator,
      }),
    ).toEqual({ text: "The disk is full.", detail: null });
  });
});

describe("the steps dialog", () => {
  function failedRun(fields: Partial<Record<string, unknown>> = {}): BackupRun {
    return backupRun(BACKUP_ID, {
      status: BackupRunStatus.Failed,
      startedAt: new Date("2026-10-24T02:00:00Z"),
      finishedAt: new Date("2026-10-24T02:03:00Z"),
      error:
        "ClickHouse could not write to the destination: Access Denied. Allow s3:PutObject on oneuptime-backups/prod/*.",
      steps: [
        step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded, {
          startedAt: "2026-10-24T02:00:00Z",
          finishedAt: "2026-10-24T02:00:02Z",
          message:
            "OneUptime and ClickHouse can write to oneuptime-backups/prod/.",
        }),
        step(BackupStepKey.BackUpPostgres, BackupStepStatus.Succeeded, {
          startedAt: "2026-10-24T02:00:02Z",
          finishedAt: "2026-10-24T02:00:08Z",
          progress: { doneBytes: 41 * 1024 ** 2 },
        }),
        step(BackupStepKey.BackUpClickhouse, BackupStepStatus.Failed, {
          startedAt: "2026-10-24T02:00:08Z",
          finishedAt: "2026-10-24T02:03:00Z",
          message:
            "ClickHouse could not write to the destination: Access Denied. Allow s3:PutObject on oneuptime-backups/prod/*.",
        }),
        step(BackupStepKey.VerifyBackup, BackupStepStatus.Pending),
        step(BackupStepKey.DeleteOldBackups, BackupStepStatus.Skipped),
      ] as unknown as JSONArray,
      ...fields,
    });
  }

  async function openSteps(run: BackupRun): Promise<void> {
    await act(async () => {
      render(<BackupRunStepsModal run={run} onClose={() => {}} />);
    });
  }

  test("each step with how it went, the run's status and where its files are", async () => {
    const run: BackupRun = failedRun();

    await openSteps(run);

    expect(screen.getByRole("dialog")).toHaveTextContent(
      `Backup of ${formatBackupDateTime(run.startedAt!, getFeedClock({ language: "en" }))}`,
    );

    const steps: HTMLElement = screen.getByTestId("backup-run-steps");

    expect(steps).toHaveTextContent("Failed");
    expect(steps).toHaveTextContent("Scheduled");
    expect(steps).toHaveTextContent("Took 3 minutes");
    expect(screen.getByTestId("backup-run-location")).toHaveTextContent(
      run.location!,
    );

    const status: (key: BackupStepKey) => string | null = (
      key: BackupStepKey,
    ): string | null => {
      return screen
        .getByTestId(`backup-run-step-${key}`)
        .getAttribute("data-status");
    };

    expect(status(BackupStepKey.CheckDestination)).toBe("succeeded");
    expect(status(BackupStepKey.BackUpClickhouse)).toBe("failed");
    expect(status(BackupStepKey.VerifyBackup)).toBe("pending");
    expect(status(BackupStepKey.DeleteOldBackups)).toBe("skipped");

    const postgres: HTMLElement = screen.getByTestId(
      `backup-run-step-${BackupStepKey.BackUpPostgres}`,
    );

    expect(postgres).toHaveTextContent("Back up PostgreSQL");
    // How long it took, and what it wrote.
    expect(postgres).toHaveTextContent("6 seconds · 41 MB");
    expect(
      screen.getByTestId(`backup-run-step-${BackupStepKey.VerifyBackup}`),
    ).toHaveTextContent("Waiting");
    expect(
      screen.getByTestId(`backup-run-step-${BackupStepKey.DeleteOldBackups}`),
    ).toHaveTextContent("Skipped");
    expect(
      screen.getByTestId(
        `backup-run-step-message-${BackupStepKey.BackUpClickhouse}`,
      ),
    ).toHaveTextContent("Allow s3:PutObject on oneuptime-backups/prod/*.");
    // The error is the step's: said once, beside it.
    expect(screen.queryByTestId("backup-run-error-box")).toBeNull();
    // And copied whole from the footer.
    expect(
      within(screen.getByTestId("modal-footer")).getByText("Copy error"),
    ).toBeInTheDocument();
  });

  test("an error no step says - the worker stopped - is said on its own", async () => {
    await openSteps(
      failedRun({
        error:
          "The worker running this backup stopped (no heartbeat for 3 minutes). Start it again with Back up now.",
      }),
    );

    expect(screen.getByTestId("backup-run-error-box")).toHaveTextContent(
      "The worker running this backup stopped",
    );
  });

  test("a restore's dialog is titled with the backup it restored", async () => {
    const backupStartedAt: Date = new Date("2026-10-23T02:00:00Z");

    await openSteps(
      backupRun(RESTORE_RUN_ID, {
        kind: BackupRunKind.Restore,
        trigger: BackupRunTrigger.Manual,
        manifest: { startedAt: backupStartedAt.toISOString() },
        steps: [
          step(BackupStepKey.CheckBackup, BackupStepStatus.Succeeded),
          step(BackupStepKey.BackUpCurrentData, BackupStepStatus.Succeeded),
          step(BackupStepKey.RestorePostgres, BackupStepStatus.Succeeded),
          step(BackupStepKey.SwitchOver, BackupStepStatus.Succeeded),
        ] as unknown as JSONArray,
      }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      `Restore of the backup of ${formatBackupDateTime(
        backupStartedAt,
        getFeedClock({ language: "en" }),
      )}`,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Switch to the restored data",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Started by hand");
  });

  test("while the run goes on it is read again every few seconds, and shows what it read", async () => {
    const running: BackupRun = backupRun(BACKUP_ID, {
      status: BackupRunStatus.Running,
      finishedAt: undefined,
      startedAt: minutesAgo(1),
      steps: [
        step(BackupStepKey.CheckDestination, BackupStepStatus.Succeeded),
        step(BackupStepKey.BackUpPostgres, BackupStepStatus.Running),
      ] as unknown as JSONArray,
    });
    const finished: BackupRun = backupRun(BACKUP_ID, {
      status: BackupRunStatus.Succeeded,
      startedAt: running.startedAt,
    });

    jest.spyOn(window, "setInterval");
    jest.spyOn(AdminModelAPI, "getItem").mockImplementation((async () => {
      return finished;
    }) as never);

    await openSteps(running);

    const timer: Array<unknown> | undefined = jest
      .mocked(window.setInterval)
      .mock.calls.find((call: Array<unknown>): boolean => {
        return call[1] === BACKUP_STEPS_POLL_INTERVAL_IN_MS;
      });

    expect(timer).toBeDefined();
    expect(
      screen.getByTestId(`backup-run-step-${BackupStepKey.BackUpPostgres}`),
    ).toHaveAttribute("data-status", "running");

    await act(async () => {
      (timer![0] as () => void)();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(`backup-run-step-${BackupStepKey.DeleteOldBackups}`),
      ).toHaveAttribute("data-status", "succeeded");
    });
    expect(
      (
        jest.mocked(AdminModelAPI.getItem).mock.calls[0]![0] as unknown as {
          id: { toString: () => string };
        }
      ).id.toString(),
    ).toBe(BACKUP_ID);
  });
});
