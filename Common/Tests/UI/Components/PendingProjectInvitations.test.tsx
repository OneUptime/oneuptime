import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The card a freshly signed-up user is shown when somebody has already invited
 * them to a project. It is the whole of that person's first screen, and it is
 * the only place in the product where accepting an invitation is one press -
 * so what it sends when they press it is worth pinning precisely.
 *
 * Two things about it are easy to get silently wrong and are covered hardest:
 *
 *   - A person invited to three teams of one project has three TeamMember
 *     rows and ONE invitation. If the grouping is lost, they are asked to
 *     accept the same company three times; if accepting only updates the row
 *     the card was folded from, they join one team and the other two stay
 *     pending with nothing on screen to say so.
 *   - The query has to reach across tenants and has to exclude invitations
 *     already accepted. Scoping it to the selected project returns nothing at
 *     all on the welcome page, where no project is selected - and "nothing"
 *     is exactly what a user with no invitations sees, so the bug looks like
 *     the empty case.
 */

/*
 * react-i18next is not initialized in the test environment. Mock the hook so
 * translate helpers echo their input and the component renders synchronously.
 */
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
 * Declared before jest.mock but dereferenced inside the factory: ts-jest
 * hoists the jest.mock call above these initializers, so naming the mocks
 * directly in the factory would capture undefined.
 */
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

const USER_ID: string = "99999999-9999-4999-8999-999999999999";

/*
 * The signed-in user is read out of a cookie, which jsdom has none of. Only
 * getUserId is stubbed - it is the whole of what the component asks for, and
 * the id it returns is what the query below is asserted against.
 *
 * ObjectID is referenced through the import further down rather than required
 * in here: the factory only builds the object when the module is first loaded,
 * and getUserId is not called until a render, by which point every import in
 * this file has run.
 */
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return new ObjectID(USER_ID);
      },
    },
  };
});

import PendingProjectInvitations from "../../../UI/Components/ProjectInvitations/PendingProjectInvitations";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";

const ACME_PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const GLOBEX_PROJECT_ID: string = "11111111-1111-4111-8111-111111111112";
const ENGINEERING_TEAM_ID: string = "22222222-2222-4222-8222-222222222221";
const ON_CALL_TEAM_ID: string = "22222222-2222-4222-8222-222222222222";
const OWNERS_TEAM_ID: string = "22222222-2222-4222-8222-222222222223";
const MEMBERSHIP_ONE_ID: string = "33333333-3333-4333-8333-333333333331";
const MEMBERSHIP_TWO_ID: string = "33333333-3333-4333-8333-333333333332";
const MEMBERSHIP_THREE_ID: string = "33333333-3333-4333-8333-333333333333";

interface MembershipSeed {
  id: string;
  projectId: string;
  projectName?: string | undefined;
  teamId?: string | undefined;
  teamName?: string | undefined;
  createdAt?: Date | undefined;
}

type MakeMembershipFunction = (seed: MembershipSeed) => TeamMember;

const makeMembership: MakeMembershipFunction = (
  seed: MembershipSeed,
): TeamMember => {
  const membership: TeamMember = new TeamMember();
  membership._id = seed.id;
  membership.projectId = new ObjectID(seed.projectId);
  membership.hasAcceptedInvitation = false;

  if (seed.createdAt) {
    membership.createdAt = seed.createdAt;
  }

  const project: Project = new Project();
  project._id = seed.projectId;

  if (seed.projectName) {
    project.name = seed.projectName;
  }

  membership.project = project;

  if (seed.teamId) {
    membership.teamId = new ObjectID(seed.teamId);

    const team: Team = new Team();
    team._id = seed.teamId;

    if (seed.teamName) {
      team.name = seed.teamName;
    }

    membership.team = team;
  }

  return membership;
};

type ListOfFunction = (
  memberships: Array<TeamMember>,
) => ListResult<TeamMember>;

const listOf: ListOfFunction = (
  memberships: Array<TeamMember>,
): ListResult<TeamMember> => {
  return {
    data: memberships,
    count: memberships.length,
    skip: 0,
    limit: 10,
  };
};

