/**
 * @timezone UTC
 */
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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A HOST'S NEEDS ATTENTION SAYS WHY EACH FAILED SYSTEMD UNIT FAILED
 * (#10129).
 *
 * A host's Overview listed each failed unit in its Needs attention card,
 * and behind its hero's Degraded, as "Failed", a step from the unit's
 * page: the reader opened the unit to learn why. Rendered for real, over
 * the host's record and what systemd wrote of its units, as the host
 * collector's default config files it:
 *
 *   - each failed unit's row says why, as systemd said it ("Exited with
 *     code 1", "Killed by SIGKILL"), since when, and systemd's own words;
 *     Degraded's dialog lists systemd's result and exit status too, as the
 *     Systemd Units list's dialog does;
 *   - from one bounded read of those units' result and exit lines, when
 *     the page opens and on Refresh - not on a tick of the auto-refresh;
 *   - a unit whose journal says nothing of why, and every unit when the
 *     journal cannot be read, keeps its row as it was.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

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
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
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
      getLastParamAsString: (): string => {
        return "";
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

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

// Covered by its own suite; it fetches counts of its own.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
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
import { advance } from "./SlowLoadHarness";
import { flush } from "./TimeRangeZoomPageHarness";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Row = Record<string, unknown>;

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

// The host's record: reporting, its readings fresh, three units failed.
const FAILED_UNITS: Array<string> = [
  "worker.service",
  "nginx.service",
  "backup.service",
];

function systemdLine(
  unit: string,
  time: string,
  body: string,
  attributes: Row,
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

const NGINX_EXIT: string =
  "nginx.service: Main process exited, code=exited, status=1/FAILURE";

/*
 * What systemd wrote of why the units failed, newest first: nginx exited 1
 * at 10:00:03, backup was killed by SIGKILL at 09:00; of worker, nothing.
 */
const SYSTEMD_LINES: Array<Row> = [
  systemdLine(
    "nginx.service",
    "10:00:03",
    "nginx.service: Failed with result 'exit-code'.",
    { [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "exit-code" },
  ),
  systemdLine("nginx.service", "10:00:03", NGINX_EXIT, {
    [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: "exited",
    [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: "1",
  }),
  systemdLine(
    "backup.service",
    "09:00:01",
    "backup.service: Failed with result 'signal'.",
    { [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "signal" },
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
];

let journalError: Error | null = null;
let failedUnits: Array<string> = FAILED_UNITS;

// The host's logs, answering a read as the server does.
function logsFor(request: ListRequest): Array<Row> {
  const attributes: Record<string, unknown> = request.query.attributes;
  const unit: unknown = attributes[JOURNALD_SYSTEMD_UNIT_ATTRIBUTE];
  const units: Array<string> =
    unit instanceof Includes ? (unit.values as Array<string>) : [];

  return SYSTEMD_LINES.filter((line: Row): boolean => {
    const lineAttributes: Row = line["attributes"] as Row;

    return (
      units.includes(
        lineAttributes[JOURNALD_SYSTEMD_UNIT_ATTRIBUTE] as string,
      ) &&
      Object.entries(attributes).every(
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
      )
    );
  });
}

function serve(): void {
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      _id: HOST_ID,
      name: "web-01",
      hostIdentifier: "web-01",
      otelCollectorStatus: "connected",
      lastSeenAt: NOW,
      readingsUpdatedAt: NOW,
      cpuCores: 4,
      totalMemoryBytes: 16 * GIB,
      processCount: 212,
      osType: "linux",
      failedSystemdUnitCount: failedUnits.length,
      failedSystemdUnits: failedUnits,
    });
  });
  aggregateMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({ data: [] });
  });
  getListMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: ListRequest = request as ListRequest;

    if (call.modelType?.name === "Log") {
      return journalError
        ? Promise.reject(journalError)
        : Promise.resolve({ data: logsFor(call) });
    }

    return Promise.resolve({ data: [] });
  });
}

