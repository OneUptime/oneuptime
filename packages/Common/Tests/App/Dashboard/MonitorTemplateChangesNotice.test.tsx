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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import type { Mock } from "jest-mock";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  emptyMonitorTemplateChangeProgress,
  MONITOR_TEMPLATE_CHANGE_RECENT_MS,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeSettings,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
} from "../../../Types/Monitor/MonitorTemplateChange";
import * as ChangeApi from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi";
import { MonitorTemplateChangeDialogMode } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeDialog";
import MonitorTemplateChangesNotice, {
  ComponentProps as NoticeProps,
  MONITOR_TEMPLATE_CHANGES_REFRESH_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangesNotice";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * THE PROJECT'S TEMPLATE CHANGES, ON THE MONITORS LIST (issue #11454).
 *
 * A change of many monitors' template runs on the server, and closing its
 * dialog never stops it. An Unlink from Template started on the Monitors
 * list belongs to no template's page, so once its dialog was closed nothing
 * showed how far it got, or what it left out. Now the list shows each change
 * of the project still running - and one that finished in the last hour with
 * monitors left out, or failed - on one line with how far it got, and Show
 * progress opens its dialog, with Stop and Retry. The alert policies' and
 * the auto import rules' pages show their own the same way (#11452, #11451).
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      getProjectMonitorTemplateChanges: jest.fn(),
    };
  },
);

interface DialogProps {
  mode: string;
  changeId?: string | undefined;
  onClose: () => void;
  onChanged: () => void;
  onTemplateDeleted?: (() => void) | undefined;
}

let dialogs: Array<DialogProps> = [];

// The change's own dialog - its progress, Stop and Retry - is tested on its own.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeDialog",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeDialog",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: (props: DialogProps) => {
        dialogs.push(props);

        return (
          <div
            data-testid="change-dialog"
            data-change-id={props.changeId}
            data-mode={props.mode}
          >
            <button
              type="button"
              data-testid="change-dialog-close"
              onClick={props.onClose}
            >
              Close
            </button>
            <button
              type="button"
              data-testid="change-dialog-changed"
              onClick={props.onChanged}
            >
              Changed
            </button>
            <button
              type="button"
              data-testid="change-dialog-template-deleted"
              onClick={props.onTemplateDeleted}
            >
              Deleted
            </button>
          </div>
        );
      },
    };
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: Array<any>) => any;

const getChanges: Mock<AnyFunction> =
  ChangeApi.getProjectMonitorTemplateChanges as unknown as Mock<AnyFunction>;

const LINK: MonitorTemplateChangeSettings = {
  kind: MonitorTemplateChangeKind.Link,
  applyTemplateSettings: true,
  clearTemplateSettings: false,
  deleteTemplateWhenDone: false,
};

const UNLINK: MonitorTemplateChangeSettings = {
  kind: MonitorTemplateChangeKind.Unlink,
  applyTemplateSettings: false,
  clearTemplateSettings: false,
  deleteTemplateWhenDone: false,
};

const POLICY_ID: string = "80000000-0000-4000-8000-000000000001";
const RULE_ID: string = "90000000-0000-4000-8000-000000000001";

function progress(
  values: Partial<MonitorTemplateChangeProgress>,
): MonitorTemplateChangeProgress {
  return { ...emptyMonitorTemplateChangeProgress(0), ...values };
}

