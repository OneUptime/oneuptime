import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Side menus build `countQuery` (and `requestOptions`) as fresh object
 * literals on every render, and section layouts re-render on every in-section
 * navigation. Without a value-level guard every one of those re-renders
 * re-issued the badge's POST /count - across the 43 badge usages that was 1-2
 * redundant requests per navigation. These tests pin the guard's contract:
 * value-equal props never refetch, a real value change does, and the global
 * refresh event still forces a refetch regardless of the guard.
 */

/*
 * Declared before jest.mock but dereferenced inside the factory: ts-jest
 * hoists the jest.mock call above these initializers, so naming the mock
 * directly in the factory would capture undefined.
 */
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
    },
  };
});

/*
 * SideMenuItem reads the active route off Navigation and UILink navigates
 * through it; neither is what these tests are about.
 */
jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      navigate: () => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import CountModelSideMenuItem, {
  REFRESH_SIDEBAR_COUNT_EVENT,
} from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import { RequestOptions } from "../../../UI/Utils/ModelAPI/ModelAPI";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Query from "../../../Types/BaseDatabase/Query";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";

const link: Link = {
  title: "Monitors",
  to: new Route("/dashboard/monitors"),
};

type MakeQueryFunction = (name: string) => Query<Monitor>;

/**
 * A FRESH object every call - the point of these tests is that value-equal
 * but identity-distinct props must not refetch, exactly what side menus
 * produce on every parent render.
 */
const makeQuery: MakeQueryFunction = (name: string): Query<Monitor> => {
  return { name: name } as Query<Monitor>;
};

type MakeRequestOptionsFunction = () => RequestOptions;

const makeRequestOptions: MakeRequestOptionsFunction = (): RequestOptions => {
  return {
    requestHeaders: {
      "x-badge": "1",
    },
  };
};

type RenderItemFunction = (
  query: Query<Monitor>,
  requestOptions?: RequestOptions,
) => React.ReactElement;

const renderItem: RenderItemFunction = (
  query: Query<Monitor>,
  requestOptions?: RequestOptions,
): React.ReactElement => {
  return (
    <CountModelSideMenuItem<Monitor>
      link={link}
      modelType={Monitor}
      countQuery={query}
      requestOptions={requestOptions}
    />
  );
};

describe("CountModelSideMenuItem fetch guard", () => {
  beforeEach(() => {
    countMock.mockReset();
    countMock.mockResolvedValue(5 as never);
  });

  afterEach(() => {
    cleanup();
  });

  test("re-rendering with a value-equal but identity-fresh query fetches exactly once", async () => {
    const { rerender } = render(
      renderItem(makeQuery("active"), makeRequestOptions()),
    );

    // wait for the count to land so the initial fetch is fully settled.
    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
    expect(countMock).toHaveBeenCalledTimes(1);

    /*
     * Simulate what section layouts do on every in-section navigation: a
     * re-render where countQuery and requestOptions are brand-new objects
     * with identical contents.
     */
    rerender(renderItem(makeQuery("active"), makeRequestOptions()));
    rerender(renderItem(makeQuery("active"), makeRequestOptions()));

    // effects flushed synchronously by RTL's act - still exactly one fetch.
    expect(countMock).toHaveBeenCalledTimes(1);
  });

  test("a value-level change to the query refetches with the new query", async () => {
    const { rerender } = render(renderItem(makeQuery("active")));

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });

    rerender(renderItem(makeQuery("resolved")));

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(2);
    });

    // the refetch must carry the NEW query, not a stale closure.
    const secondCallArgs: any = countMock.mock.calls[1]![0];
    expect(secondCallArgs.query).toEqual({ name: "resolved" });
    expect(secondCallArgs.modelType).toBe(Monitor);
  });

  test("the global refresh event still forces a refetch even when the query is unchanged", async () => {
    render(renderItem(makeQuery("active")));

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    });

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(2);
    });
  });
});
