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
import type { Mock } from "jest-mock";
import { MockFunction } from "../../MockType";
import React, { FunctionComponent, ReactElement } from "react";
import ConnectedWorkspaces, {
  ConnectedWorkspacesFetcher,
  REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX,
  WORKSPACE_TYPES,
  WorkspaceConnections,
  fetchConnectedWorkspaces,
  getOfferedWorkspaces,
  isWorkspaceConnected,
  toConnectedWorkspaces,
  useWorkspaceConnections,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The one place the Dashboard learns which chat workspaces a project has
 * connected. Every Workspace menu, the Slack and Microsoft Teams pages behind
 * them and a person's notification pages read it, so what it promises is
 * what all of them can rely on:
 *
 *  - it asks the server once per page load, however many ask, at once or
 *    later;
 *  - it remembers the last answer per project, and hands that out (marked
 *    as not fresh) until this page load's own answer is in;
 *  - an answer that arrives after a newer one was asked for is dropped;
 *  - a failed request is an error, never a guess about what is connected.
 */

const OTHER_PROJECT_ID: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void): void => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

function rememberedValue(projectId: string): string | null {
  return window.localStorage.getItem(
    `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${projectId}`,
  );
}

function rememberFor(projectId: string, value: string): void {
  window.localStorage.setItem(
    `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${projectId}`,
    value,
  );
}

let fetcher: Mock<ConnectedWorkspacesFetcher>;

beforeEach(() => {
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  fetcher = jest.fn<ConnectedWorkspacesFetcher>();
  ConnectedWorkspaces.setFetcher(fetcher);
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
  jest.restoreAllMocks();
});

