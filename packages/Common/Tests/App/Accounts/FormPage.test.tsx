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
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
  PublicForm,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import { FormTemplateFieldSetting } from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import FormPage from "../../../../App/FeatureSet/Accounts/src/Pages/Form";
import { LegacyIncidentFormRedirect } from "../../../../App/FeatureSet/Accounts/src/App";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * The public form page (/accounts/form/:shareKey), driven as a submitter
 * drives it: the real page, the real form, its real API client and the
 * real locale files - only the network (a fake axios transport) and the
 * captcha widget are stand-ins.
 */

interface MockCaptchaSettings {
  enabled: boolean;
  siteKey: string;
}

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const settings: MockCaptchaSettings = { enabled: false, siteKey: "" };

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    mockCaptchaSettings: settings,
  };

  Object.defineProperty(mocked, "CAPTCHA_ENABLED", {
    enumerable: true,
    get: (): boolean => {
      return settings.enabled;
    },
  });

  Object.defineProperty(mocked, "CAPTCHA_SITE_KEY", {
    enumerable: true,
    get: (): string => {
      return settings.siteKey;
    },
  });

  return mocked;
});

type SetCaptchaFunction = (enabled: boolean, siteKey: string) => void;

const setCaptcha: SetCaptchaFunction = (
  enabled: boolean,
  siteKey: string,
): void => {
  const settings: MockCaptchaSettings = (
    jest.requireMock("../../../UI/Config") as {
      mockCaptchaSettings: MockCaptchaSettings;
    }
  ).mockCaptchaSettings;

  settings.enabled = enabled;
  settings.siteKey = siteKey;
};

interface MockCaptchaProps {
  siteKey: string;
  resetSignal?: number | undefined;
  onTokenChange?: ((token: string) => void) | undefined;
}

const MockCaptcha: (props: MockCaptchaProps) => React.ReactElement = (
  props: MockCaptchaProps,
): React.ReactElement => {
  const signal: number = props.resetSignal || 0;

  React.useEffect(() => {
    props.onTokenChange?.("");
  }, [signal]);

  return (
    <div
      data-testid="captcha"
      data-site-key={props.siteKey}
      data-reset-signal={String(signal)}
    >
      <button
        type="button"
        onClick={() => {
          props.onTokenChange?.(`captcha-token-${signal}`);
        }}
      >
        Solve captcha
      </button>
    </div>
  );
};

jest.mock("../../../UI/Components/Captcha/Captcha", () => {
  return {
    __esModule: true,
    default: (props: MockCaptchaProps): React.ReactElement => {
      return <MockCaptcha {...props} />;
    },
  };
});

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const FORM_URL: string = `${DASHBOARD_ORIGIN}/api/form/public/${SHARE_KEY}`;
const SUBMIT_URL: string = `${FORM_URL}/submit`;
const CRITICAL_ID: string = "c1c1c1c1-0000-4000-8000-000000000001";
const MINOR_ID: string = "c1c1c1c1-0000-4000-8000-000000000002";

const NOT_AVAILABLE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";
const NETWORK_NOT_ALLOWED: string =
  "This form can only be opened from an allowed network.";
const TOO_MANY_SUBMISSIONS: string =
  "Too many submissions from your network. Please wait a few minutes and try again.";
const TOO_MANY_REQUESTS: string = "Too many requests. Please try again later.";
const SUBMISSIONS_UNAVAILABLE: string =
  "Submissions cannot be accepted right now. Please try again in a few minutes.";
const SUBMIT_FAILED: string =
  "Your response could not be submitted. Please try again in a few minutes.";
const LOAD_FAILED: string =
  "This form could not be loaded. Please try again in a few minutes.";

const FORM: PublicForm = {
  name: "Report a Problem",
  description: "Tell us what is **broken**.",
  fields: [
    {
      id: "title",
      label: "What is wrong?",
      helpText: "One line is enough.",
      type: PublicFormFieldType.Text,
      isRequired: true,
      maxLength: 500,
    },
    {
      id: "severity",
      label: "How bad is it?",
      type: PublicFormFieldType.Dropdown,
      isRequired: false,
      options: [
        { value: CRITICAL_ID, label: "Critical", color: "#ff0000" },
        { value: MINOR_ID, label: "Minor" },
      ],
      defaultValue: MINOR_ID,
    },
    {
      id: "checked",
      label: "I have checked the status page",
      type: PublicFormFieldType.Boolean,
      isRequired: false,
    },
    {
      id: "email",
      label: "Your Email",
      type: PublicFormFieldType.Email,
      isRequired: true,
      maxLength: 100,
    },
  ],
  isCaptchaRequired: false,
};

