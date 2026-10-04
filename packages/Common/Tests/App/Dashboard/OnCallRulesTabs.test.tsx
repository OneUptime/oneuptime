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
} from "@testing-library/react";
import React, { ReactElement, useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * OnCallRulesTabs: somebody's on-call rules, one page with a tab per kind.
 *
 * Both places that show on-call rules draw this one component - your own
 * User Settings page and an admin's view of a member - so what it decides is
 * decided once: which kinds there are and in what order, which tab an address
 * opens, that only the open tab is drawn, what the address says after a tab
 * is opened, and how each tab's table is wired.
 *
 * The rules table itself is a recorder here: what it does with its props is
 * OnCallRulesTable.test.tsx's business. This file is about which props each
 * tab hands it, and when it is on screen at all.
 */

interface RecordedTableProps {
  severityModelType: unknown;
  severityForeignKeyColumn: string;
  ruleType: string;
  userId?: unknown;
  notificationMethods?: unknown;
  isEditable?: boolean | undefined;
  onBehalfOfName?: string | undefined;
  userPreferencesKeyPrefix: string;
  noItemsMessage?: string | undefined;
  cardDescription: string;
}

// The tables on screen now, by rule type.
let mountedTables: Map<string, RecordedTableProps> = new Map();
// How many times a table of each rule type was mounted.
let mountCounts: Map<string, number> = new Map();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable",
  () => {
    return {
      __esModule: true,
      default: (props: RecordedTableProps): ReactElement => {
        mountedTables.set(props.ruleType, props);

        useEffect(() => {
          mountCounts.set(
            props.ruleType,
            (mountCounts.get(props.ruleType) || 0) + 1,
          );

          return (): void => {
            mountedTables.delete(props.ruleType);
          };
        }, []);

        return (
          <div data-testid="rules-table" data-rule-type={props.ruleType} />
        );
      },
    };
  },
);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import OnCallRulesTabs, {
  ComponentProps as OnCallRulesTabsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTabs";
import { ON_CALL_RULE_KIND_DEFINITIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRuleKinds";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PATH: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/user-settings/on-call-rules";

interface TabCase {
  type: string;
  tabName: string;
  ruleType: NotificationRuleType;
  severityModelType: unknown;
  severityForeignKeyColumn: string;
  ownDescription: string;
  memberDescription: string;
}

/*
 * Spelled out, not read from the definitions: the crossed pair in the middle
 * (incident EPISODES by IncidentSeverity, alert EPISODES by AlertSeverity) is
 * the mistake a re-derivation makes, and only a literal table catches it.
 */
const TAB_CASES: Array<TabCase> = [
  {
    type: "incidents",
    tabName: "Incidents",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityModelType: IncidentSeverity,
    severityForeignKeyColumn: "incidentSeverityId",
    ownDescription:
      "How you are notified when an incident of this severity is assigned to you while you are on call.",
    memberDescription:
      "How Jane is notified when an incident of this severity is assigned to them while they are on call.",
  },
  {
    type: "incident-episodes",
    tabName: "Incident Episodes",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityModelType: IncidentSeverity,
    severityForeignKeyColumn: "incidentSeverityId",
    ownDescription:
      "How you are notified when an incident episode of this severity is assigned to you while you are on call.",
    memberDescription:
      "How Jane is notified when an incident episode of this severity is assigned to them while they are on call.",
  },
  {
    type: "alerts",
    tabName: "Alerts",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityModelType: AlertSeverity,
    severityForeignKeyColumn: "alertSeverityId",
    ownDescription:
      "How you are notified when an alert of this severity is assigned to you while you are on call.",
    memberDescription:
      "How Jane is notified when an alert of this severity is assigned to them while they are on call.",
  },
  {
    type: "alert-episodes",
    tabName: "Alert Episodes",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityModelType: AlertSeverity,
    severityForeignKeyColumn: "alertSeverityId",
    ownDescription:
      "How you are notified when an alert episode of this severity is assigned to you while you are on call.",
    memberDescription:
      "How Jane is notified when an alert episode of this severity is assigned to them while they are on call.",
  },
];

const OWN_PROPS: OnCallRulesTabsProps = {
  userPreferencesKeyPrefix: "user-notification-rules-table",
};

/*
 * The page at an address: the browser's, which the tabs read, and the
 * router's, the page's surroundings.
 */
function renderAt(
  search: string,
  props: OnCallRulesTabsProps = OWN_PROPS,
): void {
  window.history.replaceState({}, "", `${PAGE_PATH}${search}`);

  render(
    <MemoryRouter initialEntries={[`${PAGE_PATH}${search}`]}>
      <OnCallRulesTabs {...props} />
    </MemoryRouter>,
  );
}

/*
 * The page, with a button that draws it again from scratch WITHOUT a
 * navigation, as a layout that redraws its page does. Opening a tab rewrites
 * the address in place, which the router never hears about, so by then the
 * router's copy of the address is the one the page was opened at.
 */
function RedrawablePage(): ReactElement {
  const [drawing, setDrawing] = useState<number>(0);

  return (
    <>
      <button
        type="button"
        data-testid="draw-page-again"
        onClick={(): void => {
          setDrawing(drawing + 1);
        }}
      >
        Draw again
      </button>
      <OnCallRulesTabs key={drawing} {...OWN_PROPS} />
    </>
  );
}

function renderRedrawableAt(search: string): void {
  window.history.replaceState({}, "", `${PAGE_PATH}${search}`);

  render(
    <MemoryRouter initialEntries={[`${PAGE_PATH}${search}`]}>
      <RedrawablePage />
    </MemoryRouter>,
  );
}

// The rule types of the tables in the page now, read from the page itself.
function drawnRuleTypes(): Array<string> {
  return screen
    .getAllByTestId("rules-table")
    .map((table: HTMLElement): string => {
      return table.getAttribute("data-rule-type") || "";
    });
}

function mountedRuleTypes(): Array<string> {
  return Array.from(mountedTables.keys());
}

function onlyTable(): RecordedTableProps {
  const tables: Array<RecordedTableProps> = Array.from(mountedTables.values());

  expect(tables).toHaveLength(1);

  return tables[0]!;
}

function selectedTabName(): string {
  const selected: Array<HTMLElement> = screen
    .getAllByRole("tab")
    .filter((tab: HTMLElement): boolean => {
      return tab.getAttribute("aria-selected") === "true";
    });

  expect(selected).toHaveLength(1);

  return selected[0]!.textContent?.trim() || "";
}

function addressType(): string | null {
  return new URLSearchParams(window.location.search).get("type");
}

beforeEach(() => {
  mountedTables = new Map();
  mountCounts = new Map();
});

afterEach(() => {
  cleanup();
});

describe("the tabs", () => {
  test("are the four kinds, in order", () => {
    renderAt("");

    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.textContent?.trim() || "";
      }),
    ).toEqual(["Incidents", "Incident Episodes", "Alerts", "Alert Episodes"]);
  });

  test("agree with the kinds' definitions", () => {
    expect(
      ON_CALL_RULE_KIND_DEFINITIONS.map(
        (definition: { kind: string; tabName: string }): Array<string> => {
          return [definition.kind, definition.tabName];
        },
      ),
    ).toEqual(
      TAB_CASES.map((tabCase: TabCase): Array<string> => {
        return [tabCase.type, tabCase.tabName];
      }),
    );
  });

  test("a bare address opens Incidents, and draws only its table", () => {
    renderAt("");

    expect(selectedTabName()).toBe("Incidents");
    expect(mountedRuleTypes()).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    ]);
    expect(screen.getAllByTestId("rules-table")).toHaveLength(1);
  });

  test.each(["?type=nonsense", "?type=", "?type=alert", "?kind=alerts"])(
    "an address naming no tab we have (%s) opens Incidents",
    (search: string) => {
      renderAt(search);

      expect(selectedTabName()).toBe("Incidents");
    },
  );

  test("case in the address is forgiven", () => {
    renderAt("?type=ALERT-EPISODES");

    expect(selectedTabName()).toBe("Alert Episodes");
  });
});

