/**
 * @jest-environment-options {"url": "https://report.acme.com/?template=t-1"}
 */
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
} from "@testing-library/react";
import axios from "axios";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
  PublicForm,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import {
  FORM_PRIVATE_USER_API_ROUTE,
  FORM_SIGN_IN_STATE_ROUTE,
  FormPrivateUserApiRoutes,
} from "../../../Types/Form/FormPrivateUserSignIn";
import { JSONObject } from "../../../Types/JSON";
import { PUBLIC_FORM_LOGO_TEST_ID } from "../../../UI/Components/PublicForm/PublicFormLogo";
import Navigation from "../../../UI/Utils/Navigation";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import FormPage from "../../../../App/FeatureSet/Accounts/src/Pages/Form";
import {
  getFormOnCustomDomainSubmitUrl,
  getFormOnCustomDomainUrl,
} from "../../../../App/FeatureSet/Accounts/src/Utils/Form";

jest.mock("axios", () => {
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * A form on its owner's own domain, as its page draws and sends it (Accounts
 * Pages/Form.tsx with isOnCustomDomain): the real page, its real API client
 * and the real locale files, opened at https://report.acme.com/ - only the
 * network is a stand-in.
 *
 *   - it reads the form at /api/form/custom-domain on the domain it was
 *     opened on, and sends the answers to /api/form/custom-domain/submit
 *     there - never to OneUptime's own host, and naming no key: the server
 *     finds the form by the domain;
 *   - a form that is not available says so, as its link does;
 *   - its logo is the form's own, or none: never OneUptime's;
 *   - the template its address names opens with it;
 *   - a form that asks its visitors to sign in (#10249) is signed in to on
 *     the domain too, and read there only once somebody is.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const PAGE_ORIGIN: string = "https://report.acme.com";
const FORM_URL: string = `${PAGE_ORIGIN}/api/form/custom-domain`;
const SUBMIT_URL: string = `${PAGE_ORIGIN}/api/form/custom-domain/submit`;
const SIGN_IN_STATE_URL: string = `${FORM_URL}${FORM_SIGN_IN_STATE_ROUTE}`;

const NOT_AVAILABLE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";

// A one-pixel PNG, as the form's branding carries its logo (base64).
const LOGO_PNG_BASE64: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const FORM: PublicForm = {
  name: "Report a Problem",
  fields: [
    {
      id: "title",
      label: "What is wrong?",
      type: PublicFormFieldType.Text,
      isRequired: true,
      maxLength: 500,
    },
    {
      id: "email",
      label: "Your Email",
      type: PublicFormFieldType.Email,
      isRequired: true,
      maxLength: 100,
    },
  ],
  templates: [
    {
      id: "t-1",
      name: "Checkout",
      answers: { title: "Checkout is down" },
    },
  ],
  isCaptchaRequired: false,
};

let server: FakeAxiosServer;

function sentRequests(): Array<string> {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
}

async function flush(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await act(async () => {
      await settle();
    });
  }
}

async function openForm(reply: FakeReply): Promise<void> {
  server.on(HTTPMethod.GET, FORM_URL, [reply]);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/?template=t-1"]}>
        <Routes>
          <Route path="*" element={<FormPage isOnCustomDomain={true} />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  await flush();
}

beforeEach(() => {
  window.localStorage.clear();
  server = new FakeAxiosServer(mockedAxios);
  /*
   * The page's first question (#10249): this form does not ask its
   * visitors to sign in, so the page goes on to read it - as often as a
   * test opens the page.
   */
  server.on(
    HTTPMethod.GET,
    SIGN_IN_STATE_URL,
    Array.from({ length: 4 }, (): FakeReply => {
      return { status: 200, data: { requireSignIn: false } };
    }),
  );
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(async () => {
  cleanup();
  await settle();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  document.title = "";
});

describe("where the page sends its requests", () => {
  test("to the domain it was opened on, under /api/form/custom-domain", () => {
    expect(window.location.origin).toBe(PAGE_ORIGIN);
    expect(getFormOnCustomDomainUrl().toString()).toBe(FORM_URL);
    expect(getFormOnCustomDomainSubmitUrl().toString()).toBe(SUBMIT_URL);

    // An origin with a port keeps it; a trailing slash adds nothing.
    expect(getFormOnCustomDomainUrl("http://localhost:3000/").toString()).toBe(
      "http://localhost:3000/api/form/custom-domain",
    );
  });

  test("never to OneUptime's own host", () => {
    expect(new URL(FORM_URL).origin).not.toBe(new URL(DASHBOARD_ORIGIN).origin);
  });
});

describe("the form on its own domain", () => {
  test("is read once, on its domain, with the page's header, naming no key", async () => {
    await openForm({ status: 200, data: FORM as unknown as JSONObject });

    expect(sentRequests()).toEqual([
      `GET ${SIGN_IN_STATE_URL}`,
      `GET ${FORM_URL}`,
    ]);

    const headers: Record<string, unknown> = server.requestsTo(
      HTTPMethod.GET,
      FORM_URL,
    )[0]!.headers as Record<
      string,
      unknown
    >;

    expect(headers[FORM_PAGE_HEADER]).toBe(FORM_PAGE_HEADER_VALUE);
    expect(headers["tenantid"]).toBe("");
    expect(
      screen.getByRole("heading", { level: 1, name: "Report a Problem" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Report a Problem");
  });

  test("opens with the template its address names", async () => {
    await openForm({ status: 200, data: FORM as unknown as JSONObject });

    expect(
      (screen.getByTestId("form-field-title") as HTMLInputElement).value,
    ).toBe("Checkout is down");
  });

  test("sends its answers to the domain, and thanks the submitter with the number", async () => {
    await openForm({ status: 200, data: FORM as unknown as JSONObject });
    server.on(HTTPMethod.POST, SUBMIT_URL, [
      { status: 200, data: { reference: "INC-42" } },
    ]);

    fireEvent.change(screen.getByTestId("form-field-email"), {
      target: { value: "ada@example.com" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    await flush();

    expect(sentRequests()).toEqual([
      `GET ${SIGN_IN_STATE_URL}`,
      `GET ${FORM_URL}`,
      `POST ${SUBMIT_URL}`,
    ]);

    const body: JSONObject = server.requestsTo(HTTPMethod.POST, SUBMIT_URL)[0]!
      .data as JSONObject;

    expect(body).toEqual({
      data: {
        answers: { title: "Checkout is down", email: "ada@example.com" },
        templateId: "t-1",
      },
    });
    expect(await screen.findByTestId("form-success")).toBeInTheDocument();
    expect(screen.getByTestId("form-reference")).toHaveTextContent("INC-42");
  });

  test("a form that is not available says so, as its link does", async () => {
    await openForm({ status: 404, data: { error: NOT_AVAILABLE } });

    expect(screen.getByTestId("form-load-failure")).toHaveTextContent(
      NOT_AVAILABLE,
    );
  });

  test("a form without a logo of its own shows none - never OneUptime's - and its name leads", async () => {
    await openForm({ status: 200, data: FORM as unknown as JSONObject });

    expect(screen.queryByTestId(PUBLIC_FORM_LOGO_TEST_ID)).toBeNull();

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 1,
      name: "Report a Problem",
    });

    expect(heading.className).not.toContain("mt-5");
  });

  test("a form with a logo shows its own", async () => {
    await openForm({
      status: 200,
      data: {
        ...(FORM as unknown as JSONObject),
        logo: { type: "image/png", data: LOGO_PNG_BASE64 },
        logoAltText: "Acme",
      },
    });

    const logo: HTMLElement = screen.getByTestId(PUBLIC_FORM_LOGO_TEST_ID);

    expect(logo.getAttribute("data-logo")).toBe("form");
    expect(logo.getAttribute("alt")).toBe("Acme");
    expect(
      screen.getByRole("heading", { level: 1, name: "Report a Problem" })
        .className,
    ).toContain("mt-5");
  });

  test("the not-available card shows no OneUptime logo either", async () => {
    await openForm({ status: 404, data: { error: NOT_AVAILABLE } });

    expect(screen.queryByTestId(PUBLIC_FORM_LOGO_TEST_ID)).toBeNull();
  });
});

/*
 * A form on its domain that asks its visitors to sign in (#10249): its
 * sign-in state, the session the browser may hold, the ways in and the
 * sign-in itself are all asked on the domain the page was opened on -
 * the cookies are the domain's own - and never on OneUptime's own host.
 */
describe("a form on its own domain that asks its visitors to sign in", () => {
  const FORM_ID: string = "0f000000-0000-4000-8000-000000000001";

  const privateUserUrl: (route: string) => string = (
    route: string,
  ): string => {
    return `${PAGE_ORIGIN}/api/form${FORM_PRIVATE_USER_API_ROUTE}${route}/${FORM_ID}`;
  };

  test("is signed in to on its domain, and the form read there once somebody is", async () => {
    // A fresh script: this form asks its visitors to sign in.
    server = new FakeAxiosServer(mockedAxios);
    server.on(HTTPMethod.GET, SIGN_IN_STATE_URL, [
      {
        status: 200,
        data: {
          requireSignIn: true,
          formId: FORM_ID,
          name: "Report a Problem",
          signedInAs: null,
        },
      },
      {
        status: 200,
        data: {
          requireSignIn: true,
          formId: FORM_ID,
          name: "Report a Problem",
          signedInAs: "reader@acme.com",
        },
      },
    ]);
    server.on(
      HTTPMethod.POST,
      privateUserUrl(FormPrivateUserApiRoutes.refreshToken),
      [{ status: 401, data: { message: "Signed out." } }],
    );
    server.on(
      HTTPMethod.POST,
      privateUserUrl(FormPrivateUserApiRoutes.signInMethods),
      [
        {
          status: 200,
          data: {
            isPasswordSignInAllowed: true,
            samlProviders: [],
            oidcProviders: [],
          },
        },
      ],
    );
    server.on(HTTPMethod.POST, privateUserUrl(FormPrivateUserApiRoutes.login), [
      { status: 200, data: { email: "reader@acme.com" } },
    ]);

    await openForm({ status: 200, data: FORM as unknown as JSONObject });

    // Nothing of the form before the sign-in.
    expect(server.requestsTo(HTTPMethod.GET, FORM_URL)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "reader@acme.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "correct horse battery staple 9" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    });
    await flush();

    expect(await screen.findByTestId("form-signed-in-as")).toHaveTextContent(
      "reader@acme.com",
    );

    // Every request went to the domain the page was opened on.
    for (const request of server.sent) {
      expect(new URL(request.url).origin).toBe(PAGE_ORIGIN);
    }

    expect(sentRequests()).toEqual([
      `GET ${SIGN_IN_STATE_URL}`,
      `POST ${privateUserUrl(FormPrivateUserApiRoutes.refreshToken)}`,
      `POST ${privateUserUrl(FormPrivateUserApiRoutes.signInMethods)}`,
      `POST ${privateUserUrl(FormPrivateUserApiRoutes.login)}`,
      `GET ${SIGN_IN_STATE_URL}`,
      `GET ${FORM_URL}`,
    ]);
  });
});
