import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import i18next, { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A COUNT PAIR ON A LIST, A RETRY OR A DRAWER, IN THE READER'S DIGITS
 * (issue #7107).
 *
 * "2/3 ready" on the Docker Swarm Clusters list, "4/5 online" on the IoT
 * Fleets list, a probe's "Attempt 1/3", a device ping's "40% (3/5
 * received)" and an ESXi host's "12 (8 running, 4 off)" were filled with
 * the raw numbers, so a Persian page read "2/3 آماده" beside the Persian
 * digits of every other count on it. Each number is written the way the
 * reader's language writes it now: Persian digits in Persian, Latin ones
 * in Arabic (LATIN_DIGIT_LANGUAGES) and English, which reads as before.
 *
 * Each page is drawn with the Dashboard's own locale files, so a pair is
 * checked in the words a reader sees.
 */

const modelTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        // A project with a cluster and a fleet: the list, not the guide.
        return Promise.resolve(1);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
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

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { rowActions: [], bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
      };
    },
  };
});

import DockerSwarmClusters from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Clusters";
import IoTFleets from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Fleets";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ProbeAttemptsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeAttemptsView";
import VMwareHostDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/Host/VMwareHostDetailsCard";
import { VMwareHostVirtualMachineSummary } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostData";
import {
  PingResultSummary,
  describePingResult,
  formatMilliseconds,
  formatPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import { NetworkDeviceDiagnosticPingResult } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LANGUAGES: Array<string> = ["en", "fa", "ar", "de"];

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

// Arabic-Indic digits, which Arabic does not write in OneUptime.
const ARABIC_INDIC_DIGIT: RegExp = /[\u0660-\u0669]/;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }

  // The plain helpers (a ping's rows) read the global instance.
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  modelTableMock.mockReset();
  setDateDisplayLanguage("en");
  await i18next.changeLanguage("en");
});

afterAll(() => {
  setDateDisplayLanguage("en");
});

const inLanguage: (
  language: string,
  element: React.ReactElement,
) => React.ReactElement = (
  language: string,
  element: React.ReactElement,
): React.ReactElement => {
  return (
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>
  );
};

