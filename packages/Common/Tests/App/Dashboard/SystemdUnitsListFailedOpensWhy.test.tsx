/**
 * @timezone UTC
 */
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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE SYSTEMD UNITS LIST'S FAILED UNITS OPEN WHY THEY FAILED (#9960).
 *
 * A host's Systemd Units list drew each failed unit's state as a plain
 * "Failed": a reader saw which units failed, and had to open each one to
 * learn why. Rendered for real, over the units' states and their journals
 * as the host collector's default config files them (each line under its
 * unit, systemd's result and exit status on its own lines):
 *
 *   - a failed unit's Failed is a pill that opens the dialog its page opens
 *     (#9748) - why, as systemd said it, since when, what it printed last -
 *     read from its journal when pressed, with View to its page;
 *   - how many units failed sits above the list, whatever page or filter
 *     shows them, and opens all of them at once - each with why, since
 *     when and View, the newest failure first - from one read of what
 *     systemd said of why those units failed;
 *   - nothing is read from the journal until a pill is pressed.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      navigate: (): void => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import HostSystemdUnits from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { SYSTEMD_UNIT_NO_REASON_IN_JOURNAL } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnitFailure";
import { SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnitJournal";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE,
  JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE,
  JOURNALD_SYSTEMD_RESULT_ATTRIBUTE,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import { flush } from "./TimeRangeZoomPageHarness";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Row = Record<string, unknown>;
type Locale = Record<string, string>;

interface ListRequest {
  modelType: { name: string };
  query: {
    time: InBetween<Date>;
    attributes: Record<string, unknown>;
  };
  limit: number;
}

function at(time: string): Date {
  return new Date(`2026-09-28T${time}.000Z`);
}

// The units on this host and the state each is in now, A to Z.
const STATES: Record<string, string> = {
  "api.service": "active",
  "backup.service": "failed",
  "cron.service": "active",
  "nginx.service": "failed",
  "worker.service": "failed",
};

let states: Record<string, string> = STATES;

function unitRows(): Array<Row> {
  return Object.entries(states).map(([name, state]: [string, string]): Row => {
    return {
      time: new Date(NOW.getTime() - 15_000),
      value: 1,
      attributes: {
        "resource.systemd.unit.name": name,
        "systemd.unit.active_state": state,
        "resource.host.name": "web-01",
      },
    };
  });
}

function systemdLine(
  unit: string,
  time: string,
  body: string,
  attributes: Row = {},
): Row {
  return {
    time: at(time),
    body: body,
    severityText: "INFO",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: unit,
      "syslog.identifier": "systemd",
      "process.pid": "1",
      ...attributes,
    },
  };
}

function ownLine(unit: string, time: string, body: string): Row {
  return {
    time: at(time),
    body: body,
    severityText: "ERROR",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: unit,
      "syslog.identifier": unit.replace(".service", ""),
      "process.pid": "4242",
    },
  };
}

const BIND_FAILED: string =
  "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)";

/*
 * Each unit's journal, newest first. nginx could not bind its port at
 * 10:00:02 and exited 1; backup was killed by SIGKILL at 09:00; worker's
 * journal says nothing of why it failed; api failed this morning and came
 * back, so it is no failed unit of the list.
 */