describe("reading the answer", () => {
  test("WORKSPACE_TYPES is Slack, then Microsoft Teams: the order every list uses", () => {
    expect(WORKSPACE_TYPES).toEqual([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]);
  });

  test.each([
    [[], []],
    [[WorkspaceType.Slack], [WorkspaceType.Slack]],
    [[WorkspaceType.MicrosoftTeams], [WorkspaceType.MicrosoftTeams]],
    [
      [WorkspaceType.MicrosoftTeams, WorkspaceType.Slack],
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
    ],
    [
      [WorkspaceType.Slack, WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
    ],
    [["Discord", null, 42, undefined, "slack"], []],
    [["Discord", WorkspaceType.MicrosoftTeams], [WorkspaceType.MicrosoftTeams]],
  ])(
    "toConnectedWorkspaces(%j) keeps the known types, once each, in order: %j",
    (values: Array<unknown>, expected: Array<WorkspaceType>) => {
      expect(toConnectedWorkspaces(values)).toEqual(expected);
    },
  );

  test("isWorkspaceConnected is null while nothing is known, then true or false", () => {
    const unknown: WorkspaceConnections = {
      connected: null,
      isFresh: false,
      error: null,
    };
    const slackOnly: WorkspaceConnections = {
      connected: [WorkspaceType.Slack],
      isFresh: true,
      error: null,
    };

    expect(isWorkspaceConnected(unknown, WorkspaceType.Slack)).toBeNull();
    expect(isWorkspaceConnected(slackOnly, WorkspaceType.Slack)).toBe(true);
    expect(isWorkspaceConnected(slackOnly, WorkspaceType.MicrosoftTeams)).toBe(
      false,
    );
  });

  test("getOfferedWorkspaces: the connected ones once known, both after a failure with nothing known, null while waiting", () => {
    expect(
      getOfferedWorkspaces({
        connected: [WorkspaceType.MicrosoftTeams],
        isFresh: false,
        error: null,
      }),
    ).toEqual([WorkspaceType.MicrosoftTeams]);
    expect(
      getOfferedWorkspaces({ connected: [], isFresh: true, error: null }),
    ).toEqual([]);
    expect(
      getOfferedWorkspaces({
        connected: null,
        isFresh: false,
        error: "Request failed",
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
    expect(
      getOfferedWorkspaces({ connected: null, isFresh: false, error: null }),
    ).toBeNull();
    // A failed refresh keeps what was known, and that is what is offered.
    expect(
      getOfferedWorkspaces({
        connected: [WorkspaceType.Slack],
        isFresh: true,
        error: "Request failed",
      }),
    ).toEqual([WorkspaceType.Slack]);
  });

  test("outside a project nothing is asked, and it reads as a failed lookup", async () => {
    expect(ConnectedWorkspaces.getConnections(null)).toEqual({
      connected: null,
      isFresh: false,
      error: "No project is selected.",
    });
    expect(ConnectedWorkspaces.getConnections("")).toBe(
      ConnectedWorkspaces.getConnections(undefined),
    );

    await ConnectedWorkspaces.load(null);
    await ConnectedWorkspaces.refresh(null);

    expect(fetcher).not.toHaveBeenCalled();
  });

  test("before anything is asked, a project with nothing remembered is unknown", () => {
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: null,
      isFresh: false,
      error: null,
    });
  });

  test("the same object comes back until something changes, as useSyncExternalStore needs", async () => {
    const first: WorkspaceConnections =
      ConnectedWorkspaces.getConnections(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toBe(first);
    expect(ConnectedWorkspaces.getConnections(new ObjectID(PROJECT_ID))).toBe(
      first,
    );

    fetcher.mockResolvedValue([WorkspaceType.Slack]);
    await ConnectedWorkspaces.load(PROJECT_ID);

    const second: WorkspaceConnections =
      ConnectedWorkspaces.getConnections(PROJECT_ID);

    expect(second).not.toBe(first);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toBe(second);
  });
});

describe("asking the server once per page load", () => {
  test("a load asks once, and its answer is fresh", async () => {
    fetcher.mockResolvedValue([WorkspaceType.MicrosoftTeams]);

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0].toString()).toBe(PROJECT_ID);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.MicrosoftTeams],
      isFresh: true,
      error: null,
    });
  });

  test("loads that arrive while the request is out share it", async () => {
    const answer: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValue(answer.promise);

    const loads: Array<Promise<void>> = [
      ConnectedWorkspaces.load(PROJECT_ID),
      ConnectedWorkspaces.load(PROJECT_ID),
      ConnectedWorkspaces.load(new ObjectID(PROJECT_ID)),
    ];

    expect(fetcher).toHaveBeenCalledTimes(1);

    answer.resolve([WorkspaceType.Slack]);
    await Promise.all(loads);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toEqual([
      WorkspaceType.Slack,
    ]);
  });

  test("after a fresh answer, a later load asks nothing", async () => {
    fetcher.mockResolvedValue([]);

    await ConnectedWorkspaces.load(PROJECT_ID);
    await ConnectedWorkspaces.load(PROJECT_ID);
    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("each project is asked about on its own", async () => {
    fetcher.mockImplementation(
      async (projectId: ObjectID): Promise<Array<WorkspaceType>> => {
        return projectId.toString() === PROJECT_ID
          ? [WorkspaceType.Slack]
          : [WorkspaceType.MicrosoftTeams];
      },
    );

    await ConnectedWorkspaces.load(PROJECT_ID);
    await ConnectedWorkspaces.load(OTHER_PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toEqual([
      WorkspaceType.Slack,
    ]);
    expect(
      ConnectedWorkspaces.getConnections(OTHER_PROJECT_ID).connected,
    ).toEqual([WorkspaceType.MicrosoftTeams]);
  });

  test("a failure is an error, never a guess about what is connected", async () => {
    fetcher.mockRejectedValue(new Error("Permission denied"));

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: null,
      isFresh: false,
      error: "Permission denied",
    });
  });

  test("after a failure, the next load asks again", async () => {
    fetcher.mockRejectedValueOnce(new Error("Network error"));
    fetcher.mockResolvedValueOnce([WorkspaceType.Slack]);

    await ConnectedWorkspaces.load(PROJECT_ID);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).error).toBe(
      "Network error",
    );

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.Slack],
      isFresh: true,
      error: null,
    });
  });

  test("an answer with unknown types keeps only Slack and Microsoft Teams", async () => {
    fetcher.mockResolvedValue([
      "Discord" as WorkspaceType,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Slack,
    ]);

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toEqual([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]);
  });
});

