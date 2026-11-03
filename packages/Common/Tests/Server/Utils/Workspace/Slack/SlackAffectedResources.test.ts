import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import Response from "../../../../../Server/Utils/Response";
import SlackAuthAction, {
  SlackRequest,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackAffectedResources, {
  SLACK_AFFECTED_RESOURCES_MAX_OPTIONS,
  SLACK_OPTION_TEXT_MAX_LENGTH,
} from "../../../../../Server/Utils/Workspace/Slack/SlackAffectedResources";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAffectedResources, {
  WORKSPACE_AFFECTED_RESOURCES_FIELD,
  WORKSPACE_MAX_AFFECTED_RESOURCES,
  WorkspaceAffectedResourceKindMatches,
  WorkspaceAffectedResourceMatch,
} from "../../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import { AiAffectedResourceKind } from "../../../../../Types/AI/AiAffectedResources";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceDropdownBlock } from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * SLACK'S AFFECTED RESOURCES FIELD ON THE NEW INCIDENT FORM (#5303
 * follow-up).
 *
 * A multi external select: Slack lists nothing the form was sent with, and
 * asks the app's Options Load URL (POST /api/slack/options-load) as the
 * person opens it and types. This suite pins:
 *
 *   - the field as Slack takes it: optional, searched from the first
 *     moment, as many picks as a declaration links, the alert's resources
 *     picked already when there are any;
 *   - the answer to an options request: a heading for each kind, how many
 *     match when more do than are listed, a resource's address under its
 *     name, at most a hundred options with every kind keeping a place, and
 *     every text within Slack's 75 characters;
 *   - who is answered: only a request of this field, read as the press of
 *     the form itself would be, as the member, in the form's project -
 *     anybody else, and any failure, gets no options and never an error.
 *     (The route itself, through the real SlackAPI router, is
 *     Tests/Server/API/SlackDeclareIncidentAffectedResourcesRoute.)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "51ac0000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("51ac0000-0000-4000-8000-000000000002");
const HOST_ID: string = "51ac0000-0000-4000-8000-0000000000a1";
const SERVICE_ID: string = "51ac0000-0000-4000-8000-0000000000b1";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

let seq: number = 0;

