import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN ARCHIVED SEVERITY ON THE ON-CALL RULES PAGE (block 28).
 *
 * Everybody's own on-call rules for a severity stay when it is archived,
 * and keep paging for the incidents and alerts that keep it - the Archive
 * dialog says so, with a link to the reader's own On-Call Rules. Nobody
 * picks an archived severity again, and the server refuses a new rule for
 * one: the page used to draw an archived severity's card like any other,
 * with an Add that came back refused. Now:
 *
 *   - live severities come first, in the project's order; archived ones
 *     after them, and only while the person has rules for them;
 *   - an archived card says it is archived - the shared Archived tag - and
 *     what its rules still do, and offers no Add; its rules can still be
 *     changed and removed;
 *   - your own page and an admin's view of a member say it about the right
 *     person.
 */

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000a1";
const CURRENT_USER_ID_STRING: string = "00000000-0000-4000-8000-0000000000b1";
const LIVE_ONE_ID: string = "00000000-0000-4000-8000-0000000000c1";
const LIVE_TWO_ID: string = "00000000-0000-4000-8000-0000000000c2";
const ARCHIVED_WITH_RULES_ID: string = "00000000-0000-4000-8000-0000000000c3";
const ARCHIVED_WITHOUT_RULES_ID: string =
  "00000000-0000-4000-8000-0000000000c4";

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return currentUserId;
      },
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

interface CapturedTableProps {
  userPreferencesKey: string;
  query: Record<string, unknown>;
  isCreateable: boolean;
  isEditable: boolean;
  cardProps: { title: ReactElement; description: string };
}

let capturedTables: Array<CapturedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTables.push(props);
      return null;
    },
  };
});