describe("remembering the last answer", () => {
  test("a remembered answer stands in, marked as not fresh, before anything is asked", () => {
    rememberFor(PROJECT_ID, JSON.stringify([WorkspaceType.MicrosoftTeams]));

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.MicrosoftTeams],
      isFresh: false,
      error: null,
    });
  });

  test("this page load's answer replaces it and is remembered in its place", async () => {
    rememberFor(PROJECT_ID, JSON.stringify([WorkspaceType.MicrosoftTeams]));
    fetcher.mockResolvedValue([WorkspaceType.Slack]);

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.Slack],
      isFresh: true,
      error: null,
    });
    expect(rememberedValue(PROJECT_ID)).toBe(
      JSON.stringify([WorkspaceType.Slack]),
    );
  });

  test("a remembered answer is still asked about: it is only a stand-in", async () => {
    rememberFor(PROJECT_ID, JSON.stringify([WorkspaceType.Slack]));
    fetcher.mockResolvedValue([WorkspaceType.Slack]);

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("an empty answer is remembered too, so nothing connected is known on the next visit", async () => {
    fetcher.mockResolvedValue([]);

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(rememberedValue(PROJECT_ID)).toBe("[]");
  });

  test("a failed request keeps the remembered answer and adds the error", async () => {
    rememberFor(PROJECT_ID, JSON.stringify([WorkspaceType.Slack]));
    fetcher.mockRejectedValue(new Error("Request timed out"));

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.Slack],
      isFresh: false,
      error: "Request timed out",
    });
  });

  test.each([
    ["not JSON", "{not json"],
    ["not a list", JSON.stringify({ Slack: true })],
    ["a list of strangers", JSON.stringify(["Discord", 7])],
  ])(
    "a remembered value that is %s reads as nothing remembered of use",
    (_case: string, stored: string) => {
      rememberFor(PROJECT_ID, stored);

      const connections: WorkspaceConnections =
        ConnectedWorkspaces.getConnections(PROJECT_ID);

      expect(connections.isFresh).toBe(false);
      expect(
        connections.connected === null || connections.connected.length === 0,
      ).toBe(true);
    },
  );

  test("storage that throws is treated as nothing remembered, and answers still arrive", async () => {
    // Storage's index signature hides its methods from spyOn's types.
    const storage: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
    } = Storage.prototype as unknown as {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
    };

    jest.spyOn(storage, "getItem").mockImplementation((): string | null => {
      throw new Error("SecurityError");
    });
    jest.spyOn(storage, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });
    fetcher.mockResolvedValue([WorkspaceType.MicrosoftTeams]);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toBeNull();

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.MicrosoftTeams],
      isFresh: true,
      error: null,
    });
  });

  test("reset forgets every answer, remembered ones included, and leaves other storage alone", async () => {
    fetcher.mockResolvedValue([WorkspaceType.Slack]);
    window.localStorage.setItem("some-other-preference", "kept");
    await ConnectedWorkspaces.load(PROJECT_ID);
    await ConnectedWorkspaces.load(OTHER_PROJECT_ID);

    ConnectedWorkspaces.reset();

    expect(rememberedValue(PROJECT_ID)).toBeNull();
    expect(rememberedValue(OTHER_PROJECT_ID)).toBeNull();
    expect(window.localStorage.getItem("some-other-preference")).toBe("kept");
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toBeNull();
  });
});