function change(
  overrides: Partial<MonitorTemplateChangeView> = {},
): MonitorTemplateChangeView {
  return {
    id: "change-link",
    status: MonitorTemplateChangeStatus.Running,
    settings: LINK,
    monitorTemplateId: "50000000-0000-4000-8000-000000000001",
    monitorTemplateName: "Switches (new)",
    progress: progress({
      total: 2000,
      processed: 1200,
      changed: 1200,
    }),
    lines: [],
    isLinesTruncated: false,
    isStopRequested: false,
    retryableCount: 0,
    isTemplateDeleted: false,
    isAutoImportRulePointed: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const RUNNING_LINK: MonitorTemplateChangeView = change();

const RUNNING_UNLINK: MonitorTemplateChangeView = change({
  id: "change-unlink",
  settings: UNLINK,
  monitorTemplateId: undefined,
  monitorTemplateName: undefined,
  progress: progress({ total: 851, processed: 400, changed: 400 }),
});

const RUNNING_POLICY_MOVE: MonitorTemplateChangeView = change({
  id: "change-policy",
  networkAlertPolicyId: POLICY_ID,
  networkAlertPolicyName: "Core switches",
  progress: progress({ total: 300, processed: 1, changed: 1 }),
});

const RUNNING_RULE_MOVE: MonitorTemplateChangeView = change({
  id: "change-rule",
  autoImportRuleId: RULE_ID,
  autoImportRuleName: "Warehouse switches",
  progress: progress({ total: 1, processed: 0 }),
});

function finished(
  overrides: Partial<MonitorTemplateChangeView>,
  minutesAgo: number,
): MonitorTemplateChangeView {
  return change({
    status: MonitorTemplateChangeStatus.Completed,
    completedAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    ...overrides,
  });
}

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        ...(language === "en"
          ? {}
          : { [language]: { translation: readDashboardLocale(language) } }),
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  dialogs = [];
  getChanges.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// What the page reads: the isolates a sentence sets its values apart with taken out.
function plain(text: string | null | undefined): string {
  return (text || "").replace(/[⁦-⁩‎‏]/g, "");
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function show(
  props: Partial<NoticeProps> = {},
  language: string = "en",
): Promise<{ rerender: (next: Partial<NoticeProps>) => Promise<void> }> {
  let rendered: ReturnType<typeof render> | undefined;

  await act(async () => {
    rendered = render(
      <I18nextProvider i18n={instances[language]!}>
        <MonitorTemplateChangesNotice {...props} />
      </I18nextProvider>,
    );
  });

  return {
    rerender: async (next: Partial<NoticeProps>): Promise<void> => {
      await act(async () => {
        rendered!.rerender(
          <I18nextProvider i18n={instances[language]!}>
            <MonitorTemplateChangesNotice {...props} {...next} />
          </I18nextProvider>,
        );
      });
    },
  };
}

interface DrawnLine {
  line: string;
  action: string;
}

function drawn(): Array<DrawnLine> {
  return screen
    .queryAllByTestId("monitor-template-change-line")
    .map((element: HTMLElement): DrawnLine => {
      const action: string = plain(
        within(element).getByTestId("alert-text-on-right").textContent,
      );

      return {
        line: plain(element.textContent).replace(action, "").trim(),
        action: action,
      };
    });
}

describe("the Monitors list shows each change of the project still running, and how far it got", () => {
  test("one line each, in the words of what it does, with Show progress", async () => {
    getChanges.mockResolvedValue([
      RUNNING_LINK,
      RUNNING_UNLINK,
      RUNNING_POLICY_MOVE,
      RUNNING_RULE_MOVE,
    ]);

    await show();

    expect(getChanges).toHaveBeenCalledTimes(1);
    expect(drawn()).toEqual([
      {
        line: "Linking monitors to Switches (new): 1,200 of 2,000 monitors done.",
        action: "Show progress",
      },
      {
        line: "Unlinking monitors from their template: 400 of 851 monitors done.",
        action: "Show progress",
      },
      {
        line: "Moving the monitors of the alert policy Core switches to Switches (new): 1 of 300 monitors done.",
        action: "Show progress",
      },
      {
        line: "Moving the monitors of the auto import rule Warehouse switches to Switches (new): 0 of 1 monitor done.",
        action: "Show progress",
      },
    ]);
  });

  test("a running change is a notice, not a warning", async () => {
    getChanges.mockResolvedValue([RUNNING_LINK]);

    await show();

    const line: HTMLElement = screen.getByTestId(
      "monitor-template-change-line",
    );

    expect(line.className).toContain("bg-blue-50");
  });

  test("with no change to show, it draws nothing, and the page keeps no gap for it", async () => {
    getChanges.mockResolvedValue([]);

    await show();

    expect(screen.queryByTestId("monitor-template-changes")).toBeNull();
    expect(drawn()).toEqual([]);
  });

  test("an error reading the changes draws nothing and breaks nothing: the change still runs on the server", async () => {
    getChanges.mockRejectedValue(new Error("Network error"));

    await show();

    expect(screen.queryByTestId("monitor-template-changes")).toBeNull();
  });
});

describe("a change that finished in the last hour stays while it left something to look at", () => {
  test("monitors left out, failed or not reached, or the change failed: Show what happened", async () => {
    getChanges.mockResolvedValue([
      finished(
        {
          id: "left-out",
          progress: progress({
            total: 5,
            processed: 5,
            changed: 3,
            skipped: 2,
          }),
        },
        10,
      ),
      finished(
        {
          id: "failed",
          status: MonitorTemplateChangeStatus.Failed,
          progress: progress({ total: 5, processed: 2, changed: 2 }),
        },
        20,
      ),
    ]);

    await show();

    expect(drawn()).toEqual([
      {
        line: "3 of 5 monitors are linked to Switches (new)",
        action: "Show what happened",
      },
      {
        line: "The change stopped before it finished",
        action: "Show what happened",
      },
    ]);

    // Left out is a warning; a change that failed as a whole is an error.
    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "monitor-template-change-line",
    );

    expect(lines[0]!.className).toContain("bg-amber-50");
    expect(lines[1]!.className).toContain("bg-red-50");
  });

  test("one that went well, or finished over an hour ago, is done with", async () => {
    getChanges.mockResolvedValue([
      finished(
        {
          id: "went-well",
          progress: progress({ total: 5, processed: 5, changed: 5 }),
        },
        5,
      ),
      finished(
        {
          id: "long-ago",
          progress: progress({
            total: 5,
            processed: 5,
            changed: 3,
            failed: 2,
          }),
        },
        MONITOR_TEMPLATE_CHANGE_RECENT_MS / 60000 + 1,
      ),
    ]);

    await show();

    expect(drawn()).toEqual([]);
  });
});

describe("Show progress opens the change's own dialog", () => {
  test("its progress dialog, for that change", async () => {
    getChanges.mockResolvedValue([RUNNING_LINK, RUNNING_POLICY_MOVE]);

    await show();

    await act(async () => {
      fireEvent.click(
        screen.getAllByTestId("monitor-template-change-line")[1]!,
      );
    });

    const dialog: HTMLElement = screen.getByTestId("change-dialog");

    expect(dialog).toHaveAttribute("data-change-id", "change-policy");
    expect(dialog).toHaveAttribute(
      "data-mode",
      MonitorTemplateChangeDialogMode.Progress,
    );
  });

  test("closing it reads the changes again, and the dialog is gone", async () => {
    getChanges.mockResolvedValue([RUNNING_LINK]);

    await show();

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-template-change-line"));
    });

    getChanges.mockResolvedValue([]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("change-dialog-close"));
    });
    await flush();

    expect(screen.queryByTestId("change-dialog")).toBeNull();
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(drawn()).toEqual([]);
  });

  test("what the dialog changed is passed on, so the page reads its list again", async () => {
    getChanges.mockResolvedValue([RUNNING_LINK]);
    const onChanged: Mock<() => void> = jest.fn();

    await show({ onChanged: onChanged });

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-template-change-line"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("change-dialog-changed"));
    });

    expect(onChanged).toHaveBeenCalledTimes(1);

    // A template deleted at the end of its change: the dialog closes, the page reads again.
    await act(async () => {
      fireEvent.click(screen.getByTestId("change-dialog-template-deleted"));
    });
    await flush();

    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("change-dialog")).toBeNull();
  });

  test("a page that just started a change opens its dialog at once", async () => {
    getChanges.mockResolvedValue([]);

    const notice: { rerender: (next: Partial<NoticeProps>) => Promise<void> } =
      await show();

    expect(screen.queryByTestId("change-dialog")).toBeNull();

    await notice.rerender({ openChangeId: "change-rule" });

    expect(screen.getByTestId("change-dialog")).toHaveAttribute(
      "data-change-id",
      "change-rule",
    );
  });
});

