// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeReply,
  FakeTransport,
  SentRequest,
  settle,
} from "../../UI/Utils/API/FakeAxiosServer";
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
import axios from "axios";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import {
  FORM_LOGIN_CODE_PARAMETER,
  FORM_PRIVATE_USER_API_ROUTE,
  FORM_PRIVATE_USER_CREDENTIALS_MESSAGE,
  FORM_RESET_PASSWORD_PARAMETER,
  FORM_SIGN_IN_STATE_ROUTE,
  FormPrivateUserApiRoutes,
} from "../../../Types/Form/FormPrivateUserSignIn";
import {
  PublicForm,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import { JSONObject } from "../../../Types/JSON";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import FormPage from "../../../../App/FeatureSet/Accounts/src/Pages/Form";
import {
  FORM_FORGOT_PASSWORD_SENT_TEST_ID,
  FORM_RESET_PASSWORD_DONE_TEST_ID,
  FORM_SIGN_IN_PROVIDERS_TEST_ID,
  FORM_SIGN_IN_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Components/FormSignIn/FormSignInView";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * A FORM THAT ASKS ITS VISITORS TO SIGN IN (#10249), on its link, as its
 * visitors meet it: the real page, the real sign-in view, their real API
 * client and the real locale files - only the network (a fake axios
 * transport) is a stand-in.
 *
 *   - the page asks the form's sign-in state first, and reads nothing of
 *     the form until somebody is signed in: a visitor without a session
 *     meets the sign-in, titled with the form's name and nothing else;
 *   - it signs in with what was typed, at the form's own sign-in routes,
 *     then opens the form, saying who is signed in, with Sign Out;
 *   - a wrong address or password gets the server's one answer, and stays;
 *   - a session the browser holds is renewed before anybody is asked; a
 *     single sign-on code in the address becomes one, once;
 *   - the forgotten password step and the page a reset link opens;
 *   - a button per single sign-on provider, starting at OneUptime's own
 *     address; a form that takes only single sign-on offers no password;
 *   - a submission whose session ran out renews it once and is sent again,
 *     or asks the visitor to sign in.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const FORM_ID: string = "0f000000-0000-4000-8000-000000000001";
const SAML_ID: string = "0f000000-0000-4000-8000-0000000000a1";
const OIDC_ID: string = "0f000000-0000-4000-8000-0000000000a2";
const FORM_URL: string = `${DASHBOARD_ORIGIN}/api/form/public/${SHARE_KEY}`;
const SUBMIT_URL: string = `${FORM_URL}/submit`;
const STATE_URL: string = `${FORM_URL}${FORM_SIGN_IN_STATE_ROUTE}`;
const EMAIL: string = "reader@acme.com";
const PASSWORD: string = "correct horse battery staple 9";

// A route of the form's sign-in, on OneUptime's own host.
const privateUserUrl: (route: string) => string = (route: string): string => {
  return `${DASHBOARD_ORIGIN}/api/form${FORM_PRIVATE_USER_API_ROUTE}${route}/${FORM_ID}`;
};

const LOGIN_URL: string = privateUserUrl(FormPrivateUserApiRoutes.login);
const REFRESH_URL: string = privateUserUrl(
  FormPrivateUserApiRoutes.refreshToken,
);
const LOGOUT_URL: string = privateUserUrl(FormPrivateUserApiRoutes.logout);
const METHODS_URL: string = privateUserUrl(
  FormPrivateUserApiRoutes.signInMethods,
);
const FORGOT_URL: string = privateUserUrl(
  FormPrivateUserApiRoutes.forgotPassword,
);
const RESET_URL: string = privateUserUrl(
  FormPrivateUserApiRoutes.resetPassword,
);
const EXCHANGE_URL: string = privateUserUrl(
  FormPrivateUserApiRoutes.exchangeLoginCode,
);

const FORM: PublicForm = {
  name: "Report a Problem",
  description: "Tell us what is **broken**.",
  fields: [
    {
      id: "title",
      label: "What is wrong?",
      type: PublicFormFieldType.Text,
      isRequired: true,
      maxLength: 500,
    },
  ],
  isCaptchaRequired: false,
};

// What the page is told first: the form asks, and who is signed in here.
const state: (signedInAs: string | null) => FakeReply = (
  signedInAs: string | null,
): FakeReply => {
  return {
    status: 200,
    data: {
      requireSignIn: true,
      formId: FORM_ID,
      name: "Report a Problem",
      signedInAs: signedInAs,
    },
  };
};

const NO_SESSION: FakeReply = {
  status: 401,
  data: { message: "Your sign-in to this form has ended. Sign in again." },
};

const methods: (data: {
  password: boolean;
  saml?: Array<JSONObject>;
  oidc?: Array<JSONObject>;
}) => FakeReply = (data: {
  password: boolean;
  saml?: Array<JSONObject>;
  oidc?: Array<JSONObject>;
}): FakeReply => {
  return {
    status: 200,
    data: {
      isPasswordSignInAllowed: data.password,
      samlProviders: data.saml || [],
      oidcProviders: data.oidc || [],
    },
  };
};

let server: FakeAxiosServer;

function sentRequests(): Array<string> {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
}

function bodyOf(method: HTTPMethod, url: string): JSONObject | undefined {
  return server.requestsTo(method, url)[0]?.data as JSONObject | undefined;
}

// Lets every answered request, and the renders it causes, finish.
async function flush(): Promise<void> {
  for (let round: number = 0; round < 6; round++) {
    await act(async () => {
      await settle();
    });
  }
}

async function openPage(search: string = ""): Promise<void> {
  window.history.replaceState(null, "", `/accounts/form/${SHARE_KEY}${search}`);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/form/${SHARE_KEY}${search}`]}>
        <Routes>
          <Route path="/accounts/form/:shareKey" element={<FormPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  await flush();
}

// A visitor without a session, at the sign-in.
async function openSignIn(
  signInMethods: FakeReply = methods({ password: true }),
): Promise<void> {
  server.on(HTTPMethod.GET, STATE_URL, [state(null)]);
  server.on(HTTPMethod.POST, REFRESH_URL, [NO_SESSION]);
  server.on(HTTPMethod.POST, METHODS_URL, [signInMethods]);

  await openPage();
}

async function click(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: name }));
  });

  await flush();
}

function type(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  window.localStorage.clear();
  server = new FakeAxiosServer(mockedAxios);
});

afterEach(async () => {
  cleanup();
  await settle();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.title = "";

  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

describe("a visitor without a session", () => {
  test("meets the sign-in, titled with the form's name, and nothing of the form is read", async () => {
    await openSignIn();

    expect(screen.getByTestId(FORM_SIGN_IN_TEST_ID)).toHaveTextContent(
      "Sign in to open this form.",
    );
    expect(
      screen.getByRole("heading", { name: "Report a Problem" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();

    // The state, the session the browser may hold, the ways in - no form.
    expect(sentRequests()).toEqual([
      `GET ${STATE_URL}`,
      `POST ${REFRESH_URL}`,
      `POST ${METHODS_URL}`,
    ]);
    expect(screen.queryByText("What is wrong?")).not.toBeInTheDocument();
  });

  test("signs in with what was typed, then opens the form, saying who is signed in", async () => {
    await openSignIn();

    server.on(HTTPMethod.POST, LOGIN_URL, [
      { status: 200, data: { email: EMAIL } },
    ]);
    server.on(HTTPMethod.GET, STATE_URL, [state(EMAIL)]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);

    type(/^Email/, `  ${EMAIL} `);
    type(/^Password/, PASSWORD);
    await click("Sign In");

    expect(bodyOf(HTTPMethod.POST, LOGIN_URL)).toEqual({
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(await screen.findByText("What is wrong?")).toBeInTheDocument();
    expect(screen.getByTestId("form-signed-in-as")).toHaveTextContent(
      `Signed in as ${EMAIL}`,
    );
    expect(
      within(screen.getByTestId("form-signed-in-as")).getByRole("button", {
        name: "Sign Out",
      }),
    ).toBeInTheDocument();
  });

  test("a wrong address or password gets the server's one answer, and stays", async () => {
    await openSignIn();

    server.on(HTTPMethod.POST, LOGIN_URL, [
      {
        status: 401,
        data: { message: FORM_PRIVATE_USER_CREDENTIALS_MESSAGE },
      },
    ]);

    type(/^Email/, EMAIL);
    type(/^Password/, "not it");
    await click("Sign In");

    expect(screen.getByTestId(FORM_SIGN_IN_TEST_ID)).toHaveTextContent(
      FORM_PRIVATE_USER_CREDENTIALS_MESSAGE,
    );
    expect(server.requestsTo(HTTPMethod.GET, FORM_URL)).toHaveLength(0);
  });

  test("Forgot password? sends the address typed, and says the same whatever it is", async () => {
    await openSignIn();

    server.on(HTTPMethod.POST, FORGOT_URL, [{ status: 200, data: {} }]);

    await click("Forgot password?");
    type(/^Email/, EMAIL);
    await click("Send Link");

    expect(bodyOf(HTTPMethod.POST, FORGOT_URL)).toEqual({
      data: { email: EMAIL },
    });
    expect(
      screen.getByTestId(FORM_FORGOT_PASSWORD_SENT_TEST_ID),
    ).toHaveTextContent(
      "If this address can sign in to this form, a link to choose a new password is on its way.",
    );
  });

  test("offers a button per single sign-on provider, each starting at OneUptime's own address", async () => {
    await openSignIn(
      methods({
        password: true,
        saml: [{ _id: SAML_ID, name: "Okta", description: "Staff" }],
        oidc: [{ _id: OIDC_ID, name: "Google", description: "" }],
      }),
    );

    const providers: HTMLElement = screen.getByTestId(
      FORM_SIGN_IN_PROVIDERS_TEST_ID,
    );

    expect(providers).toHaveTextContent("Sign in with Okta");
    expect(providers).toHaveTextContent("Sign in with Google");

    const links: Array<string> = within(providers)
      .getAllByRole("link")
      .map((link: HTMLElement): string => {
        return link.getAttribute("href") || "";
      });

    expect(links).toEqual([
      expect.stringMatching(new RegExp(`/form-sso/${FORM_ID}/${SAML_ID}$`)),
      expect.stringMatching(new RegExp(`/form-oidc/${FORM_ID}/${OIDC_ID}$`)),
    ]);
  });

  test("a form that takes only single sign-on offers no password, and says to use it", async () => {
    await openSignIn(
      methods({
        password: false,
        saml: [{ _id: SAML_ID, name: "Okta", description: "" }],
      }),
    );

    expect(screen.getByTestId(FORM_SIGN_IN_TEST_ID)).toHaveTextContent(
      "Sign in with your organization's single sign-on to open this form.",
    );
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  });

  test("a form with no way in yet says so, and who to ask", async () => {
    await openSignIn(methods({ password: false }));

    expect(screen.getByTestId(FORM_SIGN_IN_TEST_ID)).toHaveTextContent(
      "No way to sign in is set up for this form yet. Ask the person who shared it with you.",
    );
  });
});

describe("a visitor who holds a session", () => {
  test("signed in on this host, goes straight to the form", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(EMAIL)]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);

    await openPage();

    expect(await screen.findByText("What is wrong?")).toBeInTheDocument();
    expect(sentRequests()).toEqual([`GET ${STATE_URL}`, `GET ${FORM_URL}`]);
  });

  test("whose access token ran out, is renewed before anybody is asked to sign in", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(null)]);
    server.on(HTTPMethod.POST, REFRESH_URL, [
      { status: 200, data: { email: EMAIL } },
    ]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);

    await openPage();

    expect(await screen.findByText("What is wrong?")).toBeInTheDocument();
    expect(screen.queryByTestId(FORM_SIGN_IN_TEST_ID)).not.toBeInTheDocument();
  });

  test("Sign Out ends the session on this host and shows the sign-in again", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(EMAIL)]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);
    await openPage();

    server.on(HTTPMethod.POST, LOGOUT_URL, [{ status: 200, data: {} }]);
    server.on(HTTPMethod.POST, METHODS_URL, [methods({ password: true })]);

    await click("Sign Out");

    expect(server.requestsTo(HTTPMethod.POST, LOGOUT_URL)).toHaveLength(1);
    expect(screen.getByTestId(FORM_SIGN_IN_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByText("What is wrong?")).not.toBeInTheDocument();
  });

  test("a submission whose session ran out renews it once, and is sent again", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(EMAIL)]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);
    await openPage();

    server.on(HTTPMethod.POST, SUBMIT_URL, [
      NO_SESSION,
      { status: 200, data: { reference: "INC-42" } },
    ]);
    server.on(HTTPMethod.POST, REFRESH_URL, [
      { status: 200, data: { email: EMAIL } },
    ]);

    fireEvent.change(screen.getByTestId("form-field-title"), {
      target: { value: "Checkout is down" },
    });
    await click("Submit");

    expect(server.requestsTo(HTTPMethod.POST, SUBMIT_URL)).toHaveLength(2);
    expect(screen.getByTestId("form-success")).toBeInTheDocument();
  });

  test("a submission whose session cannot be renewed asks the visitor to sign in", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(EMAIL)]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);
    await openPage();

    server.on(HTTPMethod.POST, SUBMIT_URL, [NO_SESSION]);
    server.on(HTTPMethod.POST, REFRESH_URL, [NO_SESSION]);
    server.on(HTTPMethod.POST, METHODS_URL, [methods({ password: true })]);

    fireEvent.change(screen.getByTestId("form-field-title"), {
      target: { value: "Checkout is down" },
    });
    await click("Submit");

    expect(server.requestsTo(HTTPMethod.POST, SUBMIT_URL)).toHaveLength(1);
    expect(screen.getByTestId(FORM_SIGN_IN_TEST_ID)).toBeInTheDocument();
  });
});

describe("the links a form's emails and single sign-on send", () => {
  test("a reset link opens the reset step, saves the new password with its token, then says to sign in", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(null)]);
    server.on(HTTPMethod.POST, METHODS_URL, [methods({ password: true })]);

    await openPage(`?${FORM_RESET_PASSWORD_PARAMETER}=reset-token-1`);

    // Taken out of the address at once, and no session renewed for it.
    expect(window.location.search).toBe("");
    expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toHaveLength(0);

    server.on(HTTPMethod.POST, RESET_URL, [{ status: 200, data: {} }]);

    type(/^New Password/, PASSWORD);
    await click("Save Password");

    expect(bodyOf(HTTPMethod.POST, RESET_URL)).toEqual({
      data: { resetPasswordToken: "reset-token-1", password: PASSWORD },
    });
    expect(
      screen.getByTestId(FORM_RESET_PASSWORD_DONE_TEST_ID),
    ).toHaveTextContent(
      "Your password is saved. Sign in with it to open the form.",
    );
  });

  test("a single sign-on code becomes a session on this host, once, and the form opens", async () => {
    server.on(HTTPMethod.GET, STATE_URL, [state(null), state(EMAIL)]);
    server.on(HTTPMethod.POST, EXCHANGE_URL, [
      { status: 200, data: { email: EMAIL } },
    ]);
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 200, data: FORM as unknown as JSONObject },
    ]);

    await openPage(`?${FORM_LOGIN_CODE_PARAMETER}=login-code-1`);

    expect(bodyOf(HTTPMethod.POST, EXCHANGE_URL)).toEqual({
      loginCode: "login-code-1",
    });
    expect(window.location.search).toBe("");
    expect(await screen.findByText("What is wrong?")).toBeInTheDocument();
    expect(screen.getByTestId("form-signed-in-as")).toHaveTextContent(EMAIL);
  });
});
