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
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * ISSUE #7032: an import's report ended on a checklist of what to check,
 * and nothing proved the switch worked. Principle one of the UX rulebook:
 * a flow ends when the thing works and has been tested.
 *
 *   - an on-call tool's Finish the switch sends a test page to a policy the
 *     import brought over (#6811's dialog), once everyone can be paged:
 *     the one policy, or - with several - the one picked from them, created
 *     first; for whoever may edit a policy, as Test this policy is;
 *   - a status page tool's step that moves the page to the team's domain
 *     shows each imported page's addresses as its Overview draws them
 *     (PublicAddresses): live on OneUptime now, with Copy link, and Add a
 *     custom domain while it has none.
 *
 * The real report, test page dialog and address list are drawn with the
 * Dashboard's locales; only the server's answers and who is signed in are
 * stood in for.
 */

let mockPermissions: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Sam Admin";
      },
      getEmail: (): string => {
        return "sam@example.com";
      },
    },
  };
});

// An installation that serves status pages on custom domains.
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "StatusPageCNameRecord", {
    get: (): string => {
      return "statuspage.oneuptime.com";
    },
  });

  return mocked;
});

const previewMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        preview: (...args: Array<unknown>) => {
          return previewMock(...args);
        },
        send: () => {
          return new Promise(() => {});
        },
        getResult: () => {
          return new Promise(() => {});
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageSeverities",
  () => {
    return {
      __esModule: true,
      loadSeverityOptions: async () => {
        return [
          {
            value: "Incident:sev-1",
            recordKind: "Incident",
            severityId: "sev-1",
            severityName: "Critical",
          },
        ];
      },
      fromSeverityOptionValue: () => {
        return null;
      },
    };
  },
);

