import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident's (and an incident episode's) roles card is where the
 * overview's header learns who commands the response: it reports the
 * roles and who holds them each time it reads them - on load and after a
 * change made in it - so the header names the commander without a read of
 * its own, and follows a reassignment at once. The header's Assign gives
 * the commander right where it names them (assignIncidentRole /
 * assignIncidentEpisodeRole, the card's own way to give a role), and the
 * card reads its roles again when told (refreshToken) to show the same.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const projectUsersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: (...args: Array<unknown>) => {
        return projectUsersMock(...args);
      },
    },
  };
});

/*
 * The card's own drawing is MemberRoleAssignment's suites'; here it records
 * what it was handed, so a test can assign through it.
 */
const memberRoleProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../UI/Components/MemberRoleAssignment/MemberRoleAssignment",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        memberRoleProps.push(props);
        return React.createElement("div", { "data-testid": "roles-card" });
      },
    };
  },
);

import IncidentMemberRoleAssignment from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentMemberRoleAssignment";
import IncidentEpisodeMemberRoleAssignment from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment";
import {
  assignIncidentEpisodeRole,
  assignIncidentRole,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventRoleAssignment";
import { EventRolesSnapshot } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventPeople";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";
const EPISODE_ID: string = "50000000-0000-4000-8000-000000000012";
const COMMANDER_ROLE_ID: string = "76000000-0000-4000-8000-000000000001";
const SCRIBE_ROLE_ID: string = "76000000-0000-4000-8000-000000000003";
const MAYA_ID: string = "80000000-0000-4000-8000-000000000001";
const SAM_ID: string = "80000000-0000-4000-8000-000000000002";

function role(
  id: string,
  name: string,
  isPrimaryRole: boolean,
  isArchived: boolean = false,
): IncidentRole {
  const record: IncidentRole = new IncidentRole();
  record.id = new ObjectID(id);
  record.name = name;
  record.isPrimaryRole = isPrimaryRole;
  record.isArchived = isArchived;
  if (isPrimaryRole) {
    record.roleIcon = IconProp.ShieldCheck;
  }
  return record;
}

function person(id: string, name: string, hasPicture: boolean): User {
  const user: User = new User();
  user.id = new ObjectID(id);
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@acme.example`);
  if (hasPicture) {
    user.profilePictureId = new ObjectID(
      "90000000-0000-4000-8000-000000000001",
    );
  }
  return user;
}

function incidentMember(roleId: string, user: User): IncidentMember {
  const member: IncidentMember = new IncidentMember();
  member.id = new ObjectID("91000000-0000-4000-8000-000000000001");
  member.incidentRoleId = new ObjectID(roleId);
  member.userId = user.id!;
  member.user = user;
  return member;
}

function episodeMember(roleId: string, user: User): IncidentEpisodeRoleMember {
  const member: IncidentEpisodeRoleMember = new IncidentEpisodeRoleMember();
  member.id = new ObjectID("91000000-0000-4000-8000-000000000002");
  member.incidentRoleId = new ObjectID(roleId);
  member.userId = user.id!;
  member.user = user;
  return member;
}

let members: Array<IncidentMember | IncidentEpisodeRoleMember> = [];

function list(data: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: 100 };
}

beforeEach(() => {
  members = [];
  memberRoleProps.length = 0;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  projectUsersMock.mockImplementation(() => {
    return Promise.resolve([]);
  });
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentRole) {
      return Promise.resolve(
        list([
          role(COMMANDER_ROLE_ID, "Incident Commander", true),
          role(SCRIBE_ROLE_ID, "Scribe", false),
        ]),
      );
    }

    return Promise.resolve(list(members));
  });
  createMock.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createMock.mockReset();
  deleteItemMock.mockReset();
  projectUsersMock.mockReset();
  jest.restoreAllMocks();
});

describe.each([
  {
    name: "an incident's roles card",
    recordId: INCIDENT_ID,
    member: incidentMember,
    memberModel: IncidentMember,
    recordField: "incidentId",
    cardElement: (
      onRolesLoaded: (recordId: string, snapshot: EventRolesSnapshot) => void,
      refreshToken?: number,
    ): React.ReactElement => {
      return (
        <IncidentMemberRoleAssignment
          incidentId={new ObjectID(INCIDENT_ID)}
          onRolesLoaded={onRolesLoaded}
          refreshToken={refreshToken}
        />
      );
    },
    assignRole: (userId: string, roleId: string): Promise<void> => {
      return assignIncidentRole({
        incidentId: new ObjectID(INCIDENT_ID),
        userId: new ObjectID(userId),
        roleId: new ObjectID(roleId),
      });
    },
  },
  {
    name: "an incident episode's roles card",
    recordId: EPISODE_ID,
    member: episodeMember,
    memberModel: IncidentEpisodeRoleMember,
    recordField: "incidentEpisodeId",
    cardElement: (
      onRolesLoaded: (recordId: string, snapshot: EventRolesSnapshot) => void,
      refreshToken?: number,
    ): React.ReactElement => {
      return (
        <IncidentEpisodeMemberRoleAssignment
          incidentEpisodeId={new ObjectID(EPISODE_ID)}
          onRolesLoaded={onRolesLoaded}
          refreshToken={refreshToken}
        />
      );
    },
    assignRole: (userId: string, roleId: string): Promise<void> => {
      return assignIncidentEpisodeRole({
        incidentEpisodeId: new ObjectID(EPISODE_ID),
        userId: new ObjectID(userId),
        roleId: new ObjectID(roleId),
      });
    },
  },
])(
  "$name",
  (card: {
    recordId: string;
    member: (
      roleId: string,
      user: User,
    ) => IncidentMember | IncidentEpisodeRoleMember;
    memberModel: unknown;
    recordField: string;
    cardElement: (
      onRolesLoaded: (recordId: string, snapshot: EventRolesSnapshot) => void,
      refreshToken?: number,
    ) => React.ReactElement;
    assignRole: (userId: string, roleId: string) => Promise<void>;
  }) => {
    const renderCard: (
      onRolesLoaded: (recordId: string, snapshot: EventRolesSnapshot) => void,
      refreshToken?: number,
    ) => RenderResult = (
      onRolesLoaded: (recordId: string, snapshot: EventRolesSnapshot) => void,
      refreshToken?: number,
    ): RenderResult => {
      return render(card.cardElement(onRolesLoaded, refreshToken));
    };

    test("reports the roles and who holds them, stamped with its record", async () => {
      members = [
        card.member(COMMANDER_ROLE_ID, person(MAYA_ID, "Maya Chen", true)),
        card.member(SCRIBE_ROLE_ID, person(SAM_ID, "Sam Rivera", false)),
      ];
      const reports: Array<[string, EventRolesSnapshot]> = [];

      renderCard((recordId: string, snapshot: EventRolesSnapshot) => {
        reports.push([recordId, snapshot]);
      });

      await waitFor(() => {
        expect(reports).toHaveLength(1);
      });

      const [recordId, snapshot] = reports[0]!;

      expect(recordId).toBe(card.recordId);
      expect(snapshot.roles).toEqual([
        {
          id: COMMANDER_ROLE_ID,
          name: "Incident Commander",
          isPrimaryRole: true,
          icon: IconProp.ShieldCheck,
        },
        {
          id: SCRIBE_ROLE_ID,
          name: "Scribe",
          isPrimaryRole: false,
          icon: undefined,
        },
      ]);
      expect(snapshot.members).toEqual([
        {
          roleId: COMMANDER_ROLE_ID,
          userId: MAYA_ID,
          name: "Maya Chen",
          email: "maya@acme.example",
          hasProfilePicture: true,
        },
        {
          roleId: SCRIBE_ROLE_ID,
          userId: SAM_ID,
          name: "Sam Rivera",
          email: "sam@acme.example",
          hasProfilePicture: false,
        },
      ]);
    });

    test("reports again after a change made in it, so the header follows at once", async () => {
      const reports: Array<EventRolesSnapshot> = [];

      renderCard((_recordId: string, snapshot: EventRolesSnapshot) => {
        reports.push(snapshot);
      });

      await waitFor(() => {
        expect(reports).toHaveLength(1);
      });

      expect(reports[0]!.members).toEqual([]);

      members = [
        card.member(COMMANDER_ROLE_ID, person(MAYA_ID, "Maya Chen", false)),
      ];

      const onAssignMember: (
        userId: ObjectID,
        roleId: ObjectID,
      ) => Promise<void> = memberRoleProps[memberRoleProps.length - 1]![
        "onAssignMember"
      ] as (userId: ObjectID, roleId: ObjectID) => Promise<void>;

      await onAssignMember(
        new ObjectID(MAYA_ID),
        new ObjectID(COMMANDER_ROLE_ID),
      );

      await waitFor(() => {
        expect(reports).toHaveLength(2);
      });

      expect(
        reports[1]!.members.map((member: { name: string }) => {
          return member.name;
        }),
      ).toEqual(["Maya Chen"]);
    });

    test("a read that fails reports nothing, so the header names no commander", async () => {
      getListMock.mockImplementation(() => {
        return Promise.reject(new Error("No permission to read roles."));
      });

      const reports: Array<EventRolesSnapshot> = [];

      renderCard((_recordId: string, snapshot: EventRolesSnapshot) => {
        reports.push(snapshot);
      });

      await waitFor(() => {
        expect(memberRoleProps[memberRoleProps.length - 1]!["error"]).toBe(
          "No permission to read roles.",
        );
      });

      expect(reports).toEqual([]);
    });

    test("draws no wrapper of its own: nothing takes the reader to it any more", () => {
      const view: RenderResult = renderCard(() => {});

      expect(view.container.firstElementChild).toBe(
        view.getByTestId("roles-card"),
      );
      expect(view.container.querySelector("[tabindex]")).toBeNull();
      // Nor does the card take a request to open a picker from outside it.
      expect(
        memberRoleProps[memberRoleProps.length - 1]!["assignRequest"],
      ).toBeUndefined();
    });

    test("reads its roles again when the header gave one, and reports what it read", async () => {
      const reports: Array<EventRolesSnapshot> = [];
      const onRolesLoaded: (
        recordId: string,
        snapshot: EventRolesSnapshot,
      ) => void = (_recordId: string, snapshot: EventRolesSnapshot): void => {
        reports.push(snapshot);
      };

      const view: RenderResult = renderCard(onRolesLoaded, 0);

      await waitFor(() => {
        expect(reports).toHaveLength(1);
      });

      expect(reports[0]!.members).toEqual([]);

      // The header gave the commander to Maya.
      members = [
        card.member(COMMANDER_ROLE_ID, person(MAYA_ID, "Maya Chen", false)),
      ];
      view.rerender(card.cardElement(onRolesLoaded, 1));

      await waitFor(() => {
        expect(reports).toHaveLength(2);
      });

      expect(
        reports[1]!.members.map((member: { name: string }) => {
          return member.name;
        }),
      ).toEqual(["Maya Chen"]);

      // The same token again reads nothing new.
      view.rerender(card.cardElement(onRolesLoaded, 1));
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
      expect(reports).toHaveLength(2);
    });

    test("gives a role as the card's own Assign does: one row naming the record, the project, the person and the role", async () => {
      await card.assignRole(SAM_ID, COMMANDER_ROLE_ID);

      expect(createMock).toHaveBeenCalledTimes(1);

      const request: { model: Record<string, unknown>; modelType: unknown } =
        createMock.mock.calls[0]![0] as {
          model: Record<string, unknown>;
          modelType: unknown;
        };

      expect(request.modelType).toBe(card.memberModel);
      expect(String(request.model[card.recordField])).toBe(card.recordId);
      expect(String(request.model["projectId"])).toBe(PROJECT_ID);
      expect(String(request.model["userId"])).toBe(SAM_ID);
      expect(String(request.model["incidentRoleId"])).toBe(COMMANDER_ROLE_ID);
    });

    test("giving a role is refused with the server's reason, and outside a project", async () => {
      createMock.mockImplementation(() => {
        return Promise.reject(new Error("This user already has this role."));
      });

      await expect(card.assignRole(SAM_ID, COMMANDER_ROLE_ID)).rejects.toThrow(
        "This user already has this role.",
      );

      jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

      await expect(card.assignRole(SAM_ID, COMMANDER_ROLE_ID)).rejects.toThrow(
        "Project ID not found",
      );
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    test("the card's own Assign gives the role the same way", async () => {
      renderCard(() => {});

      await waitFor(() => {
        expect(memberRoleProps.length).toBeGreaterThan(0);
      });

      const onAssignMember: (
        userId: ObjectID,
        roleId: ObjectID,
      ) => Promise<void> = memberRoleProps[memberRoleProps.length - 1]![
        "onAssignMember"
      ] as (userId: ObjectID, roleId: ObjectID) => Promise<void>;

      await onAssignMember(new ObjectID(SAM_ID), new ObjectID(SCRIBE_ROLE_ID));

      const request: { model: Record<string, unknown>; modelType: unknown } =
        createMock.mock.calls[0]![0] as {
          model: Record<string, unknown>;
          modelType: unknown;
        };

      expect(request.modelType).toBe(card.memberModel);
      expect(String(request.model[card.recordField])).toBe(card.recordId);
      expect(String(request.model["incidentRoleId"])).toBe(SCRIBE_ROLE_ID);
    });
  },
);
