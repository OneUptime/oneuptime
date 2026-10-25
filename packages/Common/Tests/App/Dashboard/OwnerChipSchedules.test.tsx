import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import OwnedBy, { OwnedByMatch } from "../../../Types/BaseDatabase/OwnedBy";
import Permission from "../../../Types/Permission";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "I can't filter by Owner/team on /on-call-duty/schedules." - the
 * maintainer.
 *
 * The production On-Call Schedules page with the real Owner chip
 * (useResourceOwners, FilterChipDropdown) and the table as the fetch
 * boundary: what the list asks the server for when someone picks a person
 * or a team, under each of the chip's operators, and what the Owners column
 * reads. The table is replaced by a recorder that draws the chips it is
 * given, so every selection travels through the real chip, state and query.
 *
 *   - Owner and Labels chips over the list; Labels no longer in the Filters
 *     dialog, which keeps Name and Description;
 *   - picking a team asks for the schedules the team owns, a person for the
 *     ones the person owns - one filter under "owners" the server answers
 *     (OwnedBy), never a list of ids the page worked out, and never a team's
 *     members in its place;
 *   - is not / is empty / is not empty ask for none of them, nobody, someone;
 *   - the chips are kept in the page's address: back on the page, the first
 *     request already filters;
 *   - the Owners column reads the schedules' owner rows by their key, once
 *     per page of rows;
 *   - Add Owner / Remove Owner are on the bulk actions, for the schedules'
 *     owner tables.
 */

interface CapturedColumn {
  title: string;
  getElement?: ((item: OnCallDutyPolicySchedule) => ReactElement) | undefined;
}

interface CapturedFilter {
  title: string;
}

interface CapturedTableProps {
  id: string;
  query: Record<string, unknown>;
  topContent: ReactElement;
  emptyState: {
    isFiltered?: boolean | undefined;
    hideTopContentWhileEmpty?: boolean | undefined;
  };
  currentFacetState: JSONObject;
  onFetchSuccess: (data: Array<OnCallDutyPolicySchedule>) => void;
  columns: Array<CapturedColumn>;
  filters: Array<CapturedFilter>;
  bulkActions: { buttons: Array<{ title: string }> };
}

let capturedTableProps: CapturedTableProps | null = null;
let capturedQueries: Array<Record<string, unknown>> = [];

const getListMock: MockFunction = getJestMockFunction();
const bulkOwnerOptionsMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      capturedTableProps = props;
      capturedQueries.push(props.query);
      return <div data-testid="schedules-table">{props.topContent}</div>;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverPage",
  () => {
    return {
      __esModule: true,
      default: (props: { children: ReactNode }): ReactElement => {
        return <>{props.children}</>;
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [{ title: "Add Labels" }], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: (options: unknown) => {
      bulkOwnerOptionsMock(options);
      return {
        rowActions: [],
        bulkActions: [{ title: "Add Owner" }, { title: "Remove Owner" }],
        modals: null,
      };
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * What the signed-in member holds. Empty is a snapshot that has not landed
 * yet - nobody is known to be refused anything; a test that needs a member
 * whose role may not read the schedules' owners sets it.
 */
let heldPermissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return heldPermissions;
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

import OnCallDutySchedulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules";

const PROJECT_ID: ObjectID = new ObjectID(
  "7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);
const ADA_ID: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const GRACE_ID: string = "1e5dac3f-7b40-4f2e-8c8b-3d6f9a2b4c71";
const SRE_TEAM_ID: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";
const PAYMENTS_TEAM_ID: string = "3a7fce51-9d62-4b40-8eaa-5f8b1c4d6e93";
const PRIMARY_SCHEDULE_ID: string = "4b80df62-ae73-4c51-9fbb-60c9a2d5e7a4";
const NIGHTS_SCHEDULE_ID: string = "5c91e073-bf84-4d62-a0cc-71dab3e6f8b5";

const user: (id: string, name: string) => User = (
  id: string,
  name: string,
): User => {
  const value: User = new User();
  value._id = id;
  value.name = new Name(name);
  return value;
};

const team: (id: string, name: string) => Team = (
  id: string,
  name: string,
): Team => {
  const value: Team = new Team();
  value._id = id;
  value.name = name;
  return value;
};

const teamMember: (member: User) => TeamMember = (member: User): TeamMember => {
  const value: TeamMember = new TeamMember();
  value._id = ObjectID.generate().toString();
  value.user = member;
  return value;
};

// A team's dark tile (PeopleAvatar's group palette).
const TEAM_TILE_STOP: RegExp = /from-(?:slate|gray|stone|zinc|neutral)-700/;

const ADA: User = user(ADA_ID, "Ada Lovelace");
const GRACE: User = user(GRACE_ID, "Grace Hopper");
const SRE: Team = team(SRE_TEAM_ID, "SRE");
const PAYMENTS: Team = team(PAYMENTS_TEAM_ID, "Payments");

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
}

// The requests of one model the page made.
const requestsOf: (modelType: {
  name: string;
}) => Array<ListRequest> = (modelType: {
  name: string;
}): Array<ListRequest> => {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType.name === modelType.name;
    });
};

const answerLists: () => void = (): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: ListRequest = args[0] as ListRequest;
    let data: Array<unknown> = [];

    if (request.modelType.name === TeamMember.name) {
      data = [teamMember(ADA), teamMember(GRACE)];
    } else if (request.modelType.name === Team.name) {
      data = [SRE, PAYMENTS];
    } else if (
      request.modelType.name === OnCallDutyPolicyScheduleOwnerUser.name
    ) {
      const row: OnCallDutyPolicyScheduleOwnerUser =
        new OnCallDutyPolicyScheduleOwnerUser();
      row._id = ObjectID.generate().toString();
      row.onCallDutyPolicyScheduleId = new ObjectID(PRIMARY_SCHEDULE_ID);
      row.user = ADA;
      data = [row];
    } else if (
      request.modelType.name === OnCallDutyPolicyScheduleOwnerTeam.name
    ) {
      const row: OnCallDutyPolicyScheduleOwnerTeam =
        new OnCallDutyPolicyScheduleOwnerTeam();
      row._id = ObjectID.generate().toString();
      row.onCallDutyPolicyScheduleId = new ObjectID(PRIMARY_SCHEDULE_ID);
      row.team = SRE;
      data = [row];
    }

    return Promise.resolve({
      data: data,
      count: data.length,
      skip: 0,
      limit: 50,
    });
  });
};