import ToolImportReport, {
  TOOL_IMPORT_STATUS_PAGE_ADDRESSES_SHOWN,
  TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID,
  TOOL_IMPORT_TEST_PAGE_COPY,
  TOOL_IMPORT_TEST_PAGE_TEST_ID,
  TOOL_IMPORT_TEST_POLICY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportReport";
import { PUBLIC_ADDRESS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddressCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import Route from "../../../Types/API/Route";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Permission from "../../../Types/Permission";
import {
  ToolImportOutcome,
  ToolImportReport as ToolImportReportData,
  ToolImportReportItem,
  ToolImportRunView,
} from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "../../../Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import { STATUS_PAGE_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const POLICY_A: string = "5a000000-0000-4000-8000-0000000000a1";
const POLICY_B: string = "5a000000-0000-4000-8000-0000000000b2";
const POLICY_C: string = "5a000000-0000-4000-8000-0000000000c3";
const SCHEDULE: string = "5c000000-0000-4000-8000-000000000001";
const PAGE_1: string = "5e000000-0000-4000-8000-000000000001";
const PAGE_2: string = "5e000000-0000-4000-8000-000000000002";
const PAGE_3: string = "5e000000-0000-4000-8000-000000000003";
const PAGE_4: string = "5e000000-0000-4000-8000-000000000004";

const READINESS: string = "Make sure everyone can be paged";
const NUMBERS: string = "Carry on your incident numbers";
const ADDRESS_STEP: string = "Point your status page's address at OneUptime";

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function item(
  kind: ToolImportResourceKind,
  sourceId: string,
  name: string,
  outcome: ToolImportOutcome,
  recordIds: Array<string>,
): ToolImportReportItem {
  return {
    key: getToolImportItemKey(kind, sourceId),
    kind,
    sourceId,
    name,
    outcome,
    recordIds,
    notes: [],
  };
}

function policy(
  sourceId: string,
  name: string,
  outcome: ToolImportOutcome,
  recordIds: Array<string>,
): ToolImportReportItem {
  return item(
    ToolImportResourceKind.OnCallPolicy,
    sourceId,
    name,
    outcome,
    recordIds,
  );
}

function statusPage(
  sourceId: string,
  name: string,
  outcome: ToolImportOutcome,
  recordIds: Array<string>,
): ToolImportReportItem {
  return item(
    ToolImportResourceKind.StatusPage,
    sourceId,
    name,
    outcome,
    recordIds,
  );
}

function run(
  source: ToolImportSource,
  status: ToolImportRunStatus = ToolImportRunStatus.Completed,
): ToolImportRunView {
  return {
    id: "6c1f8a52-0d43-4e7b-9a55-2f0c3b9d7e10",
    source,
    status,
    createdAt: "2026-11-18T10:00:00.000Z",
    completedAt: "2026-11-18T10:05:00.000Z",
    createdByUserName: "Sam Admin",
    isMine: true,
  };
}

let domainReads: Array<unknown> = [];

function asRole(permissions: Array<Permission>): void {
  mockPermissions = permissions;
  PermissionGate.clearPermissionPropsCache();
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderReport(
  view: ToolImportRunView,
  items: Array<ToolImportReportItem>,
): Promise<void> {
  const report: ToolImportReportData = { items };

  await act(async () => {
    render(
      <MemoryRouter>
        <ToolImportReport
          run={view}
          report={report}
          onStartAnother={() => {}}
        />
      </MemoryRouter>,
    );
  });
  await settle();
}

function finish(): HTMLElement {
  return screen.getByTestId("tool-import-finish");
}

// Each step of the checklist, in order.
function steps(): Array<HTMLElement> {
  return Array.from(finish().querySelectorAll("ol > li")) as Array<HTMLElement>;
}

function titleOf(step: HTMLElement): string {
  return withoutIsolateMarks(step.querySelector("p")?.textContent || "");
}

function titles(): Array<string> {
  return steps().map(titleOf);
}

function step(title: string): HTMLElement {
  const found: HTMLElement | undefined = steps().find(
    (candidate: HTMLElement): boolean => {
      return titleOf(candidate) === title;
    },
  );

  if (!found) {
    throw new Error(`No step "${title}" in ${JSON.stringify(titles())}`);
  }

  return found;
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

async function pickPolicy(name: string): Promise<void> {
  const combobox: HTMLElement = screen.getByRole("combobox", {
    name: "On-Call Policy",
  });

  await act(async () => {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
  });

  const option: HTMLElement = await screen.findByRole("option", { name });

  await act(async () => {
    fireEvent.click(option);
  });
}

function pickerOptions(): Array<string> {
  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return textOf(option);
  });
}

async function openPicker(): Promise<void> {
  const combobox: HTMLElement = screen.getByRole("combobox", {
    name: "On-Call Policy",
  });

  await act(async () => {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
  });
}

// The test the dialog asked the server to preview: its target.
async function testedTarget(): Promise<unknown> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(TOOL_IMPORT_TEST_POLICY_TEST_ID));
  });
  await settle();

  expect(previewMock).toHaveBeenCalled();

  const request: { target: unknown } = previewMock.mock.calls[
    previewMock.mock.calls.length - 1
  ]![0] as { target: unknown };

  return request.target;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  asRole([Permission.ProjectOwner]);
  domainReads = [];
  previewMock.mockReset();
  previewMock.mockImplementation(() => {
    return new Promise(() => {});
  });
  goTo(`/dashboard/${PROJECT_ID}/settings/import`);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: unknown): Promise<ListResult<BaseModel>> => {
        domainReads.push(options);

        return {
          data: [],
          count: 0,
          skip: 0,
          limit: 10,
        } as unknown as ListResult<BaseModel>;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("an on-call tool's report ends on a test page", () => {
  const ONE_POLICY: Array<ToolImportReportItem> = [
    item(
      ToolImportResourceKind.OnCallSchedule,
      "rota",
      "Primary rota",
      ToolImportOutcome.Created,
      [SCHEDULE],
    ),
    policy("p-a", "Primary on-call", ToolImportOutcome.Created, [POLICY_A]),
  ];

  test.each([
    ToolImportSource.PagerDuty,
    ToolImportSource.OpsGenie,
    ToolImportSource.IncidentIo,
    ToolImportSource.SplunkOnCall,
    ToolImportSource.GrafanaOnCall,
  ])(
    "%s: Send a test page comes once everyone can be paged, before the incident numbers",
    async (source: ToolImportSource) => {
      await renderReport(run(source), ONE_POLICY);

      expect(titles()).toEqual([
        "Check the on-call schedules",
        READINESS,
        "Send a test page",
        NUMBERS,
        "Send your alerts to OneUptime",
        expect.stringMatching(/^Turn off paging in /),
      ]);
    },
  );

  test("one policy brought over: the step names it, and offers Test this policy and nothing else", async () => {
    await renderReport(run(ToolImportSource.PagerDuty), ONE_POLICY);

    const testStep: HTMLElement = step("Send a test page");

    expect(textOf(testStep)).toContain(
      "Page Primary on-call once to see that it reaches people, without an incident. Every message says TEST.",
    );
    expect(
      within(testStep).getByTestId(TOOL_IMPORT_TEST_POLICY_TEST_ID),
    ).toHaveTextContent("Test this policy");
    // One policy: no choice to make, so no picker.
    expect(within(testStep).queryByRole("combobox")).toBeNull();
    // An action, not a link away: the step's only control is the button.
    expect(within(testStep).queryAllByRole("link")).toHaveLength(0);
    expect(within(testStep).getAllByRole("button")).toHaveLength(1);
  });

  test("its button opens the test page dialog on that policy, by its name", async () => {
    await renderReport(run(ToolImportSource.PagerDuty), ONE_POLICY);

    expect(await testedTarget()).toEqual({
      kind: "policy",
      policyId: POLICY_A,
      policyName: "Primary on-call",
    });
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Test Primary on-call",
    );
  });

  test("several policies: a picker of the ones brought over, created first, the first picked", async () => {
    await renderReport(run(ToolImportSource.OpsGenie), [
      policy("p-z", "Zeta escalation", ToolImportOutcome.Created, [POLICY_B]),
      policy("p-d", "Default policy", ToolImportOutcome.AlreadyImported, [
        POLICY_C,
      ]),
      policy("p-a", "Alpha escalation", ToolImportOutcome.Created, [POLICY_A]),
      policy("p-f", "Failed escalation", ToolImportOutcome.Failed, []),
      policy("p-s", "Skipped escalation", ToolImportOutcome.Skipped, []),
    ]);

    const testStep: HTMLElement = step("Send a test page");

    expect(textOf(testStep)).toContain(
      "Pick a policy you brought over and page it once to see that it reaches people, without an incident. Every message says TEST.",
    );
    expect(
      within(testStep).getByTestId(TOOL_IMPORT_TEST_PAGE_TEST_ID),
    ).toContainElement(
      screen.getByRole("combobox", { name: "On-Call Policy" }),
    );

    await openPicker();

    // Created first, then what an earlier import brought; never one with no record.
    expect(pickerOptions()).toEqual([
      "Alpha escalation",
      "Zeta escalation",
      "Default policy",
    ]);
  });

  test("the picked policy is the one tested", async () => {
    await renderReport(run(ToolImportSource.OpsGenie), [
      policy("p-a", "Alpha escalation", ToolImportOutcome.Created, [POLICY_A]),
      policy("p-z", "Zeta escalation", ToolImportOutcome.Created, [POLICY_B]),
    ]);

    await pickPolicy("Zeta escalation");

    expect(await testedTarget()).toEqual({
      kind: "policy",
      policyId: POLICY_B,
      policyName: "Zeta escalation",
    });
  });

  test("without picking, the first is tested", async () => {
    await renderReport(run(ToolImportSource.OpsGenie), [
      policy("p-z", "Zeta escalation", ToolImportOutcome.Created, [POLICY_B]),
      policy("p-a", "Alpha escalation", ToolImportOutcome.Created, [POLICY_A]),
    ]);

    expect(await testedTarget()).toEqual({
      kind: "policy",
      policyId: POLICY_A,
      policyName: "Alpha escalation",
    });
  });

  test("a policy matched to the same record as another is offered once", async () => {
    await renderReport(run(ToolImportSource.IncidentIo), [
      policy("p-a", "Primary", ToolImportOutcome.Created, [POLICY_A]),
      policy("p-a2", "Primary (copy)", ToolImportOutcome.Matched, [POLICY_A]),
    ]);

    // One policy left: named, with no picker.
    expect(textOf(step("Send a test page"))).toContain("Page Primary once");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("an import that brought no policy has no test step: the checklist is as it was", async () => {
    await renderReport(run(ToolImportSource.PagerDuty), [
      item(
        ToolImportResourceKind.OnCallSchedule,
        "rota",
        "Primary rota",
        ToolImportOutcome.Created,
        [SCHEDULE],
      ),
      policy("p-f", "Failed escalation", ToolImportOutcome.Failed, []),
      policy("p-s", "Skipped escalation", ToolImportOutcome.Skipped, []),
    ]);

    expect(titles()).toEqual([
      "Check the on-call schedules",
      READINESS,
      NUMBERS,
      "Send your alerts to OneUptime",
      "Turn off paging in PagerDuty",
    ]);
    expect(screen.queryByTestId(TOOL_IMPORT_TEST_PAGE_TEST_ID)).toBeNull();
  });

  test("someone who may not edit a policy is not offered the test, as Test this policy is not", async () => {
    // Ran the import as someone who makes schedules, and edits no policy.
    asRole([
      Permission.CreateProjectOnCallDutyPolicySchedule,
      Permission.ReadProjectOnCallDutyPolicy,
    ]);

    await renderReport(run(ToolImportSource.PagerDuty), ONE_POLICY);

    expect(titles()).not.toContain("Send a test page");
    expect(screen.queryByTestId(TOOL_IMPORT_TEST_POLICY_TEST_ID)).toBeNull();
  });

  test("an import that stopped part way has no checklist, and so no test", async () => {
    await renderReport(
      run(ToolImportSource.PagerDuty, ToolImportRunStatus.Failed),
      ONE_POLICY,
    );

    expect(screen.queryByTestId("tool-import-finish")).toBeNull();
    expect(screen.queryByTestId(TOOL_IMPORT_TEST_POLICY_TEST_ID)).toBeNull();
  });

  test("an uptime tool's report offers no test page", async () => {
    await renderReport(run(ToolImportSource.UptimeRobot), [
      item(
        ToolImportResourceKind.Monitor,
        "m1",
        "Storefront",
        ToolImportOutcome.Created,
        ["5d000000-0000-4000-8000-000000000001"],
      ),
    ]);

    expect(titles()).not.toContain("Send a test page");
    expect(screen.queryByTestId(TOOL_IMPORT_TEST_PAGE_TEST_ID)).toBeNull();
  });

  test("German: the step and its sentence in German, the policy's name as written", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    await renderReport(run(ToolImportSource.PagerDuty), ONE_POLICY);

    const testStep: HTMLElement = step("Test-Alarmierung senden");

    expect(textOf(testStep)).toContain(
      "Alarmieren Sie Primary on-call einmal ohne Vorfall, um zu sehen, dass die Richtlinie Personen erreicht. Jede Nachricht sagt TEST.",
    );
    expect(
      within(testStep).getByTestId(TOOL_IMPORT_TEST_POLICY_TEST_ID),
    ).toHaveTextContent("Diese Richtlinie testen");
  });

  test("its words are worded in every Dashboard language", () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      if (!file.endsWith(".json") || file === "en.json") {
        continue;
      }

      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, string>;

      for (const key of [
        TOOL_IMPORT_TEST_PAGE_COPY.title,
        TOOL_IMPORT_TEST_PAGE_COPY.onePolicy,
        TOOL_IMPORT_TEST_PAGE_COPY.severalPolicies,
        TOOL_IMPORT_TEST_PAGE_COPY.policyPicker,
      ]) {
        const worded: string = locale[key] || "";

        expect({
          file,
          key,
          worded: worded.length > 0 && worded !== key,
          keepsPlaceholder:
            !key.includes("{{policy}}") || worded.includes("{{policy}}"),
        }).toEqual({ file, key, worded: true, keepsPlaceholder: true });
      }
    }
  });
});

