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
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AN INCIDENT OWNER RULE'S OWN PAGE, FOR A RULE TEAMS OWN.
 *
 * GovTech's oversight team and the teams that run services each keep rules
 * only they change: a rule some teams own is changed and deleted only with
 * those teams' permissions, and by project admins, and everyone else sees
 * it read-only. The rules list locked the row (RuleOwningTeams); the rule's
 * own page - the incident owner rules page routed as a rule's view - kept
 * offering Edit and Delete, and the server then refused. Now the page reads
 * the rule's owning teams (IncidentOwnerRuleOwningTeam) as it opens:
 *
 *   - a member outside the owning teams finds Edit and Delete locked, the
 *     tooltip the list gives naming the teams, and the details name them;
 *   - a member of an owning team, and a project admin, edit it as before;
 *   - a rule no team owns is as it was;
 *   - a read that fails locks nothing: the server still refuses what it must;
 *   - once the rule's Edit saves, who owns it is read again.
 *
 * The real page, table, rule page and cards; only the network and the
 * permission snapshot are stubbed.
 */

let isMasterAdminForTest: boolean = false;
let rowsForTest: Array<unknown> = [];
let ruleForTest: unknown = null;
// The rows the server keeps of who owns the rule, and whether reading them fails.
let owningTeamRowsForTest: Array<unknown> = [];
let owningTeamsReadFails: boolean = false;
// Set, a read of who owns the rule answers only once it settles.
let owningTeamsReadWaitsFor: Promise<void> | null = null;
const owningTeamReads: Array<Record<string, any>> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return (rowsForTest as Array<{ permission: unknown }>).map(
          (row: { permission: unknown }): unknown => {
            return row.permission;
          },
        );
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return { permissions: rowsForTest };
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
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
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        return ruleForTest;
      },
      getList: async (data: {
        modelType: { new (): { tableName?: string } };
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        if (new data.modelType().tableName === "IncidentOwnerRuleOwningTeam") {
          owningTeamReads.push(data as Record<string, any>);

          if (owningTeamsReadWaitsFor) {
            await owningTeamsReadWaitsFor;
          }

          if (owningTeamsReadFails) {
            throw new Error("The network is down.");
          }

          return {
            data: owningTeamRowsForTest,
            count: owningTeamRowsForTest.length,
            skip: 0,
            limit: 500,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {},
    },
  };
});

import IncidentOwnerRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOwnerRules";
import useRuleOwningTeams, {
  RuleOwningTeamsTable,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TeamOwnedRule/RuleOwningTeams";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerRuleOwningTeam from "../../../Models/DatabaseModels/IncidentOwnerRuleOwningTeam";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const RULE_ID: string = "0e1f2a3b-4c5d-4e6f-9a7b-8c9d0e1f2a3b";
const OVERSIGHT: string = "1f2a3b4c-5d6e-4f7a-8b8c-9d0e1f2a3b4c";
const PLATFORM: string = "2a3b4c5d-6e7f-4a8b-9c9d-0e1f2a3b4c5d";

const RULE_URL: string = `/dashboard/${PROJECT_ID}/incidents/settings/owner-rules/${RULE_ID}`;

const OVERSIGHT_OWNS_IT: string =
  "This rule belongs to Oversight: only its members, with its permissions, and project admins can change it.";

function row(permission: Permission, teamId?: string): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
}

// A member of `teamId`, whose team may read, edit and delete owner rules.
function editorOf(teamId: string): Array<UserPermission> {
  return [
    row(Permission.ReadIncidentOwnerRule, teamId),
    row(Permission.EditIncidentOwnerRule, teamId),
    row(Permission.DeleteIncidentOwnerRule, teamId),
    row(Permission.ReadIncidentOwnerRuleOwningTeam, teamId),
  ];
}

// A row of who owns the rule, as the server answers it.
function owningTeam(teamId: string, name: string): IncidentOwnerRuleOwningTeam {
  const team: Team = new Team();
  team._id = teamId;
  team.name = name;

  return Object.assign(new IncidentOwnerRuleOwningTeam(), {
    _id: ObjectID.generate().toString(),
    incidentOwnerRuleId: new ObjectID(RULE_ID),
    teamId: new ObjectID(teamId),
    team: team,
  });
}

