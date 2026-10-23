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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Owners field of the create forms (Dashboard Components/OwnersOnCreate)
 * through the real BasicForm, with only the network stubbed:
 *
 *   - "Your teams" under the picker: the creator's own teams, one click
 *     each, Add all for two or more - nothing picked by itself, and nothing
 *     offered to someone in no team;
 *   - the review step's Owners row: who is picked, then each owner rule
 *     that will run - by name, with whom it adds that is not an owner
 *     already, worked out by the server - and what it says while it asks,
 *     when it cannot, and when the person may not see the rules (nothing);
 *   - a master admin, whom OneUptime does not make the owner of what they
 *     create, is not told they will be one.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error && typeof error === "object" && "message" in error) {
          return String((error as { message: unknown }).message);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
      },
    },
  };
});

import { getOwnersOnCreateFieldOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/OwnersOnCreate/OwnersOnCreateField";
import OwnersOnCreateSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OwnersOnCreate/OwnersOnCreateSummary";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import OwnerRulePreview, {
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "../../../Types/Rules/OwnerRulePreview";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getOwnersFormField, {
  getOwnersPeoplePickerConfig,
} from "../../../UI/Components/PeoplePicker/OwnersFormField";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ME: string = "0000000e-0000-4000-8000-000000000001";
const ADA: string = "0000000e-0000-4000-8000-000000000002";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const SRE: string = "0000000b-0000-4000-8000-000000000002";
const MEMBERS: string = "0000000b-0000-4000-8000-000000000003";
const LABEL: string = "0000000c-0000-4000-8000-000000000001";

const TEAM_NAMES: Record<string, string> = {
  [PLATFORM]: "Platform",
  [SRE]: "SRE",
  [MEMBERS]: "Members",
};

// The teams the signed-in person is a member of.
let myTeamIds: Array<string> = [];

function listResult(data: Array<unknown>): JSONObject {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as unknown as JSONObject;
}

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      // The names of the people picked.
      if (request.query.userId instanceof Includes) {
        const user: User = new User();
        user._id = ADA;
        user.name = new Name("Ada Lovelace");
        user.email = new Email("ada@example.com");

        const member: TeamMember = new TeamMember();
        member.user = user;

        return listResult(
          (request.query.userId.values as Array<string>).includes(ADA)
            ? [member]
            : [],
        );
      }

      // The signed-in person's own teams.
      return listResult(
        myTeamIds.map((teamId: string): TeamMember => {
          const membership: TeamMember = new TeamMember();
          membership.teamId = new ObjectID(teamId);
          return membership;
        }),
      );
    }

    if (request.modelType === Team) {
      const ids: Array<string> =
        request.query._id instanceof Includes
          ? (request.query._id.values as Array<string>)
          : Object.keys(TEAM_NAMES);

      return listResult(
        ids
          .filter((id: string): boolean => {
            return Boolean(TEAM_NAMES[id]);
          })
          .sort((a: string, b: string): number => {
            return TEAM_NAMES[a]!.localeCompare(TEAM_NAMES[b]!);
          })
          .map((id: string): Team => {
            const team: Team = new Team();
            team._id = id;
            team.name = TEAM_NAMES[id]!;
            return team;
          }),
      );
    }

    return listResult([]);
  });
}

function previewAnswer(
  result: OwnerRulePreviewResult,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    OwnerRulePreview.resultToJSON(result),
    {},
  );
}

const PLATFORM_RULE: OwnerRulePreviewResult = {
  rules: [
    {
      ruleId: "0000000d-0000-4000-8000-000000000001",
      ruleName: "Platform owns checkout",
      userIds: [ADA],
      teamIds: [PLATFORM],
      creatorTeamIds: [PLATFORM],
      notifiesOwners: true,
    },
    // Matches, adds nobody: no line.
    {
      ruleId: "0000000d-0000-4000-8000-000000000002",
      ruleName: "Declarer's team",
      userIds: [],
      teamIds: [],
      creatorTeamIds: [],
      notifiesOwners: true,
    },
    {
      ruleId: "0000000d-0000-4000-8000-000000000003",
      ruleName: "",
      userIds: [],
      teamIds: [SRE],
      creatorTeamIds: [],
      notifiesOwners: false,
    },
  ],
};

