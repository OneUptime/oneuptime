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
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import type { Mock } from "jest-mock";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  emptyMonitorTemplateChangeProgress,
  MONITOR_NOT_REACHED_STOPPED,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
} from "../../../Types/Monitor/MonitorTemplateChange";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import { getErrorInSentenceText } from "../../../UI/Utils/ErrorInSentence";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Toast from "../../../UI/Utils/Toast";
import {
  getDeviceHasMonitorOfTemplateRefusal,
  MONITOR_NOT_FOUND_REFUSAL,
  MONITOR_NOT_LINKED_REFUSAL,
} from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import * as ChangeApi from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi";
import MonitorTemplateChangeDialog, {
  ComponentProps as DialogProps,
  MonitorTemplateChangeDialogMode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeDialog";
import MonitorTemplateDeleteChoice from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateDeleteChoice";
import {
  DELETE_LINKED_QUESTION,
  DeleteChoice,
  getIssueGroupTitle,
  getMonitorTemplateChangeIssueGroups,
  getMonitorTemplateChangePhase,
  getMonitorTemplateChangeTitle,
  NEVER_MADE_AGAIN,
  RETRY_BUTTON,
  SETTINGS_KEPT,
  SETTINGS_REPLACED,
  UNLINK_CHOICE_TITLES,
  UnlinkChoice,
  WHAT_STAYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeModel";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE DIALOGS THAT CHANGE MONITORS' TEMPLATE, ONE LANGUAGE EACH (issues
 * #11260, #11266).
 *
 * "851 of 851 monitors could not be linked", in every language, was all
 * Link Existing Monitors said to a fleet an import had made, and Unlink
 * from Template showed the refusal with its Unlink button still active.
 * Now each dialog says what changes before anything does - the template's
 * criteria replacing the monitors', or kept when switched off; what stays;
 * that what made them never makes them again - in the reader's language,
 * with the reader's digits and a monitor's name as it was written; and then
 * how far the change on the server got, what it left out and why, in the
 * reader's words too.
 */

interface CapturedDropdown {
  dataTestId?: string | undefined;
  options: Array<
    | { value: string; label: string }
    | { label: string; options: Array<{ value: string; label: string }> }
  >;
  value?: { value: string; label: string } | undefined;
  onChange: (value: string | null) => void;
}

let capturedDropdowns: Array<CapturedDropdown> = [];

// The template picker as a plain select: its options are what is checked.
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Dropdown/Dropdown",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: (props: CapturedDropdown) => {
      capturedDropdowns.push(props);

      const flat: Array<{ value: string; label: string }> =
        props.options.flatMap(
          (
            option: CapturedDropdown["options"][number],
          ): Array<{ value: string; label: string }> => {
            return "options" in option ? option.options : [option];
          },
        );

      return (
        <select
          data-testid={props.dataTestId}
          value={props.value?.value || ""}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            props.onChange(event.target.value || null);
          }}
        >
          <option value="">-</option>
          {flat.map((option: { value: string; label: string }) => {
            return (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            );
          })}
        </select>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      startMonitorTemplateChange: jest.fn(),
      getMonitorTemplateChange: jest.fn(),
      stopMonitorTemplateChange: jest.fn(),
      retryMonitorTemplateChange: jest.fn(),
      getActiveMonitorTemplateChanges: jest.fn(),
      unlinkOneMonitor: jest.fn(),
    };
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: Array<any>) => any;

type MockedApi = {
  [K in keyof typeof ChangeApi]: Mock<AnyFunction>;
};

const api: MockedApi = ChangeApi as unknown as MockedApi;

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";
const NEW_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000002";
const OLD_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000003";
const PING_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000004";
const CHECKOUT_ID: string = "60000000-0000-4000-8000-000000000001";

const GERMAN: Record<string, string> = readDashboardLocale("de");
const PERSIAN: Record<string, string> = readDashboardLocale("fa");
const ENGLISH: Translator = dashboardTranslator("en");

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, words] of Object.entries({
    de: GERMAN,
    fa: PERSIAN,
  })) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: words },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

function template(
  id: string,
  name: string,
  monitorType: MonitorType,
): MonitorTemplate {
  const item: MonitorTemplate = new MonitorTemplate(new ObjectID(id));
  item.templateName = name;
  item.monitorType = monitorType;
  return item;
}