type CapturedColumn = {
  title: string;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The list's column `title`, as the page built it in `language`.
async function listColumn(
  language: string,
  page: React.ReactElement,
  title: string,
): Promise<CapturedColumn> {
  modelTableMock.mockReset();
  render(inLanguage(language, page));
  await flush();

  expect(modelTableMock).toHaveBeenCalled();

  const columns: Array<CapturedColumn> = (
    modelTableMock.mock.calls[modelTableMock.mock.calls.length - 1]![0] as {
      columns: Array<CapturedColumn>;
    }
  ).columns;

  cleanup();

  const found: CapturedColumn | undefined = columns.find(
    (c: CapturedColumn): boolean => {
      return c.title === title;
    },
  );

  expect(found?.getElement).toBeDefined();

  return found!;
}

// What a cell says, without the isolates that set its numbers apart.
function cellText(
  language: string,
  column: CapturedColumn,
  item: Record<string, unknown>,
): string {
  const result: RenderResult = render(
    inLanguage(language, column.getElement!(item)),
  );
  const text: string = withoutIsolateMarks(result.container.textContent || "");

  result.unmount();

  return text.trim();
}

// A text in `language`'s digits: Persian ones in Persian, Latin ones elsewhere.
function expectReadersDigits(language: string, text: string): void {
  if (language === "fa") {
    expect({ text, latin: LATIN_DIGIT.test(text) }).toEqual({
      text,
      latin: false,
    });
    expect(text).toMatch(PERSIAN_DIGIT);
    return;
  }

  expect({
    text,
    persian: PERSIAN_DIGIT.test(text),
    arabicIndic: ARABIC_INDIC_DIGIT.test(text),
  }).toEqual({ text, persian: false, arabicIndic: false });
  expect(text).toMatch(LATIN_DIGIT);
}

describe("the Docker Swarm Clusters list's counts", () => {
  test("in Persian: ready nodes, services and running tasks in Persian digits", async () => {
    expect(
      cellText(
        "fa",
        await listColumn(
          "fa",
          <DockerSwarmClusters {...PAGE_PROPS} />,
          "Nodes",
        ),
        { nodeCount: 3, readyNodeCount: 2 },
      ),
    ).toBe("۲/۳ آماده");
    expect(
      cellText(
        "fa",
        await listColumn(
          "fa",
          <DockerSwarmClusters {...PAGE_PROPS} />,
          "Services",
        ),
        { serviceCount: 12 },
      ),
    ).toBe("۱۲");
    expect(
      cellText(
        "fa",
        await listColumn(
          "fa",
          <DockerSwarmClusters {...PAGE_PROPS} />,
          "Tasks",
        ),
        { taskCount: 12, runningTaskCount: 10 },
      ),
    ).toBe("۱۰/۱۲ در حال اجرا");
  });

  test.each(LANGUAGES)(
    "in %s every count is in the reader's digits",
    async (language: string) => {
      const cells: Array<[string, Record<string, unknown>]> = [
        ["Nodes", { nodeCount: 3, readyNodeCount: 2 }],
        ["Services", { serviceCount: 7 }],
        ["Tasks", { taskCount: 12, runningTaskCount: 10 }],
      ];

      for (const [title, item] of cells) {
        expectReadersDigits(
          language,
          cellText(
            language,
            await listColumn(
              language,
              <DockerSwarmClusters {...PAGE_PROPS} />,
              title,
            ),
            item,
          ),
        );
      }
    },
  );

  test("English reads as it always has", async () => {
    expect(
      cellText(
        "en",
        await listColumn(
          "en",
          <DockerSwarmClusters {...PAGE_PROPS} />,
          "Nodes",
        ),
        { nodeCount: 3, readyNodeCount: 2 },
      ),
    ).toBe("2/3 ready");
    expect(
      cellText(
        "en",
        await listColumn(
          "en",
          <DockerSwarmClusters {...PAGE_PROPS} />,
          "Tasks",
        ),
        { taskCount: 12, runningTaskCount: 10 },
      ),
    ).toBe("10/12 running");
    expect(
      cellText(
        "ar",
        await listColumn(
          "ar",
          <DockerSwarmClusters {...PAGE_PROPS} />,
          "Nodes",
        ),
        { nodeCount: 3, readyNodeCount: 2 },
      ),
    ).toBe("2/3 جاهزة");
  });
});

describe("the IoT Fleets list's devices online", () => {
  test("in Persian, Arabic and English", async () => {
    const item: Record<string, unknown> = {
      deviceCount: 5,
      onlineDeviceCount: 4,
    };

    expect(
      cellText(
        "fa",
        await listColumn("fa", <IoTFleets {...PAGE_PROPS} />, "Devices"),
        item,
      ),
    ).toBe("۴/۵ آنلاین");
    expect(
      cellText(
        "ar",
        await listColumn("ar", <IoTFleets {...PAGE_PROPS} />, "Devices"),
        item,
      ),
    ).toBe("4/5 متصلة");
    expect(
      cellText(
        "en",
        await listColumn("en", <IoTFleets {...PAGE_PROPS} />, "Devices"),
        item,
      ),
    ).toBe("4/5 online");
  });

  test("a fleet of thousands is grouped the way the reader's language groups it", async () => {
    const item: Record<string, unknown> = {
      deviceCount: 12000,
      onlineDeviceCount: 11999,
    };

    expect(
      cellText(
        "fa",
        await listColumn("fa", <IoTFleets {...PAGE_PROPS} />, "Devices"),
        item,
      ),
    ).toBe("۱۱٬۹۹۹/۱۲٬۰۰۰ آنلاین");
    expect(
      cellText(
        "de",
        await listColumn("de", <IoTFleets {...PAGE_PROPS} />, "Devices"),
        item,
      ),
    ).toBe("11.999/12.000 online");
  });
});

describe("a probe's retry attempts", () => {
  const attempts: Array<ProbeAttempt> = [1, 2, 3].map(
    (attemptNumber: number): ProbeAttempt => {
      return {
        attemptNumber: attemptNumber,
        attemptedAt: new Date(Date.UTC(2026, 10, 2, 12, 0, attemptNumber)),
        responseReceivedAt: new Date(
          Date.UTC(2026, 10, 2, 12, 0, attemptNumber + 1),
        ),
        responseTimeInMs: 1234.4,
        isOnline: attemptNumber === 3,
      };
    },
  );

  const labels: (language: string) => Array<string> = (
    language: string,
  ): Array<string> => {
    const result: RenderResult = render(
      inLanguage(language, <ProbeAttemptsView attempts={attempts} />),
    );

    return Array.from(result.container.querySelectorAll("li")).map(
      (item: Element): string => {
        return withoutIsolateMarks(item.textContent || "");
      },
    );
  };

  test("in Persian: each attempt's number, the total and its time", () => {
    const items: Array<string> = labels("fa");

    expect(items).toHaveLength(3);
    expect(items[0]).toContain("تلاش ۱/۳");
    expect(items[2]).toContain("تلاش ۳/۳");
    expect(items[0]).toContain("۱٬۲۳۴ میلی‌ثانیه");
    expect(items.join(" ")).not.toContain("1/3");
    expect(items.join(" ")).not.toContain("1234");
  });

  test("in English and Arabic, Latin digits as before", () => {
    const english: Array<string> = labels("en");

    expect(english[0]).toContain("Attempt 1/3");
    expect(english[0]).toContain("1,234 ms");

    cleanup();

    const arabic: Array<string> = labels("ar");

    expect(arabic[1]).toContain("المحاولة 2/3");
    expect(arabic.join(" ")).not.toMatch(ARABIC_INDIC_DIGIT);
  });
});

describe("an ESXi host's virtual machines", () => {
  const virtualMachines: VMwareHostVirtualMachineSummary = {
    total: 12,
    running: 8,
    poweredOff: 3,
    unknown: 1,
    templates: 2,
  };

  const drawn: (
    language: string,
    statesKnown?: boolean | undefined,
  ) => string = (
    language: string,
    statesKnown?: boolean | undefined,
  ): string => {
    const result: RenderResult = render(
      inLanguage(
        language,
        <VMwareHostDetailsCard
          identity={{
            vcenterName: "vc-prod",
            datacenterName: "dc-1",
            hostName: "esxi-01.example.com",
          }}
          externalId="host/dc-1/esxi-01.example.com"
          row={null}
          virtualMachines={virtualMachines}
          virtualMachineStatesKnown={statesKnown}
        />,
      ),
    );

    return withoutIsolateMarks(result.container.textContent || "");
  };

  test("in Persian: how many, how many run, how many are off, and the templates", () => {
    const text: string = drawn("fa");

    expect(text).toContain("۱۲ (۸ در حال اجرا، ۴ خاموش)");
    expect(text).toContain("الگوهای VM۲");
    expect(text).not.toContain("الگوهای VM2");
    expect(text).not.toContain("12 (");
  });

  test("a host vCenter cannot reach says how many, in Persian digits", () => {
    const text: string = drawn("fa", false);

    expect(text).toContain("۱۲");
    expect(text).not.toContain("در حال اجرا،");
  });

  test("in English, as before", () => {
    expect(drawn("en")).toContain("12 (8 running, 4 off)");
  });
});

describe("a device ping's packet loss", () => {
  const result: NetworkDeviceDiagnosticPingResult = {
    isOnline: true,
    failureCause: "",
    pingResponse: {
      packetsSent: 5,
      packetsReceived: 3,
      packetLossPercent: 40,
      minRoundTripTimeInMs: 10.24,
      maxRoundTripTimeInMs: 20.06,
      avgRoundTripTimeInMs: 12.44,
      jitterInMs: 1.2,
    },
  } as NetworkDeviceDiagnosticPingResult;

  const rowValue: (summary: PingResultSummary, label: string) => string = (
    summary: PingResultSummary,
    label: string,
  ): string => {
    return withoutIsolateMarks(
      summary.rows.find((row: { label: string }): boolean => {
        return row.label === label;
      })?.value || "",
    );
  };

  test("in Persian: the share, what came back and what was sent", async () => {
    await i18next.changeLanguage("fa");
    setDateDisplayLanguage("fa");

    const summary: PingResultSummary = describePingResult(result);

    expect(rowValue(summary, "Packet loss")).toBe("۴۰٪ (۳/۵ دریافت‌شده)");
    expect(rowValue(summary, "Average RTT")).toBe("۱۲٫۴ ms");
    expect(rowValue(summary, "Min / Max RTT")).toBe("۱۰٫۲ ms / ۲۰٫۱ ms");

    for (const row of summary.rows) {
      expect({ row: row.label, latin: LATIN_DIGIT.test(row.value) }).toEqual({
        row: row.label,
        latin: false,
      });
    }
  });

  test("in Arabic, Latin digits with Arabic's words", async () => {
    await i18next.changeLanguage("ar");
    setDateDisplayLanguage("ar");

    const loss: string = rowValue(describePingResult(result), "Packet loss");

    expect(loss).toContain("استُلم 3/5");
    expect(loss).toContain("40");
    expect(loss).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  test("an English sentence on a Persian page keeps English digits: the numbers follow the sentence", () => {
    // The page's dates are Persian, but the sentence itself is English.
    setDateDisplayLanguage("fa");

    expect(rowValue(describePingResult(result), "Packet loss")).toBe(
      "40% (3/5 received)",
    );
  });

  test("in English, exactly as before", () => {
    const summary: PingResultSummary = describePingResult(result);

    expect(rowValue(summary, "Packet loss")).toBe("40% (3/5 received)");
    expect(rowValue(summary, "Average RTT")).toBe("12.4 ms");
    expect(formatPercent(33.333)).toBe("33.3%");
    expect(formatMilliseconds(0)).toBe("0.0 ms");
  });

  test("German writes its decimal comma and its own percent", () => {
    setDateDisplayLanguage("de");

    expect(formatPercent(33.333)).toBe("33,3\u{00A0}%");
    expect(formatPercent(40)).toBe("40\u{00A0}%");
    expect(formatMilliseconds(12.44)).toBe("12,4 ms");
  });
});
