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
 * "Require SSO for Login" on a status page's SSO page: one switch that
 * saves the moment it is flipped (StatusPageRequireSsoCard, on the shared
 * ModelSwitchCard). It was the "SSO Settings" card whose Edit dialog held
 * one switch, "Force SSO for Login", with "Please test SSO before you you
 * enable this feature" under it and a warning about being locked out of
 * "the project".
 *
 * Requiring SSO asks first, with a red button that names who is locked
 * out: private users who sign in with an email and password. Turning it
 * off saves at once. The card, the switch and the dialog are the real ones;
 * only the network and the permission gate are stubbed.
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

import StatusPageRequireSsoCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageRequireSsoCard";
import {
  STATUS_PAGE_REQUIRE_SSO_SWITCH_TEST_ID,
  StatusPageRequireSsoCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "5b5b5b5b-0000-4000-8000-0000000000cc";

let requireSso: boolean = false;

beforeEach(() => {
  requireSso = false;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.requireSsoForLogin = requireSso;
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

async function renderCard(): Promise<void> {
  await act(async () => {
    render(
      <StatusPageRequireSsoCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />,
    );
  });
  await flush();
}

function theSwitch(): HTMLElement {
  return screen.getByTestId(STATUS_PAGE_REQUIRE_SSO_SWITCH_TEST_ID);
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

describe("Require SSO for Login, on a status page", () => {
  test("is the SSO Settings card's one switch, reading the status page's own column", async () => {
    await renderCard();

    expect(
      screen.getByText(StatusPageRequireSsoCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageRequireSsoCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: StatusPageRequireSsoCopy.switchTitle,
      }),
    ).toBe(theSwitch());
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");

    const request: { modelType: unknown; id: ObjectID; select: JSONObject } =
      getItemMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        select: JSONObject;
      };

    expect(request.modelType).toBe(StatusPage);
    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.select).toEqual(
      expect.objectContaining({ requireSsoForLogin: true }),
    );

    // Off: private users may still sign in with a password, and it says when it applies.
    expect(document.body).toHaveTextContent(
      StatusPageRequireSsoCopy.switchOffDescription,
    );
    expect(document.body).toHaveTextContent(StatusPageRequireSsoCopy.note);
    expect(document.body).not.toHaveTextContent("you you");
  });

  test("requiring SSO asks first, with a red button naming who is locked out, then saves the column", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      StatusPageRequireSsoCopy.confirmTitle,
    );
    expect(screen.getByTestId("modal")).toHaveTextContent(
      StatusPageRequireSsoCopy.confirmDescription,
    );

    const submit: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    expect(submit).toHaveTextContent(StatusPageRequireSsoCopy.confirmButton);
    expect(submit.className).toMatch(/red/);
    expect(updateByIdMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(submit);
    });
    await flush();

    expect(sent()).toEqual([
      {
        modelType: StatusPage,
        id: STATUS_PAGE_ID,
        data: { requireSsoForLogin: true },
      },
    ]);
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(document.body).toHaveTextContent(
      StatusPageRequireSsoCopy.switchOnDescription,
    );
  });

  test("cancelling the dialog saves nothing", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("turning it off saves at once: it locks nobody out", async () => {
    requireSso = true;

    await renderCard();

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(sent()).toEqual([
      {
        modelType: StatusPage,
        id: STATUS_PAGE_ID,
        data: { requireSsoForLogin: false },
      },
    ]);
  });
});
