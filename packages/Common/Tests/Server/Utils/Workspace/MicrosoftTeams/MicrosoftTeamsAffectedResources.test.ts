import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAffectedResources, {
  MICROSOFT_TEAMS_AFFECTED_RESOURCES_DATASET,
  MICROSOFT_TEAMS_MAX_SEARCH_RESULTS,
  MICROSOFT_TEAMS_SEARCH_INVOKE_NAME,
  MICROSOFT_TEAMS_SEARCH_RESPONSE_TYPE,
  MicrosoftTeamsInvokeResponse,
  MicrosoftTeamsSearchResult,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsAffectedResources";
import { MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAffectedResources, {
  WorkspaceAffectedResourceKindMatches,
  WorkspaceAffectedResourceMatch,
} from "../../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import { WorkspaceProjectClues } from "../../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import { AiAffectedResourceKind } from "../../../../../Types/AI/AiAffectedResources";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * MICROSOFT TEAMS' AFFECTED RESOURCES INPUT ON THE CREATE NEW INCIDENT CARD
 * (#5303 follow-up).
 *
 * An Input.ChoiceSet with dynamic typeahead: the card holds no list, and
 * Teams asks the bot ("application/search") as the person types. This suite
 * pins the input as the card carries it, the dataset that names the card's
 * project, the results' words and limits, and who is answered: a search is
 * read like a press of the card's own button - the organization's project,
 * the card's project only, the member the person's account is connected to
 * there - and answered 200 with no results, never an error, for anybody
 * OneUptime cannot act as. The real CloudAdapter round trip is
 * MicrosoftTeamsDeclareIncidentEndToEnd.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7ea50000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7ea50000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7ea50000-0000-4000-8000-000000000003");
const HOST_ID: string = "7ea50000-0000-4000-8000-0000000000a1";
const SWITCH_ID: string = "7ea50000-0000-4000-8000-0000000000a2";
const TENANT_ID: string = "7ea5aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AAD_OBJECT_ID: string = "7ea50000-0000-4000-8000-0000000000f1";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

// What Teams sends as the person types into the input.
function searchInvoke(
  data: {
    queryText?: unknown;
    dataset?: unknown;
    top?: unknown;
    tenantId?: string | null;
    aadObjectId?: string | null;
  } = {},
): JSONObject {
  return {
    type: "invoke",
    name: "application/search",
    id: "search-1",
    channelId: "msteams",
    from: {
      id: "29:1someone",
      name: "Someone",
      ...(data.aadObjectId === null
        ? {}
        : { aadObjectId: data.aadObjectId || AAD_OBJECT_ID }),
    },
    conversation: { id: "19:ops@thread.tacv2", conversationType: "channel" },
    channelData: {
      ...(data.tenantId === null
        ? {}
        : { tenant: { id: data.tenantId || TENANT_ID } }),
      channel: { id: "19:ops@thread.tacv2" },
    },
    // What a test asks for, values of any type: a Record, then cast.
    value: {
      queryText: "queryText" in data ? data.queryText : "api",
      queryOptions: { skip: 0, top: "top" in data ? data.top : 15 },
      dataset:
        "dataset" in data
          ? data.dataset
          : MicrosoftTeamsAffectedResources.getDataset(PROJECT_ID),
    } as Record<string, unknown> as JSONObject,
  };
}

function groupOf(
  kind: AiAffectedResourceKind,
  names: Array<string>,
): WorkspaceAffectedResourceKindMatches {
  return {
    kind: kind,
    count: names.length,
    matches: names.map(
      (name: string, index: number): WorkspaceAffectedResourceMatch => {
        return {
          kind: kind,
          id: `7ea50000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
          name: name,
        };
      },
    ),
  };
}

type ResolveProject = typeof MicrosoftTeamsUtil.resolveProjectByTenantId;
type GetUserId =
  typeof MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId;
type GetMemberProps = typeof WorkspaceActionAuthorization.getProjectMemberProps;
type Search = typeof WorkspaceAffectedResources.search;

let resolvedProjectId: ObjectID | null;
let resolveSpy: SpyInstance<ResolveProject>;
let userIdSpy: SpyInstance<GetUserId>;
let memberPropsSpy: SpyInstance<GetMemberProps>;
let searchSpy: SpyInstance<Search>;

beforeEach(() => {
  resolvedProjectId = PROJECT_ID;

  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  resolveSpy = jest
    .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
    .mockImplementation(async (): Promise<MicrosoftTeamsTenantResolution> => {
      return {
        projectAuth: resolvedProjectId
          ? ({
              projectId: resolvedProjectId,
            } as unknown as WorkspaceProjectAuthToken)
          : null,
        isAmbiguous: !resolvedProjectId,
        candidateProjectIds: [PROJECT_ID],
      };
    });
  userIdSpy = jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(USER_ID);
  memberPropsSpy = jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(MEMBER_PROPS);
  searchSpy = jest
    .spyOn(WorkspaceAffectedResources, "search")
    .mockResolvedValue([
      groupOf(AiAffectedResourceKind.Host, ["api-1", "api-2"]),
    ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function resultsOf(
  response: MicrosoftTeamsInvokeResponse,
): Array<MicrosoftTeamsSearchResult> {
  expect(response.status).toBe(200);
  expect(response.body["type"]).toBe(MICROSOFT_TEAMS_SEARCH_RESPONSE_TYPE);

  return (response.body["value"] as JSONObject)[
    "results"
  ] as Array<MicrosoftTeamsSearchResult>;
}

describe("the input, as the card carries it", () => {
  test("a dynamic typeahead of several picks, optional, that names the card's project - with the line that says why it is there", () => {
    expect(
      MicrosoftTeamsAffectedResources.getInputElements({
        projectId: PROJECT_ID,
        initial: [],
        isAiEnabled: true,
      }),
    ).toEqual([
      {
        type: "Input.ChoiceSet",
        id: "affectedResources",
        label: "Affected Resources (Optional)",
        placeholder: "Search hosts, clusters, databases…",
        style: "filtered",
        isMultiSelect: true,
        choices: [],
        "choices.data": {
          type: "Data.Query",
          dataset: `oneuptime.affectedResources:${PROJECT_ID.toString()}`,
        },
      },
      {
        type: "TextBlock",
        text: "OneUptime AI investigates what you pick here, and can fix it.",
        isSubtle: true,
        size: "Small",
        wrap: true,
        spacing: "Small",
      },
    ]);
  });

  test("a project with AI off: the input alone, with no line about AI", () => {
    const elements: Array<JSONObject> =
      MicrosoftTeamsAffectedResources.getInputElements({
        projectId: PROJECT_ID,
        initial: [],
        isAiEnabled: false,
      });

    expect(elements).toHaveLength(1);
    expect(elements[0]!["id"]).toBe("affectedResources");
    expect(JSON.stringify(elements)).not.toContain("AI");
  });

  test("declared from an alert's channel, the alert's resources are picked already, each with its kind", () => {
    const input: JSONObject = MicrosoftTeamsAffectedResources.getInputElements({
      projectId: PROJECT_ID,
      initial: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
        {
          kind: AiAffectedResourceKind.NetworkDevice,
          id: SWITCH_ID,
          name: "core-sw-01",
        },
      ],
      isAiEnabled: true,
    })[0]!;

    expect(input["choices"]).toEqual([
      { title: "api-1 (Host)", value: `Host:${HOST_ID}` },
      {
        title: "core-sw-01 (Network Device)",
        value: `NetworkDevice:${SWITCH_ID}`,
      },
    ]);
    expect(input["value"]).toBe(`Host:${HOST_ID},NetworkDevice:${SWITCH_ID}`);
  });

  test("nothing picked already: no value at all", () => {
    expect(
      MicrosoftTeamsAffectedResources.getInputElements({
        projectId: PROJECT_ID,
        initial: [],
        isAiEnabled: true,
      })[0]!["value"],
    ).toBeUndefined();
  });
});

describe("the dataset names the card's project", () => {
  test("written and read back", () => {
    const dataset: string =
      MicrosoftTeamsAffectedResources.getDataset(PROJECT_ID);

    expect(dataset).toBe(
      `${MICROSOFT_TEAMS_AFFECTED_RESOURCES_DATASET}:${PROJECT_ID.toString()}`,
    );
    expect(MicrosoftTeamsAffectedResources.readDatasetProjectId(dataset)).toBe(
      PROJECT_ID.toString(),
    );
  });

  test.each([
    ["another input's dataset", "npm"],
    ["ours, with no project", "oneuptime.affectedResources"],
    ["ours, naming no project", "oneuptime.affectedResources:prod"],
    ["ours, with nothing after it", "oneuptime.affectedResources:"],
    ["nothing", undefined],
    ["a number", 7],
  ])("names no project: %s", (_what: string, dataset: unknown) => {
    expect(
      MicrosoftTeamsAffectedResources.readDatasetProjectId(dataset),
    ).toBeUndefined();
  });
});

describe("a search invoke", () => {
  test("is an invoke named application/search", () => {
    expect(MICROSOFT_TEAMS_SEARCH_INVOKE_NAME).toBe("application/search");
    expect(MicrosoftTeamsAffectedResources.isSearch(searchInvoke())).toBe(true);
    expect(
      MicrosoftTeamsAffectedResources.isSearch({
        ...searchInvoke(),
        name: "adaptiveCard/action",
      }),
    ).toBe(false);
    expect(
      MicrosoftTeamsAffectedResources.isSearch({
        ...searchInvoke(),
        type: "message",
      }),
    ).toBe(false);
    expect(MicrosoftTeamsAffectedResources.isSearch(null)).toBe(false);
  });
});

describe("the results' words", () => {
  test("a resource's kind beside its name, and what tells two of one name apart", () => {
    expect(
      MicrosoftTeamsAffectedResources.getResultTitle({
        kind: AiAffectedResourceKind.Host,
        name: "api-1",
      }),
    ).toBe("api-1 (Host)");
    expect(
      MicrosoftTeamsAffectedResources.getResultTitle({
        kind: AiAffectedResourceKind.NetworkDevice,
        name: "core-sw-01",
        detail: "10.0.4.1",
      }),
    ).toBe("core-sw-01 (Network Device · 10.0.4.1)");
    expect(
      MicrosoftTeamsAffectedResources.getResultTitle({
        kind: AiAffectedResourceKind.DatabaseServer,
        name: "orders",
      }),
    ).toBe("orders (Database)");
  });

  test("cut to what a Teams row shows", () => {
    const title: string = MicrosoftTeamsAffectedResources.getResultTitle({
      kind: AiAffectedResourceKind.Host,
      name: "h".repeat(200),
    });

    expect(title).toHaveLength(MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });

  test(`at most ${MICROSOFT_TEAMS_MAX_SEARCH_RESULTS} results, the kinds in turn`, () => {
    const results: Array<MicrosoftTeamsSearchResult> =
      MicrosoftTeamsAffectedResources.toResults({
        groups: [
          groupOf(
            AiAffectedResourceKind.Host,
            Array.from({ length: 20 }, (_value: unknown, index: number) => {
              return `web-${String(index).padStart(2, "0")}`;
            }),
          ),
          groupOf(AiAffectedResourceKind.KubernetesCluster, ["web-prod"]),
        ],
        text: "web",
        limit: 50,
      });

    expect(results).toHaveLength(MICROSOFT_TEAMS_MAX_SEARCH_RESULTS);
    expect(
      results.slice(0, 3).map((result: MicrosoftTeamsSearchResult) => {
        return result.title;
      }),
    ).toEqual([
      "web-00 (Host)",
      "web-prod (Kubernetes Cluster)",
      "web-01 (Host)",
    ]);
  });

  test("the answer as Teams takes it, never more than its limit", () => {
    const many: Array<MicrosoftTeamsSearchResult> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): MicrosoftTeamsSearchResult => {
        return { title: `r${index}`, value: `v${index}` };
      },
    );

    const response: MicrosoftTeamsInvokeResponse =
      MicrosoftTeamsAffectedResources.getSearchResponse(many);

    expect(response).toEqual({
      status: 200,
      body: {
        type: "application/vnd.microsoft.search.searchResponse",
        value: { results: many.slice(0, MICROSOFT_TEAMS_MAX_SEARCH_RESULTS) },
      },
    });
  });
});

describe("who a search is answered for", () => {
  test("the member, in the card's project: what was typed, at most what Teams asked for", async () => {
    const response: MicrosoftTeamsInvokeResponse =
      await MicrosoftTeamsAffectedResources.answerSearch({
        activity: searchInvoke({ queryText: "  api  ", top: 10 }),
      });

    expect(resultsOf(response)).toEqual([
      {
        title: "api-1 (Host)",
        value: "Host:7ea50000-0000-4000-8000-000000000100",
      },
      {
        title: "api-2 (Host)",
        value: "Host:7ea50000-0000-4000-8000-000000000101",
      },
    ]);

    // The card's project is the clue a press of its button would give.
    const clues: WorkspaceProjectClues = (
      resolveSpy.mock.calls[0]![0] as { clues: WorkspaceProjectClues }
    ).clues;
    expect(
      (resolveSpy.mock.calls[0]![0] as { tenantId: string }).tenantId,
    ).toBe(TENANT_ID);
    expect(clues.drawnForProjectId).toBe(PROJECT_ID.toString());
    expect(clues.workspaceUserId).toBe(AAD_OBJECT_ID);
    expect(clues.channelId).toBe("19:ops@thread.tacv2");

    // As whoever typed, in that project.
    expect(userIdSpy).toHaveBeenCalledWith({
      teamsUserId: AAD_OBJECT_ID,
      projectId: PROJECT_ID,
    });
    expect(memberPropsSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(searchSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: MEMBER_PROPS,
      text: "api",
      limitPerKind: 10,
    });
  });

  test("Teams asks for nothing, or more than it lists: fifteen", async () => {
    for (const top of [undefined, 0, -3, "15", 200]) {
      searchSpy.mockClear();

      await MicrosoftTeamsAffectedResources.answerSearch({
        activity: searchInvoke({ top: top }),
      });

      expect({
        top,
        limit: (searchSpy.mock.calls[0]![0] as { limitPerKind: number })
          .limitPerKind,
      }).toEqual({ top, limit: MICROSOFT_TEAMS_MAX_SEARCH_RESULTS });
    }
  });

  test.each([
    [
      "a dataset of another input",
      (): JSONObject => {
        return searchInvoke({ dataset: "npm" });
      },
    ],
    [
      "no dataset",
      (): JSONObject => {
        return searchInvoke({ dataset: undefined });
      },
    ],
    [
      "no tenant",
      (): JSONObject => {
        return searchInvoke({ tenantId: null });
      },
    ],
    [
      "nobody it is from",
      (): JSONObject => {
        return searchInvoke({ aadObjectId: null });
      },
    ],
  ])(
    "%s: no results, and no project is read",
    async (_what: string, activity: () => JSONObject) => {
      expect(
        resultsOf(
          await MicrosoftTeamsAffectedResources.answerSearch({
            activity: activity(),
          }),
        ),
      ).toEqual([]);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    },
  );

  test("an organization whose project cannot be told apart: no results", async () => {
    resolvedProjectId = null;

    expect(
      resultsOf(
        await MicrosoftTeamsAffectedResources.answerSearch({
          activity: searchInvoke(),
        }),
      ),
    ).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("a card of a project the organization is no longer connected to searches nothing - never another project's resources", async () => {
    resolvedProjectId = OTHER_PROJECT_ID;

    expect(
      resultsOf(
        await MicrosoftTeamsAffectedResources.answerSearch({
          activity: searchInvoke(),
        }),
      ),
    ).toEqual([]);
    expect(userIdSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("somebody whose Teams account nobody connected, typing into a card in a channel: no results, and nothing said", async () => {
    userIdSpy.mockRejectedValue(
      new MicrosoftTeamsAccountNotLinkedException("Not linked."),
    );

    expect(
      resultsOf(
        await MicrosoftTeamsAffectedResources.answerSearch({
          activity: searchInvoke(),
        }),
      ),
    ).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("somebody no longer a member of the project: no results", async () => {
    memberPropsSpy.mockRejectedValue(
      new NotAuthorizedException("You are not a member of this project."),
    );

    expect(
      resultsOf(
        await MicrosoftTeamsAffectedResources.answerSearch({
          activity: searchInvoke(),
        }),
      ),
    ).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test("a search that fails: no results, 200 all the same, and it never throws", async () => {
    searchSpy.mockRejectedValue(new Error("connection reset"));

    expect(
      resultsOf(
        await MicrosoftTeamsAffectedResources.answerSearch({
          activity: searchInvoke(),
        }),
      ),
    ).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("nothing typed yet: suggestions, the first of each kind", async () => {
    await MicrosoftTeamsAffectedResources.answerSearch({
      activity: searchInvoke({ queryText: undefined }),
    });

    expect((searchSpy.mock.calls[0]![0] as { text: string }).text).toBe("");
  });
});