function renderRulePage(): void {
  goTo(RULE_URL);

  render(
    <MemoryRouter initialEntries={[RULE_URL]}>
      <IncidentOwnerRulesPage
        pageRoute={new Route(RULE_URL)}
        currentProject={null}
        hasPaymentMethod={true}
        ruleViewModelType={IncidentOwnerRule}
      />
    </MemoryRouter>,
  );
}

async function openRulePage(): Promise<void> {
  renderRulePage();

  await waitFor(() => {
    expect(
      screen.getAllByText("Oversight's Sev 0 owners").length,
    ).toBeGreaterThan(0);
  });

  // Who owns it is read as the page opens.
  await waitFor(() => {
    expect(owningTeamReads.length).toBeGreaterThan(0);
  });
}

function findButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(label);
      },
    ) || null
  );
}

function editButton(): HTMLButtonElement | null {
  return findButton("Edit Incident Owner Rule");
}

function deleteButton(): HTMLButtonElement | null {
  return findButton("Delete Incident Owner Rule");
}

// The tooltip a hovered button adds to the page, or null.
function hover(button: HTMLButtonElement): HTMLElement | null {
  const shown: number = screen.queryAllByRole("tooltip").length;

  fireEvent.mouseEnter(button.parentElement as HTMLElement);

  const tooltips: Array<HTMLElement> = screen.queryAllByRole("tooltip");

  return tooltips.length > shown ? tooltips[tooltips.length - 1]! : null;
}

