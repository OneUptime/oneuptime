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

/*
 * A DASHBOARD'S PRIVATE USERS AND SINGLE SIGN-ON PAGES (#10249).
 *
 * Forms -> a form -> Private Users, and -> Single Sign-On: the people, and the SAML and OIDC providers, that sign visitors
 * in to the form's public link once only people who sign in can view
 * it. Drawn here as a project member sees them:
 *
 *   - Private Users: one list, each person added by their email address
 *     ("Add Private User"), with whether they have joined and when they
 *     last signed in. A person added from the page belongs to the form
 *     and its project.
 *   - Single Sign-On: a tab per protocol, SAML first (`?protocol=oidc`
 *     opens OIDC), then Require SSO to Sign In, which asks first, with a
 *     red button, before it turns signing in with a password off. The
 *     values an identity provider is given - the Entity ID, the Reply URL,
 *     the redirect URI - are the ones the server holds a sign-in to, so
 *     they are pinned byte for byte. On OneUptime Cloud below Scale the page
 *     is the plan upsell, with the providers a trial left under it.
 *   - While the form does not ask its visitors to sign in, either page
 *     opens on one notice that says its settings do nothing yet, with Go
 *     to Share, and folds them under it. Before the form is read, or when it
 *     cannot be, the settings are drawn as they are.
 *
 * ModelTable and ModelSwitchCard are stand-ins that keep the props they
 * were handed; everything else is real. Billing and the plan are pinned in
 * every test: CI's config.env sets BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const urlModule: {
    default: { fromString: (url: string) => unknown };
  } = jest.requireActual("../../../Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };
  const protocolModule: { default: Record<string, unknown> } =
    jest.requireActual("../../../Types/API/Protocol") as {
      default: Record<string, unknown>;
    };

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  mocked["HOST"] = "oneuptime.example.com";
  mocked["HTTP_PROTOCOL"] = protocolModule.default["HTTPS"];
  mocked["IDENTITY_URL"] = urlModule.default.fromString(
    "https://oneuptime.example.com/identity",
  );

  return mocked;
});

/*
 * What the server answers: the form's sign-in switch (an Error when
 * it cannot be read), and how many providers a Scale trial left.
 */
const mockServer: {
  form: Record<string, unknown> | null | Error;
  leftoverProviders: number;
} = { form: null, leftoverProviders: 0 };

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        if (mockServer.form instanceof Error) {
          return Promise.reject(mockServer.form);
        }

        return Promise.resolve(mockServer.form);
      },
      count: (): Promise<number> => {
        return Promise.resolve(mockServer.leftoverProviders);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
    },
  };
});

interface MockColumn {
  title: string;
  hideOnMobile?: boolean | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
}

interface MockActionButton {
  title: string;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
}

interface MockTableProps {
  id: string;
  modelType: { new (): unknown };
  query?: Record<string, unknown> | undefined;
  createVerb?: string | undefined;
  singularName?: string | undefined;
  isCreateable?: boolean | undefined;
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;
  formFields?: Array<{ field?: Record<string, unknown> }> | undefined;
  columns?: Array<MockColumn> | undefined;
  actionButtons?: Array<MockActionButton> | undefined;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
  onCreateSuccess?:
    | ((item: unknown, modalType?: unknown) => Promise<unknown>)
    | undefined;
}

// The props each stand-in table was last drawn with, by its id.
const mockTables: Record<string, MockTableProps> = {};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: MockTableProps): ReactElement => {
      mockTables[props.id] = props;

      return react.createElement("div", {
        "data-testid": `model-table-${props.id}`,
      });
    },
  };
});

interface MockSwitchConfirmation {
  title?: string | undefined;
  description?: string | undefined;
  submitButtonText?: string | undefined;
  submitButtonType?: unknown;
}