const NAME_FIELD: Field<JSONObject> = {
  field: { title: true },
  title: "Title",
  fieldType: FormFieldSchemaType.Text,
  required: true,
};

function ownersField(
  event: OwnerRulePreviewEvent = OwnerRulePreviewEvent.Incident,
): Field<JSONObject> {
  return getOwnersFormField<JSONObject>({
    ...getOwnersOnCreateFieldOptions<JSONObject>(event),
  });
}

function renderForm(data: {
  initialValues?: JSONObject;
  event?: OwnerRulePreviewEvent;
}): MockFunction {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="create-form"
      fields={[NAME_FIELD, ownersField(data.event)]}
      initialValues={{ title: "Checkout is down", ...data.initialValues }}
      onSubmit={onSubmit}
      submitButtonText="Declare Incident"
      disableAutofocus={true}
    />,
  );

  return onSubmit;
}

function submitted(onSubmit: MockFunction): JSONObject {
  return onSubmit.mock.calls[0]![0] as JSONObject;
}

function chipNames(): Array<string | null> {
  return screen
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.textContent;
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  postMock.mockReset();
  getListMock.mockReset();
  myTeamIds = [];
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ME));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  serveDirectory();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("your teams, under the Owners picker", () => {
  test("offers nothing to someone in no team, and picks nothing by itself", async () => {
    const onSubmit: MockFunction = renderForm({});

    await screen.findByRole("button", { name: "Add owner" });
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("my-team-suggestions-line")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Declare Incident" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(submitted(onSubmit)["ownerTeams"] || []).toEqual([]);
  });

  test("asks for the signed-in person's accepted memberships in this project", async () => {
    myTeamIds = [PLATFORM];

    renderForm({});

    await screen.findByTestId("my-team-suggestions-line");

    const membershipRequest: any = getListMock.mock.calls
      .map((call: Array<unknown>): any => {
        return call[0];
      })
      .find((request: any): boolean => {
        return (
          request.modelType === TeamMember &&
          !(request.query.userId instanceof Includes)
        );
      });

    expect(String(membershipRequest.query.userId)).toBe(ME);
    expect(String(membershipRequest.query.projectId)).toBe(PROJECT_ID);
    expect(membershipRequest.query.hasAcceptedInvitation).toBe(true);
  });

  test("one team: one click makes it an owner, and the button goes", async () => {
    myTeamIds = [PLATFORM];

    const onSubmit: MockFunction = renderForm({});

    const line: HTMLElement = await screen.findByTestId(
      "my-team-suggestions-line",
    );

    expect(within(line).getByText("Your team:")).toBeInTheDocument();
    expect(
      within(line).queryByTestId("my-team-suggestions-add-all"),
    ).toBeNull();

    fireEvent.click(
      within(line).getByRole("button", { name: "Add Platform as an owner" }),
    );

    await waitFor(() => {
      expect(chipNames()).toEqual([expect.stringContaining("Platform")]);
    });
    expect(screen.queryByTestId("my-team-suggestions-line")).toBeNull();
    expect(screen.getByTestId("my-team-suggestions-status")).toHaveTextContent(
      "Added Platform to the owners.",
    );
    // Focus stays where the line was, not lost to the page.
    expect(document.activeElement).toBe(
      screen.getByTestId("my-team-suggestions"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Declare Incident" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(submitted(onSubmit)["ownerTeams"]).toEqual([PLATFORM]);
  });

  test("several teams: one at a time, focus moving on, or all at once", async () => {
    myTeamIds = [SRE, PLATFORM, MEMBERS];

    renderForm({});

    const line: HTMLElement = await screen.findByTestId(
      "my-team-suggestions-line",
    );

    expect(within(line).getByText("Your teams:")).toBeInTheDocument();
    expect(
      within(line)
        .getAllByTestId("my-team-suggestion")
        .map((button: HTMLElement): string | null => {
          return button.textContent;
        }),
    ).toEqual(["Members", "Platform", "SRE"]);

    // One: the next team's button takes the focus.
    fireEvent.click(
      within(line).getByRole("button", { name: "Add Platform as an owner" }),
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add SRE as an owner" }),
      );
    });

    // Then the rest.
    fireEvent.click(screen.getByTestId("my-team-suggestions-add-all"));

    await waitFor(() => {
      expect(screen.queryByTestId("my-team-suggestions-line")).toBeNull();
    });
    expect(screen.getByTestId("my-team-suggestions-status")).toHaveTextContent(
      "Added 2 teams to the owners.",
    );
    expect(chipNames()).toHaveLength(3);
  });

  test("never offers a team already picked, and keeps the people picked", async () => {
    myTeamIds = [PLATFORM, SRE];

    const onSubmit: MockFunction = renderForm({
      initialValues: { ownerUsers: [ADA], ownerTeams: [PLATFORM] },
    });

    const line: HTMLElement = await screen.findByTestId(
      "my-team-suggestions-line",
    );

    expect(
      within(line)
        .getAllByTestId("my-team-suggestion")
        .map((button: HTMLElement): string | null => {
          return button.textContent;
        }),
    ).toEqual(["SRE"]);

    fireEvent.click(
      within(line).getByRole("button", { name: "Add SRE as an owner" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("my-team-suggestions-line")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Declare Incident" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(submitted(onSubmit)["ownerUsers"]).toEqual([ADA]);
    expect(submitted(onSubmit)["ownerTeams"]).toEqual([PLATFORM, SRE]);
  });
});

describe("the review step's Owners row", () => {
  const config: ReturnType<typeof getOwnersPeoplePickerConfig> =
    getOwnersPeoplePickerConfig();

  function renderSummary(data: {
    values: JSONObject;
    event?: OwnerRulePreviewEvent;
  }): { rerender: (values: JSONObject) => void } {
    const view: ReturnType<typeof render> = render(
      <OwnersOnCreateSummary
        event={data.event || OwnerRulePreviewEvent.Incident}
        values={data.values}
        config={config}
      />,
    );

    return {
      rerender: (values: JSONObject): void => {
        view.rerender(
          <OwnersOnCreateSummary
            event={data.event || OwnerRulePreviewEvent.Incident}
            values={values}
            config={config}
          />,
        );
      },
    };
  }

  test("says nobody else is picked - the declarer owns it anyway", async () => {
    postMock.mockResolvedValue(previewAnswer({ rules: [] }));

    renderSummary({ values: { title: "Checkout is down" } });

    expect(
      screen.getByTestId("owners-on-create-nobody-picked"),
    ).toHaveTextContent("Nobody else picked.");

    await waitFor(() => {
      expect(screen.queryByTestId("owner-rule-preview-loading")).toBeNull();
    });
    // No rule adds anyone: nothing about rules.
    expect(screen.queryByTestId("owner-rule-preview")).toBeNull();
    expect(screen.queryByTestId("owner-rule-preview-error")).toBeNull();
  });

  test("on an episode, whose creator is not made an owner, says nobody is picked", async () => {
    postMock.mockResolvedValue(previewAnswer({ rules: [] }));

    renderSummary({
      values: { title: "Payments" },
      event: OwnerRulePreviewEvent.IncidentEpisode,
    });

    expect(
      screen.getByTestId("owners-on-create-nobody-picked"),
    ).toHaveTextContent("Nobody picked.");

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });

  test("names the owners picked", async () => {
    postMock.mockResolvedValue(previewAnswer({ rules: [] }));

    renderSummary({
      values: { title: "Checkout is down", ownerUsers: [ADA] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("owners-on-create-picked")).toHaveTextContent(
        "Ada Lovelace",
      );
    });
    expect(screen.queryByTestId("owners-on-create-nobody-picked")).toBeNull();
  });

  test("says it is checking the rules while the server works them out", async () => {
    postMock.mockImplementation(() => {
      return new Promise<never>(() => {
        // Never answers.
      });
    });

    renderSummary({ values: { title: "Checkout is down" } });

    const loading: HTMLElement = screen.getByTestId(
      "owner-rule-preview-loading",
    );

    expect(loading).toHaveTextContent("Checking which owner rules will run...");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveAttribute("aria-busy", "true");
  });

  test("lists each rule that will add someone, by name, with whom it adds", async () => {
    postMock.mockResolvedValue(previewAnswer(PLATFORM_RULE));

    renderSummary({ values: { title: "Checkout is down" } });

    const preview: HTMLElement =
      await screen.findByTestId("owner-rule-preview");

    expect(preview).toHaveTextContent("Added by owner rules");

    const rows: Array<HTMLElement> = within(preview).getAllByTestId(
      "owner-rule-preview-rule",
    );

    // The rule that adds nobody has no line.
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]!).getByTestId("owner-rule-preview-rule-name"),
    ).toHaveTextContent("Platform owns checkout");
    expect(
      within(rows[1]!).getByTestId("owner-rule-preview-rule-name"),
    ).toHaveTextContent("Unnamed rule");

    await waitFor(() => {
      expect(
        within(rows[0]!).getByTestId("owner-rule-preview-owners"),
      ).toHaveTextContent("Ada Lovelace");
    });
    await waitFor(() => {
      expect(
        within(rows[0]!).getByTestId("owner-rule-preview-owners"),
      ).toHaveTextContent("Platform");
    });
    await waitFor(() => {
      expect(
        within(rows[1]!).getByTestId("owner-rule-preview-owners"),
      ).toHaveTextContent("SRE");
    });
  });

  test("asks about the event as the form holds it", async () => {
    postMock.mockResolvedValue(previewAnswer({ rules: [] }));

    renderSummary({
      values: {
        title: "Checkout is down",
        description: "500s",
        labels: [LABEL],
      },
    });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    const request: { url: { toString: () => string }; data: JSONObject } =
      postMock.mock.calls[0]![0] as never;

    expect(request.url.toString()).toMatch(/\/incident\/owner-rule-preview$/);
    expect(request.data).toEqual(
      OwnerRulePreview.draftToJSON({
        ...OwnerRulePreview.emptyDraft(),
        title: "Checkout is down",
        description: "500s",
        labelIds: [LABEL],
      }),
    );
  });

  test("asks once for the same event, and again once it changes", async () => {
    postMock.mockResolvedValue(previewAnswer(PLATFORM_RULE));

    const view: { rerender: (values: JSONObject) => void } = renderSummary({
      values: { title: "Checkout is down" },
    });

    await screen.findByTestId("owner-rule-preview");

    view.rerender({ title: "Checkout is down" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(postMock).toHaveBeenCalledTimes(1);

    view.rerender({ title: "Checkout is down", labels: [LABEL] });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
  });

  test("never shows an answer for an event that has since changed", async () => {
    let answerFirst: (value: unknown) => void = () => {};

    postMock
      .mockImplementationOnce(() => {
        return new Promise((resolve: (value: unknown) => void) => {
          answerFirst = resolve;
        });
      })
      .mockResolvedValueOnce(previewAnswer({ rules: [] }));

    const view: { rerender: (values: JSONObject) => void } = renderSummary({
      values: { title: "Checkout is down" },
    });

    view.rerender({ title: "Checkout is down", labels: [LABEL] });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("owner-rule-preview-loading")).toBeNull();
    });

    await act(async () => {
      answerFirst(previewAnswer(PLATFORM_RULE));
      await Promise.resolve();
    });

    // The answer for the event as it is now stands: no rules, not loading.
    expect(screen.queryByTestId("owner-rule-preview")).toBeNull();
    expect(screen.queryByTestId("owner-rule-preview-loading")).toBeNull();
  });

  test("says so in a line when the rules cannot be checked - the create still goes on", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Server error" }, {}),
    );

    renderSummary({ values: { title: "Checkout is down" } });

    expect(
      await screen.findByTestId("owner-rule-preview-error"),
    ).toHaveTextContent(
      "Could not check which owner rules will run. They still run when it is created.",
    );
  });

  test("names only whom a rule adds that is not an owner already", async () => {
    postMock.mockResolvedValue(previewAnswer(PLATFORM_RULE));

    renderSummary({
      values: { title: "Checkout is down", ownerTeams: [PLATFORM] },
    });

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "owner-rule-preview-rule",
    );

    // The first rule brings Ada and Platform; Platform is picked.
    await waitFor(() => {
      expect(
        within(rows[0]!).getByTestId("owner-rule-preview-owners"),
      ).toHaveTextContent("Ada Lovelace");
    });
    expect(
      within(rows[0]!).getByTestId("owner-rule-preview-owners"),
    ).not.toHaveTextContent("Platform");
    expect(
      within(rows[0]!)
        .getAllByTestId("people-chip")
        .map((chip: HTMLElement): string | null => {
          return chip.getAttribute("data-id");
        }),
    ).toEqual([ADA]);
  });

  test("says so when everyone a rule adds is an owner already", async () => {
    postMock.mockResolvedValue(previewAnswer(PLATFORM_RULE));

    renderSummary({
      values: {
        title: "Checkout is down",
        ownerUsers: [ADA],
        ownerTeams: [PLATFORM, SRE],
      },
    });

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "owner-rule-preview-rule",
    );

    // Both rules still have their line: they run, and add nobody new.
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(
        within(row).getByTestId("owner-rule-preview-nobody-new"),
      ).toHaveTextContent("Everyone it adds is already an owner.");
      expect(within(row).queryByTestId("owner-rule-preview-owners")).toBeNull();
    }
  });

  test("leaves the person declaring it out of a rule's line - OneUptime makes them an owner", async () => {
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ADA));
    postMock.mockResolvedValue(previewAnswer(PLATFORM_RULE));

    renderSummary({ values: { title: "Checkout is down" } });

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "owner-rule-preview-rule",
    );

    await waitFor(() => {
      expect(
        within(rows[0]!).getByTestId("owner-rule-preview-owners"),
      ).toHaveTextContent("Platform");
    });
    expect(
      within(rows[0]!)
        .getAllByTestId("people-chip")
        .map((chip: HTMLElement): string | null => {
          return chip.getAttribute("data-id");
        }),
    ).toEqual([PLATFORM]);
  });

  test("tells a master admin nobody is picked, and names them where a rule adds them", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ADA));
    postMock.mockResolvedValue(previewAnswer(PLATFORM_RULE));

    renderSummary({ values: { title: "Checkout is down" } });

    expect(
      screen.getByTestId("owners-on-create-nobody-picked"),
    ).toHaveTextContent("Nobody picked.");

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "owner-rule-preview-rule",
    );

    // OneUptime does not make a master admin an owner: the rule does.
    await waitFor(() => {
      expect(
        within(rows[0]!).getByTestId("owner-rule-preview-owners"),
      ).toHaveTextContent("Ada Lovelace");
    });
  });

  test.each([403, 422])(
    "says nothing about rules to someone who may not see them (%s)",
    async (statusCode: number) => {
      postMock.mockResolvedValue(
        new HTTPErrorResponse(statusCode, { message: "Not allowed" }, {}),
      );

      renderSummary({ values: { title: "Checkout is down" } });

      await waitFor(() => {
        expect(screen.queryByTestId("owner-rule-preview-loading")).toBeNull();
      });

      expect(screen.queryByTestId("owner-rule-preview-error")).toBeNull();
      expect(screen.queryByTestId("owner-rule-preview")).toBeNull();
      expect(
        screen.getByTestId("owners-on-create-nobody-picked"),
      ).toBeInTheDocument();
    },
  );
});

