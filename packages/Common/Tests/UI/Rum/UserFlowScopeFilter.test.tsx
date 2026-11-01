import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The box that narrows User Flows to one person or one session. The list of
 * people is a help, and these pin that it stays one: it costs nothing until
 * the box is opened, it follows the window, and when it fails the box still
 * looks anyone up.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import UserFlowScopeFilter from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScopeFilter";
import { UserFlowScope } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScope";

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");
const KEY: string = "a".repeat(64);
const VISITOR: string = "0123456789abcdef0123456789abcdef";
const SESSION: string = "fedcba9876543210fedcba9876543210";
const DAY: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };
const WEEK: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_WEEK };

const USERS: Array<JSONObject> = [
  {
    groupKey: `u:${KEY}`,
    kind: "identified",
    identifiedUserKey: KEY,
    visitorId: "",
    identifiedUserLabel: "jane@example.com",
    sessionCount: 3,
  },
  {
    groupKey: `v:${VISITOR}`,
    kind: "visitor",
    identifiedUserKey: "",
    visitorId: VISITOR,
    sessionCount: 1,
  },
];

function answerWith(users: Array<JSONObject>): void {
  postMock.mockImplementation(async (): Promise<unknown> => {
    return new HTTPResponse(200, { users: users, nextCursor: null }, {});
  });
}

function input(): HTMLInputElement {
  return screen.getByTestId("user-flow-scope-input") as HTMLInputElement;
}

function options(): Array<HTMLElement> {
  return screen.queryAllByTestId("user-flow-scope-option");
}

interface Rendered {
  onSelect: MockFunction;
  rerender: (timeRange: RangeStartAndEndDateTime) => void;
}

function renderFilter(timeRange: RangeStartAndEndDateTime = DAY): Rendered {
  const onSelect: MockFunction = getJestMockFunction();

  const element: (range: RangeStartAndEndDateTime) => React.ReactElement = (
    range: RangeStartAndEndDateTime,
  ): React.ReactElement => {
    return (
      <MemoryRouter>
        <UserFlowScopeFilter
          rumApplicationId={APP_ID}
          timeRange={range}
          onSelect={onSelect as unknown as (scope: UserFlowScope) => void}
        />
      </MemoryRouter>
    );
  };

  const view: ReturnType<typeof render> = render(element(timeRange));

  return {
    onSelect: onSelect,
    rerender: (range: RangeStartAndEndDateTime): void => {
      view.rerender(element(range));
    },
  };
}

async function openWithPeople(count: number): Promise<void> {
  fireEvent.focus(input());

  await waitFor(() => {
    expect(options()).toHaveLength(count);
  });
}

beforeEach(() => {
  postMock.mockReset();
  answerWith(USERS);
});

afterEach(() => {
  cleanup();
});

describe("the list of people", () => {
  test("costs nothing until the box is opened", async () => {
    renderFilter();

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("user-flow-scope-menu")).toBeNull();

    await openWithPeople(2);

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("is read over the page's window, for this application", async () => {
    renderFilter();

    await openWithPeople(2);

    const request: { url: { toString: () => string }; data: JSONObject } =
      postMock.mock.calls[0]![0] as {
        url: { toString: () => string };
        data: JSONObject;
      };

    expect(request.url.toString()).toContain("/session-replay/users");
    expect(request.data["rumApplicationId"]).toBe(APP_ID.toString());
    expect(
      Date.parse(String(request.data["endTime"])) -
        Date.parse(String(request.data["startTime"])),
    ).toBeCloseTo(24 * 60 * 60 * 1000, -5);
  });

  test("is read once per window, however often the box is opened", async () => {
    const { rerender } = renderFilter();

    await openWithPeople(2);
    fireEvent.blur(input());
    await openWithPeople(2);

    expect(postMock).toHaveBeenCalledTimes(1);

    fireEvent.blur(input());
    rerender(WEEK);

    /* A new window, not opened yet: still nothing to pay for. */
    expect(postMock).toHaveBeenCalledTimes(1);

    await openWithPeople(2);

    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("failing to load it leaves the box working", async () => {
    postMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("ClickHouse is not reachable");
    });

    const { onSelect } = renderFilter();

    fireEvent.focus(input());

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("user-flow-scope-hint")).toBeInTheDocument();

    fireEvent.change(input(), { target: { value: "jane@example.com" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      kind: "user",
      identifiedUserKey: "",
      identifiedUserRef: "jane@example.com",
    });
  });

  test("offers a hidden person to a role that cannot read the label", async () => {
    answerWith([
      {
        groupKey: `u:${KEY}`,
        kind: "identified",
        identifiedUserKey: KEY,
        sessionCount: 2,
      },
    ]);

    renderFilter();

    await openWithPeople(1);

    expect(options()[0]).toHaveTextContent("Hidden");
  });
});

describe("choosing", () => {
  test("a person from the list hands back their key and label", async () => {
    const { onSelect } = renderFilter();

    await openWithPeople(2);
    fireEvent.click(options()[0] as HTMLElement);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "jane@example.com",
    });
  });

  test("the press on a row does not take the focus out of the box first", async () => {
    renderFilter();

    await openWithPeople(2);

    /* fireEvent returns false when the default was prevented. */
    expect(fireEvent.mouseDown(options()[0] as HTMLElement)).toBe(false);
  });

  test("the box empties and closes behind a choice", async () => {
    renderFilter();

    await openWithPeople(2);
    fireEvent.change(input(), { target: { value: "jane" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("");
    expect(screen.queryByTestId("user-flow-scope-menu")).toBeNull();
  });

  test("Enter looks up what was typed, first of all", async () => {
    const { onSelect } = renderFilter();

    await openWithPeople(2);
    fireEvent.change(input(), { target: { value: SESSION } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      kind: "session",
      sessionId: SESSION,
    });
  });

  test("the arrows move through the rows and stop at the ends", async () => {
    const { onSelect } = renderFilter();

    await openWithPeople(2);

    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      kind: "visitor",
      visitorId: VISITOR,
    });
  });

  test("the highlight goes back to the top as the text changes", async () => {
    renderFilter();

    await openWithPeople(2);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.change(input(), { target: { value: "j" } });

    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  test("Enter with nothing to ask does nothing", async () => {
    answerWith([]);

    const { onSelect } = renderFilter();

    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "visitor:abc" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("user-flow-scope-hint")).toBeInTheDocument();
  });

  test("Escape clears the text first, then closes", async () => {
    renderFilter();

    await openWithPeople(2);
    fireEvent.change(input(), { target: { value: "jane" } });

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().value).toBe("");
    expect(screen.getByTestId("user-flow-scope-menu")).toBeInTheDocument();

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByTestId("user-flow-scope-menu")).toBeNull();
  });
});

describe("for assistive technology", () => {
  test("the box says what it controls and which row is active", async () => {
    renderFilter();

    expect(input()).toHaveAttribute("role", "combobox");
    expect(input()).toHaveAttribute("aria-expanded", "false");

    await openWithPeople(2);

    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).toHaveAttribute(
      "aria-activedescendant",
      (options()[0] as HTMLElement).id,
    );
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "id",
      input().getAttribute("aria-controls"),
    );
  });
});
