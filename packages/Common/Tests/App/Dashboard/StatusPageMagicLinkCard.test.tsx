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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * "Sign-In Links", under More settings on a status page's Private Users
 * (#5600): one switch, on for every page until its team turns it off, that
 * saves the moment it is flipped. Neither way locks anybody out, so neither
 * asks first. Folded, More settings says "Sign-In Links: Off" once it is
 * off - not the default - and its name otherwise.
 *
 * And the Private Users list counts a reader who signs in with a link - or
 * with SSO - as signed up: neither needs a password, and they used to read
 * "Invite Sent" however often they signed in.
 *
 * The card, the switch and the copy are the real ones; only the network and
 * the permission gate are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import StatusPageMagicLinkCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageMagicLinkCard";
import StatusPageMagicLinkCopy, {
  getMagicLinkFoldedItem,
  STATUS_PAGE_MAGIC_LINK_COLUMN,
  STATUS_PAGE_MAGIC_LINK_PLACE,
  STATUS_PAGE_MAGIC_LINK_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageMagicLinkCopy";
import { hasPrivateUserJoined } from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/PrivateUser";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES } from "../../../Types/StatusPage/StatusPageMagicLink";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "5c5c5c5c-0000-4000-8000-0000000000cc";

let linksOn: boolean = true;

beforeEach(() => {
  linksOn = true;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.enableMagicLinkLogin = linksOn;
    return page;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

async function renderCard(onChange?: (isOn: boolean) => void): Promise<void> {
  await act(async () => {
    render(
      <StatusPageMagicLinkCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        onChange={onChange}
      />,
    );
  });
  await flush();
}

function theSwitch(): HTMLElement {
  return screen.getByTestId(STATUS_PAGE_MAGIC_LINK_SWITCH_TEST_ID);
}

function sent(): Array<{ modelType: unknown; id: string; data: JSONObject }> {
  return updateByIdMock.mock.calls.map((call: Array<unknown>) => {
    const request: { modelType: unknown; id: ObjectID; data: JSONObject } =
      call[0] as { modelType: unknown; id: ObjectID; data: JSONObject };

    return {
      modelType: request.modelType,
      id: request.id.toString(),
      data: request.data,
    };
  });
}

describe("Sign-In Links, on a status page's Private Users", () => {
  test("is one switch reading the status page's own column, on as every page starts", async () => {
    await renderCard();

    expect(
      screen.getByText(StatusPageMagicLinkCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: StatusPageMagicLinkCopy.switchTitle }),
    ).toBe(theSwitch());
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");

    const request: { modelType: unknown; id: ObjectID; select: JSONObject } =
      getItemMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        select: JSONObject;
      };

    expect(request.modelType).toBe(StatusPage);
    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.select).toEqual(
      expect.objectContaining({ [STATUS_PAGE_MAGIC_LINK_COLUMN]: true }),
    );
  });

  test("on, it says what readers can do; and it says how a link works and when it is not offered", async () => {
    await renderCard();

    expect(document.body).toHaveTextContent(
      StatusPageMagicLinkCopy.switchOnDescription,
    );
    expect(document.body).toHaveTextContent(StatusPageMagicLinkCopy.note);
  });

  test("turning it off saves at once - it locks nobody out", async () => {
    const changes: Array<boolean> = [];

    await renderCard((isOn: boolean) => {
      changes.push(isOn);
    });

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(sent()).toEqual([
      {
        modelType: StatusPage,
        id: STATUS_PAGE_ID,
        data: { enableMagicLinkLogin: false },
      },
    ]);
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(document.body).toHaveTextContent(
      StatusPageMagicLinkCopy.switchOffDescription,
    );
    // The page learns, for the folded header.
    expect(changes[changes.length - 1]).toBe(false);
  });

  test("turning it on again saves at once too", async () => {
    linksOn = false;

    await renderCard();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(sent()).toEqual([
      {
        modelType: StatusPage,
        id: STATUS_PAGE_ID,
        data: { enableMagicLinkLogin: true },
      },
    ]);
  });

  test("the card has a place a link can open More settings at", async () => {
    await renderCard();

    expect(STATUS_PAGE_MAGIC_LINK_PLACE).toBe("sign-in-links");
    expect(
      document.getElementById(STATUS_PAGE_MAGIC_LINK_PLACE),
    ).toBeInTheDocument();
  });

  test("its note says how long a link works, as the server holds it", () => {
    expect(StatusPageMagicLinkCopy.note).toContain(
      `expires after ${STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES} minutes`,
    );
  });
});

describe("Sign-In Links, folded under More settings", () => {
  test("on, the default: its name alone", () => {
    const item: FoldedSectionItem = getMagicLinkFoldedItem(true);

    expect(item.title).toBe(StatusPageMagicLinkCopy.cardTitle);
    expect(item.isSet).toBe(false);
    expect(item.value).toBeUndefined();
    expect(item.key).toBe(STATUS_PAGE_MAGIC_LINK_PLACE);
  });

  test("not read yet: its name alone", () => {
    expect(getMagicLinkFoldedItem(undefined).isSet).toBe(false);
  });

  test("off: a chip that says so", () => {
    const item: FoldedSectionItem = getMagicLinkFoldedItem(false);

    expect(item.isSet).toBe(true);
    expect(item.value).toBe(StatusPageMagicLinkCopy.offValue);
    expect(item.translateValue).toBe(true);
  });
});

describe("the Private Users list: who has signed up", () => {
  const user: (data: {
    password?: boolean;
    lastActive?: boolean;
  }) => StatusPagePrivateUser = (data: {
    password?: boolean;
    lastActive?: boolean;
  }): StatusPagePrivateUser => {
    const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();

    if (data.password) {
      privateUser.password = new HashedString("stored-hash", true);
    }

    if (data.lastActive) {
      privateUser.lastActive = new Date();
    }

    return privateUser;
  };

  test("a reader who set a password", () => {
    expect(hasPrivateUserJoined(user({ password: true }))).toBe(true);
  });

  test("a reader who signs in with a link or SSO, and never set a password", () => {
    expect(hasPrivateUserJoined(user({ lastActive: true }))).toBe(true);
  });

  test("not a reader who has done neither: their invitation is all there is", () => {
    expect(hasPrivateUserJoined(user({}))).toBe(false);
  });
});
