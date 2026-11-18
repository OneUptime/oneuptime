import React from "react";
import { act, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import GetReadyFirstRun, { isOnHome } from "./GetReadyFirstRun";

/*
 * THE FIRST STEPS, OPENED BY THEMSELVES ONCE (#7041): on a new install's
 * first launch, once the person is signed in to a project, from where the
 * app opens - Home - and never again: never on a later launch, never twice
 * in one, and never over a page the person or a notification opened.
 */

const mockNavigate: jest.Mock = jest.fn();
const mockState: {
  current: { index?: number; routes?: Array<{ name: string }> } | undefined;
} = { current: { index: 0, routes: [{ name: "Home" }] } };

const mockProjects: {
  current: { projectList: Array<{ _id: string }>; isLoadingProjects: boolean };
} = {
  current: { projectList: [{ _id: "project-1" }], isLoadingProjects: false },
};

const mockFirstRun: { current: boolean } = { current: true };
// A decision still on its way, when a test holds it.
const mockPendingDecision: { current: Promise<boolean> | null } = {
  current: null,
};
const mockMarkSeen: jest.Mock = jest.fn(async () => {
  return undefined;
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return {
        navigate: mockNavigate,
        getState: () => {
          return mockState.current;
        },
      };
    },
  };
});

jest.mock("../hooks/useProject", () => {
  return {
    useProject: () => {
      return mockProjects.current;
    },
  };
});

jest.mock("../onboarding/firstRun", () => {
  return {
    isFirstRunOfThisInstall: (): Promise<boolean> => {
      return (
        mockPendingDecision.current || Promise.resolve(mockFirstRun.current)
      );
    },
  };
});

jest.mock("../storage/getReady", () => {
  return {
    markGetReadySeen: (...args: Array<unknown>) => {
      return mockMarkSeen(...args);
    },
  };
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockMarkSeen.mockClear();
  mockState.current = { index: 0, routes: [{ name: "Home" }] };
  mockProjects.current = {
    projectList: [{ _id: "project-1" }],
    isLoadingProjects: false,
  };
  mockFirstRun.current = true;
  mockPendingDecision.current = null;
});

describe("a new install's first launch", () => {
  test("opens Get Ready for On-Call as a sheet over the on-call overview, marked opened first", async () => {
    await render(<GetReadyFirstRun />);
    await settle();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("OnCall", {
      screen: "GetReady",
      initial: false,
    });
    expect(mockMarkSeen.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]!,
    );
  });

  test("only once, however often it draws", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <GetReadyFirstRun />,
    );
    await settle();

    mockProjects.current = {
      projectList: [{ _id: "project-1" }, { _id: "project-2" }],
      isLoadingProjects: false,
    };
    await view.rerender(<GetReadyFirstRun />);
    await settle();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test("waits for the person's projects, then opens", async () => {
    mockProjects.current = { projectList: [], isLoadingProjects: true };

    const view: Awaited<ReturnType<typeof render>> = await render(
      <GetReadyFirstRun />,
    );
    await settle();

    expect(mockNavigate).not.toHaveBeenCalled();

    mockProjects.current = {
      projectList: [{ _id: "project-1" }],
      isLoadingProjects: false,
    };
    await view.rerender(<GetReadyFirstRun />);
    await settle();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test("somebody in no project yet: nothing to get ready for, nothing opens", async () => {
    mockProjects.current = { projectList: [], isLoadingProjects: false };

    await render(<GetReadyFirstRun />);
    await settle();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  test("never over a page already opened - by the person, or a notification", async () => {
    mockState.current = {
      index: 2,
      routes: [{ name: "Home" }, { name: "Monitors" }, { name: "Inbox" }],
    };

    await render(<GetReadyFirstRun />);
    await settle();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  test("gone before it decided: nothing opens", async () => {
    let decide: (isFirstRun: boolean) => void = () => {};

    mockPendingDecision.current = new Promise<boolean>(
      (resolve: (isFirstRun: boolean) => void) => {
        decide = resolve;
      },
    );

    const view: Awaited<ReturnType<typeof render>> = await render(
      <GetReadyFirstRun />,
    );
    await view.unmount();

    decide(true);
    await settle();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});

describe("any other launch", () => {
  test("opens nothing: Settings has the first steps", async () => {
    mockFirstRun.current = false;

    await render(<GetReadyFirstRun />);
    await settle();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});

describe("where the app opens", () => {
  test("is Home, with the tabs' state read as it is", () => {
    expect(
      isOnHome({
        getState: () => {
          return { index: 0, routes: [{ name: "Home" }] };
        },
      }),
    ).toBe(true);
    // A state with no index yet stands on its first route.
    expect(
      isOnHome({
        getState: () => {
          return { routes: [{ name: "Home" }, { name: "OnCall" }] };
        },
      }),
    ).toBe(true);
    expect(
      isOnHome({
        getState: () => {
          return { index: 1, routes: [{ name: "Home" }, { name: "OnCall" }] };
        },
      }),
    ).toBe(false);
  });

  test("no state yet is not Home: nothing opens before the tabs are drawn", () => {
    expect(
      isOnHome({
        getState: () => {
          return undefined;
        },
      }),
    ).toBe(false);
    expect(isOnHome({})).toBe(false);
    expect(
      isOnHome({
        getState: () => {
          return { routes: [] };
        },
      }),
    ).toBe(false);
  });
});