interface MockSwitchCardProps {
  modelType: { new (): { tableName?: string | undefined } };
  modelId: { toString: () => string };
  column: string;
  cardTitle: string;
  title: string;
  note?: string | undefined;
  getDescription: (isOn: boolean) => string;
  getConfirmation?:
    | ((isTurningOn: boolean) => MockSwitchConfirmation | undefined)
    | undefined;
  dataTestId: string;
}

const mockSwitchCards: Record<string, MockSwitchCardProps> = {};

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: MockSwitchCardProps): ReactElement => {
      mockSwitchCards[props.dataTestId] = props;

      return react.createElement("div", {
        "data-testid": `model-switch-card-${props.dataTestId}`,
      });
    },
  };
});

import FormPrivateUsersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/PrivateUsers";
import FormSingleSignOnPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/SingleSignOn";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import FormSignInCopy, {
  FORM_SIGN_IN_ONLY_FOLD_TEST_ID,
  FORM_SIGN_IN_ONLY_NOTICE_TEST_ID,
  FormSignInOnlyPage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormSignInCopy";
import PrivateAccessCopy, {
  OIDC_CONFIG_VALUES_TEST_ID,
  PRIVATE_USERS_TABLE_TEST_ID,
  REQUIRE_SSO_SWITCH_TEST_ID,
  SAML_CONFIG_VALUES_TEST_ID,
  SINGLE_SIGN_ON_TABS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/PrivateAccess/PrivateAccessCopy";
import { FORM_PRIVATE_ACCESS } from "../../../../App/FeatureSet/Dashboard/src/Components/PrivateAccess/PrivateAccessKinds";
import { getPlanLeftoverTableTestId } from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Form from "../../../Models/DatabaseModels/Form";
import FormPrivateUser from "../../../Models/DatabaseModels/FormPrivateUser";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const FORM_ID: string = "0193c0de-7777-4aaa-8bbb-0000000010e5";
const PROVIDER_ID: string = "0193c0de-7777-4aaa-8bbb-00000000ff01";

// The tables of providers a trial left, under the upsell (PlanLeftoverTable).
const SAML_LEFTOVERS_TEST_ID: string = getPlanLeftoverTableTestId(
  "form-sso-table-leftover",
);
const OIDC_LEFTOVERS_TEST_ID: string = getPlanLeftoverTableTestId(
  "form-oidc-table-leftover",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

// The form's one switch, Only people who sign in (Form.requireSignIn).
const SIGN_IN: Record<string, unknown> = {
  requireSignIn: true,
};

const SHARED_ANOTHER_WAY: Array<[string, Record<string, unknown>]> = [
  ["with anyone who has the link", { requireSignIn: false }],
];

let currentPlan: PlanType | null = null;

const pageRoute: (pageMapKey: string) => string = (
  pageMapKey: string,
): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(FORM_ID),
  }).toString();
};

const openPrivateUsers: (search?: string) => Promise<void> = async (
  search?: string,
): Promise<void> => {
  goTo(`${pageRoute(PageMap.FORM_VIEW_PRIVATE_USERS)}${search || ""}`);

  await act(async () => {
    render(<FormPrivateUsersPage {...PAGE_PROPS} />);
  });
};

const openSingleSignOn: (search?: string) => Promise<void> = async (
  search?: string,
): Promise<void> => {
  const path: string = pageRoute(PageMap.FORM_VIEW_SINGLE_SIGN_ON);

  goTo(path);

  // The protocol is read from the address bar, as the app has it.
  if (search) {
    window.history.replaceState({}, "", `${path}${search}`);
  }

  await act(async () => {
    render(<FormSingleSignOnPage {...PAGE_PROPS} />);
  });
};

const table: (id: string) => MockTableProps = (id: string): MockTableProps => {
  const props: MockTableProps | undefined = mockTables[id];

  if (!props) {
    throw new Error(
      `No table "${id}" was drawn. Drawn: ${Object.keys(mockTables).join(", ")}`,
    );
  }

  return props;
};

// What a value in a query or on a created row reads as.
const asText: (value: unknown) => string = (value: unknown): string => {
  return value === undefined || value === null ? "" : String(value);
};