describe("asking again", () => {
  test("refresh asks even after a fresh answer, and keeps it on screen until the new one lands", async () => {
    fetcher.mockResolvedValueOnce([WorkspaceType.Slack]);
    await ConnectedWorkspaces.load(PROJECT_ID);

    const second: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValueOnce(second.promise);

    const refreshing: Promise<void> = ConnectedWorkspaces.refresh(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toEqual([
      WorkspaceType.Slack,
    ]);

    second.resolve([]);
    await refreshing;

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [],
      isFresh: true,
      error: null,
    });
  });

  test("refresh without a project asks about the current one", async () => {
    goTo(`/dashboard/${OTHER_PROJECT_ID}/settings`);
    fetcher.mockResolvedValue([WorkspaceType.MicrosoftTeams]);

    await ConnectedWorkspaces.refresh();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0].toString()).toBe(OTHER_PROJECT_ID);
  });

  test("a refresh that fails keeps the fresh answer it had, with the error", async () => {
    fetcher.mockResolvedValueOnce([WorkspaceType.Slack]);
    await ConnectedWorkspaces.load(PROJECT_ID);

    fetcher.mockRejectedValueOnce(new Error("Gateway timeout"));
    await ConnectedWorkspaces.refresh(PROJECT_ID);

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.Slack],
      isFresh: true,
      error: "Gateway timeout",
    });
  });

  test("an answer that lands after a newer request is dropped", async () => {
    const older: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    const newer: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValueOnce(older.promise);
    fetcher.mockReturnValueOnce(newer.promise);

    const first: Promise<void> = ConnectedWorkspaces.load(PROJECT_ID);
    const second: Promise<void> = ConnectedWorkspaces.refresh(PROJECT_ID);

    newer.resolve([WorkspaceType.MicrosoftTeams]);
    await second;
    older.resolve([WorkspaceType.Slack]);
    await first;

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toEqual([
      WorkspaceType.MicrosoftTeams,
    ]);
    expect(rememberedValue(PROJECT_ID)).toBe(
      JSON.stringify([WorkspaceType.MicrosoftTeams]),
    );
  });

  test("setConnected records a fresh answer, remembers it, and wins over a request still out", async () => {
    const pending: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValue(pending.promise);

    const loading: Promise<void> = ConnectedWorkspaces.load(PROJECT_ID);

    ConnectedWorkspaces.setConnected(PROJECT_ID, [
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Slack,
    ]);

    pending.resolve([]);
    await loading;

    expect(ConnectedWorkspaces.getConnections(PROJECT_ID)).toEqual({
      connected: [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      isFresh: true,
      error: null,
    });
    expect(rememberedValue(PROJECT_ID)).toBe(
      JSON.stringify([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]),
    );
  });
});

