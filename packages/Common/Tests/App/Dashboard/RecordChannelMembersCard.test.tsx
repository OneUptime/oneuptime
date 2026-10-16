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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo } from "./SideMenuHarness";

/*
 * THE CHANNEL CARD ON A RECORD'S PAGE - the customer's question: "if all
 * users leave a private channel, can someone re-enter or invite others
 * without requiring assistance from a Slack workspace admin?" The card
 * shows who is in the record's channel and, for somebody who may edit the
 * record, Join channel and Add people. Driven as a person uses it, through
 * the real card, its data hook and the real people search list; only the
 * HTTP layer (API.get / API.post), the people search's model reads and the
 * signed-in user are stubbed - and every request the card sends is
 * asserted.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          // One string in German, to show the card's words are looked up.
          if (key === "Join channel" && germanJoin) {
            return "Kanal beitreten";
          }

          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

let germanJoin: boolean = false;

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return { tenantid: "c8000000-0000-4000-8000-0000000000aa" };
      },
    },
  };
});

import RecordChannelMembersCard from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/RecordChannelMembersCard";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceChannelMembersUtil, {
  WorkspaceChannelAddAnswer,
  WorkspaceChannelAddOutcome,
  WorkspaceChannelPerson,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannel,
  WorkspaceRecordChannels,
} from "../../../Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "c8000000-0000-4000-8000-0000000000aa";
const RECORD_ID: ObjectID = new ObjectID(
  "c8000000-0000-4000-8000-000000000001",
);
const VIEWER: string = "c8000000-0000-4000-8000-000000000011";
const BOB: string = "c8000000-0000-4000-8000-000000000012";
const CAROL: string = "c8000000-0000-4000-8000-000000000013";
const DAN: string = "c8000000-0000-4000-8000-000000000014";
const PLATFORM: string = "c8000000-0000-4000-8000-000000000021";

const SLACK_URL: string =
  "https://slack.com/app_redirect?channel=C0INC42&team=T0ACME";
const TEAMS_URL: string =
  "https://teams.microsoft.com/l/channel/19%3Aacme%40thread.tacv2/inc-42?groupId=c8000000-0000-4000-8000-000000000031";

const SLACK_LINK: WorkspaceChannelLink = {
  workspaceType: WorkspaceType.Slack,
  channelName: "inc-42",
  url: SLACK_URL,
};
const TEAMS_LINK: WorkspaceChannelLink = {
  workspaceType: WorkspaceType.MicrosoftTeams,
  channelName: "inc-42",
  url: TEAMS_URL,
};

function person(
  key: string,
  name: string,
  userId?: string,
): WorkspaceChannelPerson {
  return { key, name, ...(userId ? { userId } : {}) };
}

function slackChannel(
  overrides: Partial<WorkspaceRecordChannel> = {},
): WorkspaceRecordChannel {
  return {
    channelId: "C0INC42",
    workspaceType: WorkspaceType.Slack,
    name: "inc-42",
    url: SLACK_URL,
    isPrivate: true,
    state: WorkspaceChannelState.Members,
    people: [
      person("U0BOB", "Bob Jones", BOB),
      person("U0SAM", "Sam from Support"),
    ],
    peopleCount: 2,
    viewer: WorkspaceChannelViewerStatus.NotIn,
    ...overrides,
  };
}

function teamsChannel(
  overrides: Partial<WorkspaceRecordChannel> = {},
): WorkspaceRecordChannel {
  return {
    channelId: "19:acme@thread.tacv2",
    workspaceType: WorkspaceType.MicrosoftTeams,
    name: "inc-42",
    url: TEAMS_URL,
    isPrivate: false,
    state: WorkspaceChannelState.ManagedInTeams,
    people: [],
    peopleCount: 0,
    viewer: WorkspaceChannelViewerStatus.NotFound,
    teamName: "Ops",
    ...overrides,
  };
}

interface SentRequest {
  method: "GET" | "POST";
  url: string;
  data: JSONObject;
  headers: unknown;
}

let sent: Array<SentRequest> = [];
let readAnswers: Array<WorkspaceRecordChannels | HTTPErrorResponse> = [];
let addAnswers: Array<WorkspaceChannelAddAnswer | HTTPErrorResponse> = [];
let lastRead: WorkspaceRecordChannels = { channels: [], canAddPeople: false };

function readAnswer(answer: WorkspaceRecordChannels): void {
  lastRead = answer;
  readAnswers = [];
}

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

beforeEach(() => {
  germanJoin = false;
  sent = [];
  readAnswers = [];
  addAnswers = [];
  lastRead = { channels: [], canAddPeople: false };
  goTo(`/dashboard/${PROJECT_ID}/incidents/${RECORD_ID.toString()}`);

  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(VIEWER));

  jest.spyOn(API, "get").mockImplementation((async (args: {
    url: URL;
    data: JSONObject;
    headers: unknown;
  }) => {
    sent.push({
      method: "GET",
      url: args.url.toString(),
      data: args.data,
      headers: args.headers,
    });

    const next: WorkspaceRecordChannels | HTTPErrorResponse =
      readAnswers.shift() || lastRead;

    if (next instanceof HTTPErrorResponse) {
      return next;
    }

    return new HTTPResponse<JSONObject>(
      200,
      WorkspaceChannelMembersUtil.channelsToJSON(next),
      {},
    );
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: URL;
    data: JSONObject;
    headers: unknown;
  }) => {
    sent.push({
      method: "POST",
      url: args.url.toString(),
      data: args.data,
      headers: args.headers,
    });

    const next: WorkspaceChannelAddAnswer | HTTPErrorResponse | undefined =
      addAnswers.shift();

    if (next instanceof HTTPErrorResponse) {
      return next;
    }

    return new HTTPResponse<JSONObject>(
      200,
      WorkspaceChannelMembersUtil.addAnswerToJSON(next || { results: [] }),
      {},
    );
  }) as never);

  // The Add people list: the project's people and teams.
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const people: Array<User> = [
        makeUser(VIEWER, "Alice Smith", "alice@acme.test"),
        makeUser(BOB, "Bob Jones", "bob@acme.test"),
        makeUser(CAROL, "Carol Lee", "carol@acme.test"),
        makeUser(DAN, "Dan Brown", "dan@acme.test"),
      ];

      return {
        data: people.map((user: User): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        }),
        count: people.length,
        skip: 0,
        limit: people.length,
      };
    }

    if (request.modelType === Team) {
      const team: Team = new Team();
      team._id = PLATFORM;
      team.name = "Platform";
      return { data: [team], count: 1, skip: 0, limit: 1 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getListMock.mockReset();
});

function renderCard(data: {
  links?: Array<WorkspaceChannelLink>;
  recordType?: WorkspaceChannelRecordType;
  onChanged?: MockFunction;
}): { onChanged: MockFunction } {
  const onChanged: MockFunction = data.onChanged || getJestMockFunction();

  render(
    <MemoryRouter>
      <RecordChannelMembersCard
        recordType={data.recordType || WorkspaceChannelRecordType.Incident}
        recordId={RECORD_ID}
        links={data.links || [SLACK_LINK]}
        onChanged={onChanged as unknown as () => void}
      />
    </MemoryRouter>,
  );

  return { onChanged };
}

async function card(): Promise<HTMLElement> {
  const element: HTMLElement = await screen.findByTestId(
    "record-channel-members-card",
  );

  await waitFor(() => {
    expect(within(element).queryByRole("progressbar")).toBeNull();
    expect(within(element).getAllByTestId("record-channel").length).toBe(
      lastRead.channels.length,
    );
  });

  return element;
}

function requestsOf(method: "GET" | "POST"): Array<SentRequest> {
  return sent.filter((request: SentRequest) => {
    return request.method === method;
  });
}

function pathOf(url: string): string {
  return new globalThis.URL(url).pathname;
}

describe("whether there is a card at all", () => {
  test("a record without a channel of its own has no card, and the page asks nothing more", async () => {
    renderCard({ links: [] });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("record-channel-members-card")).toBeNull();
    expect(sent).toEqual([]);
  });

  test("a record with a channel reads who is in it, at its own route, with the project", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    renderCard({ recordType: WorkspaceChannelRecordType.IncidentEpisode });

    await card();

    expect(requestsOf("GET").length).toBe(1);
    expect(
      pathOf(requestsOf("GET")[0]!.url).endsWith(
        `/workspace-channel-members/incident-episode/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
    expect(requestsOf("GET")[0]!.headers).toEqual({ tenantid: PROJECT_ID });
  });

  test("the record turned out to have no channel after all: no card", async () => {
    readAnswer({ channels: [], canAddPeople: true });
    renderCard({});

    await waitFor(() => {
      expect(requestsOf("GET").length).toBe(1);
      expect(screen.queryByTestId("record-channel-members-card")).toBeNull();
    });
  });

  test("a read that fails says so, and Try again reads again", async () => {
    readAnswers = [
      new HTTPErrorResponse(
        500,
        { message: "Slack could not be reached." },
        {},
      ),
    ];
    lastRead = { channels: [slackChannel()], canAddPeople: true };
    renderCard({});

    expect(
      await screen.findByText(
        /Could not read who is in this channel\. Slack could not be reached\./,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Refresh|Try again/ }));

    await card();
    expect(requestsOf("GET").length).toBe(2);
  });

  test("a read that fails is said in the card's own quiet box, with Try again - busy until the next answer", async () => {
    let answerRetry: (() => void) | undefined;

    readAnswers = [new HTTPErrorResponse(500, { message: "Server Error" }, {})];
    lastRead = { channels: [slackChannel()], canAddPeople: true };
    renderCard({});

    const box: HTMLElement = await screen.findByTestId(
      "record-channel-read-error",
    );

    // Not the page-wide error panel with its "Refresh?" link.
    expect(within(box).getByRole("alert")).toHaveTextContent(
      "Could not read who is in this channel. Server Error",
    );
    expect(screen.queryByText("Refresh?")).toBeNull();

    // The retry is held until this test lets it answer.
    jest.spyOn(API, "get").mockImplementationOnce((async () => {
      await new Promise<void>((resolve: () => void) => {
        answerRetry = resolve;
      });

      return new HTTPResponse<JSONObject>(
        200,
        WorkspaceChannelMembersUtil.channelsToJSON(lastRead),
        {},
      );
    }) as never);

    const tryAgain: HTMLElement = within(box).getByTestId(
      "record-channel-read-try-again",
    );

    expect(tryAgain).toHaveTextContent("Try again");
    fireEvent.click(tryAgain);

    await waitFor(() => {
      expect(tryAgain).toBeDisabled();
    });
    expect(tryAgain).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      answerRetry?.();
      await Promise.resolve();
    });

    await card();
    expect(screen.queryByTestId("record-channel-read-error")).toBeNull();
  });
});

describe("the channel and the people in it", () => {
  test("names the channel as a link to it, says it is private and how many are in it, and lists them", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    renderCard({});

    const element: HTMLElement = await card();

    const name: HTMLElement = within(element).getByTestId(
      "record-channel-name",
    );
    expect(name).toHaveTextContent("#inc-42");
    expect(name).toHaveAttribute("href", SLACK_URL);
    expect(name).toHaveAttribute("target", "_blank");
    expect(name).toHaveAttribute("rel", "noopener noreferrer");

    expect(
      within(element).getByTestId("record-channel-meta"),
    ).toHaveTextContent("Private channel · 2 people");
    expect(
      within(element)
        .getAllByTestId("record-channel-person-name")
        .map((name: HTMLElement) => {
          return name.textContent;
        }),
    ).toEqual(["Bob Jones", "Sam from Support"]);
    expect(screen.getByText("Slack Channel")).toBeInTheDocument();
  });

  test("the viewer is marked You", async () => {
    readAnswer({
      channels: [
        slackChannel({
          people: [
            { ...person("U0ALICE", "Alice Smith", VIEWER), isViewer: true },
            person("U0BOB", "Bob Jones", BOB),
          ],
          viewer: WorkspaceChannelViewerStatus.In,
        }),
      ],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();
    const rows: Array<HTMLElement> = within(element).getAllByTestId(
      "record-channel-person",
    );

    expect(
      within(rows[0]!).getByTestId("record-channel-person-you"),
    ).toHaveTextContent("You");
    expect(
      within(rows[1]!).queryByTestId("record-channel-person-you"),
    ).toBeNull();
    // In it already: no Join, only Add people.
    expect(within(element).queryByTestId("record-channel-join")).toBeNull();
    expect(within(element).queryByTestId("record-channel-not-in")).toBeNull();
    expect(
      within(element).getByTestId("record-channel-add-people"),
    ).toBeInTheDocument();
  });

  test("the customer's channel - everybody left: nobody, said once, and Join channel", async () => {
    readAnswer({
      channels: [slackChannel({ people: [], peopleCount: 0 })],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("record-channel-nobody"),
    ).toHaveTextContent("Nobody is in this channel.");
    // Neither "0 people" nor "You're not in this channel." repeats it.
    expect(
      within(element).getByTestId("record-channel-meta"),
    ).toHaveTextContent(/^Private channel$/);
    expect(within(element).queryByTestId("record-channel-not-in")).toBeNull();
    expect(
      within(element).getByTestId("record-channel-join"),
    ).toHaveTextContent("Join channel");
  });

  test("a long list shows five, then Show N more, then Show fewer", async () => {
    const people: Array<WorkspaceChannelPerson> = Array.from(
      { length: 8 },
      (_: unknown, index: number) => {
        return person(`U${index}`, `Person ${index}`);
      },
    );
    readAnswer({
      channels: [slackChannel({ people, peopleCount: 8 })],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();

    expect(within(element).getAllByTestId("record-channel-person").length).toBe(
      5,
    );

    const more: HTMLElement = within(element).getByTestId(
      "record-channel-show-more",
    );
    expect(more).toHaveTextContent("Show 3 more");
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);

    expect(within(element).getAllByTestId("record-channel-person").length).toBe(
      8,
    );
    expect(more).toHaveTextContent("Show fewer");
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  test("people Slack was not asked to name are counted, not dropped", async () => {
    readAnswer({
      channels: [slackChannel({ peopleCount: 5 })],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("record-channel-unnamed"),
    ).toHaveTextContent("and 3 more people");
    expect(
      within(element).getByTestId("record-channel-meta"),
    ).toHaveTextContent("5 people");
  });

  test("a public channel says so", async () => {
    readAnswer({
      channels: [slackChannel({ isPrivate: false })],
      canAddPeople: true,
    });
    renderCard({});

    expect(
      within(await card()).getByTestId("record-channel-meta"),
    ).toHaveTextContent("Public channel · 2 people");
  });
});

describe("joining the channel", () => {
  test("Join channel has the app invite the viewer, then the card reads again and says they are in", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: VIEWER,
            name: "Alice Smith",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      },
    ];
    const { onChanged } = renderCard({});

    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("record-channel-not-in"),
    ).toHaveTextContent("You're not in this channel.");

    lastRead = {
      channels: [
        slackChannel({
          people: [
            { ...person("U0ALICE", "Alice Smith", VIEWER), isViewer: true },
            person("U0BOB", "Bob Jones", BOB),
          ],
          peopleCount: 2,
          viewer: WorkspaceChannelViewerStatus.In,
        }),
      ],
      canAddPeople: true,
    };

    fireEvent.click(within(element).getByTestId("record-channel-join"));

    expect(
      await within(element).findByText("You're in the channel now."),
    ).toBeInTheDocument();

    const posts: Array<SentRequest> = requestsOf("POST");
    expect(posts.length).toBe(1);
    expect(
      pathOf(posts[0]!.url).endsWith(
        `/workspace-channel-members/incident/${RECORD_ID.toString()}/add`,
      ),
    ).toBe(true);
    expect(posts[0]!.data).toEqual({
      channelId: "C0INC42",
      userIds: [VIEWER],
      teamIds: [],
    });
    expect(posts[0]!.headers).toEqual({ tenantid: PROJECT_ID });

    // The feed has a new entry; the card read who is in it again.
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(requestsOf("GET").length).toBe(2);
      expect(
        within(element).getByTestId("record-channel-person-you"),
      ).toBeInTheDocument();
    });

    // With a link to the channel, beside the news.
    const open: HTMLElement = within(element).getByRole("link", {
      name: "Open in Slack",
    });
    expect(open).toHaveAttribute("href", SLACK_URL);
    expect(within(element).queryByTestId("record-channel-join")).toBeNull();

    /*
     * The button pressed is gone: the keyboard moves on to the channel's
     * link beside the news, not back to the top of the page.
     */
    expect(open).toHaveAttribute(
      "data-testid",
      "record-channel-open-after-join",
    );
    expect(document.activeElement).toBe(open);
  });

  test("a join Slack refused leaves focus on Join channel, to try again", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: VIEWER,
            name: "Alice Smith",
            outcome: WorkspaceChannelAddOutcome.Refused,
          },
        ],
      },
    ];
    renderCard({});

    const element: HTMLElement = await card();
    const join: HTMLElement = within(element).getByTestId(
      "record-channel-join",
    );

    join.focus();
    fireEvent.click(join);

    expect(
      await within(element).findByText("Slack didn't let OneUptime add you."),
    ).toBeInTheDocument();
    expect(
      within(element).queryByTestId("record-channel-open-after-join"),
    ).toBeNull();
    expect(document.activeElement).toBe(join);
  });

  test("Join channel and Add people share one row and fill it, each a full row when the column is too narrow for both", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    renderCard({});

    const element: HTMLElement = await card();
    const actions: HTMLElement = within(element).getByTestId(
      "record-channel-actions",
    );
    const join: HTMLElement = within(actions).getByTestId(
      "record-channel-join",
    );
    const addPeople: HTMLElement = within(actions).getByTestId(
      "record-channel-add-people",
    );

    // jsdom lays nothing out: the classes that do it (E2E measures it).
    expect(actions.className.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap"]),
    );
    expect(join.className.split(" ")).toEqual(
      expect.arrayContaining([
        "flex-auto",
        "justify-center",
        "whitespace-nowrap",
      ]),
    );
    expect(addPeople.parentElement!.className.split(" ")).toContain(
      "flex-auto",
    );
    expect(addPeople.className.split(" ")).toEqual(
      expect.arrayContaining(["w-full", "justify-center", "whitespace-nowrap"]),
    );
  });

  test("a viewer OneUptime cannot find in Slack is told so where they pressed", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: VIEWER,
            name: "Alice Smith",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
        ],
      },
    ];
    renderCard({});

    const element: HTMLElement = await card();
    fireEvent.click(within(element).getByTestId("record-channel-join"));

    const result: HTMLElement = await within(element).findByTestId(
      "record-channel-join-result",
    );

    expect(within(result).getByRole("alert")).toHaveTextContent(
      "OneUptime can't find your Slack account, so it can't add you.",
    );
    expect(within(result).queryByRole("link")).toBeNull();
  });

  test("a channel that turned out archived says so", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      { channelState: WorkspaceChannelState.Archived, results: [] },
    ];
    renderCard({});

    const element: HTMLElement = await card();
    fireEvent.click(within(element).getByTestId("record-channel-join"));

    expect(
      await within(element).findByText(
        "This channel is archived. Unarchive it in Slack to add people.",
      ),
    ).toBeInTheDocument();
  });

  test("a refused request is said with the server's words", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      new HTTPErrorResponse(
        422,
        {
          message:
            "You do not have permission to add people to this incident's channel: it needs permission to edit the incident.",
        },
        {},
      ),
    ];
    const { onChanged } = renderCard({});

    const element: HTMLElement = await card();
    fireEvent.click(within(element).getByTestId("record-channel-join"));

    expect(
      await within(element).findByTestId("record-channel-join-error"),
    ).toHaveTextContent("it needs permission to edit the incident");
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("Join channel is a word of the reader's language", async () => {
    germanJoin = true;
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    renderCard({});

    expect(
      within(await card()).getByTestId("record-channel-join"),
    ).toHaveTextContent("Kanal beitreten");
  });
});

