import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Status page > SSO below the Scale plan (Dashboard Components/StatusPage/
 * StatusPageRequireSsoLeftover).
 *
 * The page is the plan's upsell, with the SAML providers the status page
 * still has under it, to turn off or delete. A status page a Scale trial
 * left requiring SSO lets its private users in with SSO or OIDC only, so
 * turning the providers off without letting people back in with passwords
 * would shut every viewer out. While it requires SSO, its "Require SSO for
 * Login" switch is drawn there too; once it is off, the card says how
 * people sign in now instead of offering the switch again.
 *
 * The real component is rendered; the network and the switch card (whose
 * own behaviour ModelSwitchCard.test.tsx covers) are stand-ins.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

interface RecordedSwitchCard {
  modelType: { new (): { tableName?: string | undefined } };
  modelId: { toString: () => string };
  column: string;
  cardTitle: string;
  cardDescription?: unknown;
  initialItem?: Record<string, unknown> & {
    id?: { toString: () => string } | null;
  };
  onSaved?: ((isOn: boolean) => void) | undefined;
  dataTestId: string;
}

const mockCards: { renders: Array<RecordedSwitchCard> } = { renders: [] };

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: RecordedSwitchCard): ReactElement => {
      mockCards.renders.push(props);

      return react.createElement(
        "div",
        { "data-testid": "switch-card" },
        react.createElement(
          "button",
          {
            type: "button",
            "data-testid": "saved-off",
            onClick: () => {
              props.onSaved?.(false);
            },
          },
          "saved off",
        ),
        react.createElement(
          "button",
          {
            type: "button",
            "data-testid": "saved-on",
            onClick: () => {
              props.onSaved?.(true);
            },
          },
          "saved on",
        ),
      );
    },
  };
});

import StatusPageRequireSsoLeftover, {
  STATUS_PAGE_REQUIRE_SSO_LEFTOVER_OFF_TEST_ID,
  STATUS_PAGE_REQUIRE_SSO_LEFTOVER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageRequireSsoLeftover";
import { StatusPageRequireSsoCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";

const STATUS_PAGE_ID: string = "66666666-6666-4666-8666-666666666666";

// What the status page holds (an Error: the read fails).
let stored: Record<string, unknown> | Error | null = {};

beforeEach(() => {
  stored = {};
  mockCards.renders = [];

  getItemMock.mockReset();
  getItemMock.mockImplementation(
    async (request: {
      modelType: { new (): BaseModel };
    }): Promise<BaseModel | null> => {
      if (stored instanceof Error) {
        throw stored;
      }

      if (stored === null) {
        return null;
      }

      const model: BaseModel = new request.modelType();
      model._id = STATUS_PAGE_ID;
      Object.assign(model, stored);
      return model;
    },
  );
});

afterEach(() => {
  cleanup();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderLeftover(): Promise<void> {
  await act(async () => {
    render(
      <StatusPageRequireSsoLeftover
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
      />,
    );
  });

  await flush();
}

describe("what it reads", () => {
  test("the status page's requireSsoForLogin, once, and nothing else", async () => {
    await renderLeftover();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };

    expect(request.modelType).toBe(StatusPage);
    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.select).toEqual({ requireSsoForLogin: true });
  });
});

describe("a status page that does not require SSO gets nothing: the upsell is the page", () => {
  test.each([
    ["not required", { requireSsoForLogin: false }],
    ["never set", {}],
  ])("%s", async (_label: string, values: Record<string, unknown>) => {
    stored = values;

    await renderLeftover();

    expect(
      screen.queryByTestId(STATUS_PAGE_REQUIRE_SSO_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(STATUS_PAGE_REQUIRE_SSO_LEFTOVER_OFF_TEST_ID),
    ).not.toBeInTheDocument();
    expect(mockCards.renders).toEqual([]);
  });

  test("a read that fails, or finds nothing", async () => {
    stored = new Error("network down");
    await renderLeftover();
    expect(mockCards.renders).toEqual([]);

    cleanup();

    stored = null;
    await renderLeftover();
    expect(mockCards.renders).toEqual([]);
  });
});

describe("a status page that still requires SSO", () => {
  beforeEach(() => {
    stored = { requireSsoForLogin: true };
  });

  test("gets its switch, on its own column, starting from what was read", async () => {
    await renderLeftover();

    expect(
      screen.getByTestId(STATUS_PAGE_REQUIRE_SSO_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();

    const card: RecordedSwitchCard =
      mockCards.renders[mockCards.renders.length - 1]!;

    expect(new card.modelType().tableName).toBe("StatusPage");
    expect(card.modelId.toString()).toBe(STATUS_PAGE_ID);
    expect(card.column).toBe("requireSsoForLogin");
    expect(card.cardTitle).toBe(StatusPageRequireSsoCopy.cardTitle);
    // No "test SSO with the link above": that link is not on this page.
    expect(card.cardDescription).toBeUndefined();
    expect(card.initialItem?.id?.toString()).toBe(STATUS_PAGE_ID);
    expect(card.initialItem?.["requireSsoForLogin"]).toBe(true);
    expect(card.dataTestId).toBe("status-page-require-sso-switch");
  });

  test("once turned off, the card says how people sign in now, and offers no switch to turn it on again", async () => {
    await renderLeftover();

    await act(async () => {
      fireEvent.click(screen.getByTestId("saved-off"));
    });

    expect(screen.queryByTestId("switch-card")).not.toBeInTheDocument();

    const off: HTMLElement = screen.getByTestId(
      STATUS_PAGE_REQUIRE_SSO_LEFTOVER_OFF_TEST_ID,
    );

    expect(off).toHaveTextContent(StatusPageRequireSsoCopy.cardTitle);
    expect(off).toHaveTextContent(
      "Private users can sign in with an email and password, or with SSO or OIDC.",
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("a save that keeps it on keeps the switch", async () => {
    await renderLeftover();

    await act(async () => {
      fireEvent.click(screen.getByTestId("saved-on"));
    });

    expect(screen.getByTestId("switch-card")).toBeInTheDocument();
    expect(
      screen.queryByTestId(STATUS_PAGE_REQUIRE_SSO_LEFTOVER_OFF_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