describe("telling the screen", () => {
  test("subscribers hear about every new answer, and stop when they unsubscribe", async () => {
    const listener: Mock<() => void> = jest.fn<() => void>();
    const unsubscribe: () => void = ConnectedWorkspaces.subscribe(listener);

    fetcher.mockResolvedValue([WorkspaceType.Slack]);
    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  const Probe: FunctionComponent<{ testId: string }> = (props: {
    testId: string;
  }): ReactElement => {
    const connections: WorkspaceConnections = useWorkspaceConnections();

    return (
      <div data-testid={props.testId}>
        {JSON.stringify({
          connected: connections.connected,
          isFresh: connections.isFresh,
          error: connections.error,
        })}
      </div>
    );
  };

  function probeState(testId: string): {
    connected: Array<WorkspaceType> | null;
    isFresh: boolean;
    error: string | null;
  } {
    return JSON.parse(screen.getByTestId(testId).textContent || "{}");
  }

  test("the hook draws the remembered answer first, then this page load's", async () => {
    rememberFor(PROJECT_ID, JSON.stringify([WorkspaceType.Slack]));
    const answer: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValue(answer.promise);

    render(<Probe testId="probe" />);

    expect(probeState("probe")).toEqual({
      connected: [WorkspaceType.Slack],
      isFresh: false,
      error: null,
    });

    await act(async () => {
      answer.resolve([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
      await answer.promise;
    });

    expect(probeState("probe")).toEqual({
      connected: [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      isFresh: true,
      error: null,
    });
  });

  test("however many components ask on a page, the server is asked once", async () => {
    fetcher.mockResolvedValue([WorkspaceType.MicrosoftTeams]);

    await act(async () => {
      render(
        <>
          <Probe testId="menu" />
          <Probe testId="page" />
          <Probe testId="tab" />
        </>,
      );
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const testId of ["menu", "page", "tab"]) {
      expect(probeState(testId).connected).toEqual([
        WorkspaceType.MicrosoftTeams,
      ]);
    }
  });

  test("a component mounted later on the same page load reuses the answer", async () => {
    fetcher.mockResolvedValue([WorkspaceType.Slack]);

    await act(async () => {
      render(<Probe testId="first" />);
    });
    cleanup();

    await act(async () => {
      render(<Probe testId="second" />);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(probeState("second")).toEqual({
      connected: [WorkspaceType.Slack],
      isFresh: true,
      error: null,
    });
  });

  test("switching projects asks about the new project", async () => {
    fetcher.mockImplementation(
      async (projectId: ObjectID): Promise<Array<WorkspaceType>> => {
        return projectId.toString() === PROJECT_ID ? [WorkspaceType.Slack] : [];
      },
    );

    let rendered: ReturnType<typeof render> | undefined;

    await act(async () => {
      rendered = render(<Probe testId="probe" />);
    });

    expect(probeState("probe").connected).toEqual([WorkspaceType.Slack]);

    goTo(`/dashboard/${OTHER_PROJECT_ID}/incidents`);

    await act(async () => {
      rendered!.rerender(<Probe testId="probe" />);
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(probeState("probe")).toEqual({
      connected: [],
      isFresh: true,
      error: null,
    });
  });
});

// A get-list answer of WorkspaceProjectAuthToken rows of these types.
function tokenList(types: Array<WorkspaceType>): never {
  const rows: Array<WorkspaceProjectAuthToken> = types.map(
    (workspaceType: WorkspaceType): WorkspaceProjectAuthToken => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.workspaceType = workspaceType;
      return token;
    },
  );

  const result: ListResult<WorkspaceProjectAuthToken> = {
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 10000,
  };

  return result as never;
}

describe("the server's answer", () => {
  test("is the project's WorkspaceProjectAuthToken rows, asked for by type only", async () => {
    const getList: MockFunction = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue(
        tokenList([
          WorkspaceType.MicrosoftTeams,
          WorkspaceType.Slack,
          WorkspaceType.Slack,
        ]),
      ) as unknown as MockFunction;

    const connected: Array<WorkspaceType> = await fetchConnectedWorkspaces(
      new ObjectID(PROJECT_ID),
    );

    expect(connected).toEqual([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]);
    expect(getList).toHaveBeenCalledTimes(1);

    const request: Parameters<typeof ModelAPI.getList>[0] =
      getList.mock.calls[0]![0];

    expect(request.modelType).toBe(WorkspaceProjectAuthToken);
    expect(
      (request.query as Record<string, unknown>)["projectId"]?.toString(),
    ).toBe(PROJECT_ID);
    // Only what the menus need: no token, no workspace details.
    expect(Object.keys(request.select).sort()).toEqual([
      "_id",
      "workspaceType",
    ]);
  });

  test("a project with no rows has nothing connected", async () => {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue(tokenList([]));

    await expect(
      fetchConnectedWorkspaces(new ObjectID(PROJECT_ID)),
    ).resolves.toEqual([]);
  });

  test("the store asks through it by default", async () => {
    ConnectedWorkspaces.setFetcher(null);
    const getList: MockFunction = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue(
        tokenList([WorkspaceType.Slack]),
      ) as unknown as MockFunction;

    await ConnectedWorkspaces.load(PROJECT_ID);

    expect(getList).toHaveBeenCalledTimes(1);
    expect(ConnectedWorkspaces.getConnections(PROJECT_ID).connected).toEqual([
      WorkspaceType.Slack,
    ]);
  });
});
