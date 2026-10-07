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
  ProjectMembershipAnswer,
  ProjectMembershipLoader,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectMembershipLoader";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Somebody who has left a project is never notified on its behalf any more
 * (the server's ProjectMembership check). Where a page names them - an owner,
 * someone in an on-call layer, the user an incoming call rule rings, either
 * side of an override - it says "No longer a member", so whoever looks after
 * the setup knows to replace them.
 *
 * Pinned here:
 *   - the loader answers every row of a page with ONE read, keeps answers for
 *     a minute, and answers null ("say nothing") whenever it cannot prove
 *     somebody is not a member,
 *   - the user row shows the marker in place of the email,
 *   - the wrapper asks about the person in the current project and marks
 *     them only on a definite "no".
 */

const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-000000000002";
const MEMBER: string = "10000000-0000-4000-8000-000000000001";
const LEAVER: string = "20000000-0000-4000-8000-000000000002";
const OTHER_MEMBER: string = "30000000-0000-4000-8000-000000000003";

type ReadCall = { projectId: string; userIds: Array<string> };

function fakeReader(members: Array<string>): {
  reader: ProjectMemberReader;
  calls: Array<ReadCall>;
} {
  const calls: Array<ReadCall> = [];

  const reader: ProjectMemberReader = async (data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<Set<string>> => {
    calls.push({
      projectId: data.projectId.toString(),
      userIds: [...data.userIds].sort(),
    });

    return new Set<string>(
      data.userIds.filter((userId: string): boolean => {
        return members.includes(userId);
      }),
    );
  };

  return { reader, calls };
}

describe("ProjectMembershipLoader", () => {
  test("every ask made while a page renders is answered with one read per project", async () => {
    const { reader, calls } = fakeReader([MEMBER, OTHER_MEMBER]);
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      () => {
        return true;
      },
    );

    const answers: Array<ProjectMembershipAnswer> = await Promise.all([
      loader.isMember({ projectId: PROJECT_A, userId: MEMBER }),
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
      loader.isMember({ projectId: PROJECT_A, userId: OTHER_MEMBER }),
      // The same person twice is asked once.
      loader.isMember({ projectId: PROJECT_A, userId: MEMBER.toUpperCase() }),
      loader.isMember({ projectId: PROJECT_B, userId: MEMBER }),
    ]);

    expect(answers).toEqual([true, false, true, true, true]);
    expect(calls).toEqual([
      { projectId: PROJECT_A, userIds: [MEMBER, LEAVER, OTHER_MEMBER].sort() },
      { projectId: PROJECT_B, userIds: [MEMBER] },
    ]);
  });

  test("an answer is kept for a minute, then asked again", async () => {
    const { reader, calls } = fakeReader([MEMBER]);
    let now: number = 1_000_000;
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      () => {
        return true;
      },
      () => {
        return now;
      },
    );

    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(false);

    now += 30 * 1000;
    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(1);

    now += 31 * 1000;
    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(2);

    // After the people on a page changed, clear() asks again at once.
    loader.clear();
    await loader.isMember({ projectId: PROJECT_A, userId: LEAVER });
    expect(calls).toHaveLength(3);
  });

  test("a reader who cannot see every membership is told nothing, and nothing is read", async () => {
    const { reader, calls } = fakeReader([]);
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      () => {
        return false;
      },
    );

    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("no project, no person, or ids that are not ids: nothing is read", async () => {
    const { reader, calls } = fakeReader([]);
    const loader: ProjectMembershipLoader = new ProjectMembershipLoader(
      reader,
      () => {
        return true;
      },
    );

    await expect(
      loader.isMember({ projectId: null, userId: LEAVER }),
    ).resolves.toBeNull();
    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: undefined }),
    ).resolves.toBeNull();
    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: "not-an-id" }),
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
      }): Promise<Set<string>> => {
        calls.push(data.projectId.toString());

        if (failures > 0) {
          failures -= 1;
          throw new Error("offline");
        }

        return new Set<string>();
      },
      () => {
        return true;
      },
    );

    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBeNull();
    await expect(
      loader.isMember({ projectId: PROJECT_A, userId: LEAVER }),
    ).resolves.toBe(false);
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

describe("UserElement - somebody who is no longer a member", () => {
  test("says so in place of the email, and fades the avatar", () => {
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

  test("a member looks as before", () => {
    render(
      <UserElement
        user={{ _id: MEMBER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("user-email")).toHaveTextContent("jane@acme.com");
    expect(screen.getAllByRole("img")[0]!.parentElement).not.toHaveClass(
      "opacity-50",
    );
  });
});

describe("ProjectUserElement", () => {
  let isMember: SpyInstance<typeof ProjectMembershipLoaderInstance.isMember>;

  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_A));
    isMember = jest.spyOn(ProjectMembershipLoaderInstance, "isMember");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("marks somebody who has left the current project", async () => {
    isMember.mockResolvedValue(false);

    render(
      <ProjectUserElement
        user={{ _id: LEAVER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-not-project-member")).toBeInTheDocument();
    });

    expect(isMember).toHaveBeenCalledWith({
      projectId: new ObjectID(PROJECT_A),
      userId: LEAVER,
    });
  });

  test("a member is not marked", async () => {
    isMember.mockResolvedValue(true);

    render(
      <ProjectUserElement
        user={{ _id: MEMBER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(isMember).toHaveBeenCalled();
    });

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("user-email")).toBeInTheDocument();
  });

  test("while it is not known, nobody is marked", async () => {
    isMember.mockResolvedValue(null);

    render(
      <ProjectUserElement
        user={{ _id: LEAVER, name: "Jane Doe", email: "jane@acme.com" }}
      />,
    );

    await waitFor(() => {
      expect(isMember).toHaveBeenCalled();
    });

    expect(
      screen.queryByTestId("user-not-project-member"),
    ).not.toBeInTheDocument();
  });
});