const JOURNALS: Record<string, Array<Row>> = {
  "nginx.service": [
    systemdLine(
      "nginx.service",
      "10:00:03",
      "nginx.service: Failed with result 'exit-code'.",
      {
        [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "exit-code",
      },
    ),
    systemdLine(
      "nginx.service",
      "10:00:03",
      "nginx.service: Main process exited, code=exited, status=1/FAILURE",
      {
        [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: "exited",
        [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: "1",
      },
    ),
    ownLine("nginx.service", "10:00:02", BIND_FAILED),
    ownLine(
      "nginx.service",
      "10:00:01",
      "nginx: [warn] the configuration file is deprecated",
    ),
  ],
  "backup.service": [
    systemdLine(
      "backup.service",
      "09:00:01",
      "backup.service: Failed with result 'signal'.",
      {
        [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "signal",
      },
    ),
    systemdLine(
      "backup.service",
      "09:00:00",
      "backup.service: Main process exited, code=killed, status=9/KILL",
      {
        [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: "killed",
        [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: "9",
      },
    ),
    ownLine("backup.service", "08:59:59", "backup: copying /var/lib/db"),
  ],
  "worker.service": [
    ownLine("worker.service", "07:00:00", "worker: shutting down"),
  ],
  "api.service": [
    systemdLine(
      "api.service",
      "06:00:00",
      "api.service: Failed with result 'timeout'.",
      {
        [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "timeout",
      },
    ),
  ],
};

let journalError: Error | null = null;

/*
 * The host's logs, answering a read as the server does: its lines of the
 * units named, with the attributes asked for.
 */
function logsFor(request: ListRequest): Array<Row> {
  const attributes: Record<string, unknown> = request.query.attributes;
  const unit: unknown = attributes[JOURNALD_SYSTEMD_UNIT_ATTRIBUTE];
  const units: Array<string> =
    unit instanceof Includes
      ? (unit.values as Array<string>)
      : [unit as string];

  return units
    .flatMap((name: string): Array<Row> => {
      return JOURNALS[name] || [];
    })
    .filter((line: Row): boolean => {
      const lineAttributes: Row = line["attributes"] as Row;
      return Object.entries(attributes).every(
        ([key, value]: [string, unknown]): boolean => {
          if (key === JOURNALD_SYSTEMD_UNIT_ATTRIBUTE) {
            return true;
          }
          if (key === "resource.host.name") {
            return value === "web-01";
          }
          if (value instanceof NotNull) {
            return Boolean(lineAttributes[key]);
          }
          return lineAttributes[key] === value;
        },
      );
    });
}

function serve(): void {
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      _id: HOST_ID,
      name: "web-01",
      hostIdentifier: "web-01",
      osType: "linux",
    });
  });
  getListMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: ListRequest = request as ListRequest;

    if (call.modelType.name === "Log") {
      return journalError
        ? Promise.reject(journalError)
        : Promise.resolve({ data: logsFor(call) });
    }

    return Promise.resolve({ data: unitRows() });
  });
}

function journalReads(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((args: Array<unknown>): ListRequest => {
      return args[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType.name === "Log";
    });
}

async function renderList(provider?: i18n): Promise<void> {
  serve();
  render(
    provider ? (
      <I18nextProvider i18n={provider}>
        <HostSystemdUnits {...PAGE_PROPS} />
      </I18nextProvider>
    ) : (
      <HostSystemdUnits {...PAGE_PROPS} />
    ),
  );
  await flush();
}

// The State cell of a unit's row.
function stateCell(unit: string): HTMLElement {
  const link: HTMLElement = screen.getByRole("link", { name: unit });
  const row: HTMLElement = link.closest("tr") as HTMLElement;
  return row.querySelectorAll("td")[2] as HTMLElement;
}

function failedPillOf(unit: string): HTMLElement {
  const pill: HTMLElement | null = stateCell(unit).querySelector(
    '[data-testid="systemd-units-unit-failed"]',
  );
  expect(pill).not.toBeNull();
  return pill as HTMLElement;
}

function unitRoute(unit: string): string {
  return `/dashboard/${PROJECT_ID}/host/${HOST_ID}/systemd/${encodeURIComponent(unit)}`;
}

// A text as a reader reads it: no isolate marks, one space between words.
function plain(value: string): string {
  return withoutIsolateMarks(value).replace(/\s+/g, " ").trim();
}

function text(element: HTMLElement): string {
  return plain(element.textContent || "");
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  getListMock.mockReset();
  states = STATES;
  journalError = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a failed unit's row opens why it failed", () => {
  test("Failed is the pill its page draws, and only a failed unit's state is one", async () => {
    await renderList();

    for (const unit of ["backup.service", "nginx.service", "worker.service"]) {
      const pill: HTMLElement = failedPillOf(unit);
      expect(pill.tagName).toBe("BUTTON");
      expect(pill).toHaveTextContent("Failed");
      expect(pill).toHaveAttribute("aria-haspopup", "dialog");
      expect(pill).toHaveAttribute("title", "Show why");
      expect(pill).toHaveAttribute("data-unit", unit);
      expect(pill).toHaveAttribute("data-tone", "danger");
    }

    // An active unit's state is the plain chip it was.
    for (const unit of ["api.service", "cron.service"]) {
      expect(stateCell(unit)).toHaveTextContent("Active");
      expect(stateCell(unit).querySelector("button")).toBeNull();
    }

    // Nothing is read from the journal until a pill is pressed.
    expect(journalReads()).toHaveLength(0);
  });

  test("pressed, it reads the unit's journal and says why, since when and what it printed, with View to its page", async () => {
    await renderList();

    fireEvent.click(failedPillOf("nginx.service"));
    await flush();

    // One read: the host's lines of this unit, of the last 7 days.
    expect(journalReads()).toHaveLength(1);
    const [read] = journalReads() as [ListRequest];
    expect(read.query.attributes).toEqual({
      "resource.host.name": "web-01",
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: "nginx.service",
    });
    expect(read.query.time.endValue).toEqual(NOW);
    expect(NOW.getTime() - read.query.time.startValue.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Why nginx.service failed");

    const items: Array<HTMLElement> = within(dialog).getAllByTestId(
      "systemd-units-unit-failed-dialog-item",
    );
    expect(items).toHaveLength(1);
    const row: HTMLElement = items[0]!;

    // From the list, the unit is a row of its own, a step from its page.
    expect(row).not.toHaveAttribute("data-current");
    expect(
      within(row).getByTestId("systemd-units-unit-failed-dialog-name"),
    ).toHaveTextContent("nginx.service");
    expect(
      within(row).getByTestId("systemd-units-unit-failed-dialog-reason"),
    ).toHaveTextContent("Exited with code 1");
    expect(
      within(row).getByTestId("systemd-units-unit-failed-dialog-message"),
    ).toHaveTextContent(BIND_FAILED);
    expect(
      within(row).getByTestId("systemd-units-unit-failed-dialog-since"),
    ).toHaveTextContent("Failed 1 hour ago");

    const view: HTMLElement = within(row).getByTestId(
      "systemd-units-unit-failed-dialog-view",
    );
    expect(view).toHaveTextContent("View");
    expect(view.getAttribute("href")).toBe(unitRoute("nginx.service"));
  });

  test("a unit killed by a signal says which", async () => {
    await renderList();

    fireEvent.click(failedPillOf("backup.service"));
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Why backup.service failed");
    expect(
      within(dialog).getByTestId("systemd-units-unit-failed-dialog-reason"),
    ).toHaveTextContent("Killed by SIGKILL");
    expect(
      within(dialog)
        .getAllByTestId("systemd-units-unit-failed-dialog-fact")
        .map(text),
    ).toEqual([
      expect.stringMatching(/^Result:? ?signal$/),
      expect.stringMatching(/^Exit status:? ?9\/KILL$/),
    ]);
  });

  test("a unit whose journal does not say why says so, and what it printed", async () => {
    await renderList();

    fireEvent.click(failedPillOf("worker.service"));
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    const row: HTMLElement = within(dialog).getByTestId(
      "systemd-units-unit-failed-dialog-item",
    );
    expect(
      within(row).getByTestId("systemd-units-unit-failed-dialog-reason"),
    ).toHaveTextContent("Failed");
    expect(row).toHaveTextContent(
      "Its journal of the last 7 days does not say why.",
    );
    expect(row).toHaveTextContent("worker: shutting down");
    expect(
      within(row)
        .getByTestId("systemd-units-unit-failed-dialog-view")
        .getAttribute("href"),
    ).toBe(unitRoute("worker.service"));
  });

  test("a journal that cannot be read says so, and Try again reads it again", async () => {
    journalError = new Error("The server did not answer.");
    await renderList();

    fireEvent.click(failedPillOf("nginx.service"));
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByTestId("systemd-units-unit-failed-dialog-error"),
    ).toHaveTextContent("The server did not answer.");

    journalError = null;
    fireEvent.click(within(dialog).getByRole("button", { name: /Refresh/i }));
    await flush();

    expect(journalReads()).toHaveLength(2);
    expect(
      within(dialog).getByTestId("systemd-units-unit-failed-dialog-reason"),
    ).toHaveTextContent("Exited with code 1");
  });
});

describe("how many units failed opens which and why", () => {
  test("says how many failed, beside the list's count", async () => {
    await renderList();

    const pill: HTMLElement = screen.getByTestId("systemd-units-failed");
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveTextContent("3 units failed");
    expect(pill).toHaveAttribute("title", "Show which units failed and why");
    expect(pill).toHaveAttribute("data-tone", "danger");
  });

  test("opens every failed unit, the newest failure first, from one read of why they failed", async () => {
    await renderList();

    fireEvent.click(screen.getByTestId("systemd-units-failed"));
    await flush();

    /*
     * Two reads at once - systemd's result lines and its exit lines - of
     * the failed units alone, bounded.
     */
    const reads: Array<ListRequest> = journalReads();
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      const units: unknown =
        read.query.attributes[JOURNALD_SYSTEMD_UNIT_ATTRIBUTE];
      expect(units).toBeInstanceOf(Includes);
      expect((units as Includes).values).toEqual([
        "backup.service",
        "nginx.service",
        "worker.service",
      ]);
      expect(read.query.attributes["resource.host.name"]).toBe("web-01");
      expect(read.limit).toBe(SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT);
    }
    expect(
      reads.map((read: ListRequest): Array<string> => {
        return Object.keys(read.query.attributes).filter((key: string) => {
          return read.query.attributes[key] instanceof NotNull;
        });
      }),
    ).toEqual([
      [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE],
      [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE],
    ]);

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("3 failed systemd units");

    const items: Array<HTMLElement> = within(dialog).getAllByTestId(
      "systemd-units-failed-dialog-item",
    );
    expect(
      items.map((item: HTMLElement): string => {
        return text(
          within(item).getByTestId("systemd-units-failed-dialog-name"),
        );
      }),
    ).toEqual(["nginx.service", "backup.service", "worker.service"]);

    const [nginx, backup, worker] = items as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(
      within(nginx).getByTestId("systemd-units-failed-dialog-reason"),
    ).toHaveTextContent("Exited with code 1");
    expect(
      within(nginx).getByTestId("systemd-units-failed-dialog-since"),
    ).toHaveTextContent("Failed 1 hour ago");
    expect(
      within(backup).getByTestId("systemd-units-failed-dialog-reason"),
    ).toHaveTextContent("Killed by SIGKILL");
    expect(
      within(backup).getByTestId("systemd-units-failed-dialog-since"),
    ).toHaveTextContent("Failed 2 hours ago");
    expect(worker).toHaveTextContent(
      "Its journal of the last 7 days does not say why.",
    );

    // Each a step from its page.
    for (const [item, unit] of [
      [nginx, "nginx.service"],
      [backup, "backup.service"],
      [worker, "worker.service"],
    ] as Array<[HTMLElement, string]>) {
      expect(
        within(item)
          .getByTestId("systemd-units-failed-dialog-view")
          .getAttribute("href"),
      ).toBe(unitRoute(unit));
    }
  });

  test("counts every failed unit, whatever the list's search or filters show", async () => {
    await renderList();

    fireEvent.change(screen.getByPlaceholderText("Search units..."), {
      target: { value: "api" },
    });
    await flush();

    expect(screen.queryByRole("link", { name: "nginx.service" })).toBeNull();
    expect(screen.getByTestId("systemd-units-failed")).toHaveTextContent(
      "3 units failed",
    );
  });

  test("one failed unit is one", async () => {
    states = {
      ...STATES,
      "backup.service": "active",
      "worker.service": "active",
    };
    await renderList();

    expect(screen.getByTestId("systemd-units-failed")).toHaveTextContent(
      "1 unit failed",
    );
  });

  test("with no failed unit, there is no count", async () => {
    states = {
      "api.service": "active",
      "cron.service": "inactive",
      "nginx.service": "active",
    };
    await renderList();

    expect(screen.queryByTestId("systemd-units-failed")).toBeNull();
    expect(screen.queryAllByTestId("systemd-units-unit-failed")).toHaveLength(
      0,
    );
  });

  test("a read that fails says so, and Try again reads again", async () => {
    journalError = new Error("The server did not answer.");
    await renderList();

    fireEvent.click(screen.getByTestId("systemd-units-failed"));
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByTestId("systemd-units-failed-dialog-error"),
    ).toHaveTextContent("The server did not answer.");

    journalError = null;
    fireEvent.click(within(dialog).getByRole("button", { name: /Refresh/i }));
    await flush();

    expect(
      within(dialog).getAllByTestId("systemd-units-failed-dialog-item"),
    ).toHaveLength(3);
  });
});