describe("while a change runs, its line keeps up", () => {
  test("read again every few seconds, and the line says how far it got now", async () => {
    jest.useFakeTimers();
    getChanges.mockResolvedValue([RUNNING_LINK]);

    await show();

    getChanges.mockResolvedValue([
      change({
        progress: progress({ total: 2000, processed: 1900, changed: 1900 }),
      }),
    ]);

    await act(async () => {
      jest.advanceTimersByTime(MONITOR_TEMPLATE_CHANGES_REFRESH_MS);
    });
    await flush();

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(drawn()[0]!.line).toBe(
      "Linking monitors to Switches (new): 1,900 of 2,000 monitors done.",
    );
  });

  test("not while its dialog is open - the dialog follows the change itself - nor once nothing runs", async () => {
    jest.useFakeTimers();
    getChanges.mockResolvedValue([RUNNING_LINK]);

    await show();

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-template-change-line"));
    });
    await act(async () => {
      jest.advanceTimersByTime(MONITOR_TEMPLATE_CHANGES_REFRESH_MS * 5);
    });

    expect(getChanges).toHaveBeenCalledTimes(1);

    // Closed: read once, and with nothing running, never again.
    getChanges.mockResolvedValue([]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("change-dialog-close"));
    });
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(MONITOR_TEMPLATE_CHANGES_REFRESH_MS * 5);
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
  });

  test("a change seen running that has finished tells the page once, so its list is read again", async () => {
    jest.useFakeTimers();
    const onChanged: Mock<() => void> = jest.fn();
    getChanges.mockResolvedValue([RUNNING_LINK]);

    await show({ onChanged: onChanged });

    expect(onChanged).not.toHaveBeenCalled();

    getChanges.mockResolvedValue([
      finished(
        {
          progress: progress({
            total: 2000,
            processed: 2000,
            changed: 1998,
            skipped: 2,
          }),
        },
        0,
      ),
    ]);

    await act(async () => {
      jest.advanceTimersByTime(MONITOR_TEMPLATE_CHANGES_REFRESH_MS);
    });
    await flush();

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(drawn()).toEqual([
      {
        line: "1,998 of 2,000 monitors are linked to Switches (new)",
        action: "Show what happened",
      },
    ]);

    // Done, it is no longer read every few seconds, and told no more.
    await act(async () => {
      jest.advanceTimersByTime(MONITOR_TEMPLATE_CHANGES_REFRESH_MS * 5);
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("a change the page just started is read at once (refreshToggle)", async () => {
    getChanges.mockResolvedValue([]);

    const notice: { rerender: (next: Partial<NoticeProps>) => Promise<void> } =
      await show({ refreshToggle: "a" });

    getChanges.mockResolvedValue([RUNNING_UNLINK]);

    await notice.rerender({ refreshToggle: "b" });
    await flush();

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(drawn()).toEqual([
      {
        line: "Unlinking monitors from their template: 400 of 851 monitors done.",
        action: "Show progress",
      },
    ]);
  });
});

describe("a page shows its own changes", () => {
  test("the alert policies' page: only a policy's move", async () => {
    getChanges.mockResolvedValue([
      RUNNING_LINK,
      RUNNING_POLICY_MOVE,
      RUNNING_RULE_MOVE,
    ]);

    await show({
      filter: (view: MonitorTemplateChangeView): boolean => {
        return Boolean(view.networkAlertPolicyId);
      },
    });

    expect(
      drawn().map((line: DrawnLine): string => {
        return line.line;
      }),
    ).toEqual([
      "Moving the monitors of the alert policy Core switches to Switches (new): 1 of 300 monitors done.",
    ]);
  });

  test("the auto import rules' page: only a rule's move", async () => {
    getChanges.mockResolvedValue([
      RUNNING_LINK,
      RUNNING_POLICY_MOVE,
      RUNNING_RULE_MOVE,
    ]);

    await show({
      filter: (view: MonitorTemplateChangeView): boolean => {
        return Boolean(view.autoImportRuleId);
      },
    });

    expect(
      drawn().map((line: DrawnLine): string => {
        return line.line;
      }),
    ).toEqual([
      "Moving the monitors of the auto import rule Warehouse switches to Switches (new): 0 of 1 monitor done.",
    ]);
  });
});

describe("in the reader's language", () => {
  test("German: the line, its numbers and Show progress", async () => {
    getChanges.mockResolvedValue([RUNNING_LINK, RUNNING_POLICY_MOVE]);

    await show({}, "de");

    expect(drawn()).toEqual([
      {
        line: "Monitore werden mit Switches (new) verknüpft: 1.200 von 2.000 Monitoren erledigt.",
        action: readDashboardLocale("de")["Show progress"],
      },
      {
        line: "Die Monitore der Warnungsrichtlinie Core switches werden zu Switches (new) verschoben: 1 von 300 Monitoren erledigt.",
        action: readDashboardLocale("de")["Show progress"],
      },
    ]);
  });

  test("Arabic: a rule's move of one monitor, and a change to look back at", async () => {
    getChanges.mockResolvedValue([
      RUNNING_RULE_MOVE,
      finished(
        {
          id: "failed",
          status: MonitorTemplateChangeStatus.Failed,
        },
        1,
      ),
    ]);

    await show({}, "ar");

    const arabic: Record<string, string> = readDashboardLocale("ar");

    expect(drawn()).toEqual([
      {
        line: "جارٍ نقل مراقبات قاعدة الاستيراد التلقائي Warehouse switches إلى Switches (new). اكتملت 0 من أصل 1 مراقبة.",
        action: arabic["Show progress"],
      },
      {
        line: arabic["The change stopped before it finished"],
        action: arabic["Show what happened"],
      },
    ]);
  });
});