import OnCallRulesTable, {
  getSeveritiesToDraw,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable";
import OnCallRulesTabs from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTabs";
import {
  ON_CALL_RULE_KIND_DEFINITIONS,
  OnCallRuleKindDefinition,
  OnCallRuleSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRuleKinds";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import Color from "../../../Types/Color";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const currentUserId: ObjectID = new ObjectID(CURRENT_USER_ID_STRING);

interface SeveritySpec {
  id: string;
  name: string;
  isArchived?: boolean | undefined;
}

const SEVERITIES: Array<SeveritySpec> = [
  { id: LIVE_ONE_ID, name: "Sev 1" },
  // Archived between two live ones: drawn after them all.
  {
    id: ARCHIVED_WITH_RULES_ID,
    name: "[DONOTUSE] Very critical",
    isArchived: true,
  },
  { id: LIVE_TWO_ID, name: "Sev 2" },
  { id: ARCHIVED_WITHOUT_RULES_ID, name: "Retired", isArchived: true },
];

const build: (
  modelType: { new (): OnCallRuleSeverity },
  specs: Array<SeveritySpec>,
) => Array<OnCallRuleSeverity> = (
  modelType: { new (): OnCallRuleSeverity },
  specs: Array<SeveritySpec>,
): Array<OnCallRuleSeverity> => {
  return specs.map((spec: SeveritySpec): OnCallRuleSeverity => {
    const severity: OnCallRuleSeverity = new modelType();
    severity._id = spec.id;
    severity.name = spec.name;
    severity.color = new Color("#ef4444");

    if (spec.isArchived) {
      severity.isArchived = true;
    }

    return severity;
  });
};

// How many rules the person has for each archived severity.
let rulesBySeverity: Record<string, number | "fails"> = {};

beforeEach(() => {
  capturedTables = [];
  rulesBySeverity = {
    [ARCHIVED_WITH_RULES_ID]: 2,
    [ARCHIVED_WITHOUT_RULES_ID]: 0,
  };

  getListMock.mockReset();
  getListMock.mockImplementation((data: { modelType: unknown }) => {
    if (
      data.modelType === IncidentSeverity ||
      data.modelType === AlertSeverity
    ) {
      return Promise.resolve({
        data: build(
          data.modelType as { new (): OnCallRuleSeverity },
          SEVERITIES,
        ),
        count: SEVERITIES.length,
        skip: 0,
        limit: SEVERITIES.length,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  countMock.mockReset();
  countMock.mockImplementation(
    (data: { query: Record<string, unknown> }): Promise<number> => {
      const severityId: string = String(
        data.query["incidentSeverityId"] || data.query["alertSeverityId"],
      );
      const rules: number | "fails" | undefined = rulesBySeverity[severityId];

      if (rules === "fails") {
        return Promise.reject(new Error("Server Error"));
      }

      return Promise.resolve(rules || 0);
    },
  );

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const definitionOf: (tabName: string) => OnCallRuleKindDefinition = (
  tabName: string,
): OnCallRuleKindDefinition => {
  return ON_CALL_RULE_KIND_DEFINITIONS.find(
    (definition: OnCallRuleKindDefinition): boolean => {
      return definition.tabName === tabName;
    },
  )!;
};

const renderTable: (
  definition: OnCallRuleKindDefinition,
) => Promise<void> = async (
  definition: OnCallRuleKindDefinition,
): Promise<void> => {
  render(
    <MemoryRouter>
      <OnCallRulesTable
        severityModelType={definition.severityModelType}
        severityForeignKeyColumn={definition.severityForeignKeyColumn}
        ruleType={definition.ruleType}
        userPreferencesKeyPrefix="archived-severities-test"
        cardDescription="Live card."
        archivedCardDescription="Archived card."
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTables.length).toBeGreaterThan(0);
  });
};

// The tables of the last render, one per card, in the order drawn.
const lastCards: () => Array<CapturedTableProps> =
  (): Array<CapturedTableProps> => {
    const byKey: Map<string, CapturedTableProps> = new Map();

    for (const table of capturedTables) {
      byKey.set(table.userPreferencesKey, table);
    }

    return Array.from(byKey.values());
  };

const severityIdOf: (table: CapturedTableProps) => string = (
  table: CapturedTableProps,
): string => {
  return String(
    table.query["incidentSeverityId"] || table.query["alertSeverityId"],
  );
};

describe("which severities the page draws, in what order", () => {
  test("live ones in the project's order, then archived ones the person has rules for", () => {
    const severities: Array<OnCallRuleSeverity> = build(
      IncidentSeverity,
      SEVERITIES,
    );

    expect(
      getSeveritiesToDraw({
        severities: severities,
        hasRules: (severity: OnCallRuleSeverity): boolean => {
          return severity.id?.toString() === ARCHIVED_WITH_RULES_ID;
        },
      }).map((severity: OnCallRuleSeverity): string => {
        return severity.name || "";
      }),
    ).toEqual(["Sev 1", "Sev 2", "[DONOTUSE] Very critical"]);
  });

  test("with nothing archived, the project's order as it is", () => {
    const severities: Array<OnCallRuleSeverity> = build(IncidentSeverity, [
      { id: LIVE_TWO_ID, name: "Sev 2" },
      { id: LIVE_ONE_ID, name: "Sev 1" },
    ]);

    expect(
      getSeveritiesToDraw({
        severities: severities,
        hasRules: (): boolean => {
          return false;
        },
      }),
    ).toEqual(severities);
  });
});

describe.each([
  ["Incidents", "incidentSeverityId"],
  ["Incident Episodes", "incidentSeverityId"],
  ["Alerts", "alertSeverityId"],
  ["Alert Episodes", "alertSeverityId"],
])("the %s tab", (tabName: string, foreignKeyColumn: string) => {
  const definition: () => OnCallRuleKindDefinition =
    (): OnCallRuleKindDefinition => {
      return definitionOf(tabName);
    };

  test("draws an archived severity after the live ones, and only while the person has rules for it", async () => {
    await renderTable(definition());

    await waitFor(() => {
      expect(lastCards()).toHaveLength(3);
    });

    expect(lastCards().map(severityIdOf)).toEqual([
      LIVE_ONE_ID,
      LIVE_TWO_ID,
      ARCHIVED_WITH_RULES_ID,
    ]);

    // The person's own rules of this kind, for each archived severity.
    const asked: Array<Record<string, unknown>> = countMock.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      },
    );

    expect(asked).toHaveLength(2);

    for (const query of asked) {
      expect(String(query["projectId"])).toBe(PROJECT_ID_STRING);
      expect(String(query["userId"])).toBe(CURRENT_USER_ID_STRING);
      expect(query["ruleType"]).toBe(definition().ruleType);
      expect(Object.keys(query)).toContain(foreignKeyColumn);
    }

    expect(
      (countMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(UserNotificationRule);
  });

  test("an archived card is marked Archived, says what its rules still do, and offers no Add", async () => {
    await renderTable(definition());

    await waitFor(() => {
      expect(lastCards()).toHaveLength(3);
    });

    const archived: CapturedTableProps = lastCards()[2]!;

    expect(archived.isCreateable).toBe(false);
    // Its rules can still be changed and removed.
    expect(archived.isEditable).toBe(true);
    expect(archived.cardProps.description).toBe("Archived card.");

    const title: HTMLElement = render(archived.cardProps.title).container;

    expect(title).toHaveTextContent("[DONOTUSE] Very critical");
    expect(
      title.querySelector('[data-testid="archived-tag"]'),
    ).toHaveTextContent("Archived");
  });

  test("a live card is as it was: Add, its own words, no tag", async () => {
    await renderTable(definition());

    await waitFor(() => {
      expect(lastCards()).toHaveLength(3);
    });

    for (const live of lastCards().slice(0, 2)) {
      expect(live.isCreateable).toBe(true);
      expect(live.cardProps.description).toBe("Live card.");
      expect(
        render(live.cardProps.title).container.querySelector(
          '[data-testid="archived-tag"]',
        ),
      ).toBeNull();
    }
  });

  test("a count that fails draws the archived card, as a live one would be", async () => {
    rulesBySeverity[ARCHIVED_WITHOUT_RULES_ID] = "fails";

    await renderTable(definition());

    await waitFor(() => {
      expect(lastCards().map(severityIdOf)).toEqual([
        LIVE_ONE_ID,
        LIVE_TWO_ID,
        ARCHIVED_WITH_RULES_ID,
        ARCHIVED_WITHOUT_RULES_ID,
      ]);
    });
  });
});

describe("the words of an archived card, on your own page and an admin's", () => {
  test("every tab says what its archived cards are, about you or about the member", () => {
    const own: Record<string, string> = {};
    const member: Record<string, string> = {};

    for (const definition of ON_CALL_RULE_KIND_DEFINITIONS) {
      own[definition.tabName] = definition.ownArchivedCardDescription;
      member[definition.tabName] = definition.memberArchivedCardDescription;
    }

    expect(own).toEqual({
      Incidents:
        "This severity is archived. Incidents that still have it notify you by these rules: you can change or remove them, but not add new ones.",
      "Incident Episodes":
        "This severity is archived. Incident episodes that still have it notify you by these rules: you can change or remove them, but not add new ones.",
      Alerts:
        "This severity is archived. Alerts that still have it notify you by these rules: you can change or remove them, but not add new ones.",
      "Alert Episodes":
        "This severity is archived. Alert episodes that still have it notify you by these rules: you can change or remove them, but not add new ones.",
    });

    for (const [tabName, sentence] of Object.entries(member)) {
      expect({ tabName, sentence }).toEqual({
        tabName,
        sentence: own[tabName]!.replace("notify you", "notify {{name}}"),
      });
    }
  });

  test("the page hands each tab's table the archived words, filled in for the member", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/project/users/x/on-call-rules",
    );

    render(
      <MemoryRouter>
        <OnCallRulesTabs
          userPreferencesKeyPrefix="archived-severities-tabs"
          userId={new ObjectID(CURRENT_USER_ID_STRING)}
          person={{ displayName: "Maya Chen", firstName: "Maya" }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(lastCards()).toHaveLength(3);
    });

    expect(lastCards()[2]!.cardProps.description).toBe(
      "This severity is archived. Incidents that still have it notify Maya by these rules: you can change or remove them, but not add new ones.",
    );
    expect(lastCards()[0]!.cardProps.description).toBe(
      "How Maya is notified when an incident of this severity is assigned to them while they are on call.",
    );
  });

  test("your own page says it to you", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/project/user-settings/on-call-rules?type=alerts",
    );

    render(
      <MemoryRouter>
        <OnCallRulesTabs userPreferencesKeyPrefix="archived-severities-own" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(lastCards()).toHaveLength(3);
    });

    expect(lastCards()[2]!.cardProps.description).toBe(
      "This severity is archived. Alerts that still have it notify you by these rules: you can change or remove them, but not add new ones.",
    );
    expect(lastCards()[2]!.query["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    );
  });
});