describe("what somebody without Join channel is told", () => {
  test("OneUptime cannot find the viewer in Slack: Connect Slack account, to their own Slack settings", async () => {
    readAnswer({
      channels: [
        slackChannel({ viewer: WorkspaceChannelViewerStatus.NotFound }),
      ],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();
    const connect: HTMLElement = within(element).getByTestId(
      "record-channel-connect",
    );

    expect(connect).toHaveTextContent(
      "OneUptime can't find your Slack account, so it can't add you.",
    );

    const link: HTMLElement = within(connect).getByText(
      "Connect Slack account",
    );
    expect(link.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/user-settings/slack-integration?connectAccount=true`,
    );
    expect(within(element).queryByTestId("record-channel-join")).toBeNull();
    // They may still add other people.
    expect(
      within(element).getByTestId("record-channel-add-people"),
    ).toBeInTheDocument();
  });

  test.each([
    [
      WorkspaceChannelRecordType.Incident,
      "You're not in this channel. Ask someone who can edit this incident to add you.",
    ],
    [
      WorkspaceChannelRecordType.Alert,
      "You're not in this channel. Ask someone who can edit this alert to add you.",
    ],
    [
      WorkspaceChannelRecordType.IncidentEpisode,
      "You're not in this channel. Ask someone who can edit this episode to add you.",
    ],
    [
      WorkspaceChannelRecordType.AlertEpisode,
      "You're not in this channel. Ask someone who can edit this episode to add you.",
    ],
    [
      WorkspaceChannelRecordType.ScheduledMaintenance,
      "You're not in this channel. Ask someone who can edit this event to add you.",
    ],
  ] as Array<[WorkspaceChannelRecordType, string]>)(
    "a %s's private channel, without permission: who to ask, and no buttons",
    async (recordType: WorkspaceChannelRecordType, sentence: string) => {
      readAnswer({ channels: [slackChannel()], canAddPeople: false });
      renderCard({ recordType });

      const element: HTMLElement = await card();

      expect(
        within(element).getByTestId("record-channel-ask"),
      ).toHaveTextContent(sentence);
      expect(within(element).queryByTestId("record-channel-join")).toBeNull();
      expect(
        within(element).queryByTestId("record-channel-add-people"),
      ).toBeNull();
    },
  );

  test("a public channel, without permission: open it in Slack to join", async () => {
    readAnswer({
      channels: [slackChannel({ isPrivate: false })],
      canAddPeople: false,
    });
    renderCard({});

    expect(
      within(await card()).getByTestId("record-channel-join-in-slack"),
    ).toHaveTextContent(
      "You're not in this channel. It's public: open it in Slack to join.",
    );
  });

  test("what someone without Join channel is told reads as large as 'You're not in this channel.'", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    renderCard({});

    const notIn: HTMLElement = within(await card()).getByTestId(
      "record-channel-not-in",
    );
    const sentenceClasses: Array<string> = notIn.className
      .split(" ")
      .filter((name: string): boolean => {
        return name.startsWith("text-");
      });

    cleanup();

    for (const [isPrivate, testId] of [
      [true, "record-channel-ask"],
      [false, "record-channel-join-in-slack"],
    ] as Array<[boolean, string]>) {
      readAnswer({
        channels: [slackChannel({ isPrivate })],
        canAddPeople: false,
      });
      renderCard({});

      const prompt: HTMLElement = within(await card()).getByTestId(testId);

      expect(prompt.className.split(" ")).toEqual(
        expect.arrayContaining(sentenceClasses),
      );
      cleanup();
    }
  });
});

describe("a channel that can take nobody", () => {
  test("archived: named so, its people listed, and no buttons", async () => {
    readAnswer({
      channels: [slackChannel({ state: WorkspaceChannelState.Archived })],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("record-channel-meta"),
    ).toHaveTextContent("Archived · 2 people");
    expect(
      within(element).getByTestId("record-channel-state"),
    ).toHaveTextContent(
      "This channel is archived. Unarchive it in Slack to add people.",
    );
    expect(within(element).getAllByTestId("record-channel-person").length).toBe(
      2,
    );
    expect(within(element).queryByTestId("record-channel-join")).toBeNull();
    expect(
      within(element).queryByTestId("record-channel-add-people"),
    ).toBeNull();
  });

  test("out of OneUptime's sight: what happened, and how to let the app back in", async () => {
    readAnswer({
      channels: [
        slackChannel({
          state: WorkspaceChannelState.Unreachable,
          people: [],
          peopleCount: 0,
          isPrivate: null,
          viewer: WorkspaceChannelViewerStatus.NotFound,
        }),
      ],
      canAddPeople: true,
    });
    renderCard({});

    const state: HTMLElement = within(await card()).getByTestId(
      "record-channel-state",
    );

    expect(state).toHaveTextContent(
      "OneUptime can't see this channel. It was deleted, or the OneUptime app was removed from it.",
    );
    expect(state).toHaveTextContent(
      "If it's still there, someone in it can add the app back by typing /invite @OneUptime.",
    );
    expect(screen.queryByTestId("record-channel-people")).toBeNull();

    // The command reads as one: to be typed as written, left to right.
    const command: HTMLElement = within(state).getByText("/invite @OneUptime");

    expect(command.tagName).toBe("CODE");
    expect(command).toHaveAttribute("dir", "ltr");
    expect(
      within(state).getByTestId("record-channel-unreachable-hint"),
    ).toHaveTextContent(
      /^If it's still there, someone in it can add the app back by typing \/invite @OneUptime\.$/,
    );
  });

  test("Slack not answering: Try again reads again", async () => {
    readAnswer({
      channels: [
        slackChannel({
          state: WorkspaceChannelState.Unavailable,
          people: [],
          peopleCount: 0,
        }),
      ],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("record-channel-state"),
    ).toHaveTextContent("Slack didn't answer. Try again in a minute.");

    fireEvent.click(within(element).getByTestId("record-channel-try-again"));

    await waitFor(() => {
      expect(requestsOf("GET").length).toBe(2);
    });
  });

  test("Slack disconnected from the project: Connect Slack, to the project's Slack settings", async () => {
    readAnswer({
      channels: [
        slackChannel({
          state: WorkspaceChannelState.NotConnected,
          people: [],
          peopleCount: 0,
        }),
      ],
      canAddPeople: true,
    });
    renderCard({});

    const state: HTMLElement = within(await card()).getByTestId(
      "record-channel-state",
    );

    expect(state).toHaveTextContent("Slack isn't connected to this project.");

    const connect: HTMLElement = within(state).getByRole("link", {
      name: "Connect Slack",
    });

    expect(connect).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/slack-integration`,
    );
    expect(
      within(state).getByTestId("record-channel-connect-project"),
    ).toContainElement(connect);
  });

  test("Slack not answering: Try again is busy until the next answer", async () => {
    let answerRetry: (() => void) | undefined;

    readAnswer({
      channels: [
        slackChannel({
          state: WorkspaceChannelState.Unavailable,
          people: [],
          peopleCount: 0,
        }),
      ],
      canAddPeople: true,
    });
    renderCard({});

    const element: HTMLElement = await card();

    jest.spyOn(API, "get").mockImplementationOnce((async () => {
      await new Promise<void>((resolve: () => void) => {
        answerRetry = resolve;
      });

      return new HTTPResponse<JSONObject>(
        200,
        WorkspaceChannelMembersUtil.channelsToJSON({
          channels: [slackChannel()],
          canAddPeople: true,
        }),
        {},
      );
    }) as never);

    const tryAgain: HTMLElement = within(element).getByTestId(
      "record-channel-try-again",
    );

    expect(tryAgain).not.toBeDisabled();
    fireEvent.click(tryAgain);

    await waitFor(() => {
      expect(tryAgain).toBeDisabled();
    });

    await act(async () => {
      answerRetry?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(within(element).getByTestId("record-channel")).toHaveAttribute(
        "data-channel-state",
        WorkspaceChannelState.Members,
      );
    });
  });
});

describe("Microsoft Teams channels", () => {
  test("a standard channel: everyone in its team can open it, and nothing to press", async () => {
    readAnswer({ channels: [teamsChannel()], canAddPeople: true });
    renderCard({ links: [TEAMS_LINK] });

    const element: HTMLElement = await card();

    expect(screen.getByText("Microsoft Teams Channel")).toBeInTheDocument();
    expect(
      within(element).getByTestId("record-channel-name"),
    ).toHaveTextContent(/^inc-42$/);
    expect(
      within(element).getByTestId("record-channel-teams-note"),
    ).toHaveTextContent("Everyone in Ops can open the channel.");
    expect(within(element).queryByTestId("record-channel-meta")).toBeNull();
    expect(within(element).queryByTestId("record-channel-join")).toBeNull();
    expect(
      within(element).queryByTestId("record-channel-add-people"),
    ).toBeNull();
  });

  test("a private one: only its members, added by its owners in Teams - 'private' said once", async () => {
    readAnswer({
      channels: [teamsChannel({ isPrivate: true })],
      canAddPeople: true,
    });
    renderCard({ links: [TEAMS_LINK] });

    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("record-channel-meta"),
    ).toHaveTextContent(/^Private channel$/);

    const note: HTMLElement = within(element).getByTestId(
      "record-channel-teams-note",
    );

    expect(note).toHaveTextContent(
      /^Only its members can open it\. Its owners add people in Microsoft Teams\.$/,
    );
    // The line above says it is private; the note does not say it again.
    expect(note.textContent?.toLowerCase()).not.toContain("private");
  });

  test("one Microsoft Graph could not tell about, and a team without a name", async () => {
    readAnswer({
      channels: [
        teamsChannel({ isPrivate: null }),
        teamsChannel({
          channelId: "19:other@thread.tacv2",
          teamName: undefined,
        }),
      ],
      canAddPeople: true,
    });
    renderCard({ links: [TEAMS_LINK, TEAMS_LINK] });

    const notes: Array<string> = within(await card())
      .getAllByTestId("record-channel-teams-note")
      .map((note: HTMLElement) => {
        return note.textContent || "";
      });

    expect(notes).toEqual([
      "Microsoft Teams decides who can open it: open it there to see.",
      "Everyone in the team can open the channel.",
    ]);
    expect(screen.getByText("Microsoft Teams Channels")).toBeInTheDocument();
  });

  test("channels in Slack and Teams: one card, Slack's first", async () => {
    readAnswer({
      channels: [slackChannel(), teamsChannel()],
      canAddPeople: true,
    });
    renderCard({ links: [SLACK_LINK, TEAMS_LINK] });

    const element: HTMLElement = await card();

    expect(screen.getByText("Chat Channels")).toBeInTheDocument();
    expect(
      within(element)
        .getAllByTestId("record-channel")
        .map((section: HTMLElement) => {
          return section.getAttribute("data-channel-state");
        }),
    ).toEqual([
      WorkspaceChannelState.Members,
      WorkspaceChannelState.ManagedInTeams,
    ]);
  });
});

describe("Add people", () => {
  async function openAddPeople(element: HTMLElement): Promise<HTMLElement> {
    fireEvent.click(within(element).getByTestId("record-channel-add-people"));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add people",
    });

    await within(dialog).findAllByRole("option");

    return dialog;
  }

  function optionIds(dialog: HTMLElement): Array<string> {
    return within(dialog)
      .getAllByRole("option")
      .map((option: HTMLElement) => {
        return option.getAttribute("data-id") || "";
      });
  }

  test("lists the project's people and teams, leaving out the people in the channel already", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    // Bob is in the channel; Sam is in it but not a OneUptime user.
    expect(optionIds(dialog)).toEqual([VIEWER, CAROL, DAN, PLATFORM]);
  });

  test("a person picked is added at once, and the card reads again", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: CAROL,
            name: "Carol Lee",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      },
    ];
    const { onChanged } = renderCard({});

    const element: HTMLElement = await card();
    const dialog: HTMLElement = await openAddPeople(element);

    lastRead = {
      channels: [
        slackChannel({
          people: [
            person("U0BOB", "Bob Jones", BOB),
            person("U0CAROL", "Carol Lee", CAROL),
            person("U0SAM", "Sam from Support"),
          ],
          peopleCount: 3,
        }),
      ],
      canAddPeople: true,
    };

    fireEvent.click(within(dialog).getByRole("option", { name: /Carol Lee/ }));

    await waitFor(() => {
      expect(requestsOf("POST").length).toBe(1);
    });

    expect(requestsOf("POST")[0]!.data).toEqual({
      channelId: "C0INC42",
      userIds: [CAROL],
      teamIds: [],
    });

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(within(element).getByText("Carol Lee")).toBeInTheDocument();
    });

    // Carol is in it now: the list leaves her out.
    await waitFor(() => {
      expect(optionIds(dialog)).not.toContain(CAROL);
    });
    expect(within(dialog).queryByRole("alert")).toBeNull();

    // And says so where the pick was made.
    expect(
      within(dialog).getByTestId("people-search-notice-done"),
    ).toHaveTextContent(/^Added Carol Lee\.$/);
    expect(
      within(dialog).getByTestId("people-search-notice-done"),
    ).toHaveAttribute("role", "status");
  });

  test("picking yourself joins you, said as 'you'", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: VIEWER,
            name: "Alice Smith",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(
      within(dialog).getByRole("option", { name: /Alice Smith/ }),
    );

    expect(
      await within(dialog).findByTestId("people-search-notice-done"),
    ).toHaveTextContent(/^You're in the channel now\.$/);
  });

  test("somebody in the channel already is said in grey, not as a problem", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: CAROL,
            name: "Carol Lee",
            outcome: WorkspaceChannelAddOutcome.AlreadyIn,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Carol Lee/ }));

    expect(
      await within(dialog).findByTestId("people-search-notice-unchanged"),
    ).toHaveTextContent(/^Carol Lee is already in this channel\.$/);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(
      within(dialog).queryByTestId("people-search-notice-done"),
    ).toBeNull();
  });

  test("a person OneUptime cannot find in Slack is said under the list, with what to do", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: DAN,
            name: "Dan Brown",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Dan Brown/ }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "OneUptime can't find Dan Brown in Slack: their account isn't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
    );
  });

  test("a team picked adds its people; who could not be added is said", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: CAROL,
            name: "Carol Lee",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
          {
            userId: DAN,
            name: "Dan Brown",
            outcome: WorkspaceChannelAddOutcome.Guest,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Platform/ }));

    await waitFor(() => {
      expect(requestsOf("POST").length).toBe(1);
    });
    expect(requestsOf("POST")[0]!.data).toEqual({
      channelId: "C0INC42",
      userIds: [],
      teamIds: [PLATFORM],
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Dan Brown is a guest in Slack, and Slack doesn't let OneUptime add them to this channel.",
    );
    // Who was added, by how many and from which team.
    expect(
      within(dialog).getByTestId("people-search-notice-done"),
    ).toHaveTextContent(/^Added 1 person from Platform\.$/);
  });

  test("a team's people with the same problem are named in one sentence, problems after what was done", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: BOB,
            name: "Bob Jones",
            outcome: WorkspaceChannelAddOutcome.AlreadyIn,
          },
          {
            userId: CAROL,
            name: "Carol Lee",
            outcome: WorkspaceChannelAddOutcome.Guest,
          },
          {
            userId: DAN,
            name: "Dan Brown",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
          {
            userId: "c8000000-0000-4000-8000-000000000015",
            name: "Eve Stone",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
          {
            userId: VIEWER,
            name: "Alice Smith",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Platform/ }));

    const problems: HTMLElement = await within(dialog).findByTestId(
      "people-search-notice-problem",
    );

    expect(problems).toHaveAttribute("role", "alert");
    expect(
      within(problems)
        .getAllByText(/./, { selector: "p" })
        .map((line: HTMLElement) => {
          return line.textContent;
        }),
    ).toEqual([
      "OneUptime can't find Dan Brown and Eve Stone in Slack: their accounts aren't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
      "Carol Lee is a guest in Slack, and Slack doesn't let OneUptime add them to this channel.",
    ]);
    expect(
      within(dialog).getByTestId("people-search-notice-done"),
    ).toHaveTextContent(/^Added 1 person from Platform\.$/);

    // What was done first, then what went wrong.
    expect(
      Array.from(
        within(dialog)
          .getByTestId("people-search-notices")
          .querySelectorAll("[data-testid^='people-search-notice-']"),
      ).map((band: Element) => {
        return band.getAttribute("data-testid");
      }),
    ).toEqual(["people-search-notice-done", "people-search-notice-problem"]);
  });

  test("a team whose people are all in the channel already says so, so the pick is not silent", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: BOB,
            name: "Bob Jones",
            outcome: WorkspaceChannelAddOutcome.AlreadyIn,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Platform/ }));

    expect(
      await within(dialog).findByTestId("people-search-notice-unchanged"),
    ).toHaveTextContent(/^Everyone in Platform is already in this channel\.$/);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  test("a channel archived since the card was read is said under the list", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      { channelState: WorkspaceChannelState.Archived, results: [] },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Carol Lee/ }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /^This channel is archived\. Unarchive it in Slack to add people\.$/,
    );
  });

  test("each pick says what it came to, in place of the last one's", async () => {
    readAnswer({ channels: [slackChannel()], canAddPeople: true });
    addAnswers = [
      {
        results: [
          {
            userId: DAN,
            name: "Dan Brown",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
        ],
      },
      {
        results: [
          {
            userId: CAROL,
            name: "Carol Lee",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      },
    ];
    renderCard({});

    const dialog: HTMLElement = await openAddPeople(await card());

    fireEvent.click(within(dialog).getByRole("option", { name: /Dan Brown/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "OneUptime can't find Dan Brown in Slack",
    );

    fireEvent.click(within(dialog).getByRole("option", { name: /Carol Lee/ }));

    expect(
      await within(dialog).findByTestId("people-search-notice-done"),
    ).toHaveTextContent("Added Carol Lee.");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  test("into the channel it was opened from, when the record has several", async () => {
    readAnswer({
      channels: [
        slackChannel(),
        slackChannel({ channelId: "C0WAR", name: "sre-war-room" }),
      ],
      canAddPeople: true,
    });
    addAnswers = [{ results: [] }];
    renderCard({ links: [SLACK_LINK, { ...SLACK_LINK, channelName: "sre" }] });

    const element: HTMLElement = await card();

    expect(screen.getByText("Slack Channels")).toBeInTheDocument();

    const second: HTMLElement =
      within(element).getAllByTestId("record-channel")[1]!;
    fireEvent.click(within(second).getByTestId("record-channel-join"));

    await waitFor(() => {
      expect(requestsOf("POST").length).toBe(1);
    });
    expect(requestsOf("POST")[0]!.data["channelId"]).toBe("C0WAR");
  });
});