const renderPage: () => void = (): void => {
  render(
    <MemoryRouter>
      <OnCallDutySchedulesPage
        pageRoute={
          new Route(
            `/dashboard/${PROJECT_ID.toString()}/on-call-duty/schedules`,
          )
        }
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
};

const getTable: () => CapturedTableProps = (): CapturedTableProps => {
  expect(capturedTableProps).not.toBeNull();
  return capturedTableProps!;
};

// The chip's button, and the popover it opens.
const openChip: (label: string) => HTMLElement = (
  label: string,
): HTMLElement => {
  const chip: HTMLElement = screen.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(label)}(?:$| ·)`),
  });

  if (chip.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(chip);
  }

  return chip
    .closest('[data-testid="filter-chip"]')!
    .parentElement!.querySelector('[role="dialog"]') as HTMLElement;
};

const pick: (label: string, option: string) => Promise<void> = async (
  label: string,
  option: string,
): Promise<void> => {
  const dialog: HTMLElement = openChip(label);
  const found: HTMLElement = await within(dialog).findByText(option, {
    exact: true,
  });

  await act(async () => {
    fireEvent.click(found.closest('[role="option"]')!);
  });
};

const setOperator: (label: string, operator: string) => Promise<void> = async (
  label: string,
  operator: string,
): Promise<void> => {
  openChip(label);

  // The popover opens on the next render.
  const dialog: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | null = screen
      .getByRole("button", {
        name: new RegExp(`^${escapeRegExp(label)}(?:$| ·)`),
      })
      .closest('[data-testid="filter-chip"]')!
      .parentElement!.querySelector('[role="dialog"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

  await act(async () => {
    fireEvent.change(
      within(dialog).getByRole("combobox", {
        name: `${label} operator`,
      }),
      { target: { value: operator } },
    );
  });
};

// The owners filter of the table's latest request, as the API carries it.
const ownersOfLatestQuery: () => JSONObject | null = (): JSONObject | null => {
  const owners: unknown = getTable().query["owners"];

  if (owners === undefined) {
    return null;
  }

  expect(owners).toBeInstanceOf(OwnedBy);
  return (owners as OwnedBy).toJSON();
};

beforeEach(() => {
  heldPermissions = [];
  capturedTableProps = null;
  capturedQueries = [];
  getListMock.mockReset();
  bulkOwnerOptionsMock.mockReset();
  answerLists();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID.toString()}/on-call-duty/schedules`,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("On-Call Schedules: the Owner chip", () => {
  test("Owner and Labels chips sit over the list; the Filters dialog keeps Name and Description", () => {
    renderPage();

    expect(getTable().id).toBe("on-call-schedules-table");
    expect(screen.getByRole("button", { name: /^Owner$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Labels$/ })).toBeVisible();
    expect(
      getTable().filters.map((filter: CapturedFilter): string => {
        return filter.title;
      }),
    ).toEqual(["Name", "Description"]);

    // Unfiltered: no owners filter, and nothing narrowed by id.
    expect(ownersOfLatestQuery()).toBeNull();
    expect(getTable().query["_id"]).toBeUndefined();
    expect(getTable().emptyState.isFiltered).toBe(false);
  });

  test("the chip offers the project's people and teams, apart", async () => {
    renderPage();

    const dialog: HTMLElement = openChip("Owner");

    expect(await within(dialog).findByText("Ada Lovelace")).toBeVisible();
    expect(within(dialog).getByText("Grace Hopper")).toBeVisible();
    expect(within(dialog).getByText("SRE")).toBeVisible();
    expect(within(dialog).getByText("Payments")).toBeVisible();
    expect(
      within(dialog)
        .getAllByTestId("filter-chip-group-heading")
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).toEqual(["People", "Teams"]);

    // People are searched among the project's team members, teams by name.
    expect(requestsOf(TeamMember)[0]!.query["projectId"]).toEqual(PROJECT_ID);
    expect(requestsOf(Team)[0]!.query["projectId"]).toEqual(PROJECT_ID);
  });

  test("a team: the schedules the team owns, asked of the server - not its members', not ids worked out here", async () => {
    renderPage();
    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.AnyOf,
        userIds: [],
        teamIds: [SRE_TEAM_ID],
      });
    });

    // The list is narrowed by the filter, not by ids the page looked up.
    expect(getTable().query["_id"]).toBeUndefined();

    for (const ownerTable of [
      OnCallDutyPolicyScheduleOwnerUser,
      OnCallDutyPolicyScheduleOwnerTeam,
    ]) {
      for (const request of requestsOf(ownerTable)) {
        expect(request.query["teamId"]).toBeUndefined();
        expect(request.query["userId"]).toBeUndefined();
      }
    }

    // A team never stands for its members.
    expect(requestsOf(TeamMember).length).toBeGreaterThan(0);
    for (const request of requestsOf(TeamMember)) {
      expect(request.query["teamId"]).toBeUndefined();
    }

    expect(getTable().emptyState.isFiltered).toBe(true);
  });

  test("a person: the schedules the person owns", async () => {
    renderPage();
    await pick("Owner", "Grace Hopper");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.AnyOf,
        userIds: [GRACE_ID],
        teamIds: [],
      });
    });
  });

  test("a person and a team: the schedules either owns", async () => {
    renderPage();
    await pick("Owner", "Ada Lovelace");
    await pick("Owner", "Payments");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.AnyOf,
        userIds: [ADA_ID],
        teamIds: [PAYMENTS_TEAM_ID],
      });
    });
  });

  test("is not: the schedules none of them owns", async () => {
    renderPage();
    await pick("Owner", "SRE");
    await setOperator("Owner", "is_not");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.NoneOf,
        userIds: [],
        teamIds: [SRE_TEAM_ID],
      });
    });
  });

  test.each([
    ["is_empty", OwnedByMatch.NoOwner],
    ["is_not_empty", OwnedByMatch.AnyOwner],
  ])("%s: the schedules %s", async (operator: string, match: OwnedByMatch) => {
    renderPage();
    await setOperator("Owner", operator);

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toEqual({
        _type: "OwnedBy",
        match: match,
        userIds: [],
        teamIds: [],
      });
    });

    expect(getTable().emptyState.isFiltered).toBe(true);
  });

  test("clearing the chip lists every schedule again", async () => {
    renderPage();
    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Clear Owner filter" }),
      );
    });

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toBeNull();
    });
  });

  test("the chips live in the page's address: back on the page, the first request already filters", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID.toString()}/on-call-duty/schedules`,
    );

    renderPage();
    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(
        new URLSearchParams(window.location.search).has(
          TableFilterUrlState.getParamName("on-call-schedules-table", "facets"),
        ),
      ).toBe(true);
    });

    const address: string = window.location.pathname + window.location.search;

    cleanup();
    capturedTableProps = null;
    capturedQueries = [];
    window.history.replaceState(null, "", address);

    renderPage();

    expect(capturedQueries.length).toBeGreaterThan(0);
    for (const query of capturedQueries) {
      expect((query["owners"] as OwnedBy).toJSON()).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.AnyOf,
        userIds: [],
        teamIds: [SRE_TEAM_ID],
      });
    }

    // The chip says what it filters by once the team's name is read.
    expect(
      await screen.findByRole("button", { name: /^Owner · SRE/ }),
    ).toBeVisible();
  });

  test("a saved view keeps the chip's picks", async () => {
    renderPage();
    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(getTable().currentFacetState).toEqual(
        expect.objectContaining({
          selectedOwnerKeys: [`team:${SRE_TEAM_ID}`],
          ownerOperator: "is",
        }),
      );
    });
  });

  test("the Owners column reads each page's owners by the schedules' key, and draws them", async () => {
    renderPage();

    const primary: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    primary._id = PRIMARY_SCHEDULE_ID;
    primary.name = "Primary";
    const nights: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    nights._id = NIGHTS_SCHEDULE_ID;
    nights.name = "Nights";

    await act(async () => {
      getTable().onFetchSuccess([primary, nights]);
    });

    for (const ownerTable of [
      OnCallDutyPolicyScheduleOwnerUser,
      OnCallDutyPolicyScheduleOwnerTeam,
    ]) {
      const requests: Array<ListRequest> = requestsOf(ownerTable);

      expect(requests).toHaveLength(1);
      expect(requests[0]!.query["onCallDutyPolicyScheduleId"]).toEqual(
        new Includes([PRIMARY_SCHEDULE_ID, NIGHTS_SCHEDULE_ID]),
      );
    }

    const owners: CapturedColumn | undefined = getTable().columns.find(
      (column: CapturedColumn): boolean => {
        return column.title === "Owners";
      },
    );

    expect(owners).toBeDefined();

    const { container } = render(
      <div data-testid="owners-cell">{owners!.getElement!(primary)}</div>,
    );

    await waitFor(() => {
      // Ada Lovelace and the SRE team, as their initials.
      expect(container.textContent).toContain("AL");
      expect(container.textContent).toContain("S");
    });
  });

  test("Add Owner and Remove Owner are bulk actions, on the schedules' owner tables", () => {
    renderPage();

    expect(
      getTable().bulkActions.buttons.map(
        (button: { title: string }): string => {
          return button.title;
        },
      ),
    ).toEqual(["Add Labels", "Add Owner", "Remove Owner"]);

    expect(bulkOwnerOptionsMock).toHaveBeenCalledWith({
      ownerUserModelType: OnCallDutyPolicyScheduleOwnerUser,
      ownerTeamModelType: OnCallDutyPolicyScheduleOwnerTeam,
      resourceIdField: "onCallDutyPolicyScheduleId",
    });
  });

  test("the owners filter reaches the API as the server reads it", async () => {
    renderPage();
    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).not.toBeNull();
    });

    const sent: JSONObject = JSON.parse(
      JSON.stringify(JSONFunctions.serialize(getTable().query as JSONObject)),
    );

    expect(sent["owners"]).toEqual({
      _type: "OwnedBy",
      match: "AnyOf",
      userIds: [],
      teamIds: [SRE_TEAM_ID],
    });
    expect(
      (JSONFunctions.deserialize(sent) as Record<string, unknown>)["owners"],
    ).toBeInstanceOf(OwnedBy);
  });
});

describe("On-Call Schedules: when the chips stay out of the way", () => {
  /*
   * The chips filter a list with records. Over a project with no schedule
   * yet they offered to narrow nothing: the table is asked to leave them
   * out while its list is empty with nothing applied (BaseModelTable reads
   * hideTopContentWhileEmpty), and to keep them while a chip is in force.
   */
  test("the table is asked to leave the chips out while the list has nothing", async () => {
    renderPage();

    expect(getTable().emptyState.hideTopContentWhileEmpty).toBe(true);
    expect(getTable().emptyState.isFiltered).toBe(false);

    await pick("Owner", "SRE");

    // A chip in force: the empty state says nothing matches, chips kept.
    await waitFor(() => {
      expect(getTable().emptyState.isFiltered).toBe(true);
    });
    expect(getTable().emptyState.hideTopContentWhileEmpty).toBe(true);
  });

  /*
   * A custom role may read the schedules but not who owns them. The server
   * refuses that member a filter by owners (403), so the chip is not
   * offered to them - and an owner filter a colleague's link carries is
   * dropped rather than turning the list into an error.
   */
  const MAY_NOT_READ_OWNERS: Array<Permission> = [
    Permission.ReadProjectOnCallDutyPolicySchedule,
    Permission.ReadProjectLabel,
  ];

  test("a member who may not read the schedules' owners gets no Owner chip", async () => {
    heldPermissions = MAY_NOT_READ_OWNERS;

    renderPage();

    expect(screen.getByRole("button", { name: /^Labels$/ })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^Owner(?:$| ·)/ }),
    ).not.toBeInTheDocument();
    expect(ownersOfLatestQuery()).toBeNull();

    // Nor are the owner tables read for an Owners column they may not see.
    const nights: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    nights._id = NIGHTS_SCHEDULE_ID;

    await act(async () => {
      getTable().onFetchSuccess([nights]);
    });

    expect(requestsOf(OnCallDutyPolicyScheduleOwnerUser)).toHaveLength(0);
    expect(requestsOf(OnCallDutyPolicyScheduleOwnerTeam)).toHaveLength(0);
  });

  test("a link's owner filter is dropped for them, not sent to be refused", async () => {
    heldPermissions = MAY_NOT_READ_OWNERS;

    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID.toString()}/on-call-duty/schedules?${TableFilterUrlState.getParamName(
        "on-call-schedules-table",
        "facets",
      )}=${encodeURIComponent(
        JSON.stringify({
          selectedOwnerKeys: [`team:${SRE_TEAM_ID}`],
          ownerOperator: "is",
        }),
      )}`,
    );

    renderPage();

    expect(capturedQueries.length).toBeGreaterThan(0);
    for (const query of capturedQueries) {
      expect(query["owners"]).toBeUndefined();
    }

    // And it is not kept to be saved with their views.
    await waitFor(() => {
      expect(getTable().currentFacetState).toEqual(
        expect.objectContaining({
          selectedOwnerKeys: [],
          ownerOperator: "is",
        }),
      );
    });
    expect(getTable().emptyState.isFiltered).toBe(false);
  });

  test("a member who may read them keeps the chip once their permissions are known", async () => {
    heldPermissions = [Permission.ProjectMember];

    renderPage();

    expect(screen.getByRole("button", { name: /^Owner$/ })).toBeVisible();

    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(ownersOfLatestQuery()).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.AnyOf,
        userIds: [],
        teamIds: [SRE_TEAM_ID],
      });
    });
  });
});