beforeEach(() => {
  billingEnabledForTest = false;
  currentPlan = null;
  mockServer.form = { ...SIGN_IN };
  mockServer.leftoverProviders = 0;

  for (const id of Object.keys(mockTables)) {
    delete mockTables[id];
  }

  for (const id of Object.keys(mockSwitchCards)) {
    delete mockSwitchCards[id];
  }

  goTo(`/dashboard/${PROJECT_ID}`);

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return currentPlan;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Private Users page", () => {
  test("on a form that asks its visitors to sign in, draws the list as it is", async () => {
    await openPrivateUsers();

    expect(
      screen.queryByTestId(FORM_SIGN_IN_ONLY_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(PRIVATE_USERS_TABLE_TEST_ID)).toBeInTheDocument();

    const list: MockTableProps = table("form-private-users-table");

    expect(new list.modelType()).toBeInstanceOf(FormPrivateUser);
    // The form's own private users, in the project the page is in.
    expect(asText(list.query?.["formId"])).toBe(FORM_ID);
    expect(asText(list.query?.["projectId"])).toBe(PROJECT_ID);
  });

  test("adds a person by their email address: Add Private User, nothing to edit", async () => {
    await openPrivateUsers();

    const list: MockTableProps = table("form-private-users-table");

    expect(list.createVerb).toBe("Add");
    expect(list.singularName).toBe(PrivateAccessCopy.privateUser);
    expect(
      (list.formFields || []).map(
        (formField: { field?: Record<string, unknown> }) => {
          return Object.keys(formField.field || {});
        },
      ),
    ).toEqual([["email"]]);
    expect(list.isCreateable).toBe(true);
    expect(list.isEditable).toBe(false);
    // Remove ends every session the person holds (the server's part).
    expect(list.isDeleteable).toBe(true);
  });

  test("a person added from the page belongs to the form and its project", async () => {
    await openPrivateUsers();

    const created: FormPrivateUser = (await table(
      "form-private-users-table",
    ).onBeforeCreate!(new FormPrivateUser())) as FormPrivateUser;

    expect(asText(created.formId)).toBe(FORM_ID);
    expect(asText(created.projectId)).toBe(PROJECT_ID);
  });

  test("says who has joined, and when each last signed in", async () => {
    await openPrivateUsers();

    const columns: Array<MockColumn> =
      table("form-private-users-table").columns || [];

    expect(
      columns.map((column: MockColumn) => {
        return column.title;
      }),
    ).toEqual([
      PrivateAccessCopy.emailTitle,
      PrivateAccessCopy.statusTitle,
      PrivateAccessCopy.lastSignedIn,
    ]);
    expect(
      columns
        .filter((column: MockColumn) => {
          return column.hideOnMobile;
        })
        .map((column: MockColumn) => {
          return column.title;
        }),
    ).toEqual([PrivateAccessCopy.lastSignedIn]);

    const status: MockColumn = columns[1]!;

    const statusOf: (row: Record<string, unknown>) => string = (
      row: Record<string, unknown>,
    ): string => {
      const { container } = render(<div>{status.getElement!(row)}</div>);
      const text: string = container.textContent || "";
      cleanup();
      return text;
    };

    // Set a password from the invitation, or signed in with single sign-on.
    expect(statusOf({ hasPassword: true })).toBe(PrivateAccessCopy.joined);
    expect(statusOf({ hasPassword: false, lastActive: new Date() })).toBe(
      PrivateAccessCopy.joined,
    );
    // Only sent the invitation.
    expect(statusOf({ hasPassword: false })).toBe(PrivateAccessCopy.invited);
  });

  test.each(SHARED_ANOTHER_WAY)(
    "on a form shared %s, says the list does nothing yet and folds it under the notice",
    async (_label: string, form: Record<string, unknown>) => {
      mockServer.form = form;
      await openPrivateUsers();

      const notice: HTMLElement = screen.getByTestId(
        FORM_SIGN_IN_ONLY_NOTICE_TEST_ID,
      );

      expect(notice).toHaveTextContent(FormSignInCopy.notice);
      expect(notice).toHaveTextContent(FormSignInCopy.noticeAction);

      const fold: HTMLElement = screen.getByTestId(
        FORM_SIGN_IN_ONLY_FOLD_TEST_ID,
      );

      expect(fold).toHaveTextContent(FormSignInCopy.foldTitle);
      expect(fold).toHaveTextContent(
        FormSignInCopy.foldSummary[
          FormSignInOnlyPage.PrivateUsers
        ],
      );
      // Folded, and still there to set up first.
      expect(within(fold).getByRole("button")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(
        within(fold).getByTestId(PRIVATE_USERS_TABLE_TEST_ID),
      ).toBeInTheDocument();
    },
  );

  test("Go to Share opens the form's Share page", async () => {
    mockServer.form = { requireSignIn: false };

    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {
      return undefined;
    });

    await openPrivateUsers();

    fireEvent.click(screen.getByTestId(FORM_SIGN_IN_ONLY_NOTICE_TEST_ID));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      pageRoute(PageMap.FORM_VIEW_SHARE),
    );
  });

  test("a link that names a place on the page opens the fold", async () => {
    mockServer.form = { requireSignIn: false };

    await openPrivateUsers("#private-users");

    expect(
      within(screen.getByTestId(FORM_SIGN_IN_ONLY_FOLD_TEST_ID)).getByRole(
        "button",
      ),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test.each([
    ["not found", null],
    ["unreadable", new Error("offline")],
  ])(
    "on a %s form, draws the list as it is and says nothing it cannot be sure of",
    async (_label: string, form: null | Error) => {
      mockServer.form = form;
      await openPrivateUsers();

      expect(
        screen.getByTestId(PRIVATE_USERS_TABLE_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(FORM_SIGN_IN_ONLY_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(FORM_SIGN_IN_ONLY_FOLD_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );
});

describe("the Single Sign-On page", () => {
  test("opens on SAML, with OIDC beside it and Require SSO to Sign In under them", async () => {
    await openSingleSignOn();

    const tabs: HTMLElement = screen.getByTestId(SINGLE_SIGN_ON_TABS_TEST_ID);

    expect(tabs).toHaveTextContent(PrivateAccessCopy.samlTabName);
    expect(tabs).toHaveTextContent(PrivateAccessCopy.oidcTabName);
    // The panel draws one tab at a time.
    expect(
      within(tabs).getByTestId("model-table-form-sso-table"),
    ).toBeInTheDocument();
    expect(
      within(tabs).queryByTestId("model-table-form-oidc-table"),
    ).not.toBeInTheDocument();

    const saml: MockTableProps = table("form-sso-table");

    expect(saml.createVerb).toBe("Add");
    expect(saml.isCreateable).toBe(true);
    expect(saml.isEditable).toBe(true);
    expect(saml.isDeleteable).toBe(true);
    expect(asText(saml.query?.["formId"])).toBe(FORM_ID);
    expect(asText(saml.query?.["projectId"])).toBe(PROJECT_ID);

    expect(
      screen.getByTestId(`model-switch-card-${REQUIRE_SSO_SWITCH_TEST_ID}`),
    ).toBeInTheDocument();
  });

  test("?protocol=oidc opens the OIDC tab", async () => {
    await openSingleSignOn("?protocol=oidc");

    const tabs: HTMLElement = screen.getByTestId(SINGLE_SIGN_ON_TABS_TEST_ID);

    expect(
      within(tabs).getByTestId("model-table-form-oidc-table"),
    ).toBeInTheDocument();
    expect(
      within(tabs).queryByTestId("model-table-form-sso-table"),
    ).not.toBeInTheDocument();

    const oidc: MockTableProps = table("form-oidc-table");

    expect(oidc.createVerb).toBe("Add");
    expect(asText(oidc.query?.["formId"])).toBe(FORM_ID);
  });

  test("a provider added from the page belongs to the form and its project", async () => {
    await openSingleSignOn();

    const created: { formId?: unknown; projectId?: unknown } =
      (await table("form-sso-table").onBeforeCreate!(
        new FORM_PRIVATE_ACCESS.samlModel(),
      )) as { formId?: unknown; projectId?: unknown };

    expect(asText(created.formId)).toBe(FORM_ID);
    expect(asText(created.projectId)).toBe(PROJECT_ID);
  });

  test("View SSO Config gives the identity provider the form's Entity ID and Reply URL, byte for byte", async () => {
    await openSingleSignOn();

    const saml: MockTableProps = table("form-sso-table");
    const viewConfig: MockActionButton = (saml.actionButtons || []).find(
      (button: MockActionButton) => {
        return button.title === PrivateAccessCopy.viewSamlConfig;
      },
    )!;

    await act(async () => {
      viewConfig.onClick(
        { _id: PROVIDER_ID, isEnabled: true },
        () => {},
        () => {},
      );
    });

    const values: HTMLElement = screen.getByTestId(SAML_CONFIG_VALUES_TEST_ID);

    expect(values).toHaveTextContent(
      `https://oneuptime.example.com/form-sso/${FORM_ID}/${PROVIDER_ID}`,
    );
    expect(values).toHaveTextContent(
      `https://oneuptime.example.com/identity/form-idp-login/${FORM_ID}/${PROVIDER_ID}`,
    );
    // On already: nothing more to do.
    expect(
      screen.queryByTestId("sso-config-turn-on-note"),
    ).not.toBeInTheDocument();
  });

  test("saving a new SAML provider opens its values straight away, and says to turn it on", async () => {
    await openSingleSignOn();

    await act(async () => {
      await table("form-sso-table").onCreateSuccess!(
        { _id: PROVIDER_ID, isEnabled: false },
        ModalType.Create,
      );
    });

    expect(screen.getByTestId(SAML_CONFIG_VALUES_TEST_ID)).toHaveTextContent(
      `https://oneuptime.example.com/identity/form-idp-login/${FORM_ID}/${PROVIDER_ID}`,
    );
    expect(screen.getByTestId("sso-config-turn-on-note")).toHaveTextContent(
      PrivateAccessCopy.samlTurnOnNote,
    );
  });

  test("an edit saved does not open the values again", async () => {
    await openSingleSignOn();

    await act(async () => {
      await table("form-sso-table").onCreateSuccess!(
        { _id: PROVIDER_ID, isEnabled: true },
        ModalType.Edit,
      );
    });

    expect(
      screen.queryByTestId(SAML_CONFIG_VALUES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("View OIDC Config gives the identity provider the form's redirect URI, byte for byte", async () => {
    await openSingleSignOn("?protocol=oidc");

    const viewConfig: MockActionButton = (
      table("form-oidc-table").actionButtons || []
    ).find((button: MockActionButton) => {
      return button.title === PrivateAccessCopy.viewOidcConfig;
    })!;

    await act(async () => {
      viewConfig.onClick(
        { _id: PROVIDER_ID, isEnabled: false },
        () => {},
        () => {},
      );
    });

    expect(screen.getByTestId(OIDC_CONFIG_VALUES_TEST_ID)).toHaveTextContent(
      `https://oneuptime.example.com/identity/form-oidc-callback/${FORM_ID}/${PROVIDER_ID}`,
    );
    expect(screen.getByTestId("oidc-config-turn-on-note")).toHaveTextContent(
      PrivateAccessCopy.oidcTurnOnNote,
    );
  });

  test("Require SSO to Sign In saves the form's own switch, and asks first, in red, only to turn it on", async () => {
    await openSingleSignOn();

    const card: MockSwitchCardProps =
      mockSwitchCards[REQUIRE_SSO_SWITCH_TEST_ID]!;

    expect(new card.modelType()).toBeInstanceOf(Form);
    expect(card.modelId.toString()).toBe(FORM_ID);
    expect(card.column).toBe("requireSsoForLogin");
    expect(card.title).toBe(PrivateAccessCopy.requireSsoSwitchTitle);
    expect(card.note).toBe(FORM_PRIVATE_ACCESS.copy.requireSsoNote);
    expect(card.getDescription(true)).toBe(
      PrivateAccessCopy.requireSsoOnDescription,
    );
    expect(card.getDescription(false)).toBe(
      PrivateAccessCopy.requireSsoOffDescription,
    );

    const turningOn: MockSwitchConfirmation | undefined =
      card.getConfirmation!(true);

    expect(turningOn?.title).toBe(PrivateAccessCopy.requireSsoConfirmTitle);
    expect(turningOn?.description).toBe(
      FORM_PRIVATE_ACCESS.copy.requireSsoConfirmDescription,
    );
    expect(turningOn?.submitButtonType).toBe(ButtonStyleType.DANGER);
    // Turning it off locks nobody out: it saves at once.
    expect(card.getConfirmation!(false)).toBeUndefined();
  });

  test("on OneUptime Cloud below Scale, shows the plan upsell instead, with nothing to set up", async () => {
    billingEnabledForTest = true;
    currentPlan = PlanType.Growth;

    await openSingleSignOn();

    expect(document.body).toHaveTextContent(
      "Single Sign-On is available on the Scale plan and above.",
    );
    expect(
      screen.queryByTestId(SINGLE_SIGN_ON_TABS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`model-switch-card-${REQUIRE_SSO_SWITCH_TEST_ID}`),
    ).not.toBeInTheDocument();
    // No provider is left over from a trial: nothing under the upsell.
    expect(
      screen.queryByTestId(SAML_LEFTOVERS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(OIDC_LEFTOVERS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("below Scale, the providers a trial left are listed under the upsell, to turn off or delete", async () => {
    billingEnabledForTest = true;
    currentPlan = PlanType.Growth;
    mockServer.leftoverProviders = 1;

    await openSingleSignOn();

    expect(screen.getByTestId(SAML_LEFTOVERS_TEST_ID)).toBeInTheDocument();
    expect(screen.getByTestId(OIDC_LEFTOVERS_TEST_ID)).toBeInTheDocument();

    // The form's own providers, in the project the page is in.
    for (const leftovers of [SAML_LEFTOVERS_TEST_ID, OIDC_LEFTOVERS_TEST_ID]) {
      expect(asText(table(leftovers).query?.["formId"])).toBe(
        FORM_ID,
      );
      expect(asText(table(leftovers).query?.["projectId"])).toBe(PROJECT_ID);
    }
  });

  test.each([PlanType.Scale, PlanType.Enterprise])(
    "on OneUptime Cloud on %s, the page is the configuration screen",
    async (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlan = plan;

      await openSingleSignOn();

      expect(
        screen.getByTestId(SINGLE_SIGN_ON_TABS_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`model-switch-card-${REQUIRE_SSO_SWITCH_TEST_ID}`),
      ).toBeInTheDocument();
    },
  );

  test.each(SHARED_ANOTHER_WAY)(
    "on a form shared %s, says the providers do nothing yet and folds them under the notice",
    async (_label: string, form: Record<string, unknown>) => {
      mockServer.form = form;
      await openSingleSignOn();

      expect(
        screen.getByTestId(FORM_SIGN_IN_ONLY_NOTICE_TEST_ID),
      ).toHaveTextContent(FormSignInCopy.notice);

      const fold: HTMLElement = screen.getByTestId(
        FORM_SIGN_IN_ONLY_FOLD_TEST_ID,
      );

      expect(fold).toHaveTextContent(
        FormSignInCopy.foldSummary[
          FormSignInOnlyPage.SingleSignOn
        ],
      );
      expect(
        within(fold).getByTestId(SINGLE_SIGN_ON_TABS_TEST_ID),
      ).toBeInTheDocument();
    },
  );
});
