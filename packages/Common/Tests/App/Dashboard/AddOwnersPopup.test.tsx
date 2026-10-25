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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE ADD OWNERS LIST, WHEREVER A RECORD NAMES ITS OWNERS.
 *
 * The maintainer: "If I click on add owners, I should be able to add owners
 * from this page directly instead of going to owners page." The Owners
 * page's own list (AddOwnersPopup) now opens from every Add that names a
 * record's owners - an incident's, alert's, episode's or maintenance event's
 * header, a monitor's and an SLO's overview, an incident's postmortem - so
 * the rules are the Owners page's wherever the Add is pressed:
 *
 *   - who may add: the create permission on the record's own owner tables,
 *     a kind the reader may not add locked in the list with why;
 *   - who can be picked: the project's people and teams;
 *   - no duplicates: whoever owns the record is left out, and so is whoever
 *     was just added, before the place has read its owners again;
 *   - the notifications: the row written is the Owners page's own - the
 *     record, the project and the person or the team, nothing else - so the
 *     server tells the new owner, writes the feed and invites them to the
 *     record's channels as it always has.
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

import AddOwnersPopup, {
  ADD_OWNERS_PLACE_OPEN_CLASS_NAME,
  AddOwnersPlaceButton,
  useAddOwnersPopup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwnersPopup";
import {
  ADD_OWNER_KIND_REFUSED_SENTENCES,
  ADD_OWNERS_REFUSED_SENTENCE,
  addOwner,
  buildOwnerRow,
  canAddOwners,
  getAddOwnersGate,
  getOwnerKeys,
  getOwnerKindAccess,
  OwnerKindAccess,
  OwnersChange,
  OwnersTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwners";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  AnchoredFieldPopup,
  getAnchoredPopupTriggerProps,
} from "../../../UI/Types/UseAnchoredFieldPopup";
import PermissionUtil from "../../../UI/Utils/Permission";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222221";
const OTHER_INCIDENT_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444441";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const DATABASE: string = "0000000b-0000-4000-8000-000000000002";

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function makeTeam(id: string, name: string): Team {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
}

const PEOPLE: Array<User> = [
  makeUser(ADA, "Ada Lovelace", "ada@example.com"),
  makeUser(BOB, "Bob Stone", "bob@example.com"),
];

const TEAMS: Array<Team> = [
  makeTeam(DATABASE, "Database"),
  makeTeam(PLATFORM, "Platform"),
];

function list(rows: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
}

function serve(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      return list(
        PEOPLE.map((user: User): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        }),
      );
    }

    if (request.modelType === Team) {
      return list(TEAMS);
    }

    return list([]);
  });
}

const INCIDENT_TARGET: OwnersTarget = {
  ownerUserModelType: IncidentOwnerUser,
  ownerTeamModelType: IncidentOwnerTeam,
  resourceIdField: "incidentId",
  resourceId: new ObjectID(INCIDENT_ID),
};

const MONITOR_TARGET: OwnersTarget = {
  ownerUserModelType: MonitorOwnerUser,
  ownerTeamModelType: MonitorOwnerTeam,
  resourceIdField: "monitorId",
  resourceId: new ObjectID(MONITOR_ID),
};

function owner(kind: "user" | "team", id: string): ResourceOwnerEntry {
  if (kind === "user") {
    return { kind: "user", user: makeUser(id, "Owner", "owner@example.com") };
  }

  return { kind: "team", team: makeTeam(id, "Owning team") };
}

interface HarnessProps {
  target: OwnersTarget;
  owners: Array<ResourceOwnerEntry>;
  onOwnersChanged?: ((change: OwnersChange) => void | Promise<void>) | undefined;
}

// A place that names a record's owners, with its Add and the shared list.
const Harness: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const popup: AnchoredFieldPopup = useAddOwnersPopup(props.owners.length);

  return (
    <div>
      <div ref={popup.anchorRef}>
        <button type="button" {...getAnchoredPopupTriggerProps(popup)}>
          Add owners
        </button>
      </div>
      <AddOwnersPopup
        popup={popup}
        target={props.target}
        ownerKeys={getOwnerKeys(props.owners)}
        onOwnersChanged={props.onOwnersChanged}
      />
    </div>
  );
};

async function openList(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Add owners" }));

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owners",
  });

  await within(dialog).findAllByRole("option");

  return dialog;
}

function offered(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return `${option.getAttribute("data-kind")}:${option.getAttribute("data-id")}`;
    });
}

function pick(dialog: HTMLElement, id: string): void {
  fireEvent.click(
    within(dialog)
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.getAttribute("data-id") === id;
      })!,
  );
}