/*
 * The chip's people and teams are the ones the owners picker offers
 * (PeoplePickerKinds): people in name order, their pictures read with them,
 * drawn as the Owners column draws them. And a read that fails says so,
 * with Try again - it used to show "Nothing to show", as though the project
 * had nobody in it.
 */
describe("On-Call Schedules: the Owner chip's people and teams", () => {
  const OWNER_NAMES: Array<string> = [
    "Ada Lovelace",
    "Grace Hopper",
    "SRE",
    "Payments",
  ];

  // The names the open chip lists, in its order (not its operator's).
  const listedOwners: (dialog: HTMLElement) => Array<string> = (
    dialog: HTMLElement,
  ): Array<string> => {
    return within(within(dialog).getByRole("listbox"))
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return (
          OWNER_NAMES.find((name: string): boolean => {
            return (option.textContent || "").endsWith(name);
          }) || `?${option.textContent}`
        );
      });
  };

  test("people are listed by name, as the owners picker lists them, then the teams", async () => {
    const answer: ((...args: Array<unknown>) => unknown) | undefined =
      getListMock.getMockImplementation();

    // The server answers in no particular order.
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (request.modelType.name === TeamMember.name) {
        const data: Array<TeamMember> = [teamMember(GRACE), teamMember(ADA)];
        return Promise.resolve({ data, count: 2, skip: 0, limit: 50 });
      }

      return answer!(...args);
    });

    renderPage();

    const dialog: HTMLElement = openChip("Owner");

    await within(dialog).findByText("Ada Lovelace");

    expect(listedOwners(dialog)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "SRE",
      "Payments",
    ]);
  });

  test("a person's picture is read with them, so the chip can show it", async () => {
    renderPage();

    const dialog: HTMLElement = openChip("Owner");

    await within(dialog).findByText("Ada Lovelace");

    expect(requestsOf(TeamMember).length).toBeGreaterThan(0);
    for (const request of requestsOf(TeamMember)) {
      expect(request.select).toEqual(
        expect.objectContaining({
          user: expect.objectContaining({
            _id: true,
            name: true,
            email: true,
            profilePictureId: true,
          }),
        }),
      );
    }
  });

  test("a person and a team are drawn as the Owners column draws them", async () => {
    renderPage();

    const dialog: HTMLElement = openChip("Owner");
    const ada: HTMLElement = (
      await within(dialog).findByText("Ada Lovelace")
    ).closest('[role="option"]') as HTMLElement;
    const sre: HTMLElement = within(dialog)
      .getByText("SRE")
      .closest('[role="option"]') as HTMLElement;

    // A person: their initials on their gradient, no badge.
    expect(ada.innerHTML).toContain("bg-gradient-to-br");
    expect(ada.querySelectorAll("div[aria-hidden='true']")).toHaveLength(1);

    // A team: the dark tile, and its people badge.
    expect(sre.innerHTML).toMatch(TEAM_TILE_STOP);
    expect(
      sre.querySelectorAll("div[aria-hidden='true']").length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a read that fails says so, and Try again reads the people and teams again", async () => {
    const answer: ((...args: Array<unknown>) => unknown) | undefined =
      getListMock.getMockImplementation();
    let isFailing: boolean = true;

    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (
        isFailing &&
        (request.modelType.name === TeamMember.name ||
          request.modelType.name === Team.name)
      ) {
        return Promise.reject(new Error("502 Bad Gateway"));
      }

      return answer!(...args);
    });

    renderPage();

    const dialog: HTMLElement = openChip("Owner");

    expect(
      await within(dialog).findByText("Couldn't load this list."),
    ).toBeVisible();
    expect(within(dialog).queryByText("Nothing to show")).toBeNull();
    expect(within(dialog).queryByText("No options available")).toBeNull();

    isFailing = false;

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Try again" }),
      );
    });

    expect(await within(dialog).findByText("Ada Lovelace")).toBeVisible();
    expect(within(dialog).getByText("SRE")).toBeVisible();
    expect(within(dialog).queryByText("Couldn't load this list.")).toBeNull();
  });

  test("picks a link brings back are named by one lookup of each kind", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID.toString()}/on-call-duty/schedules`,
    );

    renderPage();
    await pick("Owner", "Ada Lovelace");
    await pick("Owner", "SRE");

    await waitFor(() => {
      expect(
        new URLSearchParams(window.location.search).has(
          TableFilterUrlState.getParamName("on-call-schedules-table", "facets"),
        ),
      ).toBe(true);
    });

    const address: string = window.location.pathname + window.location.search;

    cleanup();
    getListMock.mockClear();
    window.history.replaceState(null, "", address);

    renderPage();

    expect(
      await screen.findByRole("button", { name: /^Owner · Ada Lovelace, SRE/ }),
    ).toBeVisible();

    const peopleLookups: Array<ListRequest> = requestsOf(TeamMember).filter(
      (request: ListRequest): boolean => {
        return request.query["userId"] !== undefined;
      },
    );
    const teamLookups: Array<ListRequest> = requestsOf(Team).filter(
      (request: ListRequest): boolean => {
        return request.query["_id"] !== undefined;
      },
    );

    expect(peopleLookups).toHaveLength(1);
    expect(peopleLookups[0]!.query["userId"]).toEqual(new Includes([ADA_ID]));
    expect(teamLookups).toHaveLength(1);
    expect(teamLookups[0]!.query["_id"]).toEqual(new Includes([SRE_TEAM_ID]));
  });

  test("a link's person who has left the project is an Unknown user, never their key", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID.toString()}/on-call-duty/schedules`,
    );

    renderPage();
    await pick("Owner", "Ada Lovelace");

    await waitFor(() => {
      expect(
        new URLSearchParams(window.location.search).has(
          TableFilterUrlState.getParamName("on-call-schedules-table", "facets"),
        ),
      ).toBe(true);
    });

    const address: string = window.location.pathname + window.location.search;
    const answer: ((...args: Array<unknown>) => unknown) | undefined =
      getListMock.getMockImplementation();

    cleanup();

    // Ada has since left the project: looking her up finds nobody.
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (
        request.modelType.name === TeamMember.name &&
        request.query["userId"] !== undefined
      ) {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
      }

      return answer!(...args);
    });
    window.history.replaceState(null, "", address);

    renderPage();

    expect(
      await screen.findByRole("button", { name: /^Owner · Unknown user/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: new RegExp(escapeRegExp(ADA_ID)) }),
    ).toBeNull();
  });
});
