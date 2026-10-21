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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import ResourceAiAgentStatusSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import { isAiAgentStatusRefresh } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/useAiAgentAccessStatus";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * When the Overview's "AI agent" card reads the status, and which answer it
 * shows.
 *
 * Every Overview stamps its refresh signal when a load finishes — its own
 * first load included — and hands it to the card. The card reads when it
 * opens; the signal going from none to one is that first load ending, which
 * the opening read already covers, so it reads nothing again. Every change
 * after that is a refresh and reads again. Only the latest read may change
 * what the card shows: a slow answer to an earlier read, or to another
 * resource, never replaces a newer one — and the opening read still lands
 * when the page's first load ends while it is in flight.
 */

const WAIT_TIMEOUT: number = 20000;
const RESOURCE_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
  "55555555-0000-4000-8000-000000000005",
);
const DESCRIPTOR: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.DockerHost,
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {
    // replaced below
  };
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });

  return { promise, resolve };
}

function makeStatus(
  mode: ResourceAiRemediationMode,
  resourceId: ObjectID = RESOURCE_ID,
): HTTPResponse<JSONObject> {
  const status: ResourceAiAccessStatus = {
    resourceType: AiResourceType.DockerHost,
    resourceId: resourceId.toString(),
    resourceName: "web-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiCommandAllowlist: [],
    agent: {
      agentId: "99999999-0000-4000-8000-000000000009",
      connectionStatus: "connected",
      isOnline: true,
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };

  return new HTTPResponse<JSONObject>(200, status as unknown as JSONObject, {});
}

let postSpy: ReturnType<typeof jest.spyOn>;

// Each read gets the next answer, in order; answers settle when the test says.
function serveInOrder(
  answers: Array<Deferred<HTTPResponse<JSONObject>>>,
): void {
  let call: number = 0;

  postSpy.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
    const answer: Deferred<HTTPResponse<JSONObject>> | undefined =
      answers[call];
    call += 1;

    if (!answer) {
      throw new Error(`Read ${call} was not expected.`);
    }

    return answer.promise;
  });
}

function serveStatus(mode: ResourceAiRemediationMode): void {
  postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return makeStatus(mode);
  });
}

function card(props: {
  refreshToken?: number;
  resourceId?: ObjectID;
}): React.ReactElement {
  return (
    <ResourceAiAgentStatusSummaryCard
      descriptor={DESCRIPTOR}
      resourceId={props.resourceId || RESOURCE_ID}
      refreshToken={props.refreshToken}
    />
  );
}

async function findFixesBadge(): Promise<string> {
  return (
    (
      await screen.findByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-badge`,
        {},
        { timeout: WAIT_TIMEOUT },
      )
    ).textContent || ""
  );
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function readResourceIds(): Array<string> {
  return postSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(
      ((call[0] as JSONObject)["data"] as JSONObject)["resourceId"],
    );
  });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/docker/${RESOURCE_ID.toString()}`);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which changes of the Overview's refresh signal are refreshes", () => {
  test.each<[string, number | undefined, number | undefined, boolean]>([
    ["no signal yet, still none", undefined, undefined, false],
    [
      "the page's own first load ending (none, then one)",
      undefined,
      1000,
      false,
    ],
    ["the same signal again", 1000, 1000, false],
    ["a later load (one, then another)", 1000, 2000, true],
    ["the signal cleared after a load", 1000, undefined, true],
  ])(
    "%s",
    (
      _label: string,
      previousToken: number | undefined,
      token: number | undefined,
      isRefresh: boolean,
    ) => {
      expect(isAiAgentStatusRefresh({ previousToken, token })).toBe(isRefresh);
    },
  );
});

