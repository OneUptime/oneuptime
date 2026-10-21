import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A project's new single sign-on provider starts on the team the project's
 * members join (Dashboard/src/Components/Sso/UseDefaultSsoTeams): the same
 * team Invite User starts on (Utils/DefaultInviteTeam - its own suite tests
 * which team that is, and that only a team the person may hand on is
 * picked). Someone signing in for the first time with a provider that has
 * no teams stops at "No teams added", so the form asked for teams with
 * nothing picked; now it opens with that team picked, and can be changed.
 *
 * Looked up once, when the page opens. A lookup that finds nothing, fails,
 * or ends after the page has gone leaves the form with nothing picked.
 */

interface LookupCall {
  projectId: string | null;
}

const mockLookup: {
  calls: Array<LookupCall>;
  answer: () => Promise<{ id: string; name: string } | null>;
} = {
  calls: [],
  answer: async (): Promise<null> => {
    return null;
  },
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam",
    ) as Record<string, unknown>;

    return {
      ...actual,
      findDefaultInviteTeam: (data: {
        projectId: { toString: () => string } | null;
      }): Promise<{ id: string; name: string } | null> => {
        mockLookup.calls.push({
          projectId: data.projectId ? data.projectId.toString() : null,
        });

        return mockLookup.answer();
      },
    };
  },
);

import {
  getDefaultSsoTeamsInitialValues,
  useDefaultSsoTeamsInitialValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/UseDefaultSsoTeams";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ObjectID from "../../../Types/ObjectID";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "0c000000-0000-4000-8000-000000000001";
const MEMBERS_TEAM_ID: string = "0c000000-0000-4000-8000-0000000000a1";

// Every value the hook hands back, render by render.
let seen: Array<FormValues<ProjectOIDC> | undefined> = [];

function Probe(props: { tick?: number | undefined }): ReactElement {
  const values: FormValues<ProjectOIDC> | undefined =
    useDefaultSsoTeamsInitialValues<ProjectOIDC>();

  seen.push(values);

  return (
    <div data-testid="probe" data-tick={String(props.tick || 0)}>
      {JSON.stringify(values || null)}
    </div>
  );
}

beforeEach(() => {
  seen = [];
  mockLookup.calls = [];
  mockLookup.answer = async (): Promise<null> => {
    return null;
  };

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("getDefaultSsoTeamsInitialValues", () => {
  test("starts the teams on the team found", () => {
    expect(
      getDefaultSsoTeamsInitialValues<ProjectOIDC>({
        id: MEMBERS_TEAM_ID,
        name: "Members",
      }),
    ).toEqual({ teams: [MEMBERS_TEAM_ID] });
  });

  test("starts with nothing when no team was found", () => {
    expect(getDefaultSsoTeamsInitialValues<ProjectOIDC>(null)).toBeUndefined();
    expect(
      getDefaultSsoTeamsInitialValues<ProjectOIDC>({ id: "", name: "Members" }),
    ).toBeUndefined();
  });
});

describe("useDefaultSsoTeamsInitialValues", () => {
  test("looks the team up once, for the current project, and hands it to the form", async () => {
    mockLookup.answer = async (): Promise<{ id: string; name: string }> => {
      return { id: MEMBERS_TEAM_ID, name: "Members" };
    };

    const { rerender } = render(<Probe tick={1} />);

    // Nothing picked until the answer is in.
    expect(seen[0]).toBeUndefined();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("probe")).toHaveTextContent(
      JSON.stringify({ teams: [MEMBERS_TEAM_ID] }),
    );

    const handedOver: FormValues<ProjectOIDC> | undefined =
      seen[seen.length - 1];

    // Re-renders hand the form the same object, and look nothing up again.
    rerender(<Probe tick={2} />);
    rerender(<Probe tick={3} />);

    expect(seen[seen.length - 1]).toBe(handedOver);
    expect(mockLookup.calls).toEqual([{ projectId: PROJECT_ID }]);
  });

  test("leaves the form with nothing picked when there is no team to start on", async () => {
    render(<Probe />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("null");
    expect(mockLookup.calls).toHaveLength(1);
  });

  test("leaves the form with nothing picked when the lookup fails", async () => {
    mockLookup.answer = async (): Promise<null> => {
      throw new Error("no permission to read teams");
    };

    render(<Probe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("null");
  });

  test("an answer that comes after the page has gone changes nothing", async () => {
    let resolveLookup: (team: { id: string; name: string }) => void = () => {
      // Replaced below.
    };

    mockLookup.answer = (): Promise<{ id: string; name: string }> => {
      return new Promise<{ id: string; name: string }>(
        (resolve: (team: { id: string; name: string }) => void) => {
          resolveLookup = resolve;
        },
      );
    };

    const errors: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      console,
      "error",
    );

    const { unmount } = render(<Probe />);
    const rendersBefore: number = seen.length;

    unmount();

    await act(async () => {
      resolveLookup({ id: MEMBERS_TEAM_ID, name: "Members" });
      await Promise.resolve();
    });

    expect(seen).toHaveLength(rendersBefore);
    expect(errors).not.toHaveBeenCalled();
  });
});