function monitor(
  id: string,
  name: string,
  monitorType: MonitorType = MonitorType.API,
): Monitor {
  const item: Monitor = new Monitor(new ObjectID(id));
  item.name = name;
  item.monitorType = monitorType;
  return item;
}

function monitors(count: number): Array<Monitor> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return monitor(
      `60000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      `switch-${index}`,
    );
  });
}

function progress(
  values: Partial<MonitorTemplateChangeProgress>,
): MonitorTemplateChangeProgress {
  return { ...emptyMonitorTemplateChangeProgress(0), ...values };
}

function changeView(
  overrides: Partial<MonitorTemplateChangeView> = {},
): MonitorTemplateChangeView {
  return {
    id: "change-1",
    status: MonitorTemplateChangeStatus.Queued,
    settings: {
      kind: MonitorTemplateChangeKind.Link,
      applyTemplateSettings: true,
      clearTemplateSettings: false,
      deleteTemplateWhenDone: false,
    },
    monitorTemplateId: NEW_TEMPLATE_ID,
    monitorTemplateName: "Switches (new)",
    progress: progress({ total: 3 }),
    lines: [],
    isLinesTruncated: false,
    isStopRequested: false,
    retryableCount: 0,
    isTemplateDeleted: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

let onClose: Mock<() => void>;
let onChanged: Mock<() => void>;
let onTemplateDeleted: Mock<() => void>;
let toasts: Array<string>;

beforeEach(() => {
  capturedDropdowns = [];
  toasts = [];
  onClose = jest.fn();
  onChanged = jest.fn();
  onTemplateDeleted = jest.fn();

  for (const mock of Object.values(api)) {
    if (typeof mock?.mockReset === "function") {
      mock.mockReset();
    }
  }

  jest.spyOn(Toast, "success").mockImplementation(((title: string) => {
    toasts.push(title);
    return "toast";
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [
      template(TEMPLATE_ID, "Switches", MonitorType.API),
      template(NEW_TEMPLATE_ID, "Switches (new)", MonitorType.API),
      template(OLD_TEMPLATE_ID, "Switches (old)", MonitorType.API),
    ],
    count: 3,
    skip: 0,
    limit: 1000,
  } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openDialog(
  language: string,
  props: Partial<DialogProps> & { mode: MonitorTemplateChangeDialogMode },
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <I18nextProvider i18n={instances[language]!}>
          <MonitorTemplateChangeDialog
            template={{
              id: TEMPLATE_ID,
              name: "Switches",
              monitorType: MonitorType.API,
            }}
            onClose={onClose}
            onChanged={onChanged}
            onTemplateDeleted={onTemplateDeleted}
            {...props}
          />
        </I18nextProvider>
      </MemoryRouter>,
    );
  });
}

function whatChanges(): Array<string> {
  return Array.from(
    screen
      .getByTestId("monitor-template-change-what-changes")
      .querySelectorAll("li"),
  ).map((item: Element): string => {
    return item.textContent || "";
  });
}

function submitButton(): HTMLButtonElement {
  return screen.getByTestId("modal-footer-submit-button") as HTMLButtonElement;
}

async function pickTemplate(templateId: string): Promise<void> {
  await waitFor(() => {
    expect(
      screen
        .getByTestId("monitor-template-change-template")
        .querySelector(`option[value="${templateId}"]`),
    ).not.toBeNull();
  });

  await act(async () => {
    fireEvent.change(screen.getByTestId("monitor-template-change-template"), {
      target: { value: templateId },
    });
  });
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

// What the dialog's last picker offered: each group's label and its templates' names.
function offered(): Array<string | [string, Array<string>]> {
  const last: CapturedDropdown =
    capturedDropdowns[capturedDropdowns.length - 1]!;

  return last.options.map((option: CapturedDropdown["options"][number]) => {
    return "options" in option
      ? [
          option.label,
          option.options.map((item: { label: string }): string => {
            return item.label;
          }),
        ]
      : option.label;
  });
}

describe("Move to Another Template, in German", () => {
  const de: Translator = dashboardTranslator("de");

  test("says what changes before anything does: the template's criteria replace theirs, what stays, and that nothing makes them again", async () => {
    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Move,
      monitors: monitors(3),
    });

    // The templates of the monitors' type, other than this one.
    await waitFor(() => {
      expect(offered()).toEqual(["Switches (new)", "Switches (old)"]);
    });
    expect(ModelAPI.getList).toHaveBeenCalledWith(
      expect.objectContaining({ query: { monitorType: MonitorType.API } }),
    );

    expect(whatChanges()).toEqual([
      de.translatePlural(SETTINGS_REPLACED, 3),
      de.translatePlural(WHAT_STAYS, 3),
      de.translatePlural(NEVER_MADE_AGAIN, 3),
    ]);
    expect(whatChanges()[0]).not.toBe(
      ENGLISH.translatePlural(SETTINGS_REPLACED, 3),
    );

    // Nothing to do until a template is picked.
    expect(submitButton().textContent).toBe(
      de.translatePlural(
        { one: "Move {{count}} Monitor", other: "Move {{count}} Monitors" },
        3,
        { count: "3" },
      ),
    );
    expect(submitButton()).toBeDisabled();
    expect(api.startMonitorTemplateChange).not.toHaveBeenCalled();
  });

  test("switched off, it says they keep their own criteria, and the change goes without the template's settings", async () => {
    api.startMonitorTemplateChange.mockResolvedValue(changeView());
    api.getMonitorTemplateChange.mockResolvedValue(changeView());

    const picked: Array<Monitor> = monitors(3);

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Move,
      monitors: picked,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });

    expect(whatChanges()[0]).toBe(de.translatePlural(SETTINGS_KEPT, 3));

    await pickTemplate(NEW_TEMPLATE_ID);
    expect(submitButton()).not.toBeDisabled();
    await submit();

    expect(api.startMonitorTemplateChange).toHaveBeenCalledTimes(1);
    expect(api.startMonitorTemplateChange).toHaveBeenCalledWith({
      monitorTemplateId: NEW_TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Link,
        applyTemplateSettings: false,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      monitorIds: picked.map((item: Monitor): string => {
        return item.id!.toString();
      }),
    });
  });

  test("then shows the change on the server: its headline, and what it left out and why, in German - the monitor in the way named as written", async () => {
    const lines: Array<MonitorTemplateChangeLine> = [
      {
        monitorId: "m-2",
        monitorName: "core-sw-02",
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason: getDeviceHasMonitorOfTemplateRefusal("core-sw-02 (new)"),
      },
      {
        monitorId: "m-3",
        monitorName: "core-sw-03",
        outcome: MonitorTemplateChangeOutcome.Failed,
        reason: MONITOR_NOT_FOUND_REFUSAL,
      },
    ];
    const finished: MonitorTemplateChangeView = changeView({
      status: MonitorTemplateChangeStatus.Completed,
      progress: progress({
        total: 3,
        processed: 3,
        changed: 1,
        skipped: 1,
        failed: 1,
      }),
      lines: lines,
      retryableCount: 1,
    });

    api.startMonitorTemplateChange.mockResolvedValue(changeView());
    api.getMonitorTemplateChange.mockResolvedValue(finished);
    api.retryMonitorTemplateChange.mockResolvedValue(
      changeView({ id: "change-2" }),
    );

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Move,
      monitors: monitors(3),
    });
    await pickTemplate(NEW_TEMPLATE_ID);
    await submit();

    const headline: string = getMonitorTemplateChangeTitle({
      translator: de,
      view: finished,
      phase: getMonitorTemplateChangePhase(finished),
    });

    expect(
      await screen.findByText(headline, { exact: false }),
    ).toBeInTheDocument();
    expect(headline).not.toBe(
      getMonitorTemplateChangeTitle({
        translator: ENGLISH,
        view: finished,
        phase: getMonitorTemplateChangePhase(finished),
      }),
    );

    // Each reason in German, the monitor in the way as it was written.
    const inTheWay: string = getErrorInSentenceText({
      message: lines[0]!.reason,
      translator: de,
    });

    expect(inTheWay).toContain("core-sw-02 (new)");
    expect(inTheWay).not.toBe(lines[0]!.reason);
    expect(screen.getByText(inTheWay)).toBeInTheDocument();
    expect(
      screen.getByText(
        getErrorInSentenceText({
          message: MONITOR_NOT_FOUND_REFUSAL,
          translator: de,
        }),
      ),
    ).toBeInTheDocument();

    for (const group of getMonitorTemplateChangeIssueGroups(lines)) {
      expect(
        screen.getByText(getIssueGroupTitle(de, group)),
      ).toBeInTheDocument();
    }

    // The monitors it changed are changed: the page reads its lists again.
    expect(onChanged).toHaveBeenCalled();

    // Retry tries again the one that failed.
    expect(submitButton().textContent).toBe(
      de.translatePlural(RETRY_BUTTON, 1, { count: "1" }),
    );
    await submit();
    expect(api.retryMonitorTemplateChange).toHaveBeenCalledWith("change-1");
  });
});

describe("Unlink from Template, one monitor, in Persian", () => {
  const fa: Translator = dashboardTranslator("fa");

  test("asks which of the two, the monitor's name as written and set apart; keeping its settings is the default", async () => {
    api.unlinkOneMonitor.mockResolvedValue({
      outcome: MonitorTemplateChangeOutcome.Changed,
      resolvedIncidentCount: 0,
      resolvedAlertCount: 0,
    });

    await openDialog("fa", {
      mode: MonitorTemplateChangeDialogMode.Unlink,
      monitors: [monitor(CHECKOUT_ID, "Checkout API")],
    });

    expect(screen.getByTestId("modal-title").textContent).toBe(
      PERSIAN["Unlink Monitor from Template"],
    );

    const name: HTMLElement | null = screen
      .getByTestId("monitor-template-change-dialog")
      .querySelector("bdi");

    expect(name?.textContent).toBe("Checkout API");
    expect(name?.getAttribute("dir")).toBe("ltr");

    for (const choice of [
      UnlinkChoice.KeepSettings,
      UnlinkChoice.ClearCriteria,
    ]) {
      expect(
        screen.getByTestId(`card-select-option-${choice}`).textContent,
      ).toContain(fa.translatePlural(UNLINK_CHOICE_TITLES[choice], 1));
    }

    expect(submitButton().textContent).toBe(
      fa.translatePlural(
        { one: "Unlink", other: "Unlink {{count}} Monitors" },
        1,
        {
          count: "۱",
        },
      ),
    );
    await submit();

    expect(api.unlinkOneMonitor).toHaveBeenCalledWith({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: CHECKOUT_ID,
      clearTemplateSettings: false,
    });
    expect(api.startMonitorTemplateChange).not.toHaveBeenCalled();
    expect(toasts).toEqual([
      PERSIAN["Unlinked. The monitor keeps its settings as its own."],
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("clearing its criteria: the button says so, and what that resolved is counted in Persian digits", async () => {
    api.unlinkOneMonitor.mockResolvedValue({
      outcome: MonitorTemplateChangeOutcome.Changed,
      resolvedIncidentCount: 2,
      resolvedAlertCount: 1,
    });

    await openDialog("fa", {
      mode: MonitorTemplateChangeDialogMode.Unlink,
      monitors: [monitor(CHECKOUT_ID, "Checkout API")],
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`card-select-option-${UnlinkChoice.ClearCriteria}`),
      );
    });

    expect(submitButton().textContent).toBe(
      fa.translatePlural(
        {
          one: "Unlink and Clear",
          other: "Unlink and Clear {{count}} Monitors",
        },
        1,
        { count: "۱" },
      ),
    );
    await submit();

    expect(api.unlinkOneMonitor).toHaveBeenCalledWith({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: CHECKOUT_ID,
      clearTemplateSettings: true,
    });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("۳");
    expect(toasts[0]).not.toMatch(/[0-9]/);
  });

  test("refused: the server's reason, in Persian - and the dialog stays open to say it", async () => {
    api.unlinkOneMonitor.mockRejectedValue(
      new HTTPErrorResponse(400, { message: MONITOR_NOT_LINKED_REFUSAL }, {}),
    );

    await openDialog("fa", {
      mode: MonitorTemplateChangeDialogMode.Unlink,
      monitors: [monitor(CHECKOUT_ID, "Checkout API")],
    });
    await submit();

    expect((await screen.findByTestId("modal-error")).textContent).toBe(
      PERSIAN[MONITOR_NOT_LINKED_REFUSAL],
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });
});

describe("Unlink from Template, many monitors, in German", () => {
  const de: Translator = dashboardTranslator("de");

  test("asks with their count, and runs as one change on the server", async () => {
    api.startMonitorTemplateChange.mockResolvedValue(
      changeView({
        settings: {
          kind: MonitorTemplateChangeKind.Unlink,
          applyTemplateSettings: false,
          clearTemplateSettings: false,
          deleteTemplateWhenDone: false,
        },
      }),
    );
    api.getMonitorTemplateChange.mockResolvedValue(
      changeView({ status: MonitorTemplateChangeStatus.Running }),
    );

    const fleet: Array<Monitor> = monitors(851);

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Unlink,
      monitors: fleet,
    });

    expect(screen.getByTestId("modal-title").textContent).toBe(
      GERMAN["Unlink Monitors from Template"],
    );
    expect(
      screen.getByText(
        de.translatePlural(
          {
            one: "{{count}} monitor selected",
            other: "{{count}} monitors selected",
          },
          851,
          { count: "851" },
        ),
      ),
    ).toBeInTheDocument();
    expect(submitButton().textContent).toBe(
      de.translatePlural(
        { one: "Unlink", other: "Unlink {{count}} Monitors" },
        851,
        { count: "851" },
      ),
    );

    await submit();

    expect(api.unlinkOneMonitor).not.toHaveBeenCalled();
    expect(api.startMonitorTemplateChange).toHaveBeenCalledWith({
      monitorTemplateId: TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        applyTemplateSettings: false,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      monitorIds: fleet.map((item: Monitor): string => {
        return item.id!.toString();
      }),
    });

    // While it runs: Stop, and closing never stops it.
    const stop: HTMLElement = await screen.findByTestId(
      "monitor-template-change-stop",
    );

    expect(stop.textContent).toBe(GERMAN["Stop"]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.stopMonitorTemplateChange).not.toHaveBeenCalled();
  });
});

describe("Link to Template from the Monitors list, in German", () => {
  const de: Translator = dashboardTranslator("de");

  test("offers every template, by type, and says how many of the selected are of another type and left out", async () => {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [
        template(NEW_TEMPLATE_ID, "Switches (new)", MonitorType.API),
        template(PING_TEMPLATE_ID, "Gateways", MonitorType.Ping),
      ],
      count: 2,
      skip: 0,
      limit: 1000,
    } as never);

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.LinkTo,
      template: undefined,
      monitors: [
        monitor(CHECKOUT_ID, "Checkout API"),
        monitor("60000000-0000-4000-8000-000000000002", "Search API"),
        monitor(
          "60000000-0000-4000-8000-000000000003",
          "Gateway",
          MonitorType.Ping,
        ),
      ],
    });

    await waitFor(() => {
      expect(offered()).toEqual([
        [
          de.translateText(MonitorTypeHelper.getTitle(MonitorType.API)),
          ["Switches (new)"],
        ],
        [
          de.translateText(MonitorTypeHelper.getTitle(MonitorType.Ping)),
          ["Gateways"],
        ],
      ]);
    });
    expect(ModelAPI.getList).toHaveBeenCalledWith(
      expect.objectContaining({ query: {} }),
    );

    await pickTemplate(NEW_TEMPLATE_ID);

    expect(
      screen.getByTestId("monitor-template-change-other-types").textContent,
    ).toBe(
      de.translatePlural(
        {
          one: "{{count}} of the selected monitors is of another type and is left out.",
          other:
            "{{count}} of the selected monitors are of another type and are left out.",
        },
        1,
        { count: "1" },
      ),
    );
    expect(submitButton().textContent).toBe(
      de.translatePlural(
        { one: "Link {{count}} Monitor", other: "Link {{count}} Monitors" },
        2,
        { count: "2" },
      ),
    );
  });
});

describe("a change's progress, opened again", () => {
  test("not reached: the change's own reason, in German", async () => {
    const de: Translator = dashboardTranslator("de");

    api.getMonitorTemplateChange.mockResolvedValue(
      changeView({
        status: MonitorTemplateChangeStatus.Stopped,
        progress: progress({
          total: 3,
          processed: 3,
          changed: 1,
          notReached: 2,
        }),
        lines: [
          {
            monitorId: "m-2",
            outcome: MonitorTemplateChangeOutcome.NotReached,
            reason: MONITOR_NOT_REACHED_STOPPED,
          },
          {
            monitorId: "m-3",
            outcome: MonitorTemplateChangeOutcome.NotReached,
            reason: MONITOR_NOT_REACHED_STOPPED,
          },
        ],
        retryableCount: 2,
      }),
    );

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Progress,
      changeId: "change-1",
    });

    expect(
      await screen.findByText(GERMAN[MONITOR_NOT_REACHED_STOPPED]!),
    ).toBeInTheDocument();
    expect(GERMAN[MONITOR_NOT_REACHED_STOPPED]).not.toBe(
      MONITOR_NOT_REACHED_STOPPED,
    );
    expect(submitButton().textContent).toBe(
      de.translatePlural(RETRY_BUTTON, 2, { count: "2" }),
    );
  });

  test("a finished change whose list was cut short reads it whole, so each group counts all its monitors", async () => {
    const de: Translator = dashboardTranslator("de");
    const leftOut: (monitorId: string) => MonitorTemplateChangeLine = (
      monitorId: string,
    ): MonitorTemplateChangeLine => {
      return {
        monitorId: monitorId,
        monitorName: monitorId,
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason: MONITOR_NOT_FOUND_REFUSAL,
      };
    };
    const finished: MonitorTemplateChangeView = changeView({
      status: MonitorTemplateChangeStatus.Completed,
      progress: progress({ total: 3, processed: 3, skipped: 3 }),
      lines: [leftOut("m-1"), leftOut("m-2")],
      isLinesTruncated: true,
    });

    api.getMonitorTemplateChange.mockImplementation(
      async (
        _changeId: string,
        options?: { allLines?: boolean | undefined },
      ): Promise<MonitorTemplateChangeView> => {
        return options?.allLines
          ? {
              ...finished,
              lines: [leftOut("m-1"), leftOut("m-2"), leftOut("m-3")],
              isLinesTruncated: false,
            }
          : finished;
      },
    );

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Progress,
      changeId: "change-1",
    });

    const allThree: string = de.translatePlural(
      {
        one: "{{count}} monitor was left out",
        other: "{{count}} monitors were left out",
      },
      3,
      { count: "3" },
    );

    expect(await screen.findByText(allThree)).toBeInTheDocument();
    expect(api.getMonitorTemplateChange).toHaveBeenCalledWith("change-1", {
      allLines: true,
    });
    expect(
      screen.queryByTestId("monitor-template-change-issues-truncated"),
    ).toBeNull();
  });

  test("a delete that cleared its monitors first: once the template is gone, it says so, and closing leaves its page", async () => {
    api.getMonitorTemplateChange.mockResolvedValue(
      changeView({
        status: MonitorTemplateChangeStatus.Completed,
        settings: {
          kind: MonitorTemplateChangeKind.Unlink,
          applyTemplateSettings: false,
          clearTemplateSettings: true,
          deleteTemplateWhenDone: true,
        },
        monitorTemplateId: TEMPLATE_ID,
        monitorTemplateName: "Switches",
        progress: progress({ total: 3, processed: 3, changed: 3 }),
        isTemplateDeleted: true,
      }),
    );

    await openDialog("de", {
      mode: MonitorTemplateChangeDialogMode.Progress,
      changeId: "change-1",
    });

    await waitFor(() => {
      expect(toasts).toEqual([
        GERMAN["{{templateName}} was deleted."]!.replace(
          "{{templateName}}",
          "Switches",
        ),
      ]);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });
    expect(onTemplateDeleted).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a template's delete asks what happens to its monitors, in Persian", () => {
  test("its question carries the count in Persian digits and the template's name as written; keeping their settings is the default", async () => {
    const fa: Translator = dashboardTranslator("fa");
    const onChange: Mock<(choice: DeleteChoice) => void> = jest.fn();

    await act(async () => {
      render(
        <I18nextProvider i18n={instances["fa"]!}>
          <MonitorTemplateDeleteChoice
            templateName="Switches"
            linkedMonitorCount={851}
            onChange={onChange}
          />
        </I18nextProvider>,
      );
    });

    const question: string =
      screen.getByTestId("monitor-template-delete-choice").querySelector("p")
        ?.textContent || "";

    expect(question).toBe(
      fa.translatePlural(DELETE_LINKED_QUESTION, 851, {
        count: "۸۵۱",
        templateName: "Switches",
      }),
    );
    expect(question).toContain("۸۵۱");
    expect(question).not.toMatch(/[0-9]/);
    expect(question).toContain("Switches");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`card-select-option-${DeleteChoice.ClearCriteria}`),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith(DeleteChoice.ClearCriteria);
  });
});
