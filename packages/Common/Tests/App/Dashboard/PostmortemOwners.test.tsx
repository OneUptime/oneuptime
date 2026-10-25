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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHO OWNS A POSTMORTEM, AND ADDING ONE RIGHT THERE.
 *
 * An incident's postmortem is owned by the incident's owners. Its summary
 * used to send the reader to the incident's Owners page to add one ("Add
 * owners" / "Change owners"). Now a reader who may add an owner adds one
 * right where the owners are named: "Add owners" beside "No owners yet.",
 * or the empty place after the owners - each opening the shared Add owners
 * list - and the page reads the owners again.
 */

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

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

import PostmortemOwners, {
  PostmortemAddOwners,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemOwners";
import PostmortemSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemSummary";
import { OwnersChange } from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwners";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const INCIDENT_ID: string = "20000000-0000-4000-8000-0000000000b1";
const ALICE_ID: string = "30000000-0000-4000-8000-0000000000c1";
const BOB_ID: string = "30000000-0000-4000-8000-0000000000c2";
const SRE_ID: string = "31000000-0000-4000-8000-0000000000c1";

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

const ALICE: User = makeUser(ALICE_ID, "Alice Smith", "alice@acme.test");
const BOB: User = makeUser(BOB_ID, "Bob Jones", "bob@acme.test");

function sre(): Team {
  const team: Team = new Team();
  team._id = SRE_ID;
  team.name = "SRE";
  return team;
}

let changes: Array<OwnersChange> = [];

const ADD_OWNERS: PostmortemAddOwners = {
  target: {
    ownerUserModelType: IncidentOwnerUser,
    ownerTeamModelType: IncidentOwnerTeam,
    resourceIdField: "incidentId",
    resourceId: new ObjectID(INCIDENT_ID),
  },
  onOwnersChanged: (change: OwnersChange): void => {
    changes.push(change);
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  changes = [];
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const members: Array<TeamMember> = [ALICE, BOB].map(
        (user: User): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        },
      );
      return { data: members, count: 2, skip: 0, limit: 25 };
    }
    if (request.modelType === Team) {
      return { data: [sre()], count: 1, skip: 0, limit: 25 };
    }
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  createMock.mockResolvedValue({});
  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
});

describe("PostmortemOwners", () => {
  test("no owners yet: says so, and Add owners opens the Add owners list right there", async () => {
    render(
      <PostmortemOwners owners={[]} hasLoaded={true} addOwners={ADD_OWNERS} />,
    );

    const owners: HTMLElement = screen.getByTestId("postmortem-owners");

    expect(owners).toHaveTextContent("No owners yet.");

    const add: HTMLElement = within(owners).getByRole("button", {
      name: "Add owners",
    });

    expect(add).toHaveAttribute("data-testid", "postmortem-add-owners");
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(add);

    const list: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    await within(list).findAllByRole("option");

    expect(
      within(list)
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return option.getAttribute("data-id");
        }),
    ).toEqual([ALICE_ID, BOB_ID, SRE_ID]);
  });

  test("a pick makes them an owner of the incident, and the page reads the owners again", async () => {
    render(
      <PostmortemOwners owners={[]} hasLoaded={true} addOwners={ADD_OWNERS} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add owners" }));

    const list: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    fireEvent.click(await within(list).findByText("SRE"));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createMock.mock.calls[0]![0];

    expect(request.modelType).toBe(IncidentOwnerTeam);
    expect(String(request.model.incidentId)).toBe(INCIDENT_ID);
    expect(String(request.model.teamId)).toBe(SRE_ID);
    await waitFor(() => {
      expect(changes).toEqual([{ wasAdded: true }]);
    });
  });

  test("owners: avatars and names, then the empty place to add more, leaving out whoever owns it", async () => {
    const owners: Array<ResourceOwnerEntry> = [
      { kind: "user", user: ALICE },
      { kind: "team", team: sre() },
    ];

    render(
      <PostmortemOwners
        owners={owners}
        hasLoaded={true}
        addOwners={ADD_OWNERS}
      />,
    );

    const line: HTMLElement = screen.getByTestId("postmortem-owners");

    expect(line).toHaveTextContent("Alice Smith, SRE");

    const place: HTMLElement = within(line).getByRole("button", {
      name: "Add owners",
    });

    expect(place).toHaveAttribute("data-testid", "postmortem-add-more-owners");
    // The last thing on the line.
    expect(line.lastElementChild?.contains(place)).toBe(true);

    fireEvent.click(place);

    const list: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    await within(list).findAllByRole("option");

    expect(
      within(list)
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return option.getAttribute("data-id");
        }),
    ).toEqual([BOB_ID]);
  });

  test("the list stays open as the first owner takes 'No owners yet.''s place", async () => {
    const view: RenderResult = render(
      <PostmortemOwners owners={[]} hasLoaded={true} addOwners={ADD_OWNERS} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add owners" }));

    const list: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    fireEvent.click(await within(list).findByText("Bob Jones"));

    await within(list).findByText("Added Bob Jones.");

    view.rerender(
      <PostmortemOwners
        owners={[{ kind: "user", user: BOB }]}
        hasLoaded={true}
        addOwners={ADD_OWNERS}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Add owners" })).toBe(list);
    expect(within(list).getByText("Added Bob Jones.")).toBeVisible();
    expect(
      screen.getByTestId("postmortem-add-more-owners"),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("a reader who may not add owners reads the owners alone", () => {
    const view: RenderResult = render(
      <PostmortemOwners owners={[]} hasLoaded={true} />,
    );

    expect(screen.getByTestId("postmortem-owners")).toHaveTextContent(
      /^No owners yet\.$/,
    );
    expect(screen.queryByRole("button")).toBeNull();
    view.unmount();

    render(
      <PostmortemOwners
        owners={[{ kind: "user", user: ALICE }]}
        hasLoaded={true}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  test("while the owners load, nothing offers to add", () => {
    render(
      <PostmortemOwners owners={[]} hasLoaded={false} addOwners={ADD_OWNERS} />,
    );

    expect(screen.getByTestId("postmortem-owners-loading")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("PostmortemSummary", () => {
  test("names Owners as every detail card names a field, with no link away to the Owners page", () => {
    render(
      <PostmortemSummary
        incidentId={new ObjectID(INCIDENT_ID)}
        statusId={null}
        choices={[]}
        canChangeStatus={false}
        onStatusChanged={(): void => {}}
        owners={[{ kind: "user", user: ALICE }]}
        hasLoadedOwners={true}
        addOwners={ADD_OWNERS}
      />,
    );

    const summary: HTMLElement = screen.getByTestId("postmortem-summary");
    const labels: Array<string> = within(summary)
      .getAllByTestId("detail-label")
      .map((label: HTMLElement): string => {
        return label.textContent || "";
      });

    expect(labels).toEqual(["Status", "Owners"]);
    expect(within(summary).queryByRole("link")).toBeNull();
    expect(within(summary).queryByText("Change owners")).toBeNull();
    expect(
      within(summary).getByRole("button", { name: "Add owners" }),
    ).toBeVisible();
  });

  test("offers nothing to add without the permission to", () => {
    render(
      <PostmortemSummary
        incidentId={new ObjectID(INCIDENT_ID)}
        statusId={null}
        choices={[]}
        canChangeStatus={false}
        onStatusChanged={(): void => {}}
        owners={[]}
        hasLoadedOwners={true}
      />,
    );

    expect(
      within(screen.getByTestId("postmortem-summary")).queryByRole("button", {
        name: "Add owners",
      }),
    ).toBeNull();
  });
});
