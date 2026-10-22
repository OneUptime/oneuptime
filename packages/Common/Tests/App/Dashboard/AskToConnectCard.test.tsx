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

/*
 * THE "ASK EVERYONE TO CONNECT" CARD, on a project's Slack and Microsoft
 * Teams settings. A customer bringing a thousand people into OneUptime asked
 * how to get them all to connect Slack: an owner or admin sees how many
 * members have connected, asks the rest in one go, and watches the
 * messages go out. Driven as a person uses it, through the real card; only
 * the HTTP layer (API.get / API.post) and the signed-in person's
 * permissions are stubbed, and every request the card sends is asserted.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "c9000000-0000-4000-8000-0000000000aa" };
      },
    },
  };
});

import AskToConnectCard, {
  ASK_TO_CONNECT_POLL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/AskToConnectCard";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import WorkspaceAskToConnectUtil, {
  WorkspaceAskToConnectState,
  WorkspaceAskToConnectStatus,
} from "../../../Types/Workspace/WorkspaceAskToConnect";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";

interface SentRequest {
  method: "GET" | "POST";
  url: string;
}

let sent: Array<SentRequest> = [];
let reads: Array<WorkspaceAskToConnectStatus | HTTPErrorResponse> = [];
let lastRead: WorkspaceAskToConnectStatus;
let startAnswer: WorkspaceAskToConnectStatus | HTTPErrorResponse;

const NOT_ASKED_YET: WorkspaceAskToConnectStatus = {
  memberCount: 4,
  connectedCount: 1,
  run: null,
};

const ASKING: WorkspaceAskToConnectStatus = {
  memberCount: 4,
  connectedCount: 1,
  run: {
    state: WorkspaceAskToConnectState.Asking,
    startedAt: "2026-10-22T10:00:00.000Z",
    askedByName: "Jane Admin",
    toAskCount: 3,
    askedCount: 1,
    notFoundCount: 0,
    failedCount: 0,
    notFoundNames: [],
  },
};

const DONE: WorkspaceAskToConnectStatus = {
  memberCount: 4,
  connectedCount: 2,
  run: {
    state: WorkspaceAskToConnectState.Done,
    startedAt: "2026-10-22T10:00:00.000Z",
    finishedAt: "2026-10-22T10:00:09.000Z",
    askedByName: "Jane Admin",
    toAskCount: 3,
    askedCount: 2,
    notFoundCount: 1,
    failedCount: 0,
    notFoundNames: ["Carol"],
  },
};

function answer(
  value: WorkspaceAskToConnectStatus | HTTPErrorResponse,
): HTTPResponse<JSONObject> | HTTPErrorResponse {
  if (value instanceof HTTPErrorResponse) {
    return value;
  }

  return new HTTPResponse<JSONObject>(
    200,
    WorkspaceAskToConnectUtil.statusToJSON(value),
    {},
  );
}

function holds(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

beforeEach(() => {
  sent = [];
  reads = [];
  lastRead = NOT_ASKED_YET;
  startAnswer = ASKING;

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  holds([Permission.ProjectAdmin]);

  jest.spyOn(API, "get").mockImplementation((async (args: { url: URL }) => {
    sent.push({ method: "GET", url: args.url.toString() });
    return answer(reads.shift() || lastRead);
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: { url: URL }) => {
    sent.push({ method: "POST", url: args.url.toString() });
    return answer(startAnswer);
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function renderCard(
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AskToConnectCard workspaceType={workspaceType} />
    </MemoryRouter>,
  );
}

async function card(): Promise<HTMLElement> {
  const element: HTMLElement = await screen.findByTestId("ask-to-connect-card");

  await waitFor(() => {
    expect(within(element).getByTestId("ask-to-connect-count")).toBeTruthy();
  });

  return element;
}

describe("who sees the card", () => {
  test.each([[Permission.ProjectMember], [Permission.ProjectUser]])(
    "a %s does not: the card is for the project's owners and admins, and asks the server nothing",
    async (permission: Permission) => {
      holds([permission]);

      const { container } = renderCard();

      expect(container.innerHTML).toBe("");
      expect(sent).toEqual([]);
    },
  );

  test("a project owner does", async () => {
    holds([Permission.ProjectOwner]);
    renderCard();

    expect(await card()).toBeTruthy();
  });
});

describe("asking everybody in Slack", () => {
  test("the card says how many members connected, and offers to ask the rest", async () => {
    renderCard();

    const element: HTMLElement = await card();

    expect(element).toHaveTextContent("Members' Slack accounts");
    expect(
      within(element).getByTestId("ask-to-connect-count"),
    ).toHaveTextContent("1 of 4 members connected");
    expect(
      within(element).getByRole("button", { name: /Ask everyone to connect/ }),
    ).toBeTruthy();

    expect(sent).toEqual([
      {
        method: "GET",
        url: expect.stringContaining("/workspace-ask-to-connect/Slack"),
      },
    ]);
  });

  test("asking is confirmed first, then the messages go out and the card follows them until they are done", async () => {
    renderCard();
    const element: HTMLElement = await card();

    fireEvent.click(
      within(element).getByRole("button", { name: /Ask everyone to connect/ }),
    );

    // What asking does, before anything is sent.
    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Ask everyone to connect their Slack accounts?",
    );
    expect(dialog).toHaveTextContent(
      "Each member who has not connected gets a direct message from OneUptime in Slack, with a button that connects their account in one click. Members asked in the last 24 hours are not asked again.",
    );
    expect(dialog).toHaveTextContent(
      "OneUptime finds them in Slack by their email address.",
    );
    expect(
      sent.filter((request: SentRequest): boolean => {
        return request.method === "POST";
      }),
    ).toEqual([]);

    jest.useFakeTimers();

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Send messages/ }),
      );
    });

    expect(sent[sent.length - 1]).toEqual({
      method: "POST",
      url: expect.stringContaining("/workspace-ask-to-connect/Slack"),
    });

    // The dialog closes, and the card says the messages are going out.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("ask-to-connect-run")).toHaveTextContent(
      "Asking 3 members to connect. 1 messaged so far.",
    );

    // The next read finds them done.
    lastRead = DONE;

    await act(async () => {
      jest.advanceTimersByTime(ASK_TO_CONNECT_POLL_MS);
    });

    await waitFor(() => {
      expect(screen.getByTestId("ask-to-connect-run")).toHaveTextContent(
        "Jane Admin asked 2 members to connect on",
      );
    });

    const run: HTMLElement = screen.getByTestId("ask-to-connect-run");

    expect(run).toHaveTextContent(
      "1 member could not be found in Slack by their email address: Carol.",
    );
    expect(run).toHaveTextContent(
      "They can connect under User Settings → Workspace → Slack.",
    );
    expect(screen.getByTestId("ask-to-connect-count")).toHaveTextContent(
      "2 of 4 members connected",
    );

    // Done: no more reads.
    const readsSoFar: number = sent.length;

    await act(async () => {
      jest.advanceTimersByTime(ASK_TO_CONNECT_POLL_MS * 3);
    });

    expect(sent.length).toBe(readsSoFar);
  });

  test("a refusal is said in the dialog, which stays open to try again", async () => {
    startAnswer = new HTTPErrorResponse(
      400,
      {
        message:
          "OneUptime is already asking this project's members to connect their accounts. Wait for it to finish.",
      },
      {},
    );

    renderCard();
    const element: HTMLElement = await card();

    fireEvent.click(
      within(element).getByRole("button", { name: /Ask everyone to connect/ }),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Send messages/ }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "already asking this project's members",
      );
    });
  });

  test("with everybody connected, the card says so and offers nothing to send", async () => {
    lastRead = { memberCount: 4, connectedCount: 4, run: null };

    renderCard();
    const element: HTMLElement = await card();

    expect(
      within(element).getByTestId("ask-to-connect-count"),
    ).toHaveTextContent("Everyone has connected their Slack account.");
    expect(
      within(element).queryByRole("button", {
        name: /Ask everyone to connect/,
      }),
    ).toBeNull();
  });

  test("a run whose server stopped half way says how to go on", async () => {
    lastRead = {
      ...DONE,
      run: {
        ...DONE.run!,
        state: WorkspaceAskToConnectState.Stopped,
        failedCount: 0,
      },
    };

    renderCard();
    await card();

    expect(screen.getByTestId("ask-to-connect-run")).toHaveTextContent(
      "Asking stopped before it was done. Ask again to message the rest.",
    );
  });
});

describe("asking everybody in Microsoft Teams", () => {
  test("the same card, for Microsoft Teams: people are found in the teams the app is installed in", async () => {
    renderCard(WorkspaceType.MicrosoftTeams);
    const element: HTMLElement = await card();

    expect(element).toHaveTextContent("Members' Microsoft Teams accounts");

    fireEvent.click(
      within(element).getByRole("button", { name: /Ask everyone to connect/ }),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(
      "OneUptime finds them by their email address, in the teams its app is installed in.",
    );

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Send messages/ }),
      );
    });

    expect(sent[sent.length - 1]).toEqual({
      method: "POST",
      url: expect.stringContaining("/workspace-ask-to-connect/MicrosoftTeams"),
    });
  });
});
