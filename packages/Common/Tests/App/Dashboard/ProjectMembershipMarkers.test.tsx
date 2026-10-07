import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,YXZhdGFy";
});

import UserElement from "../../../../App/FeatureSet/Dashboard/src/Components/User/User";
import ProjectUserElement from "../../../../App/FeatureSet/Dashboard/src/Components/User/ProjectUserElement";
import ProjectMembershipLoaderInstance, {
  PROJECT_MEMBERSHIP_READ_PERMISSIONS,
  ProjectMemberReader,
  ProjectMemberships,
  ProjectMembershipAnswer,
  ProjectMembershipLoader,
  ProjectMembershipStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectMembershipLoader";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Nobody who is not a member of a project is notified on its behalf any
 * more (the server's ProjectMembership check). Where a page names somebody -
 * an owner, someone in an on-call layer, the user an incoming call rule
 * rings, either side of an override - it says "No longer a member" for
 * somebody who has left, and "Invitation not accepted yet" for somebody who
 * has not joined yet, so whoever looks after the setup knows what to do.
 *
 * Pinned here:
 *   - the loader answers every row of a page with ONE read, keeps answers for
 *     a minute, and answers null ("say nothing") whenever it cannot know,
 *   - the user row shows the right line in place of the email,
 *   - the wrapper asks about the person in the current project, again when
 *     the project changes, and marks them only on a definite answer.
 */

const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-000000000002";
const MEMBER: string = "10000000-0000-4000-8000-000000000001";
const LEAVER: string = "20000000-0000-4000-8000-000000000002";
const OTHER_MEMBER: string = "30000000-0000-4000-8000-000000000003";
const INVITEE: string = "40000000-0000-4000-8000-000000000004";

type ReadCall = { projectId: string; userIds: Array<string> };

function fakeReader(data: {
  members: Array<string>;
  invited?: Array<string>;
}): {
  reader: ProjectMemberReader;
  calls: Array<ReadCall>;
} {
  const calls: Array<ReadCall> = [];

  const reader: ProjectMemberReader = async (ask: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<ProjectMemberships> => {
    calls.push({
      projectId: ask.projectId.toString(),
      userIds: [...ask.userIds].sort(),
    });

    return {
      members: new Set<string>(
        ask.userIds.filter((userId: string): boolean => {
          return data.members.includes(userId);
        }),
      ),
      invited: new Set<string>(
        ask.userIds.filter((userId: string): boolean => {
          return (data.invited || []).includes(userId);
        }),
      ),
    };
  };

  return { reader, calls };
}

function alwaysAllowed(): boolean {
  return true;
}

describe("ProjectMembershipLoader", () => {
  test("every ask made while a page renders is answered with one read per project", async () => {
    const { reader, calls } = fakeReader({
      members: [MEMBER, OTHER_MEMBER],
      invited: [INVITEE],
    });
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      alwaysAllowed,
    );

    const answers: Array<ProjectMembershipAnswer> = await Promise.all([
      loader.getMembership({ projectId: PROJECT_A, userId: MEMBER }),
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
      loader.getMembership({ projectId: PROJECT_A, userId: INVITEE }),
      loader.getMembership({ projectId: PROJECT_A, userId: OTHER_MEMBER }),
      // The same person twice is asked once.
      loader.getMembership({
        projectId: PROJECT_A,
        userId: MEMBER.toUpperCase(),
      }),
      loader.getMembership({ projectId: PROJECT_B, userId: MEMBER }),
    ]);

    expect(answers).toEqual([
      ProjectMembershipStatus.Member,
      ProjectMembershipStatus.NotMember,
      ProjectMembershipStatus.Invited,
      ProjectMembershipStatus.Member,
      ProjectMembershipStatus.Member,
      ProjectMembershipStatus.Member,
    ]);
    expect(calls).toEqual([
      {
        projectId: PROJECT_A,
        userIds: [MEMBER, LEAVER, INVITEE, OTHER_MEMBER].sort(),
      },
      { projectId: PROJECT_B, userIds: [MEMBER] },
    ]);
  });

  test("an answer is kept for a minute, then asked again", async () => {
    const { reader, calls } = fakeReader({ members: [MEMBER] });
    let now: number = 1_000_000;
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      alwaysAllowed,
      () => {
        return now;
      },
    );

    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(ProjectMembershipStatus.NotMember);

    now += 30 * 1000;
    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(ProjectMembershipStatus.NotMember);
    expect(calls).toHaveLength(1);

    now += 31 * 1000;
    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(ProjectMembershipStatus.NotMember);
    expect(calls).toHaveLength(2);
  });

  test("a reader who cannot see every membership is told nothing, and nothing is read", async () => {
    const { reader, calls } = fakeReader({ members: [] });
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      () => {
        return false;
      },
    );

    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("no project, no person, or ids that are not ids: nothing is read", async () => {
    const { reader, calls } = fakeReader({ members: [] });
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      alwaysAllowed,
    );

    await expect(
      loader.getMembership({ projectId: null, userId: LEAVER }),
    ).resolves.toBeNull();
    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: undefined }),
    ).resolves.toBeNull();
    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: "not-an-id" }),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("a failed read says nothing, and is not kept: the next render asks again", async () => {
    let failures: number = 1;
    const calls: Array<string> = [];
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      async (data: {
        projectId: ObjectID;
        userIds: Array<string>;
      }): Promise<ProjectMemberships> => {
        calls.push(data.projectId.toString());

        if (failures > 0) {
          failures -= 1;
          throw new Error("offline");
        }

        return { members: new Set<string>(), invited: new Set<string>() };
      },
      alwaysAllowed,
    );

    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBeNull();
    await expect(
      loader.getMembership({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(ProjectMembershipStatus.NotMember);
    expect(calls).toHaveLength(2);
  });

  test("only grants that see every membership count, never the person's own", () => {
    expect(PROJECT_MEMBERSHIP_READ_PERMISSIONS).not.toContain(
      Permission.CurrentUser,
    );
    expect(PROJECT_MEMBERSHIP_READ_PERMISSIONS).toContain(
      Permission.ReadProjectTeam,
    );
  });
});