describe("each tab draws its kind's table, wired for its kind", () => {
  for (const tabCase of TAB_CASES) {
    test(`?type=${tabCase.type} opens ${tabCase.tabName} with ${tabCase.ruleType} rules`, () => {
      renderAt(`?type=${tabCase.type}`);

      expect(selectedTabName()).toBe(tabCase.tabName);

      const table: RecordedTableProps = onlyTable();

      expect(table.ruleType).toBe(tabCase.ruleType);
      expect(table.severityModelType).toBe(tabCase.severityModelType);
      expect(table.severityForeignKeyColumn).toBe(
        tabCase.severityForeignKeyColumn,
      );
      expect(table.cardDescription).toBe(tabCase.ownDescription);
    });
  }
});

describe("opening a tab", () => {
  test("draws its table and drops the one before", () => {
    renderAt("");

    for (const tabCase of TAB_CASES.slice(1)) {
      fireEvent.click(screen.getByTestId(`tab-${tabCase.tabName}`));

      expect(selectedTabName()).toBe(tabCase.tabName);
      expect(mountedRuleTypes()).toEqual([tabCase.ruleType]);
    }
  });

  /*
   * The two incident tabs share a severity model, as do the two alert ones.
   * Without a key per kind the tab panel would hand the incidents table -
   * its loaded severities, its open dialog - to the incident episodes tab.
   */
  test("starts the next kind's table afresh, even with the same severities", () => {
    renderAt("");

    fireEvent.click(screen.getByTestId("tab-Incident Episodes"));
    fireEvent.click(screen.getByTestId("tab-Incidents"));

    expect(
      mountCounts.get(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toBe(2);
    expect(
      mountCounts.get(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toBe(1);
  });

  test("puts the tab in the address, and the first tab is the bare address", () => {
    renderAt("");

    fireEvent.click(screen.getByTestId("tab-Alerts"));
    expect(addressType()).toBe("alerts");

    fireEvent.click(screen.getByTestId("tab-Incident Episodes"));
    expect(addressType()).toBe("incident-episodes");

    fireEvent.click(screen.getByTestId("tab-Incidents"));
    expect(addressType()).toBeNull();
  });

  test("keeps the rest of the address as it was", () => {
    renderAt("?from=email");

    fireEvent.click(screen.getByTestId("tab-Alert Episodes"));

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    expect(params.get("from")).toBe("email");
    expect(params.get("type")).toBe("alert-episodes");
  });

  test("leaves an address that names the open tab as it is", () => {
    renderAt("?type=alerts");

    expect(addressType()).toBe("alerts");
  });
});

/*
 * The tab is read from where opening a tab writes it, so the address and
 * the tab drawn never disagree - not even when the page is drawn again
 * without a navigation, while the router still holds the address the page
 * was opened at.
 */
describe("drawn again, the page opens the tab the address says", () => {
  test("after a tab was opened, it opens that tab, not the one it was linked to", async () => {
    renderRedrawableAt("?type=alerts");

    fireEvent.click(screen.getByTestId("tab-Incident Episodes"));

    expect(addressType()).toBe("incident-episodes");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("draw-page-again"));
    });

    expect(selectedTabName()).toBe("Incident Episodes");
    expect(drawnRuleTypes()).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    ]);
    expect(addressType()).toBe("incident-episodes");
  });

  test("after the first tab was opened, it opens the first tab", async () => {
    renderRedrawableAt("?type=alert-episodes");

    fireEvent.click(screen.getByTestId("tab-Incidents"));

    expect(addressType()).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("draw-page-again"));
    });

    expect(selectedTabName()).toBe("Incidents");
    expect(drawnRuleTypes()).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    ]);
    expect(addressType()).toBeNull();
  });
});