describe("when the card reads", () => {
  test("once when it opens, and not again when the page's own first load ends", async () => {
    serveStatus(ResourceAiRemediationMode.RequireApproval);
    const view: RenderResult = render(card({}));
    expect(await findFixesBadge()).toBe("Ask for approval");

    view.rerender(card({ refreshToken: 1000 }));
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("again on every refresh after that", async () => {
    serveStatus(ResourceAiRemediationMode.RequireApproval);
    const view: RenderResult = render(card({}));
    await findFixesBadge();

    view.rerender(card({ refreshToken: 1000 }));
    await settle();
    serveStatus(ResourceAiRemediationMode.Automatic);
    view.rerender(card({ refreshToken: 2000 }));
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(await findFixesBadge()).toBe("Automatic");

    serveStatus(ResourceAiRemediationMode.BypassApproval);
    view.rerender(card({ refreshToken: 3000 }));
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(await findFixesBadge()).toBe("Bypass approval");
  });

  test("opened after the page's first load ended (a signal already there): once, then on every change", async () => {
    serveStatus(ResourceAiRemediationMode.RequireApproval);
    const view: RenderResult = render(card({ refreshToken: 1000 }));
    await findFixesBadge();
    expect(postSpy).toHaveBeenCalledTimes(1);

    view.rerender(card({ refreshToken: 2000 }));
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  test("once under React's strict mode, which runs every effect twice", async () => {
    serveStatus(ResourceAiRemediationMode.RequireApproval);
    render(<React.StrictMode>{card({})}</React.StrictMode>);

    expect(await findFixesBadge()).toBe("Ask for approval");
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});

describe("which answer the card shows", () => {
  test("the opening read still lands when the page's first load ends while it is in flight", async () => {
    const opening: Deferred<HTTPResponse<JSONObject>> = deferred();
    serveInOrder([opening]);

    const view: RenderResult = render(card({}));
    view.rerender(card({ refreshToken: 1000 }));
    await settle();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();

    await act(async () => {
      opening.resolve(makeStatus(ResourceAiRemediationMode.RequireApproval));
    });

    expect(await findFixesBadge()).toBe("Ask for approval");
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });

  test("an earlier read that answers after a later one never replaces it", async () => {
    const earlier: Deferred<HTTPResponse<JSONObject>> = deferred();
    const later: Deferred<HTTPResponse<JSONObject>> = deferred();
    serveInOrder([earlier, later]);

    const view: RenderResult = render(card({ refreshToken: 1000 }));
    view.rerender(card({ refreshToken: 2000 }));
    await settle();
    expect(postSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      later.resolve(makeStatus(ResourceAiRemediationMode.BypassApproval));
    });
    expect(await findFixesBadge()).toBe("Bypass approval");

    await act(async () => {
      earlier.resolve(makeStatus(ResourceAiRemediationMode.RequireApproval));
    });
    await settle();

    expect(await findFixesBadge()).toBe("Bypass approval");
  });

  test("the previous resource's late answer never shows on the next resource's card", async () => {
    const previous: Deferred<HTTPResponse<JSONObject>> = deferred();
    const next: Deferred<HTTPResponse<JSONObject>> = deferred();
    serveInOrder([previous, next]);

    const view: RenderResult = render(card({}));
    view.rerender(card({ resourceId: OTHER_RESOURCE_ID }));
    await settle();

    expect(readResourceIds()).toEqual([
      RESOURCE_ID.toString(),
      OTHER_RESOURCE_ID.toString(),
    ]);

    await act(async () => {
      previous.resolve(makeStatus(ResourceAiRemediationMode.Automatic));
    });
    await settle();

    expect(
      screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-badge`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();

    await act(async () => {
      next.resolve(
        makeStatus(
          ResourceAiRemediationMode.RequireApproval,
          OTHER_RESOURCE_ID,
        ),
      );
    });

    expect(await findFixesBadge()).toBe("Ask for approval");
  });

  test("a refresh still in flight keeps the status on screen until it answers", async () => {
    const opening: Deferred<HTTPResponse<JSONObject>> = deferred();
    const refresh: Deferred<HTTPResponse<JSONObject>> = deferred();
    serveInOrder([opening, refresh]);

    const view: RenderResult = render(card({ refreshToken: 1000 }));
    await act(async () => {
      opening.resolve(makeStatus(ResourceAiRemediationMode.RequireApproval));
    });
    expect(await findFixesBadge()).toBe("Ask for approval");

    view.rerender(card({ refreshToken: 2000 }));
    await settle();

    // No loader in its place while the refresh is out.
    expect(await findFixesBadge()).toBe("Ask for approval");
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();

    await act(async () => {
      refresh.resolve(makeStatus(ResourceAiRemediationMode.Disabled));
    });

    expect(await findFixesBadge()).toBe("Off");
  });
});