function uuid(): string {
  seq++;
  return `51ac0000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function group(
  kind: AiAffectedResourceKind,
  count: number,
  shown?: number,
): WorkspaceAffectedResourceKindMatches {
  const matches: Array<WorkspaceAffectedResourceMatch> = [];

  for (let index: number = 1; index <= (shown ?? count); index++) {
    matches.push({ kind: kind, id: uuid(), name: `${kind}-${index}` });
  }

  return { kind: kind, count: count, matches: matches };
}

// What Slack posts when the field asks for its options.
function blockSuggestion(
  data: {
    value?: string;
    actionId?: string;
    type?: string;
  } = {},
): JSONObject {
  return {
    type: data.type ?? "block_suggestion",
    user: { id: "U0MEMBER", team_id: "T0TEAM" },
    team: { id: "T0TEAM" },
    action_id: data.actionId ?? WORKSPACE_AFFECTED_RESOURCES_FIELD,
    block_id: WORKSPACE_AFFECTED_RESOURCES_FIELD,
    value: data.value ?? "api",
    view: {
      id: "V0FORM",
      type: "modal",
      callback_id: SlackActionType.SubmitNewIncident,
      private_metadata: JSON.stringify({
        oneuptime: 1,
        value: "C0OPS",
        channelId: "C0OPS",
        projectId: PROJECT_ID.toString(),
      }),
      state: { values: {} },
    },
  };
}

type IsAuthorized = typeof SlackAuthAction.isAuthorized;
type GetProjectMemberProps =
  typeof WorkspaceActionAuthorization.getProjectMemberProps;
type Search = typeof WorkspaceAffectedResources.search;

let isAuthorizedSpy: SpyInstance<IsAuthorized>;
let memberPropsSpy: SpyInstance<GetProjectMemberProps>;
let searchSpy: SpyInstance<Search>;
let answered: Array<JSONObject>;
let slackRequest: SlackRequest;

beforeEach(() => {
  seq = 0;
  answered = [];
  slackRequest = {
    isAuthorized: true,
    userId: USER_ID,
    projectId: PROJECT_ID,
    slackUserId: "U0MEMBER",
    slackTeamId: "T0TEAM",
  };

  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(ProductBrandingText, "getProductName").mockReturnValue("OneUptime");

  isAuthorizedSpy = jest
    .spyOn(SlackAuthAction, "isAuthorized")
    .mockImplementation(async (): Promise<SlackRequest> => {
      return slackRequest;
    });
  memberPropsSpy = jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(MEMBER_PROPS);
  searchSpy = jest
    .spyOn(WorkspaceAffectedResources, "search")
    .mockResolvedValue([group(AiAffectedResourceKind.Host, 2)]);
  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(
      (_req: ExpressRequest, _res: ExpressResponse, item: JSONObject) => {
        answered.push(item);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function answerOptions(body: unknown): Promise<JSONObject> {
  await SlackAffectedResources.answerOptionsRequest({
    req: { body: body } as unknown as ExpressRequest,
    res: {} as ExpressResponse,
  });

  expect(answered).toHaveLength(1);

  return answered[0]!;
}

describe("the field, as Slack takes it", () => {
  test("a multi external select, searched as soon as it is opened, optional, under its label and hint", () => {
    const block: JSONObject = SlackUtil.getDropdownBlock({
      payloadDropdownBlock: SlackAffectedResources.getField({ initial: [] }),
    });

    expect(block).toEqual({
      type: "input",
      block_id: "affectedResources",
      optional: true,
      element: {
        type: "multi_external_select",
        action_id: "affectedResources",
        placeholder: {
          type: "plain_text",
          text: "Search hosts, clusters, databases…",
        },
        initial_option: undefined,
        min_query_length: 0,
        max_selected_items: WORKSPACE_MAX_AFFECTED_RESOURCES,
      },
      label: { type: "plain_text", text: "Affected Resources" },
      hint: {
        type: "plain_text",
        text: "OneUptime AI investigates what an incident is linked to, and can fix it.",
      },
    });
  });

  test("lists nothing it was sent with: no options, no option groups", () => {
    const element: JSONObject = SlackUtil.getDropdownBlock({
      payloadDropdownBlock: SlackAffectedResources.getField({ initial: [] }),
    })["element"] as JSONObject;

    expect(element["options"]).toBeUndefined();
    expect(element["option_groups"]).toBeUndefined();
    expect(element["initial_options"]).toBeUndefined();
  });

  test("opened from an alert's channel, the alert's resources are picked already, each by its name", () => {
    const element: JSONObject = SlackUtil.getDropdownBlock({
      payloadDropdownBlock: SlackAffectedResources.getField({
        initial: [
          { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
          {
            kind: AiAffectedResourceKind.Service,
            id: SERVICE_ID,
            name: "checkout",
          },
        ],
      }),
    })["element"] as JSONObject;

    expect(element["initial_options"]).toEqual([
      {
        text: { type: "plain_text", text: "api-1" },
        value: `Host:${HOST_ID}`,
      },
      {
        text: { type: "plain_text", text: "checkout" },
        value: `Service:${SERVICE_ID}`,
      },
    ]);
    expect(element["options"]).toBeUndefined();
  });

  test("a name past Slack's 75 characters is cut, with an ellipsis", () => {
    const field: WorkspaceDropdownBlock = SlackAffectedResources.getField({
      initial: [
        {
          kind: AiAffectedResourceKind.Host,
          id: HOST_ID,
          name: "h".repeat(120),
        },
      ],
    });

    expect(field.options[0]!.label).toHaveLength(SLACK_OPTION_TEXT_MAX_LENGTH);
    expect(field.options[0]!.label.endsWith("…")).toBe(true);
  });

  test(`at most ${WORKSPACE_MAX_AFFECTED_RESOURCES} picked already`, () => {
    const initial: Array<{
      kind: AiAffectedResourceKind;
      id: string;
      name: string;
    }> = [];

    for (let index: number = 0; index < 60; index++) {
      initial.push({
        kind: AiAffectedResourceKind.Host,
        id: uuid(),
        name: `host-${index}`,
      });
    }

    expect(
      SlackAffectedResources.getField({ initial: initial }).initialValues,
    ).toHaveLength(WORKSPACE_MAX_AFFECTED_RESOURCES);
  });

  test("a static select is drawn as it always was", () => {
    const element: JSONObject = SlackUtil.getDropdownBlock({
      payloadDropdownBlock: {
        _type: "WorkspaceDropdownBlock",
        label: "Monitors",
        blockId: "incidentMonitors",
        placeholder: "Select Monitors",
        options: [{ label: "Checkout API", value: "m1" }],
        multiSelect: true,
        optional: true,
      },
    })["element"] as JSONObject;

    expect(element["type"]).toBe("multi_static_select");
    expect(element["options"]).toEqual([
      { text: { type: "plain_text", text: "Checkout API" }, value: "m1" },
    ]);
    expect(element["min_query_length"]).toBeUndefined();
  });
});

describe("the answer Slack lists", () => {
  test("a heading for each kind with matches, in the order the kinds are offered", () => {
    const response: JSONObject = SlackAffectedResources.getOptionsResponse([
      {
        kind: AiAffectedResourceKind.Host,
        count: 1,
        matches: [
          { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
        ],
      },
      {
        kind: AiAffectedResourceKind.Service,
        count: 1,
        matches: [
          {
            kind: AiAffectedResourceKind.Service,
            id: SERVICE_ID,
            name: "checkout",
          },
        ],
      },
    ]);

    expect(response).toEqual({
      option_groups: [
        {
          label: { type: "plain_text", text: "Hosts" },
          options: [
            {
              text: { type: "plain_text", text: "api-1" },
              value: `Host:${HOST_ID}`,
            },
          ],
        },
        {
          label: { type: "plain_text", text: "Services" },
          options: [
            {
              text: { type: "plain_text", text: "checkout" },
              value: `Service:${SERVICE_ID}`,
            },
          ],
        },
      ],
    });
  });

  test("more match than are listed: the heading says how many, so the person types more", () => {
    const response: JSONObject = SlackAffectedResources.getOptionsResponse([
      group(AiAffectedResourceKind.Host, 240, 15),
    ]);

    expect(
      ((response["option_groups"] as Array<JSONObject>)[0]!["label"] as JSONObject)[
        "text"
      ],
    ).toBe("Hosts (15 of 240)");
  });

  test("what tells two of one name apart - a network device's address - goes under its name", () => {
    const response: JSONObject = SlackAffectedResources.getOptionsResponse([
      {
        kind: AiAffectedResourceKind.NetworkDevice,
        count: 1,
        matches: [
          {
            kind: AiAffectedResourceKind.NetworkDevice,
            id: HOST_ID,
            name: "core-sw-01",
            detail: "10.0.4.1",
          },
        ],
      },
    ]);

    expect(
      (
        (response["option_groups"] as Array<JSONObject>)[0]![
          "options"
        ] as Array<JSONObject>
      )[0],
    ).toEqual({
      text: { type: "plain_text", text: "core-sw-01" },
      value: `NetworkDevice:${HOST_ID}`,
      description: { type: "plain_text", text: "10.0.4.1" },
    });
  });

  test(`at most ${SLACK_AFFECTED_RESOURCES_MAX_OPTIONS} options in all: the longest lists give way first, and every kind keeps a place`, () => {
    const groups: Array<WorkspaceAffectedResourceKindMatches> =
      WorkspaceAffectedResources.getKinds().map(
        (kind: AiAffectedResourceKind, index: number) => {
          // The last kind matched once; every other kind fifteen times.
          return index === 13 ? group(kind, 1) : group(kind, 300, 15);
        },
      );

    const optionGroups: Array<JSONObject> =
      SlackAffectedResources.getOptionsResponse(groups)[
        "option_groups"
      ] as Array<JSONObject>;

    const sizes: Array<number> = optionGroups.map(
      (optionGroup: JSONObject): number => {
        return (optionGroup["options"] as Array<JSONObject>).length;
      },
    );

    expect(optionGroups).toHaveLength(14);
    expect(
      sizes.reduce((sum: number, size: number) => {
        return sum + size;
      }, 0),
    ).toBe(SLACK_AFFECTED_RESOURCES_MAX_OPTIONS);
    // The one kind with one match keeps it; the rest share the room.
    expect(sizes[13]).toBe(1);
    expect(Math.max(...sizes.slice(0, 13))).toBeLessThanOrEqual(
      Math.min(...sizes.slice(0, 13)) + 1,
    );
    // A heading cut short says how many there are.
    expect(
      (optionGroups[0]!["label"] as JSONObject)["text"] as string,
    ).toMatch(/^Hosts \(\d of 300\)$/);
  });

  test("every text Slack shows within its 75 characters", () => {
    const response: JSONObject = SlackAffectedResources.getOptionsResponse([
      {
        kind: AiAffectedResourceKind.NetworkDevice,
        count: 1,
        matches: [
          {
            kind: AiAffectedResourceKind.NetworkDevice,
            id: HOST_ID,
            name: "n".repeat(200),
            detail: "d".repeat(200),
          },
        ],
      },
    ]);

    const option: JSONObject = (
      (response["option_groups"] as Array<JSONObject>)[0]![
        "options"
      ] as Array<JSONObject>
    )[0]!;

    expect(
      ((option["text"] as JSONObject)["text"] as string).length,
    ).toBe(SLACK_OPTION_TEXT_MAX_LENGTH);
    expect(
      ((option["description"] as JSONObject)["text"] as string).length,
    ).toBe(SLACK_OPTION_TEXT_MAX_LENGTH);
  });

  test("nothing found: no options, which Slack shows as no results", () => {
    expect(SlackAffectedResources.getOptionsResponse([])).toEqual({
      options: [],
    });
    expect(
      SlackAffectedResources.getOptionsResponse([
        { kind: AiAffectedResourceKind.Host, count: 0, matches: [] },
      ]),
    ).toEqual({ options: [] });
  });
});

describe("an options request of the field", () => {
  test("is a block_suggestion of the field's own action", () => {
    expect(SlackAffectedResources.isOptionsRequest(blockSuggestion())).toBe(
      true,
    );
    expect(
      SlackAffectedResources.isOptionsRequest(
        blockSuggestion({ actionId: "labels" }),
      ),
    ).toBe(false);
    expect(
      SlackAffectedResources.isOptionsRequest(
        blockSuggestion({ type: "block_actions" }),
      ),
    ).toBe(false);
    expect(SlackAffectedResources.isOptionsRequest(null)).toBe(false);
    expect(SlackAffectedResources.isOptionsRequest([])).toBe(false);
  });

  test("is answered with what the member's search finds for what was typed, in the form's project", async () => {
    const response: JSONObject = await answerOptions({
      payload: JSON.stringify(blockSuggestion({ value: "  api  " })),
    });

    // Read as the press of the form itself would be.
    expect(isAuthorizedSpy).toHaveBeenCalledTimes(1);
    expect(
      (isAuthorizedSpy.mock.calls[0]![0] as { payload: JSONObject }).payload,
    ).toEqual(blockSuggestion({ value: "  api  " }));

    // As the member, in the project the form was drawn for.
    expect(memberPropsSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(searchSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: MEMBER_PROPS,
      text: "api",
      limitPerKind: 15,
    });

    expect(
      (response["option_groups"] as Array<JSONObject>).map(
        (optionGroup: JSONObject): unknown => {
          return (optionGroup["label"] as JSONObject)["text"];
        },
      ),
    ).toEqual(["Hosts"]);
  });

  test("a request posted as JSON, not a form, is read the same way", async () => {
    const response: JSONObject = await answerOptions(blockSuggestion());

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(response["option_groups"]).toBeDefined();
  });

  test.each([
    [
      "an account nobody connected",
      (): void => {
        slackRequest = {
          isAuthorized: false,
          projectId: PROJECT_ID,
        };
      },
    ],
    [
      "a workspace of several projects, with no clue which",
      (): void => {
        slackRequest = { isAuthorized: false };
      },
    ],
    [
      "a request read in no project",
      (): void => {
        slackRequest = { isAuthorized: true, userId: USER_ID };
      },
    ],
    [
      "a request with no member",
      (): void => {
        slackRequest = { isAuthorized: true, projectId: PROJECT_ID };
      },
    ],
  ])(
    "%s is listed nothing, and nothing is searched",
    async (_who: string, arrange: () => void) => {
      arrange();

      await expect(
        answerOptions({ payload: JSON.stringify(blockSuggestion()) }),
      ).resolves.toEqual({ options: [] });
      expect(searchSpy).not.toHaveBeenCalled();
    },
  );

  test("somebody no longer a member of the project is listed nothing", async () => {
    memberPropsSpy.mockRejectedValue(
      new NotAuthorizedException("You are not a member of this project."),
    );

    await expect(
      answerOptions({ payload: JSON.stringify(blockSuggestion()) }),
    ).resolves.toEqual({ options: [] });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("a request of another select, or no request of a select at all, is listed nothing and never read", async () => {
    for (const body of [
      { payload: JSON.stringify(blockSuggestion({ actionId: "labels" })) },
      { payload: JSON.stringify(blockSuggestion({ type: "block_actions" })) },
      { payload: "{not json" },
      { payload: "[1, 2]" },
      null,
      "text",
    ]) {
      answered = [];

      await expect(answerOptions(body)).resolves.toEqual({ options: [] });
    }

    expect(isAuthorizedSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("a search that fails is listed nothing - never an error, which Slack would show over the field", async () => {
    searchSpy.mockRejectedValue(new Error("connection reset"));

    await expect(
      answerOptions({ payload: JSON.stringify(blockSuggestion()) }),
    ).resolves.toEqual({ options: [] });
    expect(logger.error).toHaveBeenCalled();
  });
});
