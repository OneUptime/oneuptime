import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { UserFlowScopeDto } from "../../../Types/Rum/UserFlow";
import getJestMockFunction, { MockFunction } from "../../MockType";
import UserFlowScopeBanner from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScopeBanner";
import { UserFlowScope } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScope";

/*
 * The strip that says who the page is narrowed to. A narrowed page reads like
 * the whole of it, so what matters is that it names the right person in every
 * state of knowing, and is the way back.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

const KEY: string = "a".repeat(64);
const VISITOR: string = "0123456789abcdef0123456789abcdef";
const SESSION: string = "c0000000000000000000000000000001";

const SCOPED_USER: UserFlowScope = {
  kind: "user",
  identifiedUserKey: KEY,
  identifiedUserRef: "",
};

function applied(overrides: Partial<UserFlowScopeDto>): UserFlowScopeDto {
  return {
    kind: "user",
    identifiedUserKey: "",
    visitorId: "",
    sessionId: "",
    ...overrides,
  };
}

function renderBanner(props: {
  scope: UserFlowScope;
  applied?: UserFlowScopeDto | null;
  sessionsInWindow?: number | null;
}): MockFunction {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <UserFlowScopeBanner
      scope={props.scope}
      applied={props.applied ?? null}
      sessionsInWindow={props.sessionsInWindow ?? null}
      onChange={onChange as unknown as (scope: UserFlowScope | null) => void}
    />,
  );

  return onChange;
}

function name(): HTMLElement {
  return screen.getByTestId("user-flow-scope-name");
}

function detail(): HTMLElement {
  return screen.getByTestId("user-flow-scope-detail");
}

afterEach(() => {
  cleanup();
});

describe("who it names", () => {
  test("nobody yet, while the read runs and only the key is known", () => {
    renderBanner({ scope: SCOPED_USER });

    expect(name()).toHaveTextContent("This user");
    expect(detail()).toHaveTextContent("Identified user");
    expect(detail()).not.toHaveTextContent("session");
  });

  test("the label the server gives a role that may read it", () => {
    renderBanner({
      scope: SCOPED_USER,
      applied: applied({
        identifiedUserKey: KEY,
        identifiedUserLabel: "jane@example.com",
      }),
      sessionsInWindow: 4,
    });

    expect(name()).toHaveTextContent("jane@example.com");
    expect(detail()).toHaveTextContent(
      "Identified user · 4 sessions in this range",
    );
  });

  test("Hidden for a role that may not, in words of its own language", () => {
    renderBanner({
      scope: SCOPED_USER,
      applied: applied({ identifiedUserKey: KEY }),
      sessionsInWindow: 1,
    });

    expect(name()).toHaveTextContent("Hidden");
    expect(detail()).toHaveTextContent("1 session in this range");
  });

  test("a visitor as the Users page does", () => {
    renderBanner({
      scope: { kind: "visitor", visitorId: VISITOR },
      sessionsInWindow: 2,
    });

    expect(name()).toHaveTextContent("Visitor 012345");
    expect(detail()).toHaveTextContent(
      "Anonymous visitor · 2 sessions in this range",
    );
  });

  test("a session by its short id, with no count of one", () => {
    renderBanner({
      scope: { kind: "session", sessionId: SESSION },
      applied: applied({ kind: "session", sessionId: SESSION }),
      sessionsInWindow: 1,
    });

    expect(name()).toHaveTextContent("Session c0000000");
    expect(detail()).toHaveTextContent(/^One session$/);
  });
});

describe("where it goes", () => {
  test("Show all users clears the scope", () => {
    const onChange: MockFunction = renderBanner({ scope: SCOPED_USER });

    fireEvent.click(screen.getByTestId("user-flow-scope-clear"));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("a person has no owner to widen to", () => {
    renderBanner({
      scope: SCOPED_USER,
      applied: applied({
        identifiedUserKey: KEY,
        identifiedUserLabel: "jane@example.com",
      }),
    });

    expect(screen.queryByTestId("user-flow-scope-owner")).toBeNull();
  });

  test("a session widens to its identified owner, with their label", () => {
    const onChange: MockFunction = renderBanner({
      scope: { kind: "session", sessionId: SESSION },
      applied: applied({
        kind: "session",
        sessionId: SESSION,
        identifiedUserKey: KEY,
        visitorId: VISITOR,
        identifiedUserLabel: "jane@example.com",
      }),
    });

    expect(detail()).toHaveTextContent("One session from jane@example.com");

    fireEvent.click(screen.getByTestId("user-flow-scope-owner"));

    expect(onChange).toHaveBeenCalledWith({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "jane@example.com",
    });
  });

  test("an anonymous session widens to its browser, for any role", () => {
    const onChange: MockFunction = renderBanner({
      scope: { kind: "session", sessionId: SESSION },
      applied: applied({
        kind: "session",
        sessionId: SESSION,
        visitorId: VISITOR,
      }),
    });

    expect(detail()).toHaveTextContent("One session from Visitor 012345");

    fireEvent.click(screen.getByTestId("user-flow-scope-owner"));

    expect(onChange).toHaveBeenCalledWith({
      kind: "visitor",
      visitorId: VISITOR,
    });
  });

  test("a hidden owner is reached by key, unnamed", () => {
    const onChange: MockFunction = renderBanner({
      scope: { kind: "session", sessionId: SESSION },
      applied: applied({
        kind: "session",
        sessionId: SESSION,
        identifiedUserKey: KEY,
      }),
    });

    expect(detail()).toHaveTextContent("One session from Hidden");

    fireEvent.click(screen.getByTestId("user-flow-scope-owner"));

    expect(onChange).toHaveBeenCalledWith({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "",
    });
  });
});