/*
 * In the reader's language, from the Dashboard's own locale files: the
 * count, the dialog's title and each row's why.
 */
describe.each([
  ["fa", persianLocale as unknown as Locale],
  ["ar", arabicLocale as unknown as Locale],
])("in %s", (language: string, locale: Locale) => {
  let instance: i18n;

  beforeAll(() => {
    instance = createInstance();
    instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });
  });

  const translator: Translator = createTranslator(
    (key: string): string | undefined => {
      return locale[key];
    },
    language,
  );

  test("the count, the dialog and each row's why read in the reader's words", async () => {
    await renderList(instance);

    const pill: HTMLElement = screen.getByTestId("systemd-units-failed");
    expect(text(pill)).toBe(
      plain(
        translator.translatePlural(
          { one: "{{count}} unit failed", other: "{{count}} units failed" },
          3,
        ),
      ),
    );
    expect(text(pill)).not.toContain("failed");

    fireEvent.click(pill);
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(text(screen.getByTestId("modal-title"))).toBe(
      plain(
        translator.translatePlural(
          {
            one: "{{count}} failed systemd unit",
            other: "{{count}} failed systemd units",
          },
          3,
        ),
      ),
    );

    const [nginx, , worker] = within(dialog).getAllByTestId(
      "systemd-units-failed-dialog-item",
    ) as [HTMLElement, HTMLElement, HTMLElement];

    expect(
      text(within(nginx).getByTestId("systemd-units-failed-dialog-reason")),
    ).toBe(
      // Its code in the reader's digits: "۱" in Persian, "1" in Arabic.
      plain(
        translator.translateTemplate("Exited with code {{code}}", {
          code: translator.formatNumber(1),
        }),
      ),
    );
    expect(text(worker)).toContain(
      plain(
        translator.translateTemplate(SYSTEMD_UNIT_NO_REASON_IN_JOURNAL, {
          days: translator.formatNumber(7),
        }),
      ),
    );
    // The unit's name reads as systemd writes it.
    expect(
      text(within(nginx).getByTestId("systemd-units-failed-dialog-name")),
    ).toBe("nginx.service");
  });
});