/* One invitation to Acme, on the Engineering team. */
const ONE_INVITATION: Array<TeamMember> = [
  makeMembership({
    id: MEMBERSHIP_ONE_ID,
    projectId: ACME_PROJECT_ID,
    projectName: "Acme Rockets",
    teamId: ENGINEERING_TEAM_ID,
    teamName: "Engineering",
  }),
];

/* One invitation to Acme, folded from two team memberships. */
const TWO_TEAMS_ONE_PROJECT: Array<TeamMember> = [
  makeMembership({
    id: MEMBERSHIP_ONE_ID,
    projectId: ACME_PROJECT_ID,
    projectName: "Acme Rockets",
    teamId: ENGINEERING_TEAM_ID,
    teamName: "Engineering",
  }),
  makeMembership({
    id: MEMBERSHIP_TWO_ID,
    projectId: ACME_PROJECT_ID,
    projectName: "Acme Rockets",
    teamId: ON_CALL_TEAM_ID,
    teamName: "On Call",
  }),
];

/* Invitations to two different projects. */
const TWO_PROJECTS: Array<TeamMember> = [
  ...TWO_TEAMS_ONE_PROJECT,
  makeMembership({
    id: MEMBERSHIP_THREE_ID,
    projectId: GLOBEX_PROJECT_ID,
    projectName: "Globex",
    teamId: OWNERS_TEAM_ID,
    teamName: "Owners",
  }),
];

type RenderInvitationsProps = {
  onInvitationAccepted?: ((projectId: ObjectID) => void) | undefined;
  onInvitationsLoaded?: ((count: number) => void) | undefined;
};

type RenderInvitationsFunction = (props?: RenderInvitationsProps) => void;

const renderInvitations: RenderInvitationsFunction = (
  props?: RenderInvitationsProps,
): void => {
  render(
    <PendingProjectInvitations
      {...(props?.onInvitationAccepted
        ? { onInvitationAccepted: props.onInvitationAccepted }
        : {})}
      {...(props?.onInvitationsLoaded
        ? { onInvitationsLoaded: props.onInvitationsLoaded }
        : {})}
    />,
  );
};

type GetInvitationCardsFunction = () => Array<HTMLElement>;

const getInvitationCards: GetInvitationCardsFunction =
  (): Array<HTMLElement> => {
    return screen.queryAllByTestId("project-invitation");
  };

