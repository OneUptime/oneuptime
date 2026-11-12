import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Import from ..." under an empty Monitors, On-Call or Status Pages list
 * (#6809, ToolImportOffer): which tools each list names, in the reader's
 * language, where the link goes, and who is offered it - the same people
 * the list's Create button is for.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import {
  canRunToolImportFor,
  getToolImportEmptyStateAction,
  getToolImportOfferRoute,
  getToolImportOfferTitle,
  MONITORS_IMPORT_OFFER,
  ON_CALL_POLICIES_IMPORT_OFFER,
  ON_CALL_SCHEDULES_IMPORT_OFFER,
  STATUS_PAGES_IMPORT_OFFER,
  TOOL_IMPORT_OFFER_NAMED_TOOLS,
  TOOL_IMPORT_OFFER_TEST_ID,
  ToolImportListOffer,
  withToolImportOffer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportOffer";
import {
  getToolImportQueryString,
  IMPORTER_KIND_QUERY_PARAM,
  IMPORTER_OPENED_FROM_QUERY_PARAM,
  IMPORTER_TOOL_QUERY_PARAM,
  readToolImportKindParam,
  readToolImportToolParam,
  ToolImportEntryPoint,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportLinks";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";
import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import { createTranslator, Translator } from "../../../Types/Translator";
import { buildModelTableEmptyState } from "../../../UI/Components/ModelTable/ModelTableEmptyState";
import type EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
} from "../../../UI/Components/Table/TableEmptyState";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

const LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function translatorFor(code: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, code);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

const ALL_OFFERS: Array<[string, ToolImportListOffer]> = [
  ["Monitors", MONITORS_IMPORT_OFFER],
  ["On-Call Policies", ON_CALL_POLICIES_IMPORT_OFFER],
  ["On-Call Schedules", ON_CALL_SCHEDULES_IMPORT_OFFER],
  ["Status Pages", STATUS_PAGES_IMPORT_OFFER],
];

let navigated: Array<string> = [];

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [Permission.ProjectAdmin];
  navigated = [];
  PermissionGate.clearPermissionPropsCache();
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigated.push(String(route));
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which tools each list names", () => {
  test("Monitors names the three most used uptime tools, and others: not Atlassian Statuspage, which checks nothing", () => {
    expect(
      getToolImportOfferTitle({
        kind: ToolImportResourceKind.Monitor,
        translator: ENGLISH,
      }),
    ).toBe("Import from UptimeRobot, Better Stack, Pingdom and others");
  });

  test("On-Call Policies and Schedules name the three on-call tools teams leave most, and others", () => {
    for (const kind of [
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.OnCallSchedule,
    ]) {
      expect(getToolImportOfferTitle({ kind, translator: ENGLISH })).toBe(
        "Import from Opsgenie, PagerDuty, incident.io and others",
      );
    }
  });

  test("Status Pages names all three tools that bring status pages, joined with 'or' and no 'others'", () => {
    expect(
      getToolImportOfferTitle({
        kind: ToolImportResourceKind.StatusPage,
        translator: ENGLISH,
      }),
    ).toBe("Import from UptimeRobot, Atlassian Statuspage or Better Stack");
  });

  test("a list one tool fills names it alone; incident fields come from incident.io only", () => {
    expect(
      getToolImportOfferTitle({
        kind: ToolImportResourceKind.IncidentRole,
        translator: ENGLISH,
      }),
    ).toBe("Import from incident.io");
  });

  test("never more than three names before 'and others'", () => {
    expect(TOOL_IMPORT_OFFER_NAMED_TOOLS).toBe(3);

    for (const [, offer] of ALL_OFFERS) {
      const title: string = getToolImportOfferTitle({
        kind: offer.kind,
        translator: ENGLISH,
      });
      const names: string = title
        .replace("Import from ", "")
        .replace(" and others", "");

      expect(names.split(/, | or /).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("in the reader's language", () => {
  test("German says it as the importer's own German does, the brands as they are", () => {
    const german: Translator = translatorFor("de");

    expect(
      getToolImportOfferTitle({
        kind: ToolImportResourceKind.Monitor,
        translator: german,
      }),
    ).toBe("Import aus UptimeRobot, Better Stack, Pingdom und anderen");
    expect(
      getToolImportOfferTitle({
        kind: ToolImportResourceKind.StatusPage,
        translator: german,
      }),
    ).toBe("Import aus UptimeRobot, Atlassian Statuspage oder Better Stack");
  });

  test("Japanese lists the names with its own separator", () => {
    expect(
      getToolImportOfferTitle({
        kind: ToolImportResourceKind.OnCallPolicy,
        translator: translatorFor("ja"),
      }),
    ).toBe("Opsgenie、PagerDuty、incident.io などからインポート");
  });

  test.each([
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
    "ar",
  ])(
    "%s words the link itself, and keeps every tool's name",
    (code: string) => {
      const translator: Translator = translatorFor(code);

      for (const [, offer] of ALL_OFFERS) {
        const title: string = getToolImportOfferTitle({
          kind: offer.kind,
          translator,
        });

        expect(title).not.toContain("Import from");
        expect(title).not.toContain("{{");
        expect(title).toContain(
          offer.kind === ToolImportResourceKind.Monitor
            ? "UptimeRobot"
            : offer.kind === ToolImportResourceKind.StatusPage
              ? "Atlassian Statuspage"
              : "PagerDuty",
        );
      }
    },
  );
});

describe("where the link goes", () => {
  test.each(ALL_OFFERS)(
    "%s: the importer in this project, on the tools that fill the list, saying where it came from",
    (_name: string, offer: ToolImportListOffer) => {
      const route: Route = getToolImportOfferRoute(offer);
      const [routePath, query] = route.toString().split("?");
      const params: URLSearchParams = new URLSearchParams(query);

      expect(routePath).toBe(`/dashboard/${PROJECT_ID}/settings/import`);
      expect(params.get(IMPORTER_OPENED_FROM_QUERY_PARAM)).toBe(offer.from);
      expect(params.get(IMPORTER_KIND_QUERY_PARAM)).toBe(offer.kind);
      expect(params.get(IMPORTER_TOOL_QUERY_PARAM)).toBeNull();
    },
  );

  test("each list says its own name as where the importer was opened from", () => {
    expect(
      ALL_OFFERS.map(([, offer]: [string, ToolImportListOffer]) => {
        return [offer.from, offer.kind];
      }),
    ).toEqual([
      ["monitors-empty", ToolImportResourceKind.Monitor],
      ["on-call-policies-empty", ToolImportResourceKind.OnCallPolicy],
      ["on-call-schedules-empty", ToolImportResourceKind.OnCallSchedule],
      ["status-pages-empty", ToolImportResourceKind.StatusPage],
    ]);
  });

  test("clicking the link opens that address", () => {
    const action: TableEmptyStateAction | undefined =
      getToolImportEmptyStateAction({
        offer: ON_CALL_SCHEDULES_IMPORT_OFFER,
        translator: ENGLISH,
      });

    action!.onClick();

    expect(navigated).toEqual([
      `/dashboard/${PROJECT_ID}/settings/import?from=on-call-schedules-empty&kind=OnCallSchedule`,
    ]);
  });
});

describe("the importer's query string", () => {
  test("from, then the kind or the tool, escaped", () => {
    expect(
      getToolImportQueryString({
        from: ToolImportEntryPoint.Search,
        tool: ToolImportSource.PagerDuty,
      }),
    ).toBe("?from=search&tool=PagerDuty");
    expect(
      getToolImportQueryString({
        from: ToolImportEntryPoint.StatusPagesEmpty,
        kind: ToolImportResourceKind.StatusPage,
      }),
    ).toBe("?from=status-pages-empty&kind=StatusPage");
    expect(
      getToolImportQueryString({ from: ToolImportEntryPoint.MonitorsEmpty }),
    ).toBe("?from=monitors-empty");
  });

  test("a kind or a tool the importer does not know reads as none", () => {
    expect(readToolImportKindParam("Monitor")).toBe(
      ToolImportResourceKind.Monitor,
    );
    expect(readToolImportKindParam("monitor")).toBeNull();
    expect(readToolImportKindParam("")).toBeNull();
    expect(readToolImportKindParam(null)).toBeNull();
    expect(readToolImportToolParam("UptimeKuma")).toBe(
      ToolImportSource.UptimeKuma,
    );
    expect(readToolImportToolParam("Zabbix")).toBeNull();
    expect(readToolImportToolParam(undefined)).toBeNull();
  });
});

describe("who is offered it", () => {
  test.each(ALL_OFFERS)(
    "%s: a project admin is offered a quiet link with the import icon",
    (_name: string, offer: ToolImportListOffer) => {
      const action: TableEmptyStateAction | undefined =
        getToolImportEmptyStateAction({ offer, translator: ENGLISH });

      expect(action).toBeDefined();
      expect(action!.style).toBe(TableEmptyStateActionStyle.Link);
      expect(action!.icon).toBe(IconProp.InboxArrowDown);
      expect(action!.dataTestId).toBe(TOOL_IMPORT_OFFER_TEST_ID);
      expect(action!.disabled).toBeUndefined();
    },
  );

  test.each(ALL_OFFERS)(
    "%s: a read-only member is not offered it at all, not even locked",
    (_name: string, offer: ToolImportListOffer) => {
      permissionsForTest = [Permission.Viewer];

      expect(canRunToolImportFor(offer)).toBe(false);
      expect(
        getToolImportEmptyStateAction({ offer, translator: ENGLISH }),
      ).toBeUndefined();
    },
  );

  test("before the permissions have loaded, nothing is offered", () => {
    permissionsForTest = [];

    expect(
      getToolImportEmptyStateAction({
        offer: MONITORS_IMPORT_OFFER,
        translator: ENGLISH,
      }),
    ).toBeUndefined();
  });

  test("a master admin is offered it", () => {
    permissionsForTest = [];
    isMasterAdminForTest = true;

    expect(canRunToolImportFor(MONITORS_IMPORT_OFFER)).toBe(true);
  });

  test("someone who may create monitors but not status pages is offered it on Monitors only", () => {
    permissionsForTest = [Permission.CreateProjectMonitor];

    expect(canRunToolImportFor(MONITORS_IMPORT_OFFER)).toBe(true);
    expect(canRunToolImportFor(STATUS_PAGES_IMPORT_OFFER)).toBe(false);
    expect(canRunToolImportFor(ON_CALL_POLICIES_IMPORT_OFFER)).toBe(false);
  });
});

describe("in the list's empty state", () => {
  const help: EmptyStateOptions["actions"] = [
    {
      title: "Read the guide",
      onClick: (): void => {},
      style: TableEmptyStateActionStyle.Link,
      dataTestId: "guide",
    },
  ];

  test("joins the list's own actions, after them", () => {
    const emptyState: EmptyStateOptions = withToolImportOffer({
      emptyState: { hideCreateButton: true, actions: help },
      offer: MONITORS_IMPORT_OFFER,
      translator: ENGLISH,
    });

    expect(emptyState.hideCreateButton).toBe(true);
    expect(
      (emptyState.actions || []).map((action: TableEmptyStateAction) => {
        return action.dataTestId;
      }),
    ).toEqual(["guide", TOOL_IMPORT_OFFER_TEST_ID]);
  });

  test("for someone who may not import, the empty state is left exactly as it was", () => {
    permissionsForTest = [Permission.Viewer];
    const given: EmptyStateOptions = { isFiltered: false, actions: help };

    expect(
      withToolImportOffer({
        emptyState: given,
        offer: STATUS_PAGES_IMPORT_OFFER,
        translator: ENGLISH,
      }),
    ).toBe(given);
    expect(
      withToolImportOffer({
        offer: STATUS_PAGES_IMPORT_OFFER,
        translator: ENGLISH,
      }),
    ).toEqual({});
  });

  function shownActions(data: {
    isSearchActive: boolean;
    isFilterActive: boolean;
    isFiltered?: boolean;
  }): Array<string | undefined> {
    const options: EmptyStateOptions = withToolImportOffer({
      emptyState: data.isFiltered ? { isFiltered: true } : undefined,
      offer: MONITORS_IMPORT_OFFER,
      translator: ENGLISH,
    });

    return (
      buildModelTableEmptyState({
        pluralLabel: "Monitors",
        options,
        hasCustomElement: false,
        isSearchActive: data.isSearchActive,
        isFilterActive: data.isFilterActive,
        onClearSearchAndFilters: (): void => {},
        isCreateDeniedByPermission: false,
        translate: (text: string): string => {
          return text;
        },
        translator: ENGLISH,
      }).emptyStateProps?.actions || []
    ).map((action: TableEmptyStateAction) => {
      return action.dataTestId;
    });
  }

  test("an empty list shows it", () => {
    expect(
      shownActions({ isSearchActive: false, isFilterActive: false }),
    ).toContain(TOOL_IMPORT_OFFER_TEST_ID);
  });

  test.each([
    ["a search", { isSearchActive: true, isFilterActive: false }],
    ["a filter", { isSearchActive: false, isFilterActive: true }],
    [
      "a chip",
      { isSearchActive: false, isFilterActive: false, isFiltered: true },
    ],
  ])(
    "%s that hides every row never shows it: importing is not the answer to a search that missed",
    (
      _name: string,
      data: {
        isSearchActive: boolean;
        isFilterActive: boolean;
        isFiltered?: boolean;
      },
    ) => {
      expect(shownActions(data)).not.toContain(TOOL_IMPORT_OFFER_TEST_ID);
    },
  );
});