beforeEach(() => {
  isMasterAdminForTest = false;
  rowsForTest = [];
  owningTeamRowsForTest = [];
  owningTeamsReadFails = false;
  owningTeamsReadWaitsFor = null;
  owningTeamReads.length = 0;
  ruleForTest = Object.assign(new IncidentOwnerRule(), {
    _id: RULE_ID,
    name: "Oversight's Sev 0 owners",
    isEnabled: true,
  });
  PermissionGate.clearPermissionPropsCache();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("an incident owner rule's own page", () => {
  test("reads who owns the rule it shows, in its project", async () => {
    rowsForTest = editorOf(PLATFORM);
    owningTeamRowsForTest = [owningTeam(OVERSIGHT, "Oversight")];

    await openRulePage();

    const query: Record<string, any> = owningTeamReads[0]!["query"];

    expect(query["incidentOwnerRuleId"]).toBeInstanceOf(Includes);
    expect(
      ((query["incidentOwnerRuleId"] as Includes).values as Array<unknown>).map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([RULE_ID]);
    expect(String(query["projectId"])).toBe(PROJECT_ID);
  });

  test("a member outside the owning teams sees it read-only, told which team owns it", async () => {
    rowsForTest = editorOf(PLATFORM);
    owningTeamRowsForTest = [owningTeam(OVERSIGHT, "Oversight")];

    await openRulePage();

    await waitFor(() => {
      expect(editButton()).toBeDisabled();
    });

    expect(hover(editButton()!)).toHaveTextContent(
      `You do not have permission to update this Incident Owner Rule. ${OVERSIGHT_OWNS_IT}`,
    );

    expect(deleteButton()).toBeDisabled();
    expect(hover(deleteButton()!)).toHaveTextContent(
      `You do not have permission to delete this Incident Owner Rule. ${OVERSIGHT_OWNS_IT}`,
    );

    // Its details say who owns it, as the list's column does.
    expect(screen.getByTestId("rule-owning-teams")).toHaveTextContent(
      "Oversight",
    );
  });

  test("names every team that owns it", async () => {
    rowsForTest = editorOf(PLATFORM);
    owningTeamRowsForTest = [
      owningTeam(OVERSIGHT, "Oversight"),
      owningTeam("3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e", "Payments"),
    ];

    await openRulePage();

    await waitFor(() => {
      expect(editButton()).toBeDisabled();
    });

    expect(hover(editButton()!)).toHaveTextContent(
      "This rule belongs to Oversight and Payments: only their members, with their permissions, and project admins can change it.",
    );
  });

  test("a member of the owning team can still edit and delete it", async () => {
    rowsForTest = editorOf(OVERSIGHT);
    owningTeamRowsForTest = [owningTeam(OVERSIGHT, "Oversight")];

    await openRulePage();

    await waitFor(() => {
      expect(screen.getByTestId("rule-owning-teams")).toBeInTheDocument();
    });

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });

  test("so can a project admin, who is on none of the teams", async () => {
    rowsForTest = [row(Permission.ProjectAdmin, PLATFORM)];
    owningTeamRowsForTest = [owningTeam(OVERSIGHT, "Oversight")];

    await openRulePage();

    await waitFor(() => {
      expect(screen.getByTestId("rule-owning-teams")).toBeInTheDocument();
    });

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });

  test("a rule no team owns is everyone's who may change rules, and names no team", async () => {
    rowsForTest = editorOf(PLATFORM);
    owningTeamRowsForTest = [];

    await openRulePage();

    await waitFor(() => {
      expect(editButton()).not.toBeNull();
    });

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
    expect(screen.queryByTestId("rule-owning-teams")).toBeNull();
  });

  test("a read that fails locks nothing: the server still refuses what it must", async () => {
    rowsForTest = editorOf(PLATFORM);
    owningTeamsReadFails = true;

    await openRulePage();

    await waitFor(() => {
      expect(editButton()).not.toBeNull();
    });

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });
});

/*
 * The hook the page reads with (useRuleOwningTeams' viewRuleOwnership),
 * drawn on its own: what it hands the rule's page before and after the
 * read, and again once the rule's Edit saves.
 */
describe("useRuleOwningTeams on a rule's own page", () => {
  let latest: RuleOwningTeamsTable<IncidentOwnerRule> | null = null;

  const Harness: FunctionComponent<{
    viewRuleId?: ObjectID | undefined;
  }> = (props: { viewRuleId?: ObjectID | undefined }): ReactElement => {
    latest = useRuleOwningTeams<IncidentOwnerRule>({
      ruleModelType: IncidentOwnerRule,
      owningTeamModelType: IncidentOwnerRuleOwningTeam,
      viewRuleId: props.viewRuleId,
    });

    return <></>;
  };

  beforeEach(() => {
    latest = null;
    goTo(RULE_URL);
  });

  test("holds the rule's changes back until it has read who owns it", async () => {
    rowsForTest = editorOf(PLATFORM);
    owningTeamRowsForTest = [owningTeam(OVERSIGHT, "Oversight")];

    let answer: () => void = () => {};
    const answered: Promise<void> = new Promise<void>((resolve: () => void) => {
      answer = resolve;
    });
    owningTeamsReadWaitsFor = answered;

    render(<Harness viewRuleId={new ObjectID(RULE_ID)} />);

    // Not read yet: nothing offered, and nobody accused.
    expect(latest!.viewRuleOwnership!.editLock).toEqual({ isAllowed: false });
    expect(latest!.viewRuleOwnership!.deleteLock).toEqual({
      isAllowed: false,
    });

    await act(async () => {
      answer();
      await answered;
    });

    await waitFor(() => {
      expect(latest!.viewRuleOwnership!.editLock.disabledReason).toContain(
        OVERSIGHT_OWNS_IT,
      );
    });

    expect(latest!.viewRuleOwnership!.deleteLock.disabledReason).toContain(
      OVERSIGHT_OWNS_IT,
    );
  });

  test("reads who owns it again once its Edit saves, the teams last read standing meanwhile", async () => {
    rowsForTest = editorOf(OVERSIGHT);
    owningTeamRowsForTest = [owningTeam(OVERSIGHT, "Oversight")];

    render(<Harness viewRuleId={new ObjectID(RULE_ID)} />);

    await waitFor(() => {
      expect(latest!.viewRuleOwnership!.editLock.isAllowed).toBe(true);
    });

    expect(owningTeamReads).toHaveLength(1);

    // The Edit form handed the rule to Platform.
    owningTeamRowsForTest = [owningTeam(PLATFORM, "Platform")];

    await act(async () => {
      latest!.viewRuleOwnership!.onRuleSaved!();
    });

    await waitFor(() => {
      expect(latest!.viewRuleOwnership!.editLock.isAllowed).toBe(false);
    });

    expect(owningTeamReads).toHaveLength(2);
    expect(latest!.viewRuleOwnership!.editLock.disabledReason).toContain(
      "This rule belongs to Platform",
    );
  });

  test("on the list, says nothing of a rule's own page, and reads nothing for one", async () => {
    rowsForTest = editorOf(PLATFORM);

    render(<Harness />);

    expect(latest!.viewRuleOwnership).toBeUndefined();
    expect(owningTeamReads).toHaveLength(0);
  });
});