describe("whose rules the tabs are about", () => {
  test("your own: the tables are about the signed-in user and speak in the first person", () => {
    renderAt("?type=alerts");

    const table: RecordedTableProps = onlyTable();

    expect(table.userId).toBeUndefined();
    expect(table.notificationMethods).toBeUndefined();
    expect(table.onBehalfOfName).toBeUndefined();
    expect(table.userPreferencesKeyPrefix).toBe(
      "user-notification-rules-table",
    );
    expect(table.cardDescription).toBe(TAB_CASES[2]!.ownDescription);
  });

  test("a member's: every table is about them, by name, with what the caller handed over", () => {
    const userId: ObjectID = new ObjectID(
      "30000000-0000-4000-8000-000000000003",
    );
    const methods: Array<unknown> = [
      {
        methodType: "SMS",
        methodId: "60000000-0000-4000-8000-000000000002",
        maskedIdentifier: "+1 ••• ••• 4821",
        isVerified: true,
      },
    ];

    renderAt("", {
      userId: userId,
      person: { displayName: "Jane Ops", firstName: "Jane" },
      notificationMethods: methods as never,
      isEditable: false,
      userPreferencesKeyPrefix: "admin-user-notification-rules",
      noItemsMessage: "Jane Ops has no rule here.",
    });

    for (const tabCase of TAB_CASES) {
      fireEvent.click(screen.getByTestId(`tab-${tabCase.tabName}`));

      const table: RecordedTableProps = onlyTable();

      expect(table.userId).toBe(userId);
      expect(table.notificationMethods).toBe(methods);
      expect(table.isEditable).toBe(false);
      expect(table.onBehalfOfName).toBe("Jane Ops");
      expect(table.userPreferencesKeyPrefix).toBe(
        "admin-user-notification-rules",
      );
      expect(table.noItemsMessage).toBe("Jane Ops has no rule here.");
      expect(table.cardDescription).toBe(tabCase.memberDescription);
    }
  });

  test("a member with no name on record: the forms do not claim to be about somebody nameless", () => {
    renderAt("", {
      userId: new ObjectID("30000000-0000-4000-8000-000000000003"),
      person: { displayName: "", firstName: "this user" },
      userPreferencesKeyPrefix: "admin-user-notification-rules",
    });

    const table: RecordedTableProps = onlyTable();

    expect(table.onBehalfOfName).toBeUndefined();
    expect(table.cardDescription).toBe(
      "How this user is notified when an incident of this severity is assigned to them while they are on call.",
    );
  });
});