describe("PendingProjectInvitations", () => {
  beforeEach(() => {
    getListMock.mockReset();
    updateByIdMock.mockReset();
    deleteItemMock.mockReset();

    getListMock.mockResolvedValue(listOf([]) as never);
    updateByIdMock.mockResolvedValue(undefined as never);
    deleteItemMock.mockResolvedValue(undefined as never);
  });

  describe("what it asks the server for", () => {
    test("asks for this user's unaccepted memberships, across every project", async () => {
      renderInvitations();

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalled();
      });

      const request: JSONObject = getListMock.mock
        .calls[0]![0] as unknown as JSONObject;

      const query: JSONObject = request["query"] as JSONObject;

      expect((query["userId"] as ObjectID).toString()).toBe(USER_ID);
      /*
       * Not merely falsy: an omitted flag would return the projects this user
       * is already a member of and offer them "Accept & Join" for a project
       * they are standing in.
       */
      expect(query["hasAcceptedInvitation"]).toBe(false);

      /*
       * The welcome page has no project selected, so a tenant-scoped request
       * returns nothing - which looks exactly like having no invitations.
       */
      expect(
        (request["requestOptions"] as JSONObject)["isMultiTenantRequest"],
      ).toBe(true);
    });

    test("selects the project and team names the card is built out of", async () => {
      renderInvitations();

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalled();
      });

      const select: JSONObject = getListMock.mock.calls[0]![0]![
        "select"
      ] as JSONObject;

      expect((select["project"] as JSONObject)["name"]).toBe(true);
      expect((select["team"] as JSONObject)["name"]).toBe(true);
      // The accept and decline calls address memberships by id.
      expect(select["_id"]).toBe(true);
      expect(select["projectId"]).toBe(true);
    });
  });

  describe("with nothing pending", () => {
    test("renders nothing at all", async () => {
      const onInvitationsLoaded: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationsLoaded: onInvitationsLoaded as unknown as (
          count: number,
        ) => void,
      });

      await waitFor(() => {
        expect(onInvitationsLoaded).toHaveBeenCalled();
      });

      expect(screen.queryByTestId("pending-invitations")).toBeNull();
      expect(getInvitationCards()).toHaveLength(0);
    });

    test("reports a count of zero so the page can offer to create a project", async () => {
      const onInvitationsLoaded: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationsLoaded: onInvitationsLoaded as unknown as (
          count: number,
        ) => void,
      });

      await waitFor(() => {
        expect(onInvitationsLoaded).toHaveBeenCalledWith(0);
      });
    });
  });

  describe("while the first load is in flight", () => {
    /*
     * Most people who reach the welcome page have no invitation waiting. A
     * loader that resolves into an empty region is furniture flashed at the
     * majority to serve the minority.
     */
    test("renders nothing, and has not reported a count yet", async () => {
      let resolveList: ((result: ListResult<TeamMember>) => void) | null = null;

      getListMock.mockReturnValue(
        new Promise<ListResult<TeamMember>>(
          (resolve: (result: ListResult<TeamMember>) => void) => {
            resolveList = resolve;
          },
        ) as never,
      );

      const onInvitationsLoaded: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationsLoaded: onInvitationsLoaded as unknown as (
          count: number,
        ) => void,
      });

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalled();
      });

      expect(screen.queryByTestId("pending-invitations")).toBeNull();
      expect(screen.queryByTestId("invitations-error")).toBeNull();
      expect(onInvitationsLoaded).not.toHaveBeenCalled();

      resolveList!(listOf(ONE_INVITATION));

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });
    });
  });

  describe("with invitations pending", () => {
    test("shows one card per project and names it", async () => {
      getListMock.mockResolvedValue(listOf(TWO_PROJECTS) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(2);
      });

      expect(screen.getByText("Acme Rockets")).toBeInTheDocument();
      expect(screen.getByText("Globex")).toBeInTheDocument();
    });

    /*
     * The core of the grouping. Three memberships, two projects: asking this
     * person to press Accept three times would read as three invitations from
     * two companies.
     */
    test("folds every team of one project into a single invitation", async () => {
      getListMock.mockResolvedValue(listOf(TWO_TEAMS_ONE_PROJECT) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      expect(screen.getAllByText("Acme Rockets")).toHaveLength(1);
      // Both teams still shown, as chips on the one card.
      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("On Call")).toBeInTheDocument();
    });

    test("reports how many invitations there are, not how many memberships", async () => {
      getListMock.mockResolvedValue(listOf(TWO_PROJECTS) as never);

      const onInvitationsLoaded: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationsLoaded: onInvitationsLoaded as unknown as (
          count: number,
        ) => void,
      });

      await waitFor(() => {
        expect(onInvitationsLoaded).toHaveBeenCalledWith(2);
      });
    });

    test("names the projects in a stable order", async () => {
      getListMock.mockResolvedValue(
        listOf([...TWO_PROJECTS].reverse()) as never,
      );

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(2);
      });

      const cards: Array<HTMLElement> = getInvitationCards();

      // Alphabetical, whatever order the memberships came back in.
      expect(cards[0]!).toHaveTextContent("Acme Rockets");
      expect(cards[1]!).toHaveTextContent("Globex");
    });

    test("says how many projects invited them", async () => {
      getListMock.mockResolvedValue(listOf(TWO_PROJECTS) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(2);
      });

      expect(
        screen.getByText("You have been invited to 2 projects"),
      ).toBeInTheDocument();
    });

    test("uses the singular when there is one", async () => {
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      expect(
        screen.getByText("You have been invited to a project"),
      ).toBeInTheDocument();
    });

    /*
     * The team relation can come back unexpanded. Without a fallback the card
     * would name a project and then say nothing whatsoever about what
     * accepting it does.
     */
    test("still says what accepting does when the teams could not be named", async () => {
      getListMock.mockResolvedValue(
        listOf([
          makeMembership({
            id: MEMBERSHIP_ONE_ID,
            projectId: ACME_PROJECT_ID,
            projectName: "Acme Rockets",
          }),
        ]) as never,
      );

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      expect(
        screen.getByText("You have been invited to 1 team in this project."),
      ).toBeInTheDocument();
    });
  });

  describe("accepting", () => {
    test("accepts every membership behind the card, not just one", async () => {
      getListMock.mockResolvedValue(listOf(TWO_TEAMS_ONE_PROJECT) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("accept-invitation-button"));

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(2);
      });

      const acceptedIds: Array<string> = updateByIdMock.mock.calls.map(
        (call: Array<any>) => {
          return (call[0]!["id"] as ObjectID).toString();
        },
      );

      expect(acceptedIds.sort()).toEqual(
        [MEMBERSHIP_ONE_ID, MEMBERSHIP_TWO_ID].sort(),
      );
    });

    test("sets the accepted flag and stamps when it happened", async () => {
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("accept-invitation-button"));

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      const sent: JSONObject = updateByIdMock.mock.calls[0]![0]![
        "data"
      ] as JSONObject;

      expect(sent["hasAcceptedInvitation"]).toBe(true);
      expect(sent["invitationAcceptedAt"]).toBeInstanceOf(Date);

      // Same cross-tenant reach as the read; the project is not the user's yet.
      expect(
        (updateByIdMock.mock.calls[0]![0]!["requestOptions"] as JSONObject)[
          "isMultiTenantRequest"
        ],
      ).toBe(true);
    });

    test("hands the caller the project that was joined", async () => {
      getListMock.mockResolvedValue(listOf(TWO_PROJECTS) as never);

      const onInvitationAccepted: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationAccepted: onInvitationAccepted as unknown as (
          projectId: ObjectID,
        ) => void,
      });

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(2);
      });

      // The second card is Globex - the list is alphabetical.
      fireEvent.click(screen.getAllByTestId("accept-invitation-button")[1]!);

      await waitFor(() => {
        expect(onInvitationAccepted).toHaveBeenCalled();
      });

      expect(
        (
          onInvitationAccepted.mock.calls[0]![0] as unknown as ObjectID
        ).toString(),
      ).toBe(GLOBEX_PROJECT_ID);
    });

    test("accepts only the project whose button was pressed", async () => {
      getListMock.mockResolvedValue(listOf(TWO_PROJECTS) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(2);
      });

      fireEvent.click(screen.getAllByTestId("accept-invitation-button")[1]!);

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      expect(
        (updateByIdMock.mock.calls[0]![0]!["id"] as ObjectID).toString(),
      ).toBe(MEMBERSHIP_THREE_ID);
    });

    /*
     * The caller normally reloads the dashboard into the project and this
     * render never survives - but a caller that only wants to be told must not
     * be left looking at an invitation that has already been accepted.
     */
    test("reloads the list afterwards so the accepted card leaves", async () => {
      getListMock.mockResolvedValueOnce(listOf(ONE_INVITATION) as never);
      getListMock.mockResolvedValue(listOf([]) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("accept-invitation-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("pending-invitations")).toBeNull();
      });

      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    test("reports a failure in place, and leaves the invitation there", async () => {
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);
      updateByIdMock.mockRejectedValue(
        new BadDataException(
          "You are not allowed to join this project.",
        ) as never,
      );

      const onInvitationAccepted: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationAccepted: onInvitationAccepted as unknown as (
          projectId: ObjectID,
        ) => void,
      });

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("accept-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("invitation-action-error")).toHaveTextContent(
          "You are not allowed to join this project.",
        );
      });

      // Nothing was joined, so nothing may be handed to the caller to navigate to.
      expect(onInvitationAccepted).not.toHaveBeenCalled();
      expect(getInvitationCards()).toHaveLength(1);
    });
  });

  describe("declining", () => {
    test("asks first, and deletes nothing until it is confirmed", async () => {
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("decline-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      expect(deleteItemMock).not.toHaveBeenCalled();
    });

    test("says what is being given up", async () => {
      getListMock.mockResolvedValue(listOf(TWO_TEAMS_ONE_PROJECT) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("decline-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      const modal: HTMLElement = screen.getByTestId("modal");

      expect(modal).toHaveTextContent("Acme Rockets");
      expect(modal).toHaveTextContent("2 teams");
    });

    test("closing the confirmation deletes nothing", async () => {
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("decline-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("modal-footer-close-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("modal")).toBeNull();
      });

      expect(deleteItemMock).not.toHaveBeenCalled();
      expect(getInvitationCards()).toHaveLength(1);
    });

    test("deletes every membership behind the card once confirmed", async () => {
      getListMock.mockResolvedValue(listOf(TWO_TEAMS_ONE_PROJECT) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("decline-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(deleteItemMock).toHaveBeenCalledTimes(2);
      });

      const deletedIds: Array<string> = deleteItemMock.mock.calls.map(
        (call: Array<any>) => {
          return (call[0]!["id"] as ObjectID).toString();
        },
      );

      expect(deletedIds.sort()).toEqual(
        [MEMBERSHIP_ONE_ID, MEMBERSHIP_TWO_ID].sort(),
      );
    });

    test("reloads the list afterwards, so the declined invitation leaves", async () => {
      getListMock.mockResolvedValueOnce(listOf(ONE_INVITATION) as never);
      getListMock.mockResolvedValue(listOf([]) as never);

      const onInvitationsLoaded: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationsLoaded: onInvitationsLoaded as unknown as (
          count: number,
        ) => void,
      });

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("decline-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("pending-invitations")).toBeNull();
      });

      /*
       * The count has to be re-reported: the page it is on decides whether to
       * offer "create your first project" off this number, and declining the
       * last invitation is exactly when that offer becomes the only way out.
       */
      expect(onInvitationsLoaded).toHaveBeenLastCalledWith(0);
    });

    test("declines only the project whose button was pressed", async () => {
      getListMock.mockResolvedValue(listOf(TWO_PROJECTS) as never);

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(2);
      });

      fireEvent.click(screen.getAllByTestId("decline-invitation-button")[1]!);

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(deleteItemMock).toHaveBeenCalledTimes(1);
      });

      expect(
        (deleteItemMock.mock.calls[0]![0]!["id"] as ObjectID).toString(),
      ).toBe(MEMBERSHIP_THREE_ID);
    });

    test("reports a failed decline in place", async () => {
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);
      deleteItemMock.mockRejectedValue(
        new BadDataException("This invitation no longer exists.") as never,
      );

      renderInvitations();

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("decline-invitation-button"));

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(screen.getByTestId("invitation-action-error")).toHaveTextContent(
          "This invitation no longer exists.",
        );
      });
    });
  });

  describe("when the invitations cannot be read", () => {
    test("says so, and offers to try again", async () => {
      getListMock.mockRejectedValue(
        new BadDataException("Server is unreachable.") as never,
      );

      renderInvitations();

      await waitFor(() => {
        expect(screen.getByTestId("invitations-error")).toHaveTextContent(
          "Server is unreachable.",
        );
      });

      expect(screen.queryByTestId("pending-invitations")).toBeNull();
    });

    /*
     * A user whose invitations cannot be read still has to be offered the way
     * forward that does not depend on them - so the page is told zero rather
     * than being left waiting on a load that already failed.
     */
    test("reports zero, so the page still offers to create a project", async () => {
      getListMock.mockRejectedValue(
        new BadDataException("Server is unreachable.") as never,
      );

      const onInvitationsLoaded: MockFunction = getJestMockFunction();

      renderInvitations({
        onInvitationsLoaded: onInvitationsLoaded as unknown as (
          count: number,
        ) => void,
      });

      await waitFor(() => {
        expect(onInvitationsLoaded).toHaveBeenCalledWith(0);
      });
    });

    test("retries on refresh, and shows what it finds", async () => {
      getListMock.mockRejectedValueOnce(
        new BadDataException("Server is unreachable.") as never,
      );
      getListMock.mockResolvedValue(listOf(ONE_INVITATION) as never);

      renderInvitations();

      await waitFor(() => {
        expect(screen.getByTestId("invitations-error")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("refresh-button"));

      await waitFor(() => {
        expect(getInvitationCards()).toHaveLength(1);
      });

      expect(screen.queryByTestId("invitations-error")).toBeNull();
    });
  });
});