function journalReads(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((args: Array<unknown>): ListRequest => {
      return args[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType?.name === "Log";
    });
}

function persian(): i18n {
  const instance: i18n = createInstance();
  void instance.init({
    lng: "fa",
    fallbackLng: "en",
    resources: { fa: { translation: persianLocale } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });
  return instance;
}

async function renderOverview(provider?: i18n): Promise<void> {
  serve();
  render(
    provider ? (
      <I18nextProvider i18n={provider}>
        <HostOverview {...PAGE_PROPS} />
      </I18nextProvider>
    ) : (
      <HostOverview {...PAGE_PROPS} />
    ),
  );
  await flush();
}

// A text as a reader reads it: no isolate marks, one space between words.
function plain(value: string): string {
  return withoutIsolateMarks(value).replace(/\s+/g, " ").trim();
}

// The Needs attention card's row of a unit.
function cardRow(unit: string): HTMLElement {
  const card: HTMLElement = screen.getByTestId("host-needs-attention");
  const row: HTMLElement | undefined = within(card)
    .getAllByTestId("host-needs-attention-item")
    .find((item: HTMLElement): boolean => {
      return item.getAttribute("data-key") === `systemd-unit:${unit}`;
    });

  expect(row).toBeDefined();

  return row as HTMLElement;
}

function reasonsOf(row: HTMLElement, testId: string): Array<string> {
  return within(row)
    .getAllByTestId(`${testId}-reason`)
    .map((reason: HTMLElement): string => {
      return plain(reason.textContent || "");
    });
}

// The hero's Degraded, pressed: its dialog's row of a unit.
function openDegraded(): HTMLElement {
  fireEvent.click(screen.getByTestId("host-hero-health"));

  return screen.getByTestId("host-hero-health-dialog");
}

function dialogRow(dialog: HTMLElement, unit: string): HTMLElement {
  const row: HTMLElement | undefined = within(dialog)
    .getAllByTestId("host-hero-health-dialog-item")
    .find((item: HTMLElement): boolean => {
      return within(item)
        .getByTestId("host-hero-health-dialog-name")
        .textContent?.includes(unit) as boolean;
    });

  expect(row).toBeDefined();

  return row as HTMLElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  journalError = null;
  failedUnits = FAILED_UNITS;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a host's Needs attention says why each failed unit failed", () => {
  test("each failed unit's row says why, as systemd said it, since when and in systemd's own words", async () => {
    await renderOverview();

    const nginx: HTMLElement = cardRow("nginx.service");
    expect(reasonsOf(nginx, "host-needs-attention")).toEqual([
      "Exited with code 1",
    ]);
    expect(
      within(nginx).getByTestId("host-needs-attention-since"),
    ).toHaveTextContent("Failed 1 hour ago");
    expect(
      within(nginx).getByTestId("host-needs-attention-message"),
    ).toHaveTextContent(NGINX_EXIT);
    // Still a step from the unit's page, and as urgent as the host says.
    expect(nginx).toHaveAttribute("data-severity", "warning");
    expect(nginx.querySelector("a")?.getAttribute("href")).toContain(
      `/host/${HOST_ID}/systemd/nginx.service`,
    );

    expect(
      reasonsOf(cardRow("backup.service"), "host-needs-attention"),
    ).toEqual(["Killed by SIGKILL"]);
  });

  test("the card leaves systemd's result and exit status to the dialog, as it does every part's facts", async () => {
    await renderOverview();

    expect(
      within(cardRow("nginx.service")).queryByTestId(
        "host-needs-attention-facts",
      ),
    ).toBeNull();
  });

  test("a unit whose journal says nothing of why keeps its row as it was", async () => {
    await renderOverview();

    const worker: HTMLElement = cardRow("worker.service");
    expect(reasonsOf(worker, "host-needs-attention")).toEqual(["Failed"]);
    expect(
      within(worker).queryByTestId("host-needs-attention-since"),
    ).toBeNull();
    expect(
      within(worker).queryByTestId("host-needs-attention-message"),
    ).toBeNull();
  });

  test("Degraded's dialog says why each failed, with systemd's result and exit status, as the Systemd Units list's does", async () => {
    await renderOverview();

    const dialog: HTMLElement = openDegraded();
    const nginx: HTMLElement = dialogRow(dialog, "nginx.service");

    expect(reasonsOf(nginx, "host-hero-health-dialog")).toEqual([
      "Exited with code 1",
    ]);
    expect(
      within(nginx).getByTestId("host-hero-health-dialog-since"),
    ).toHaveTextContent("Failed 1 hour ago");
    expect(
      within(nginx)
        .getAllByTestId("host-hero-health-dialog-fact")
        .map((fact: HTMLElement): string => {
          return plain(fact.textContent || "");
        }),
    ).toEqual([
      expect.stringMatching(/^Result:? ?exit-code$/),
      expect.stringMatching(/^Exit status:? ?1\/FAILURE$/),
    ]);

    const backup: HTMLElement = dialogRow(dialog, "backup.service");
    expect(reasonsOf(backup, "host-hero-health-dialog")).toEqual([
      "Killed by SIGKILL",
    ]);

    // One that does not say why reads as the card's.
    expect(
      reasonsOf(dialogRow(dialog, "worker.service"), "host-hero-health-dialog"),
    ).toEqual(["Failed"]);
  });
});

describe("one bounded read of why, when it is needed", () => {
  test("one read of the failed units' result and exit lines, of the last 7 days, when the page opens", async () => {
    await renderOverview();

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
      expect(read.query.time.endValue).toEqual(NOW);
      expect(NOW.getTime() - read.query.time.startValue.getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
    }

    expect(
      reads.map((read: ListRequest): boolean => {
        return (
          read.query.attributes[JOURNALD_SYSTEMD_RESULT_ATTRIBUTE] instanceof
          NotNull
        );
      }),
    ).toEqual([true, false]);
  });

  test("not read again on a tick of the auto-refresh, nor on opening Degraded, but on Refresh", async () => {
    await renderOverview();
    expect(journalReads()).toHaveLength(2);

    await advance(30_000);
    expect(getItemMock.mock.calls.length).toBeGreaterThan(1);
    expect(journalReads()).toHaveLength(2);

    openDegraded();
    await flush();
    expect(journalReads()).toHaveLength(2);
    // The dialog's own Close, at its foot.
    const closes: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Close",
    });
    fireEvent.click(closes[closes.length - 1]!);
    await flush();
    expect(screen.queryByTestId("host-hero-health-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await flush();
    expect(journalReads()).toHaveLength(4);
  });

  test("a host with no failed unit reads nothing of the journal", async () => {
    failedUnits = [];
    await renderOverview();

    expect(journalReads()).toHaveLength(0);
    expect(screen.queryByTestId("host-needs-attention")).toBeNull();
  });
});

describe("when the journal cannot be read", () => {
  test("every failed unit keeps its row as it was, in the card and in Degraded's dialog", async () => {
    journalError = new Error("The log store did not answer.");
    await renderOverview();

    for (const unit of FAILED_UNITS) {
      expect(reasonsOf(cardRow(unit), "host-needs-attention")).toEqual([
        "Failed",
      ]);
    }

    const dialog: HTMLElement = openDegraded();

    for (const unit of FAILED_UNITS) {
      expect(
        reasonsOf(dialogRow(dialog, unit), "host-hero-health-dialog"),
      ).toEqual(["Failed"]);
    }

    // No error where nothing broke: what is wrong is still listed.
    expect(screen.queryByText("The log store did not answer.")).toBeNull();
  });
});

describe("in Persian", () => {
  test("each unit's reason and since when read in Persian, its name as written", async () => {
    await renderOverview(persian());

    const words: Translator = createTranslator(
      (key: string): string | undefined => {
        return (persianLocale as Record<string, string>)[key];
      },
      "fa",
    );
    const nginx: HTMLElement = cardRow("nginx.service");
    const [reason] = reasonsOf(nginx, "host-needs-attention") as [string];

    // Its code in Persian digits, "۱".
    expect(reason).toBe(
      plain(
        words.translateTemplate("Exited with code {{code}}", {
          code: words.formatNumber(1),
        }),
      ),
    );
    expect(reason).toContain("۱");
    expect(
      plain(
        within(nginx).getByTestId("host-needs-attention-since").textContent ||
          "",
      ),
    ).not.toContain("Failed");
    expect(
      within(nginx).getByTestId("host-needs-attention-name"),
    ).toHaveTextContent("nginx.service");
  });
});