describe("the Owners field of a create form", () => {
  test("is always on the review, and says what the person creating it gets", () => {
    for (const event of [
      OwnerRulePreviewEvent.Incident,
      OwnerRulePreviewEvent.Alert,
      OwnerRulePreviewEvent.IncidentEpisode,
      OwnerRulePreviewEvent.AlertEpisode,
    ]) {
      const field: Field<JSONObject> = ownersField(event);

      expect(field.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
      expect(field.alwaysInSummary).toBe(true);
      expect(field.getSummaryElement).toBeDefined();
      expect(field.getFooterElement).toBeDefined();
      // Outside a form there is no field to add to: no suggestions.
      expect(field.getFooterElement!({} as never)).toBeUndefined();
    }

    expect(ownersField(OwnerRulePreviewEvent.Incident).description).toContain(
      "You become an owner when you declare it.",
    );
    expect(ownersField(OwnerRulePreviewEvent.Alert).description).toContain(
      "You become an owner when you create it.",
    );
  });

  test("tells a master admin only to add owners: OneUptime does not make them one", () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

    for (const event of [
      OwnerRulePreviewEvent.Incident,
      OwnerRulePreviewEvent.Alert,
    ]) {
      expect(ownersField(event).description).toBe(
        "Add your team, or anyone else who should own it.",
      );
    }

    expect(ownersField(OwnerRulePreviewEvent.IncidentEpisode).description).toBe(
      "Who owns this episode. They are notified when it is created or updated.",
    );
  });
});
