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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A status page's Private Users page says, in a notice, when its private
 * users cannot sign in because visitors enter the master password instead:
 * the page is private and its password is what lets visitors in. The notice
 * keeps its message, and takes the reader to Access, where who can see the
 * page is chosen.
 *
 * It used to show whenever the password switch was on - on a public page,
 * where the password did nothing, and on a private page with no password
 * set, where the server lets private users sign in. It follows the rule the
 * server enforces now (Types/StatusPage/StatusPageAccess).
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

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { id: string }): ReactElement => {
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": `model-table-${props.id}`,
      });
    },
  };
});

import StatusPagePrivateUsers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/PrivateUser";
import StatusPageAccessCopy, {
  PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface Stored {
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
  hasMasterPassword: boolean;
}

// A page visitors enter the password for.
const PASSWORD_PAGE: Stored = {
  isPublicStatusPage: false,
  enableMasterPassword: true,
  hasMasterPassword: true,
};

let stored: Stored = PASSWORD_PAGE;

let navigateMock: MockFunction;

beforeEach(() => {
  stored = { ...PASSWORD_PAGE };
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.isPublicStatusPage = stored.isPublicStatusPage;
    page.enableMasterPassword = stored.enableMasterPassword;

    if (stored.hasMasterPassword) {
      page.masterPassword = new HashedString("stored-hash", true);
    }

    return page;
  });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  navigateMock = getJestMockFunction();
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (...args: Array<unknown>): void => {
      navigateMock(...args);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<StatusPagePrivateUsers {...PAGE_PROPS} />);
  });

  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

describe("the Private Users notice", () => {
  test("reads what decides who can see the page", async () => {
    await renderPage();

    const request: { select: JSONObject; id: ObjectID } = getItemMock.mock
      .calls[0]![0] as { select: JSONObject; id: ObjectID };

    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.select).toEqual({
      isPublicStatusPage: true,
      enableMasterPassword: true,
      masterPassword: true,
    });
  });

  test("shows while visitors enter the password, with its message and the way to Access", async () => {
    await renderPage();

    const notice: HTMLElement = screen.getByTestId(
      PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(
      StatusPageAccessCopy.privateUsersPasswordNotice,
    );
    expect(notice).toHaveTextContent(
      StatusPageAccessCopy.privateUsersPasswordNoticeAction,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(StatusPageAccessCopy.privateUsersPasswordNotice),
      }),
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect((navigateMock.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/authentication-settings`,
    );
  });

  test.each([
    [
      "a public page (the password does nothing there)",
      { isPublicStatusPage: true, enableMasterPassword: true, hasMasterPassword: true },
    ],
    [
      "a private page with the switch on but no password set (private users sign in)",
      { isPublicStatusPage: false, enableMasterPassword: true, hasMasterPassword: false },
    ],
    [
      "a private page with a password set but switched off",
      { isPublicStatusPage: false, enableMasterPassword: false, hasMasterPassword: true },
    ],
    [
      "a sign-in page",
      { isPublicStatusPage: false, enableMasterPassword: false, hasMasterPassword: false },
    ],
  ])("is not shown on %s", async (_label: string, page: Stored) => {
    stored = page;

    await renderPage();

    expect(
      screen.queryByTestId(PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("model-table-status-page-group"),
    ).toBeInTheDocument();
  });
});