let server: FakeAxiosServer;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;
let logoutSpy: SpyInstance<typeof User.logout>;

function serveForm(reply: FakeReply): void {
  server.on(HTTPMethod.GET, FORM_URL, [reply]);
}

function serveSubmit(reply: FakeReply): void {
  server.on(HTTPMethod.POST, SUBMIT_URL, [reply]);
}

function sentRequests(): Array<string> {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
}

function submittedBodies(): Array<JSONObject> {
  return server
    .requestsTo(HTTPMethod.POST, SUBMIT_URL)
    .map((request: SentRequest): JSONObject => {
      return request.data as JSONObject;
    });
}

// Lets every answered request, and the renders it causes, finish.
async function flush(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await act(async () => {
      await settle();
    });
  }
}

async function renderPage(shareKey: string = SHARE_KEY): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/form/${shareKey}`]}>
        <Routes>
          <Route path="/accounts/form/:shareKey" element={<FormPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  await flush();
}

async function renderForm(form: PublicForm = FORM): Promise<void> {
  serveForm({ status: 200, data: form as unknown as JSONObject });

  await renderPage();

  await screen.findByTestId("form-field-title");
}

function typeInto(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  });

  await flush();
}

function fillRequired(): void {
  typeInto("form-field-title", "Checkout is down");
  typeInto("form-field-email", "ada@example.com");
}

beforeEach(() => {
  window.localStorage.clear();
  setCaptcha(false, "");
  server = new FakeAxiosServer(mockedAxios);

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  logoutSpy = jest.spyOn(User, "logout").mockImplementation((): void => {});
});

afterEach(async () => {
  cleanup();
  await settle();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  window.localStorage.clear();
  document.title = "";

  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

describe("the page reads the form behind its link", () => {
  test("one GET, through the page's own client, with its header and an empty tenant", async () => {
    await renderForm();

    expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);

    const headers: Record<string, unknown> = server.sent[0]!.headers as Record<
      string,
      unknown
    >;

    expect(headers[FORM_PAGE_HEADER]).toBe(FORM_PAGE_HEADER_VALUE);
    expect(headers["tenantid"]).toBe("");
  });

  test("the form's name is the heading, its description shown as Markdown", async () => {
    await renderForm();

    expect(
      screen.getByRole("heading", { level: 1, name: "Report a Problem" }),
    ).toBeInTheDocument();
    // Markdown, as the form's builder wrote it (the renderer is a stub here).
    expect(screen.getByTestId("form-about")).toHaveTextContent(
      "Tell us what is **broken**.",
    );
  });

  test("a form without a description shows none", async () => {
    await renderForm({ ...FORM, description: undefined });

    expect(screen.queryByTestId("form-about")).not.toBeInTheDocument();
  });

  test("the tab is named after the form, and named back on the way out", async () => {
    document.title = "OneUptime";

    await renderForm();

    expect(document.title).toBe("Report a Problem");

    cleanup();

    expect(document.title).toBe("OneUptime");
  });

  test("an upper-case key is the same key", async () => {
    serveForm({ status: 200, data: FORM as unknown as JSONObject });

    await renderPage(SHARE_KEY.toUpperCase());

    expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);
  });

  test("a link that is not a key reads nothing and says the form is not available", async () => {
    await renderPage("not-a-key");

    expect(sentRequests()).toEqual([]);
    expect(screen.getByTestId("form-load-failure")).toHaveTextContent(
      NOT_AVAILABLE,
    );
  });
});

describe("the questions are the form's", () => {
  test("each question is drawn, with its help text, its options and its default", async () => {
    await renderForm();

    expect(screen.getByText("What is wrong?")).toBeInTheDocument();
    expect(screen.getByText("One line is enough.")).toBeInTheDocument();
    expect(screen.getByText("How bad is it?")).toBeInTheDocument();
    // The form's own choice is picked to begin with.
    expect(screen.getByText("Minor")).toBeInTheDocument();
    expect(
      screen.getByText("I have checked the status page"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("form-field-email")).toBeInTheDocument();
  });

  test("a required question left blank is refused in the browser, and nothing is sent", async () => {
    await renderForm();

    typeInto("form-field-title", "   ");
    typeInto("form-field-email", "ada@example.com");
    await submit();

    expect(screen.getByText("What is wrong? is required.")).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });

  test("an email the server would refuse is refused in the browser", async () => {
    await renderForm();

    typeInto("form-field-title", "Down");
    typeInto("form-field-email", "Ada <ada@example.com>");
    await submit();

    expect(screen.getByText("Email is not valid.")).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });
});

describe("what the page sends", () => {
  test("the answers keyed by question, the default choice and an unticked box included - and nothing else", async () => {
    await renderForm();
    serveSubmit({ status: 200, data: { reference: "INC-42" } });

    fillRequired();
    await submit();

    expect(submittedBodies()).toEqual([
      {
        data: {
          answers: {
            title: "Checkout is down",
            severity: MINOR_ID,
            // An optional checkbox left unticked is an answer: No.
            checked: false,
            email: "ada@example.com",
          },
        },
      },
    ]);
  });

  test("a submit still in flight cannot be sent twice", async () => {
    await renderForm();
    serveSubmit({ status: 200, data: { reference: "INC-42" } });

    fillRequired();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    await flush();

    expect(submittedBodies()).toHaveLength(1);
  });
});

describe("the captcha", () => {
  const CAPTCHA_FORM: PublicForm = { ...FORM, isCaptchaRequired: true };

  test("is shown when the server asks for one and this install can draw one", async () => {
    setCaptcha(true, "site-key");

    await renderForm(CAPTCHA_FORM);

    expect(screen.getByTestId("captcha")).toBeInTheDocument();
  });

  test("is not shown when this install has none, and no token is sent", async () => {
    await renderForm(CAPTCHA_FORM);
    serveSubmit({ status: 200, data: {} });

    expect(screen.queryByTestId("captcha")).not.toBeInTheDocument();

    fillRequired();
    await submit();

    expect(submittedBodies()[0]!["captchaToken"]).toBeUndefined();
  });

  test("its token is sent, and a failed submit gets a fresh challenge", async () => {
    setCaptcha(true, "site-key");

    await renderForm(CAPTCHA_FORM);
    serveSubmit({
      status: 400,
      data: { error: "Captcha verification failed. Please try again." },
    });

    fillRequired();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
    });
    await submit();

    expect(submittedBodies()[0]!["captchaToken"]).toBe("captcha-token-0");
    expect(screen.getByTestId("captcha")).toHaveAttribute(
      "data-reset-signal",
      "1",
    );
    expect(screen.getByTestId("form-submit-error")).toHaveTextContent(
      "Captcha verification failed. Please try again.",
    );
  });
});

describe("after the response is sent", () => {
  test("the thank-you screen gives the reference and the form's message, and takes focus", async () => {
    await renderForm();
    serveSubmit({
      status: 200,
      data: { reference: "INC-42", successMessage: "We are **on it**." },
    });

    fillRequired();
    await submit();

    expect(screen.getByTestId("form-success")).toBeInTheDocument();

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 2,
      name: "Thank you — your response was submitted.",
    });

    expect(heading).toHaveFocus();
    expect(screen.getByTestId("form-reference")).toHaveTextContent(
      "Your reference number is INC-42.",
    );
    expect(heading).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("form-reference").id,
    );
    expect(screen.getByTestId("form-success-message")).toHaveTextContent(
      "We are **on it**.",
    );
  });

  test("with no reference and no message, it simply says thank you", async () => {
    await renderForm();
    serveSubmit({ status: 200, data: {} });

    fillRequired();
    await submit();

    expect(screen.queryByTestId("form-reference")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("form-success-message"),
    ).not.toBeInTheDocument();
  });

  test("another response starts from an empty form, without reading it again", async () => {
    await renderForm();
    serveSubmit({ status: 200, data: { reference: "INC-42" } });

    fillRequired();
    await submit();

    await act(async () => {
      fireEvent.click(screen.getByTestId("form-submit-another"));
    });
    await flush();

    expect(screen.getByTestId("form-field-title")).toHaveValue("");
    expect(server.requestsTo(HTTPMethod.GET, FORM_URL)).toHaveLength(1);
  });
});

describe("a form that cannot be opened says why", () => {
  test.each([
    ["404", 404, {}, NOT_AVAILABLE, false],
    ["403", 403, { error: NETWORK_NOT_ALLOWED }, NETWORK_NOT_ALLOWED, false],
    ["429", 429, { message: TOO_MANY_REQUESTS }, TOO_MANY_REQUESTS, true],
    ["500", 500, { error: "Server Error" }, LOAD_FAILED, true],
  ])(
    "a %s",
    async (
      _label: string,
      status: number,
      data: JSONObject,
      message: string,
      canTryAgain: boolean,
    ) => {
      serveForm({ status, data });

      await renderPage();

      expect(screen.getByTestId("form-load-failure")).toHaveTextContent(
        message,
      );
      expect(Boolean(screen.queryByTestId("form-try-again"))).toBe(canTryAgain);
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
    },
  );

  test("a limit says when to come back", async () => {
    serveForm({
      status: 429,
      data: { message: TOO_MANY_REQUESTS },
      headers: { "retry-after": "120" },
    });

    await renderPage();

    expect(screen.getByTestId("form-load-failure")).toHaveTextContent(
      "You can try again in 2 minutes.",
    );
  });

  test("Try again reads the form again, and focus lands on its heading", async () => {
    serveForm({ status: 500, data: {} });

    await renderPage();

    serveForm({ status: 200, data: FORM as unknown as JSONObject });

    await act(async () => {
      fireEvent.click(screen.getByTestId("form-try-again"));
    });
    await flush();

    expect(server.requestsTo(HTTPMethod.GET, FORM_URL)).toHaveLength(2);
    expect(
      screen.getByRole("heading", { level: 1, name: "Report a Problem" }),
    ).toHaveFocus();
  });
});

describe("a submission that is refused says why, next to the form", () => {
  test.each([
    [
      "the server's own words for a 400",
      400,
      { error: "Region is required." },
      "Region is required.",
    ],
    [
      "a network over its limit",
      429,
      { message: TOO_MANY_SUBMISSIONS },
      TOO_MANY_SUBMISSIONS,
    ],
    [
      "submissions paused",
      503,
      { message: SUBMISSIONS_UNAVAILABLE },
      SUBMISSIONS_UNAVAILABLE,
    ],
    ["any other failure", 500, { error: "Server Error" }, SUBMIT_FAILED],
  ])(
    "%s",
    async (
      _label: string,
      status: number,
      data: JSONObject,
      message: string,
    ) => {
      await renderForm();
      serveSubmit({ status, data });

      fillRequired();
      await submit();

      expect(screen.getByTestId("form-submit-error")).toHaveTextContent(
        message,
      );
      // The answers are still there to send again.
      expect(screen.getByTestId("form-field-title")).toHaveValue(
        "Checkout is down",
      );
    },
  );

  test("sending it again clears the last refusal", async () => {
    await renderForm();
    serveSubmit({ status: 500, data: {} });

    fillRequired();
    await submit();

    expect(screen.getByTestId("form-submit-error")).toBeInTheDocument();

    serveSubmit({ status: 200, data: { reference: "INC-7" } });
    await submit();

    expect(screen.queryByTestId("form-submit-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("form-success")).toBeInTheDocument();
  });

  test("a visitor signed in to OneUptime here stays signed in after a 401", async () => {
    await renderForm();
    serveSubmit({ status: 401, data: { error: "Unauthorized" } });

    fillRequired();
    await submit();

    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe("the page speaks the submitter's language", () => {
  test("in German: its own words, and the server's refusals it knows", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });

    await renderForm();
    serveSubmit({ status: 429, data: { message: TOO_MANY_SUBMISSIONS } });

    fillRequired();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    });
    await flush();

    expect(screen.getByTestId("form-submit-error")).toHaveTextContent(
      "Zu viele Meldungen aus Ihrem Netzwerk.",
    );
  });

  test("in German, the thank-you screen", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });

    await renderForm();
    serveSubmit({ status: 200, data: { reference: "INC-42" } });

    fillRequired();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    });
    await flush();

    expect(screen.getByTestId("form-success")).toHaveTextContent(
      "Vielen Dank – Ihre Antwort wurde übermittelt.",
    );
    expect(screen.getByTestId("form-reference")).toHaveTextContent(
      "Ihre Referenznummer lautet INC-42.",
    );
  });
});

describe("links to incident forms", () => {
  test("/accounts/incident-form/:shareKey opens the same form at its new address", async () => {
    serveForm({ status: 200, data: FORM as unknown as JSONObject });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={[`/accounts/incident-form/${SHARE_KEY}`]}>
          <Routes>
            <Route
              path="/accounts/incident-form/:shareKey"
              element={<LegacyIncidentFormRedirect />}
            />
            <Route path="/accounts/form/:shareKey" element={<FormPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await flush();

    expect(await screen.findByTestId("form-field-title")).toBeInTheDocument();
    expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);
  });
});

/*
 * The form's branding: its logo in place of the OneUptime logo, at the top
 * of every screen that has the form, and its favicon as the tab's icon
 * while it is open. Until it has its own, OneUptime's.
 */
describe("the form's branding", () => {
  const LOGO: { type: string; data: string } = {
    type: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString("base64"),
  };
  const FAVICON: { type: string; data: string } = {
    type: "image/svg+xml",
    data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString(
      "base64",
    ),
  };
  const LOGO_URL: string = `data:image/png;base64,${LOGO.data}`;
  const ANY_NAME: RegExp = /\S/;
  const FAVICON_URL: string = `data:image/svg+xml;base64,${FAVICON.data}`;

  const BRANDED: PublicForm = {
    ...FORM,
    logo: LOGO,
    logoAltText: "Acme Inc.",
    favicon: FAVICON,
  };

  // The page's own icon links, as Accounts' index.ejs has them.
  const addPageIcons: () => void = (): void => {
    document.head.innerHTML = [
      '<link rel="apple-touch-icon" sizes="180x180" href="/accounts/assets/img/favicons/apple-touch-icon.png">',
      '<link rel="shortcut icon" href="/accounts/assets/img/favicons/favicon.ico">',
      '<link rel="icon" type="image/png" sizes="32x32" href="/accounts/assets/img/favicons/favicon-32x32.png">',
      '<link rel="mask-icon" href="/accounts/assets/img/favicons/safari-pinned-tab.svg" color="#5bbad5">',
    ].join("");
  };

  const iconLinks: () => Array<Record<string, string | null>> = (): Array<
    Record<string, string | null>
  > => {
    return Array.from(document.head.querySelectorAll("link")).map(
      (link: HTMLLinkElement): Record<string, string | null> => {
        return {
          rel: link.getAttribute("rel"),
          href: link.getAttribute("href"),
          type: link.getAttribute("type"),
          sizes: link.getAttribute("sizes"),
        };
      },
    );
  };

  const PAGE_ICONS: Array<Record<string, string | null>> = [
    {
      rel: "apple-touch-icon",
      href: "/accounts/assets/img/favicons/apple-touch-icon.png",
      type: null,
      sizes: "180x180",
    },
    {
      rel: "shortcut icon",
      href: "/accounts/assets/img/favicons/favicon.ico",
      type: null,
      sizes: null,
    },
    {
      rel: "icon",
      href: "/accounts/assets/img/favicons/favicon-32x32.png",
      type: "image/png",
      sizes: "32x32",
    },
    {
      rel: "mask-icon",
      href: "/accounts/assets/img/favicons/safari-pinned-tab.svg",
      type: null,
      sizes: null,
    },
  ];

  afterEach(() => {
    document.head.innerHTML = "";
  });

  test("a form without a logo shows the OneUptime logo", async () => {
    await renderForm();

    const logo: HTMLElement = screen.getByTestId("form-logo");

    expect(logo).toHaveAttribute("data-logo", "oneuptime");
    expect(logo).toHaveAttribute("alt", "OneUptime");
    expect(logo.getAttribute("src")).not.toContain("data:image/png;base64");
  });

  test("a form's own logo takes the OneUptime logo's place, read out as its alt text says", async () => {
    await renderForm(BRANDED);

    const logo: HTMLElement = screen.getByRole("img", { name: "Acme Inc." });

    expect(logo).toBe(screen.getByTestId("form-logo"));
    expect(logo).toHaveAttribute("data-logo", "form");
    expect(logo).toHaveAttribute("src", LOGO_URL);
    expect(
      screen.queryByRole("img", { name: "OneUptime" }),
    ).not.toBeInTheDocument();
    // Still above the form's name.
    expect(
      logo.compareDocumentPosition(
        screen.getByRole("heading", { level: 1, name: "Report a Problem" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("without alt text, screen readers skip the logo: the form's name follows it", async () => {
    await renderForm({ ...BRANDED, logoAltText: undefined });

    expect(screen.getByTestId("form-logo")).toHaveAttribute("alt", "");
    // Nothing on the page reads out as an image with a name.
    expect(
      screen.queryByRole("img", { name: ANY_NAME }),
    ).not.toBeInTheDocument();
  });

  test("the thank-you screen keeps the form's logo", async () => {
    await renderForm(BRANDED);
    serveSubmit({ status: 200, data: { reference: "INC-42" } });

    fillRequired();
    await submit();

    expect(screen.getByTestId("form-success")).toBeInTheDocument();
    expect(screen.getByTestId("form-logo")).toHaveAttribute("src", LOGO_URL);
  });

  test("a link that leads to no form shows the OneUptime logo", async () => {
    serveForm({ status: 404, data: {} });

    await renderPage();

    expect(screen.getByTestId("form-load-failure")).toBeInTheDocument();
    expect(screen.getByTestId("form-logo")).toHaveAttribute(
      "data-logo",
      "oneuptime",
    );
  });

  test("a logo that cannot be drawn gives way to the OneUptime logo, never a broken image", async () => {
    await renderForm(BRANDED);

    await act(async () => {
      fireEvent.error(screen.getByTestId("form-logo"));
    });

    expect(screen.getByTestId("form-logo")).toHaveAttribute(
      "data-logo",
      "oneuptime",
    );
    expect(screen.getByTestId("form-logo")).toHaveAttribute("alt", "OneUptime");
  });

  test("an image the page cannot draw safely is never drawn", async () => {
    await renderForm({
      ...FORM,
      logo: { type: "text/html", data: LOGO.data },
      logoAltText: "Acme Inc.",
      favicon: { type: "image/png", data: "not base64!" },
    } as unknown as PublicForm);

    expect(screen.getByTestId("form-logo")).toHaveAttribute(
      "data-logo",
      "oneuptime",
    );
    expect(document.head.innerHTML).not.toContain("data:");
  });

  test("the form's favicon is the tab's icon while it is open, and OneUptime's comes back after", async () => {
    addPageIcons();

    await renderForm(BRANDED);

    expect(iconLinks()).toEqual([
      PAGE_ICONS[0],
      {
        rel: "shortcut icon",
        href: FAVICON_URL,
        type: "image/svg+xml",
        sizes: null,
      },
      { rel: "icon", href: FAVICON_URL, type: "image/svg+xml", sizes: null },
      PAGE_ICONS[3],
    ]);

    cleanup();

    expect(iconLinks()).toEqual(PAGE_ICONS);
  });

  test("a page with no icon link gets one for the form, gone again after", async () => {
    await renderForm(BRANDED);

    expect(iconLinks()).toEqual([
      { rel: "icon", href: FAVICON_URL, type: "image/svg+xml", sizes: null },
    ]);

    cleanup();

    expect(iconLinks()).toEqual([]);
  });

  test("an ICO favicon is the tab's icon, as an ICO", async () => {
    addPageIcons();

    const ico: { type: string; data: string } = {
      type: "image/x-icon",
      data: Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]).toString(
        "base64",
      ),
    };
    const icoUrl: string = `data:image/x-icon;base64,${ico.data}`;

    await renderForm({ ...BRANDED, favicon: ico });

    expect(iconLinks()).toEqual([
      PAGE_ICONS[0],
      { rel: "shortcut icon", href: icoUrl, type: "image/x-icon", sizes: null },
      { rel: "icon", href: icoUrl, type: "image/x-icon", sizes: null },
      PAGE_ICONS[3],
    ]);
  });

  test("a form without a favicon leaves the tab's icon alone", async () => {
    addPageIcons();

    await renderForm({ ...BRANDED, favicon: undefined });

    expect(iconLinks()).toEqual(PAGE_ICONS);
  });
});

/*
 * A form with templates: the page lists them over the questions, opens with
 * the one its link names (else the form's default, else none), fills the
 * form in from the one chosen - the address following the choice - and the
 * submission names the template it started from.
 */
describe("templates", () => {
  const OUTAGE_TITLE: string = "The application is down";
  const MAINTENANCE_TITLE: string = "Planned maintenance tonight";

  const WITH_TEMPLATES: PublicForm = {
    ...FORM,
    templates: [
      {
        id: "outage",
        name: "Application Outage",
        answers: { title: OUTAGE_TITLE, severity: CRITICAL_ID },
      },
      {
        id: "maintenance",
        name: "Planned Maintenance",
        answers: { title: MAINTENANCE_TITLE, checked: true },
      },
    ],
  };

  const WITH_DEFAULT: PublicForm = {
    ...WITH_TEMPLATES,
    templates: WITH_TEMPLATES.templates!.map(
      (template: { id: string; name: string; answers: JSONObject }) => {
        return template.id === "maintenance"
          ? { ...template, isDefault: true }
          : template;
      },
    ),
  };

  function titleValue(): string {
    return (screen.getByTestId("form-field-title") as HTMLInputElement).value;
  }

  function picker(): HTMLElement {
    return screen.getByRole("combobox", { name: "Start from a template" });
  }

  async function choose(name: string): Promise<void> {
    // user-event wraps each step in act itself.
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(picker());

    const menu: HTMLElement = await screen.findByRole("listbox");

    await user.click(
      Array.from(menu.querySelectorAll("*")).find((element: Element) => {
        return element.textContent === name && element.children.length === 0;
      }) as HTMLElement,
    );

    await flush();
  }

  function openAt(search: string): void {
    window.history.replaceState({}, "", `/accounts/form/${SHARE_KEY}${search}`);
  }

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  test("a form with templates lists them over its questions", async () => {
    await renderForm(WITH_TEMPLATES);

    const pickerCard: HTMLElement = screen.getByTestId("form-template-picker");

    expect(pickerCard).toHaveTextContent("Start from a template");
    expect(pickerCard).toHaveTextContent(
      "Choose a template to fill in the form. You can change any answer before you submit.",
    );
    // No default: the form opens empty, the picker on "No template".
    expect(pickerCard).toHaveTextContent("No template");
    expect(titleValue()).toBe("");
  });

  test("a form without templates has no picker", async () => {
    await renderForm();

    expect(
      screen.queryByTestId("form-template-picker"),
    ).not.toBeInTheDocument();
  });

  test("a form with a default opens with it filled in", async () => {
    await renderForm(WITH_DEFAULT);

    expect(titleValue()).toBe(MAINTENANCE_TITLE);
    expect(screen.getByTestId("form-template-picker")).toHaveTextContent(
      "Planned Maintenance",
    );
  });

  test("a link that names a template opens the form with it - over the default", async () => {
    openAt("?template=outage");

    await renderForm(WITH_DEFAULT);

    expect(titleValue()).toBe(OUTAGE_TITLE);
    // The template's choice wins over the question's own default.
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  test("a link that names a template the form does not have opens it as if it named none", async () => {
    openAt("?template=deleted");

    await renderForm(WITH_DEFAULT);

    expect(titleValue()).toBe(MAINTENANCE_TITLE);

    cleanup();
    openAt("?template=deleted");

    await renderForm(WITH_TEMPLATES);

    expect(titleValue()).toBe("");
  });

  test("choosing a template fills the form in, and the address names it", async () => {
    await renderForm(WITH_TEMPLATES);

    await choose("Application Outage");

    expect(titleValue()).toBe(OUTAGE_TITLE);
    expect(window.location.search).toBe("?template=outage");

    await choose("Planned Maintenance");

    expect(titleValue()).toBe(MAINTENANCE_TITLE);
    expect(window.location.search).toBe("?template=maintenance");
  });

  test("the submitter can change what a template filled in; the submission names the template", async () => {
    await renderForm(WITH_TEMPLATES);
    serveSubmit({ status: 200, data: { reference: "INC-7" } });

    await choose("Application Outage");
    typeInto("form-field-title", "The checkout is down");
    typeInto("form-field-email", "ada@example.com");
    await submit();

    expect(submittedBodies()).toEqual([
      {
        data: {
          answers: {
            title: "The checkout is down",
            severity: CRITICAL_ID,
            checked: false,
            email: "ada@example.com",
          },
          templateId: "outage",
        },
      },
    ]);
  });

  test("a submission started from no template names none", async () => {
    await renderForm(WITH_TEMPLATES);
    serveSubmit({ status: 200, data: { reference: "INC-8" } });

    fillRequired();
    await submit();

    expect(submittedBodies()[0]!["data"]).not.toHaveProperty("templateId");
  });

  test("another response after a submission starts from the same template", async () => {
    await renderForm(WITH_DEFAULT);
    serveSubmit({ status: 200, data: { reference: "INC-9" } });

    typeInto("form-field-email", "ada@example.com");
    await submit();

    await act(async () => {
      fireEvent.click(screen.getByTestId("form-submit-another"));
    });
    await flush();

    expect(titleValue()).toBe(MAINTENANCE_TITLE);
  });

  test("the picker speaks the page's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });

    await renderForm(WITH_TEMPLATES);

    expect(screen.getByTestId("form-template-picker")).toHaveTextContent(
      "Mit einer Vorlage beginnen",
    );
  });
});

/*
 * Templates that ask the form's questions their own way (issue #4563): the
 * page asks the form as the chosen template asks it - a question it
 * requires is required here, one it hides is not drawn and never sent, and
 * a question the form hides is drawn only under a template that asks it.
 * The server holds the submission to the same questions.
 */
describe("templates that ask the questions their own way", () => {
  const WITH_SETTINGS: PublicForm = {
    ...FORM,
    fields: [
      ...FORM.fields,
      {
        id: "app",
        label: "Application Name",
        type: PublicFormFieldType.Text,
        isRequired: false,
        maxLength: 10000,
      },
      {
        id: "window",
        label: "Maintenance Window",
        type: PublicFormFieldType.Text,
        isRequired: false,
        isHidden: true,
        maxLength: 10000,
      },
    ],
    templates: [
      {
        id: "outage",
        name: "Application Outage",
        answers: { title: "The application is down" },
        fieldSettings: {
          app: FormTemplateFieldSetting.Required,
          email: FormTemplateFieldSetting.Hidden,
        },
      },
      {
        id: "maintenance",
        name: "Planned Maintenance",
        answers: { title: "Planned maintenance", window: "Saturday 02:00" },
        fieldSettings: {
          window: FormTemplateFieldSetting.Required,
          app: FormTemplateFieldSetting.Optional,
        },
      },
    ],
  };

  async function choose(name: string): Promise<void> {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(
      screen.getByRole("combobox", { name: "Start from a template" }),
    );

    const menu: HTMLElement = await screen.findByRole("listbox");

    await user.click(
      Array.from(menu.querySelectorAll("*")).find((element: Element) => {
        return element.textContent === name && element.children.length === 0;
      }) as HTMLElement,
    );

    await flush();
  }

  function labelOf(testId: string): string {
    const input: HTMLElement = screen.getByTestId(testId);
    const label: HTMLLabelElement | null = document.querySelector(
      `label[for="${input.id}"]`,
    );

    return label?.textContent?.trim() || "";
  }

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  test("a question the form hides is not drawn without a template that asks it", async () => {
    await renderForm(WITH_SETTINGS);

    expect(screen.queryByTestId("form-field-window")).not.toBeInTheDocument();
    expect(screen.queryByText("Maintenance Window")).not.toBeInTheDocument();
    expect(screen.getByTestId("form-field-email")).toBeInTheDocument();
  });

  test("a template that asks it draws it, required, and fills it in", async () => {
    await renderForm(WITH_SETTINGS);

    await choose("Planned Maintenance");

    expect(screen.getByTestId("form-field-window")).toHaveValue(
      "Saturday 02:00",
    );
    expect(labelOf("form-field-window")).toBe("Maintenance Window");
    // A question it says nothing of is asked as the form asks it.
    expect(labelOf("form-field-email")).toBe("Your Email");
  });

  test("a question the template requires, left empty, is refused in the browser, and nothing is sent", async () => {
    await renderForm(WITH_SETTINGS);
    serveSubmit({ status: 200, data: { reference: "INC-1" } });

    await choose("Application Outage");

    expect(labelOf("form-field-app")).toBe("Application Name");

    await submit();

    expect(
      screen.getByText("Application Name is required."),
    ).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });

  test("the submission sends only the questions its template asks, and names the template", async () => {
    await renderForm(WITH_SETTINGS);
    serveSubmit({ status: 200, data: { reference: "INC-2" } });

    await choose("Application Outage");

    typeInto("form-field-app", "Checkout");
    await submit();

    expect(submittedBodies()).toEqual([
      {
        data: {
          answers: {
            title: "The application is down",
            severity: MINOR_ID,
            checked: false,
            app: "Checkout",
          },
          templateId: "outage",
        },
      },
    ]);
  });

  test("another template asks the form its own way: the page follows the choice", async () => {
    await renderForm(WITH_SETTINGS);
    serveSubmit({ status: 200, data: { reference: "INC-3" } });

    await choose("Application Outage");

    expect(screen.queryByTestId("form-field-window")).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-field-email")).not.toBeInTheDocument();

    await choose("Planned Maintenance");

    expect(screen.getByTestId("form-field-window")).toBeInTheDocument();
    // Outage hid the email; Planned Maintenance asks it as the form does.
    expect(screen.getByTestId("form-field-email")).toBeInTheDocument();
    expect(labelOf("form-field-app")).toBe("Application Name (Optional)");

    typeInto("form-field-email", "ada@example.com");
    await submit();

    expect(submittedBodies()).toEqual([
      {
        data: {
          answers: {
            title: "Planned maintenance",
            severity: MINOR_ID,
            checked: false,
            email: "ada@example.com",
            window: "Saturday 02:00",
          },
          templateId: "maintenance",
        },
      },
    ]);
  });

  test("a template's link opens the form asked its way", async () => {
    window.history.replaceState(
      {},
      "",
      `/accounts/form/${SHARE_KEY}?template=maintenance`,
    );

    await renderForm(WITH_SETTINGS);

    expect(screen.getByTestId("form-field-window")).toHaveValue(
      "Saturday 02:00",
    );
    expect(labelOf("form-field-app")).toBe("Application Name (Optional)");

    cleanup();
    window.history.replaceState(
      {},
      "",
      `/accounts/form/${SHARE_KEY}?template=outage`,
    );

    await renderForm(WITH_SETTINGS);

    expect(screen.queryByTestId("form-field-window")).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-field-email")).not.toBeInTheDocument();
    expect(labelOf("form-field-app")).toBe("Application Name");
  });
});
