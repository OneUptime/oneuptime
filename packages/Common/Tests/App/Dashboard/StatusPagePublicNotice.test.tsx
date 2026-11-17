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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A public status page lets every visitor in without signing in, so its
 * private users, its single sign-on providers and SCIM do nothing there
 * (#9130). While the page is public, the Private Users, Single Sign-On and
 * SCIM pages each open on one notice that says so, with the way to Access,
 * and fold what they hold under it. On a private page - signed in to, or
 * behind the password - and before the page is read, they say nothing of
 * the kind and draw their settings as they are.
 *
 * The lists and the Enterprise screen are drawn as markers: what matters
 * here is whether the notice is there, and where the settings are.
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

function mockMarker(testId: string): {
  __esModule: boolean;
  default: (props: { id?: string }) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: { id?: string }): ReactElement => {
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": props.id ? `${testId}-${props.id}` : testId,
      });
    },
  };
}

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return mockMarker("model-table");
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SSO",
  () => {
    return mockMarker("saml-providers");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/OIDC",
  () => {
    return mockMarker("oidc-providers");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePluginPage",
  () => {
    return mockMarker("scim-screen");
  },
);

import StatusPagePrivateUsers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/PrivateUser";
import StatusPageSingleSignOn, {
  STATUS_PAGE_SINGLE_SIGN_ON_TABS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SingleSignOn";
import StatusPageScim from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SCIM";
import StatusPagePrivateOnlyCopy, {
  STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID,
  STATUS_PAGE_PUBLIC_NOTICE_TEST_ID,
  StatusPagePrivateOnlyPage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagePrivateOnlyCopy";
import { PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import HashedString from "../../../Types/HashedString";
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

const PUBLIC_PAGE: Stored = {
  isPublicStatusPage: true,
  enableMasterPassword: false,
  hasMasterPassword: false,
};

const SIGN_IN_PAGE: Stored = {
  isPublicStatusPage: false,
  enableMasterPassword: false,
  hasMasterPassword: false,
};

const PASSWORD_PAGE: Stored = {
  isPublicStatusPage: false,
  enableMasterPassword: true,
  hasMasterPassword: true,
};

interface PrivateOnlyPage {
  name: string;
  page: StatusPagePrivateOnlyPage;
  element: () => ReactElement;
  // What the page holds, as the markers draw it.
  holds: string;
}

const PAGES: Array<PrivateOnlyPage> = [
  {
    name: "Private Users",
    page: StatusPagePrivateOnlyPage.PrivateUsers,
    element: (): ReactElement => {
      return <StatusPagePrivateUsers {...PAGE_PROPS} />;
    },
    holds: "model-table-status-page-group",
  },
  {
    name: "Single Sign-On",
    page: StatusPagePrivateOnlyPage.SingleSignOn,
    element: (): ReactElement => {
      return <StatusPageSingleSignOn {...PAGE_PROPS} />;
    },
    holds: STATUS_PAGE_SINGLE_SIGN_ON_TABS_TEST_ID,
  },
  {
    name: "SCIM",
    page: StatusPagePrivateOnlyPage.Scim,
    element: (): ReactElement => {
      return <StatusPageScim {...PAGE_PROPS} />;
    },
    holds: "scim-screen",
  },
];

let stored: Stored = PUBLIC_PAGE;
let navigateMock: MockFunction;

beforeEach(() => {
  stored = { ...PUBLIC_PAGE };
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
  window.history.replaceState(null, "", "#");
});

async function renderPage(element: () => ReactElement): Promise<void> {
  await act(async () => {
    render(element());
  });

  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

function foldHeader(): HTMLElement {
  return within(
    screen.getByTestId(STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID),
  ).getAllByRole("button")[0]!;
}

describe.each(PAGES)(
  "$name, on a public status page",
  (page: PrivateOnlyPage) => {
    test("says the settings do nothing until the page is private", async () => {
      await renderPage(page.element);

      expect(
        screen.getByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
      ).toHaveTextContent(StatusPagePrivateOnlyCopy.publicNotice);
      expect(
        screen.getAllByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
      ).toHaveLength(1);
    });

    test("takes the reader to Access, where the page is made private", async () => {
      await renderPage(page.element);

      expect(
        screen.getByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
      ).toHaveTextContent(StatusPagePrivateOnlyCopy.publicNoticeAction);

      fireEvent.click(
        screen.getByRole("button", {
          name: new RegExp(StatusPagePrivateOnlyCopy.publicNotice),
        }),
      );

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect((navigateMock.mock.calls[0]![0] as Route).toString()).toBe(
        `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/authentication-settings`,
      );
    });

    test("folds what it holds under the notice, naming it, and opens to set it up", async () => {
      await renderPage(page.element);

      const fold: HTMLElement = screen.getByTestId(
        STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID,
      );

      expect(fold).toHaveTextContent(StatusPagePrivateOnlyCopy.foldTitle);
      expect(fold).toHaveTextContent(
        StatusPagePrivateOnlyCopy.foldSummary[page.page],
      );
      expect(foldHeader()).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(foldHeader());

      expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
      expect(within(fold).getByTestId(page.holds)).toBeInTheDocument();
    });

    test("opened at a place on the page, the fold is open", async () => {
      window.history.replaceState(null, "", "#sign-in-links");

      await renderPage(page.element);

      expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
    });
  },
);

describe.each(PAGES)(
  "$name, on a private status page",
  (page: PrivateOnlyPage) => {
    test.each([
      ["signed in to", SIGN_IN_PAGE],
      ["behind the password", PASSWORD_PAGE],
    ])(
      "%s, says nothing of the kind and draws its settings as they are",
      async (_label: string, access: Stored) => {
        stored = access;

        await renderPage(page.element);

        expect(
          screen.queryByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId(STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId(page.holds)).toBeInTheDocument();
      },
    );

    test("before the page is read, says nothing of the kind", async () => {
      getItemMock.mockImplementation((): Promise<unknown> => {
        return new Promise<unknown>(() => {
          // Never answers.
        });
      });

      await renderPage(page.element);

      expect(
        screen.queryByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(page.holds)).toBeInTheDocument();
    });
  },
);

describe("Private Users keeps its own notice for the password", () => {
  test("behind the password, the password notice shows and the public one does not", async () => {
    stored = PASSWORD_PAGE;

    await renderPage(PAGES[0]!.element);

    expect(
      screen.getByTestId(PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("on a public page, only the public notice shows", async () => {
    stored = {
      ...PUBLIC_PAGE,
      enableMasterPassword: true,
      hasMasterPassword: true,
    };

    await renderPage(PAGES[0]!.element);

    expect(
      screen.queryByTestId(PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(STATUS_PAGE_PUBLIC_NOTICE_TEST_ID),
    ).toBeInTheDocument();
  });
});