describe("UserElement - somebody nothing of the project reaches", () => {
  test("no longer a member: says so in place of the email, and fades the avatar", () => {
    render(
      <UserElement
        user={{ _id: LEAVER, name: "Jane Doe", email: "jane@acme.com" }}
        isNotProjectMember={true}
      />,
    );

    expect(screen.getByTestId("user-not-project-member")).toHaveTextContent(
      "No longer a member",
    );
    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getAllByRole("img")[0]!.parentElement).toHaveClass(
      "opacity-50",
      "grayscale",
    );
  });

  test("invited and not accepted yet: says that instead", () => {
    render(
      <UserElement
        user={{ _id: INVITEE, name: "Sam Roe", email: "sam@acme.com" }}
        hasPendingProjectInvitation={true}
      />,
    );

    expect(
      screen.getByTestId("user-project-invitation-pending"),
    ).toHaveTextContent("Invitation not accepted yet");
    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")[0]!.parentElement).toHaveClass(
      "opacity-50",
    );
  });

  test("a member looks as before", () => {
    render(
      <UserElement
        user={{ _id: MEMBER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("user-project-invitation-pending"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("user-email")).toHaveTextContent("jane@acme.com");
    expect(screen.getAllByRole("img")[0]!.parentElement).not.toHaveClass(
      "opacity-50",
    );
  });
});

describe("ProjectUserElement", () => {
  let getMembership: SpyInstance<
    typeof ProjectMembershipLoaderInstance.getMembership
  >;
  let currentProject: string;

  beforeEach(() => {
    currentProject = PROJECT_A;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
      return new ObjectID(currentProject);
    });
    getMembership = jest.spyOn(
      ProjectMembershipLoaderInstance,
      "getMembership",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("marks somebody who has left the current project", async () => {
    getMembership.mockResolvedValue(ProjectMembershipStatus.NotMember);

    render(
      <ProjectUserElement
        user={{ _id: LEAVER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-not-project-member")).toBeInTheDocument();
    });

    expect(getMembership).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      userId: LEAVER,
    });
  });

  test("marks somebody invited who has not accepted yet", async () => {
    getMembership.mockResolvedValue(ProjectMembershipStatus.Invited);

    render(
      <ProjectUserElement
        user={{ _id: INVITEE, name: "Sam Roe", email: "sam@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("user-project-invitation-pending"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
  });

  test("a member is not marked", async () => {
    getMembership.mockResolvedValue(ProjectMembershipStatus.Member);

    render(
      <ProjectUserElement
        user={{ _id: MEMBER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(getMembership).toHaveBeenCalled();
    });

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("user-email")).toBeInTheDocument();
  });

  test("while it is not known, nobody is marked", async () => {
    getMembership.mockResolvedValue(null);

    render(
      <ProjectUserElement
        user={{ _id: LEAVER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(getMembership).toHaveBeenCalled();
    });

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
  });

  test("switching projects asks again, about the new project", async () => {
    getMembership.mockResolvedValue(ProjectMembershipStatus.Member);

    const { rerender } = render(
      <ProjectUserElement
        user={{ _id: MEMBER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(getMembership).toHaveBeenCalledTimes(1);
    });

    currentProject = PROJECT_B;
    getMembership.mockResolvedValue(ProjectMembershipStatus.NotMember);

    rerender(
      <ProjectUserElement
        user={{ _id: MEMBER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-not-project-member")).toBeInTheDocument();
    });

    expect(getMembership).toHaveBeenLastCalledWith({
      projectId: PROJECT_B,
      userId: MEMBER,
    });
  });
});