describe("a status page tool's report shows where each page it brought is live", () => {
  function addressBlock(pageId: string): HTMLElement {
    return screen.getByTestId(
      `${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID}-${pageId}`,
    );
  }

  test("UptimeRobot: the page's OneUptime address, to open and copy, in the step that moves it to your domain", async () => {
    await renderReport(run(ToolImportSource.UptimeRobot), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
    ]);

    const addressStep: HTMLElement = step(ADDRESS_STEP);
    const block: HTMLElement = within(addressStep).getByTestId(
      `${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID}-${PAGE_1}`,
    );
    const link: HTMLElement = within(block).getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.link,
    );

    expect(within(block).getByText("Acme Status")).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      `${STATUS_PAGE_URL.toString()}/${PAGE_1}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(block).getByText("OneUptime address")).toBeInTheDocument();
    expect(
      within(block).getByRole("button", { name: /Copy link/ }),
    ).toBeInTheDocument();
  });

  test("Add a custom domain opens that page's Custom Domains, which is what the step asks", async () => {
    await renderReport(run(ToolImportSource.UptimeRobot), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
    ]);

    const add: HTMLElement = within(addressBlock(PAGE_1)).getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.addCustomDomain,
    );

    expect(
      within(add).getByRole("link", { name: "Add a custom domain" }),
    ).toHaveAttribute(
      "href",
      (RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", PAGE_1),
    );
  });

  test("each page's custom domains are read for it alone", async () => {
    await renderReport(run(ToolImportSource.BetterStack), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
      statusPage("sp-2", "Acme Internal", ToolImportOutcome.Created, [PAGE_2]),
    ]);

    const reads: Array<{ modelType: unknown; query: Record<string, unknown> }> =
      domainReads as Array<{
        modelType: unknown;
        query: Record<string, unknown>;
      }>;

    expect(
      reads.every((read: { modelType: unknown }): boolean => {
        return read.modelType === StatusPageDomain;
      }),
    ).toBe(true);
    expect(
      reads
        .map((read: { query: Record<string, unknown> }): string => {
          return String(read.query["statusPageId"]);
        })
        .sort(),
    ).toEqual([PAGE_1, PAGE_2].sort());
  });

  test("with the addresses shown, the step has no Open Status Pages of its own: every page is there", async () => {
    await renderReport(run(ToolImportSource.UptimeRobot), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
    ]);

    expect(
      within(step(ADDRESS_STEP)).queryByRole("link", {
        name: /Open Status Pages/,
      }),
    ).toBeNull();
  });

  test(`more than ${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_SHOWN} pages: the first ${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_SHOWN}, created first, and Status Pages for the rest`, async () => {
    await renderReport(run(ToolImportSource.BetterStack), [
      statusPage("sp-4", "Delta Status", ToolImportOutcome.AlreadyImported, [
        PAGE_4,
      ]),
      statusPage("sp-3", "Charlie Status", ToolImportOutcome.Created, [PAGE_3]),
      statusPage("sp-1", "Alpha Status", ToolImportOutcome.Created, [PAGE_1]),
      statusPage("sp-2", "Bravo Status", ToolImportOutcome.Created, [PAGE_2]),
    ]);

    const list: HTMLElement = within(step(ADDRESS_STEP)).getByTestId(
      TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID,
    );

    expect(
      Array.from(list.children).map((child: Element): string | null => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual(
      [PAGE_1, PAGE_2, PAGE_3].map((id: string): string => {
        return `${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID}-${id}`;
      }),
    );
    expect(
      within(step(ADDRESS_STEP)).getByRole("link", {
        name: /Open Status Pages/,
      }),
    ).toHaveAttribute(
      "href",
      (RouteMap[PageMap.STATUS_PAGES] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID),
    );
  });

  test("Atlassian Statuspage: the addresses in its second step, after Check your status pages keeps its link", async () => {
    await renderReport(run(ToolImportSource.AtlassianStatuspage), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
    ]);

    expect(titles()).toEqual([
      "Check your status pages",
      ADDRESS_STEP,
      "Turn off your page in Atlassian Statuspage",
    ]);
    expect(
      within(step(ADDRESS_STEP)).getByTestId(
        `${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID}-${PAGE_1}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(step("Check your status pages")).getByRole("link", {
        name: /Open Status Pages/,
      }),
    ).toBeInTheDocument();
  });

  test("a page that failed or was not brought over has no address", async () => {
    await renderReport(run(ToolImportSource.UptimeRobot), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
      statusPage("sp-2", "Broken Status", ToolImportOutcome.Failed, []),
      statusPage("sp-3", "Left Status", ToolImportOutcome.Skipped, []),
    ]);

    const list: HTMLElement = screen.getByTestId(
      TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID,
    );

    expect(list.children).toHaveLength(1);
    expect(list).not.toHaveTextContent("Broken Status");
    expect(list).not.toHaveTextContent("Left Status");
  });

  test("an import that brought no page keeps the step as it was: its words and Open Status Pages", async () => {
    await renderReport(run(ToolImportSource.UptimeRobot), [
      item(
        ToolImportResourceKind.Monitor,
        "m1",
        "Storefront",
        ToolImportOutcome.Created,
        ["5d000000-0000-4000-8000-000000000001"],
      ),
    ]);

    expect(
      screen.queryByTestId(TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID),
    ).toBeNull();
    expect(
      within(step(ADDRESS_STEP)).getByRole("link", {
        name: /Open Status Pages/,
      }),
    ).toBeInTheDocument();
    expect(domainReads).toEqual([]);
  });

  test("a tool that brings no status page has no address step at all", async () => {
    await renderReport(run(ToolImportSource.Pingdom), [
      item(
        ToolImportResourceKind.Monitor,
        "m1",
        "Storefront",
        ToolImportOutcome.Created,
        ["5d000000-0000-4000-8000-000000000001"],
      ),
    ]);

    expect(titles()).not.toContain(ADDRESS_STEP);
    expect(
      screen.queryByTestId(TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID),
    ).toBeNull();
  });

  test("Persian: the address reads left to right inside a Persian step", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    await renderReport(run(ToolImportSource.UptimeRobot), [
      statusPage("sp-1", "Acme Status", ToolImportOutcome.Created, [PAGE_1]),
    ]);

    const block: HTMLElement = addressBlock(PAGE_1);

    expect(
      within(block).getByTestId(PUBLIC_ADDRESS_TEST_IDS.text),
    ).toHaveAttribute("dir", "ltr");
    expect(textOf(block)).toContain("نشانی OneUptime");
  });
});