function created(): Array<{ model: BaseModel; modelType: unknown }> {
  return createMock.mock.calls.map((call: Array<any>) => {
    return call[0];
  });
}

function holdPermissions(permissions: Array<Permission>): void {
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  serve();
  createMock.mockResolvedValue({});
  // jsdom has no scrollIntoView.
  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Add owners list", () => {
  test("offers the project's people, then its teams, leaving out whoever owns the record", async () => {
    render(
      <Harness
        target={INCIDENT_TARGET}
        owners={[owner("user", ADA), owner("team", PLATFORM)]}
      />,
    );

    const dialog: HTMLElement = await openList();

    expect(offered(dialog)).toEqual([`user:${BOB}`, `team:${DATABASE}`]);
    // People first, then teams: each under its own heading.
    const groups: Array<HTMLElement> = within(dialog).getAllByRole("group");
    expect(groups.map((group: HTMLElement) => group.textContent)).toEqual([
      expect.stringContaining("People"),
      expect.stringContaining("Teams"),
    ]);
    // The project's own: both reads are of this project.
    for (const call of getListMock.mock.calls) {
      expect(String((call[0] as any).query.projectId)).toBe(PROJECT_ID);
    }
  });

  test("one click adds a person as the Owners page always has: one row naming the record, the project and the person", async () => {
    render(<Harness target={INCIDENT_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    pick(dialog, BOB);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: { model: BaseModel; modelType: unknown } = created()[0]!;
    const row: Record<string, unknown> = request.model as unknown as Record<
      string,
      unknown
    >;

    expect(request.modelType).toBe(IncidentOwnerUser);
    expect(String(row["incidentId"])).toBe(INCIDENT_ID);
    expect(String(row["projectId"])).toBe(PROJECT_ID);
    expect(String(row["userId"])).toBe(BOB);
    /*
     * Nothing else: the row starts as an owner nobody has told yet
     * (isOwnerNotified keeps its default), which is what makes the server
     * send the "you were added as an owner" notification.
     */
    expect(row["isOwnerNotified"]).toBeUndefined();
    expect(row["teamId"]).toBeUndefined();
  });

  test("a team goes to the record's team owners", async () => {
    render(<Harness target={INCIDENT_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    pick(dialog, DATABASE);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: { model: BaseModel; modelType: unknown } = created()[0]!;
    const row: Record<string, unknown> = request.model as unknown as Record<
      string,
      unknown
    >;

    expect(request.modelType).toBe(IncidentOwnerTeam);
    expect(String(row["incidentId"])).toBe(INCIDENT_ID);
    expect(String(row["teamId"])).toBe(DATABASE);
    expect(row["userId"]).toBeUndefined();
  });

  test("a team and a person in one opening: the list stays open, and each pick leaves it at once", async () => {
    const changes: Array<OwnersChange> = [];

    render(
      <Harness
        target={INCIDENT_TARGET}
        owners={[]}
        onOwnersChanged={(change: OwnersChange): void => {
          changes.push(change);
        }}
      />,
    );

    const dialog: HTMLElement = await openList();

    pick(dialog, PLATFORM);

    // Gone from the list before the place has read its owners again.
    await waitFor(() => {
      expect(offered(dialog)).toEqual([
        `user:${ADA}`,
        `user:${BOB}`,
        `team:${DATABASE}`,
      ]);
    });

    pick(dialog, ADA);

    await waitFor(() => {
      expect(offered(dialog)).toEqual([`user:${BOB}`, `team:${DATABASE}`]);
    });

    expect(
      created().map((request: { modelType: unknown }) => {
        return request.modelType;
      }),
    ).toEqual([IncidentOwnerTeam, IncidentOwnerUser]);
    expect(changes).toEqual([{ wasAdded: true }, { wasAdded: true }]);
    // Still open for the next one.
    expect(screen.getByRole("dialog", { name: "Add owners" })).toBeVisible();
  });

  test("says under the list what the pick did, by name", async () => {
    render(<Harness target={INCIDENT_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    pick(dialog, BOB);

    const done: HTMLElement = await within(dialog).findByTestId(
      "people-search-notice-done",
    );

    expect(done).toHaveAttribute("role", "status");
    expect(done).toHaveTextContent("Added Bob Stone.");
  });

  test("the pick stays busy until the place has read its owners again", async () => {
    let finishRead: () => void = (): void => {};
    const read: Promise<void> = new Promise<void>((resolve: () => void) => {
      finishRead = resolve;
    });

    render(
      <Harness
        target={INCIDENT_TARGET}
        owners={[]}
        onOwnersChanged={(): Promise<void> => {
          return read;
        }}
      />,
    );

    const dialog: HTMLElement = await openList();

    pick(dialog, BOB);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    // While the owners are read again, the other rows wait their turn.
    await waitFor(() => {
      const others: Array<HTMLElement> = within(dialog)
        .getAllByRole("option")
        .filter((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") !== BOB;
        });
      expect(others.length).toBeGreaterThan(0);
      for (const other of others) {
        expect(other).toHaveAttribute("aria-disabled", "true");
      }
    });
    expect(within(dialog).queryByTestId("people-search-notices")).toBeNull();

    await act(async () => {
      finishRead();
      await read;
    });

    expect(
      await within(dialog).findByText("Added Bob Stone."),
    ).toBeInTheDocument();
    for (const option of within(dialog).getAllByRole("option")) {
      expect(option).not.toHaveAttribute("aria-disabled");
    }
  });

  test("a refusal is said in the list, the owners are read again, and the pick stays offered", async () => {
    createMock.mockRejectedValue(
      new Error("This user is already an owner of this incident."),
    );
    const changes: Array<OwnersChange> = [];

    render(
      <Harness
        target={INCIDENT_TARGET}
        owners={[]}
        onOwnersChanged={(change: OwnersChange): void => {
          changes.push(change);
        }}
      />,
    );

    const dialog: HTMLElement = await openList();

    pick(dialog, BOB);

    const problem: HTMLElement = await within(dialog).findByText(
      "This user is already an owner of this incident.",
    );

    expect(problem.closest("[role='alert']")).not.toBeNull();
    // Read again: whoever added Bob a moment earlier shows on the page.
    expect(changes).toEqual([{ wasAdded: false }]);
    // Not added here, so still offered, and nothing said as done.
    expect(offered(dialog)).toContain(`user:${BOB}`);
    expect(within(dialog).queryByText("Added Bob Stone.")).toBeNull();
  });

  test("an owner the place reads in later is left out too", async () => {
    const view: ReturnType<typeof render> = render(
      <Harness target={INCIDENT_TARGET} owners={[]} />,
    );

    const dialog: HTMLElement = await openList();

    expect(offered(dialog)).toContain(`user:${BOB}`);

    view.rerender(
      <Harness target={INCIDENT_TARGET} owners={[owner("user", BOB)]} />,
    );

    await waitFor(() => {
      expect(offered(dialog)).not.toContain(`user:${BOB}`);
    });
  });

  test("whoever was added stays left out when the list is opened again, until the place shows another record", async () => {
    const view: ReturnType<typeof render> = render(
      <Harness target={INCIDENT_TARGET} owners={[]} />,
    );

    let dialog: HTMLElement = await openList();

    pick(dialog, BOB);

    await waitFor(() => {
      expect(offered(dialog)).not.toContain(`user:${BOB}`);
    });

    // Closed and opened again, before any read of the owners came back.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add owners" })).toBeNull();
    });

    dialog = await openList();
    expect(offered(dialog)).not.toContain(`user:${BOB}`);

    // Another record: its own owners decide.
    fireEvent.keyDown(document, { key: "Escape" });
    view.rerender(
      <Harness
        target={{
          ...INCIDENT_TARGET,
          resourceId: new ObjectID(OTHER_INCIDENT_ID),
        }}
        owners={[]}
      />,
    );

    dialog = await openList();
    expect(offered(dialog)).toContain(`user:${BOB}`);
  });

  test("a monitor's owners go to the monitor's own owner tables", async () => {
    render(<Harness target={MONITOR_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    pick(dialog, ADA);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: { model: BaseModel; modelType: unknown } = created()[0]!;
    const row: Record<string, unknown> = request.model as unknown as Record<
      string,
      unknown
    >;

    expect(request.modelType).toBe(MonitorOwnerUser);
    expect(String(row["monitorId"])).toBe(MONITOR_ID);
    expect(row["incidentId"]).toBeUndefined();
  });
});

describe("who may add, in the list", () => {
  test("before the permissions are known, people and teams are both offered: the server decides", async () => {
    render(<Harness target={INCIDENT_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    expect(offered(dialog)).toEqual([
      `user:${ADA}`,
      `user:${BOB}`,
      `team:${DATABASE}`,
      `team:${PLATFORM}`,
    ]);
    expect(within(dialog).queryByTestId("people-search-locked-kinds")).toBeNull();
  });

  test("a reader who may add people but not teams finds Teams locked, saying why, and never searched", async () => {
    holdPermissions([Permission.CreateIncidentOwnerUser]);

    render(<Harness target={INCIDENT_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    expect(offered(dialog)).toEqual([`user:${ADA}`, `user:${BOB}`]);

    const locked: Array<HTMLElement> = within(dialog).getAllByTestId(
      "people-search-locked-kind",
    );

    expect(locked).toHaveLength(1);
    expect(locked[0]).toHaveAttribute("data-kind", PeoplePickerKind.Team);
    expect(locked[0]).toHaveAccessibleName("Teams");
    const reason: string =
      within(locked[0]!).getByTestId("people-search-locked-reason")
        .textContent || "";
    expect(reason.startsWith(ADD_OWNER_KIND_REFUSED_SENTENCES.team)).toBe(true);
    expect(reason).toContain("You need one of these permissions:");
    // Teams are not read at all.
    expect(
      getListMock.mock.calls.some((call: Array<any>): boolean => {
        return call[0].modelType === Team;
      }),
    ).toBe(false);
  });

  test("a reader who may add teams but not people finds People locked", async () => {
    holdPermissions([Permission.CreateIncidentOwnerTeam]);

    render(<Harness target={INCIDENT_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    expect(offered(dialog)).toEqual([`team:${DATABASE}`, `team:${PLATFORM}`]);

    const locked: HTMLElement = within(dialog).getByTestId(
      "people-search-locked-kind",
    );

    expect(locked).toHaveAttribute("data-kind", PeoplePickerKind.User);
    expect(locked).toHaveTextContent(ADD_OWNER_KIND_REFUSED_SENTENCES.user);
  });

  test("a monitor's list asks the monitor's owner tables", async () => {
    holdPermissions([Permission.CreateMonitorOwnerTeam]);

    render(<Harness target={MONITOR_TARGET} owners={[]} />);

    const dialog: HTMLElement = await openList();

    // The incident's owner permissions would say nothing here.
    expect(offered(dialog)).toEqual([`team:${DATABASE}`, `team:${PLATFORM}`]);
  });
});

describe("the empty place after a row of owners (AddOwnersPlaceButton)", () => {
  const Place: () => ReactElement = (): ReactElement => {
    const popup: AnchoredFieldPopup = useAddOwnersPopup();

    return (
      <>
        <AddOwnersPlaceButton popup={popup} dataTestId="place" />
        <AddOwnersPopup popup={popup} target={INCIDENT_TARGET} ownerKeys={new Set()} />
      </>
    );
  };

  test("is heard as Add owners, says it opens a dialog, and is lit while its list is open", async () => {
    render(<Place />);

    const place: HTMLElement = screen.getByTestId("place");

    expect(place).toHaveAccessibleName("Add owners");
    expect(place).toHaveAttribute("aria-haspopup", "dialog");
    expect(place).toHaveAttribute("aria-expanded", "false");
    expect(place).toHaveClass("h-6", "w-6", "rounded-full", "border-dashed");
    expect(place).not.toHaveClass(ADD_OWNERS_PLACE_OPEN_CLASS_NAME.split(" ")[0]!);

    fireEvent.click(place);

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    expect(place).toHaveAttribute("aria-expanded", "true");
    expect(place).toHaveAttribute("aria-controls", dialog.id);
    for (const className of ADD_OWNERS_PLACE_OPEN_CLASS_NAME.split(" ")) {
      expect(place).toHaveClass(className);
    }
  });
});

describe("the rules (AddOwners)", () => {
  test("what the list offers: both kinds before the permissions are known, each kind as held after", () => {
    const unknown: OwnerKindAccess = getOwnerKindAccess(INCIDENT_TARGET);

    expect(unknown).toEqual({
      kinds: [PeoplePickerKind.User, PeoplePickerKind.Team],
      locked: [],
    });

    holdPermissions([Permission.ProjectMember]);
    expect(getOwnerKindAccess(INCIDENT_TARGET)).toEqual({
      kinds: [PeoplePickerKind.User, PeoplePickerKind.Team],
      locked: [],
    });

    jest.restoreAllMocks();
    holdPermissions([Permission.CreateIncidentOwnerUser]);
    const peopleOnly: OwnerKindAccess = getOwnerKindAccess(INCIDENT_TARGET);
    expect(peopleOnly.kinds).toEqual([PeoplePickerKind.User]);
    expect(peopleOnly.locked).toHaveLength(1);
    expect(peopleOnly.locked[0]!.kind).toBe(PeoplePickerKind.Team);

    jest.restoreAllMocks();
    holdPermissions([Permission.IncidentViewer]);
    const neither: OwnerKindAccess = getOwnerKindAccess(INCIDENT_TARGET);
    expect(neither.kinds).toEqual([]);
    expect(
      neither.locked.map((locked: { kind: PeoplePickerKind }) => {
        return locked.kind;
      }),
    ).toEqual([PeoplePickerKind.User, PeoplePickerKind.Team]);
    expect(neither.locked[0]!.reason).toContain(
      ADD_OWNER_KIND_REFUSED_SENTENCES.user,
    );
  });

  test("canAddOwners: only once the permissions say so, for either kind", () => {
    // Not on a guess: before the snapshot, nothing offers to add.
    expect(canAddOwners(INCIDENT_TARGET)).toBe(false);

    holdPermissions([Permission.CreateIncidentOwnerTeam]);
    expect(canAddOwners(INCIDENT_TARGET)).toBe(true);
    expect(canAddOwners(MONITOR_TARGET)).toBe(false);

    jest.restoreAllMocks();
    holdPermissions([Permission.IncidentViewer]);
    expect(canAddOwners(INCIDENT_TARGET)).toBe(false);
  });

  test("the gate of an Add owner that stays on screen: open unless the reader may add neither kind, then locked with why", () => {
    expect(getAddOwnersGate(INCIDENT_TARGET)).toEqual({ isAllowed: true });

    holdPermissions([Permission.CreateIncidentOwnerUser]);
    expect(getAddOwnersGate(INCIDENT_TARGET)).toEqual({ isAllowed: true });

    jest.restoreAllMocks();
    holdPermissions([Permission.IncidentViewer]);
    const locked: PermissionGateResult = getAddOwnersGate(INCIDENT_TARGET);

    expect(locked.isAllowed).toBe(false);
    expect(
      locked.disabledReason?.startsWith(ADD_OWNERS_REFUSED_SENTENCE),
    ).toBe(true);
    expect(locked.disabledReason).toContain("You need one of these permissions:");
  });

  test("buildOwnerRow writes the record, the project and the pick, in the kind's table", () => {
    const projectId: ObjectID = new ObjectID(PROJECT_ID);
    const person: { model: BaseModel; modelType: unknown } = buildOwnerRow({
      target: INCIDENT_TARGET,
      option: { kind: PeoplePickerKind.User, id: ADA, name: "Ada Lovelace" },
      projectId: projectId,
    });
    const team: { model: BaseModel; modelType: unknown } = buildOwnerRow({
      target: MONITOR_TARGET,
      option: { kind: PeoplePickerKind.Team, id: PLATFORM, name: "Platform" },
      projectId: projectId,
    });

    expect(person.modelType).toBe(IncidentOwnerUser);
    expect(
      (person.model as unknown as Record<string, unknown>)["userId"],
    ).toBeInstanceOf(ObjectID);
    expect(
      String((person.model as unknown as Record<string, unknown>)["incidentId"]),
    ).toBe(INCIDENT_ID);
    expect(team.modelType).toBe(MonitorOwnerTeam);
    expect(
      String((team.model as unknown as Record<string, unknown>)["teamId"]),
    ).toBe(PLATFORM);
    expect(
      String((team.model as unknown as Record<string, unknown>)["monitorId"]),
    ).toBe(MONITOR_ID);

    // Only people and teams own things.
    expect(() => {
      buildOwnerRow({
        target: INCIDENT_TARGET,
        option: {
          kind: PeoplePickerKind.OnCallSchedule,
          id: PLATFORM,
          name: "Primary",
        },
        projectId: projectId,
      });
    }).toThrow("Only a person or a team can be an owner.");
  });

  test("addOwner needs a project, and writes one row", async () => {
    await addOwner(INCIDENT_TARGET, {
      kind: PeoplePickerKind.User,
      id: BOB,
      name: "Bob Stone",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(created()[0]!.modelType).toBe(IncidentOwnerUser);

    window.history.replaceState({}, "", "/accounts/login");

    await expect(
      addOwner(INCIDENT_TARGET, {
        kind: PeoplePickerKind.User,
        id: BOB,
        name: "Bob Stone",
      }),
    ).rejects.toThrow("Project not found");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("getOwnerKeys: the owners as the list's keys, ids read without case", () => {
    const keys: Set<string> = getOwnerKeys([
      owner("user", ADA.toUpperCase()),
      owner("team", PLATFORM),
      { kind: "team", team: new Team() },
    ]);

    expect(Array.from(keys)).toEqual([
      `${PeoplePickerKind.User}:${ADA}`,
      `${PeoplePickerKind.Team}:${PLATFORM}`,
    ]);
    expect(getOwnerKeys(undefined).size).toBe(0);
  });
});
