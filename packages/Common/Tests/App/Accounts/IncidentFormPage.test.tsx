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
  waitFor,
  within,
} from "@testing-library/react";
import axios from "axios";
import { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import OneUptimeDate from "../../../Types/Date";
import {
  IncidentFormFieldSetting,
  PublicIncidentForm,
} from "../../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../../Types/JSON";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import IncidentFormPage from "../../../../App/FeatureSet/Accounts/src/Pages/IncidentForm";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * The captcha settings of this install, switched per test (setCaptcha). They
 * are getters over state the mock itself owns, because the page reads them
 * as it renders - and because this factory runs while the imports above are
 * still loading, before anything declared in this file exists.
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

/*
 * hCaptcha itself loads a script from the network. The stand-in keeps the
 * part of its contract the page relies on: a reset signal clears the token
 * (as the real widget does, on mount and on every new signal), and solving
 * the challenge hands one over - numbered by the reset it was solved after,
 * so a test can tell a fresh token from a spent one.
 */
interface MockCaptchaProps {
  siteKey: string;
  resetSignal?: number | undefined;
  error?: string | undefined;
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
      {props.error ? <span>{props.error}</span> : <></>}
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

/*
 * THE PAGE ANYBODY WITH AN INCIDENT FORM'S LINK OPENS.
 *
 * These drive the real page, the real form and fields, the real
 * IncidentFormAPI and BaseAPI and the core client, with a scripted server
 * where axios would reach the network. The server answers only what each
 * test expects, so a session refresh, a logout request or a second read
 * that should not have happened fails the test naming the request.
 *
 * What is pinned:
 *  - the page reads the form behind the link and asks exactly its questions:
 *    the title always, the description as the form says, the severity only
 *    when the form offers a choice, each custom field it asks, the reporter's
 *    details, and a captcha only when the server wants one and this install
 *    can draw one;
 *  - no Markdown editor on it can upload an image - that needs a signed-in
 *    user, and a reporter may be none;
 *  - what it sends is the answers and nothing else, custom field answers
 *    under each field's name;
 *  - every refusal is said on the page, next to the form, and none of them
 *    navigates, refreshes a session or signs anybody out - a visitor who is
 *    also signed in to OneUptime on this host keeps their session.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";

const FORM_URL: string = `${DASHBOARD_ORIGIN}/api/incident-form/public/${SHARE_KEY}`;

const SUBMIT_URL: string = `${FORM_URL}/submit`;

const CRITICAL_ID: string = "c1c1c1c1-0000-4000-8000-000000000001";
const MINOR_ID: string = "c1c1c1c1-0000-4000-8000-000000000002";

const NOT_AVAILABLE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";
const NETWORK_NOT_ALLOWED: string =
  "This form can only be opened from an allowed network.";
const TOO_MANY_SUBMISSIONS: string =
  "Too many submissions from your network. Please wait a few minutes and try again.";
const FORM_BUSY: string =
  "This form is receiving too many reports right now. Please try again later.";
const TOO_MANY_REQUESTS: string = "Too many requests. Please try again later.";
const CAPTCHA_FAILED: string = "Captcha verification failed. Please try again.";
const REPORTS_UNAVAILABLE: string =
  "Reports cannot be accepted right now. Please try again in a few minutes.";
const SUBMIT_FAILED: string =
  "Your report could not be submitted. Please try again in a few minutes.";
const LOAD_FAILED: string =
  "This form could not be loaded. Please try again in a few minutes.";

/*
 * A form that asks everything it can: an optional description, a choice of
 * severity, one field of every type - and one called "title", which must not
 * become the title's answer.
 */
const FULL_FORM: PublicIncidentForm = {
  name: "Report a Problem",
  description: "Tell us what is **broken**.",
  descriptionSetting: IncidentFormFieldSetting.Optional,
  isReporterDetailsRequired: true,
  severities: [
    { _id: CRITICAL_ID, name: "Critical", color: "#ff0000" },
    { _id: MINOR_ID, name: "Minor" },
  ],
  defaultIncidentSeverityId: MINOR_ID,
  customFields: [
    {
      name: "Impact",
      description: "Who is affected?",
      customFieldType: CustomFieldType.Text,
      isRequired: true,
    },
    {
      name: "Users Affected",
      customFieldType: CustomFieldType.Number,
      isRequired: false,
    },
    {
      name: "Acknowledged",
      customFieldType: CustomFieldType.Boolean,
      isRequired: true,
    },
    {
      name: "Region",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "EU\nUS",
      isRequired: false,
    },
    {
      name: "Services",
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "API\nWeb",
      isRequired: false,
    },
    {
      name: "Started On",
      customFieldType: CustomFieldType.Date,
      isRequired: false,
    },
    {
      name: "Started At",
      customFieldType: CustomFieldType.DateTime,
      isRequired: false,
    },
    {
      name: "Details",
      customFieldType: CustomFieldType.LongText,
      isRequired: false,
    },
    {
      name: "Notes",
      customFieldType: CustomFieldType.Markdown,
      isRequired: false,
    },
    {
      name: "title",
      customFieldType: CustomFieldType.Text,
      isRequired: false,
    },
  ],
  isCaptchaRequired: false,
};

// The smallest form there is: a title, and the reporter's details.
const MINIMAL_FORM: PublicIncidentForm = {
  name: "Minimal",
  descriptionSetting: IncidentFormFieldSetting.Hidden,
  isReporterDetailsRequired: true,
  customFields: [],
  isCaptchaRequired: false,
};

let server: FakeAxiosServer;

let navigateSpy: SpyInstance<typeof Navigation.navigate>;

let logoutSpy: SpyInstance<typeof User.logout>;

type SentRequestsFunction = () => Array<string>;

const sentRequests: SentRequestsFunction = (): Array<string> => {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
};

type ServeFormFunction = (reply: FakeReply) => void;

const serveForm: ServeFormFunction = (reply: FakeReply): void => {
  server.on(HTTPMethod.GET, FORM_URL, [reply]);
};

type ServeSubmitFunction = (reply: FakeReply) => void;

const serveSubmit: ServeSubmitFunction = (reply: FakeReply): void => {
  server.on(HTTPMethod.POST, SUBMIT_URL, [reply]);
};

type SubmittedBodiesFunction = () => Array<JSONObject>;

const submittedBodies: SubmittedBodiesFunction = (): Array<JSONObject> => {
  return server
    .requestsTo(HTTPMethod.POST, SUBMIT_URL)
    .map((request: SentRequest): JSONObject => {
      return request.data as JSONObject;
    });
};

type FlushFunction = () => Promise<void>;

// Lets every answered request, and the renders it causes, finish.
const flush: FlushFunction = async (): Promise<void> => {
  for (let round: number = 0; round < 5; round++) {
    await act(async () => {
      await settle();
    });
  }
};

type RenderPageFunction = (shareKey?: string) => Promise<void>;

const renderPage: RenderPageFunction = async (
  shareKey: string = SHARE_KEY,
): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/incident-form/${shareKey}`]}>
        <Routes>
          <Route
            path="/accounts/incident-form/:shareKey"
            element={<IncidentFormPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });

  await flush();
};

type RenderFormFunction = (form: PublicIncidentForm) => Promise<void>;

// Serves the form, opens the page, and waits for its first question.
const renderForm: RenderFormFunction = async (
  form: PublicIncidentForm,
): Promise<void> => {
  serveForm({ status: 200, data: form as unknown as JSONObject });

  await renderPage();

  await screen.findByTestId("incident-form-title");
};

type TypeFunction = (element: HTMLElement, value: string) => void;

const typeInto: TypeFunction = (element: HTMLElement, value: string): void => {
  fireEvent.change(element, { target: { value: value } });
};

type TypeMarkdownFunction = (editable: HTMLElement, html: string) => void;

/*
 * The visual Markdown editor reads what was typed from its own HTML on each
 * input event, which is how a browser reports typing into it.
 */
const typeMarkdown: TypeMarkdownFunction = (
  editable: HTMLElement,
  html: string,
): void => {
  editable.innerHTML = html;
  fireEvent.input(editable);
};

type ElementFunction = () => HTMLElement;

const descriptionEditor: ElementFunction = (): HTMLElement => {
  return within(screen.getByTestId("incident-form-description")).getByRole(
    "textbox",
  );
};

type PickOptionFunction = (combobox: HTMLElement, optionText: string) => void;

// react-select opens on ArrowDown; its options are portalled to document.body.
const pickOption: PickOptionFunction = (
  combobox: HTMLElement,
  optionText: string,
): void => {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByRole("option", { name: optionText });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

type SubmitFunction = () => Promise<void>;

const submit: SubmitFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  });

  await flush();
};

type FillRequiredFunction = () => void;

// The answers MINIMAL_FORM requires, and nothing else.
const fillMinimalForm: FillRequiredFunction = (): void => {
  typeInto(screen.getByTestId("incident-form-title"), "Checkout is down");
  typeInto(screen.getByTestId("incident-form-reporter-name"), "Ada Lovelace");
  typeInto(
    screen.getByTestId("incident-form-reporter-email"),
    "ada@example.com",
  );
};

type ExpectNoSideEffectsFunction = () => void;

/*
 * Whatever went wrong, the page said so itself: nothing navigated, nobody
 * was signed out, and no request was made beyond the ones the test served.
 */
const expectNoNavigationOrLogout: ExpectNoSideEffectsFunction = (): void => {
  expect(navigateSpy).not.toHaveBeenCalled();
  expect(logoutSpy).not.toHaveBeenCalled();
};

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
  test("one GET, through the page's own client, with an empty tenant", async () => {
    await renderForm(FULL_FORM);

    expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);

    const headers: Record<string, string> = server.sent[0]!.headers;

    expect(headers["tenantid"]).toBe("");
    expect(Object.keys(headers)).not.toContain("apikey");
  });

  test("the form's name is the heading, and its description is shown as Markdown", async () => {
    await renderForm(FULL_FORM);

    expect(
      screen.getByRole("heading", { level: 1, name: "Report a Problem" }),
    ).toBeInTheDocument();

    const about: HTMLElement = screen.getByTestId("incident-form-about");

    await waitFor(() => {
      expect(within(about).getByTestId("react-markdown")).toHaveTextContent(
        "Tell us what is **broken**.",
      );
    });
  });

  test("a form without a description shows none", async () => {
    await renderForm(MINIMAL_FORM);

    expect(screen.queryByTestId("incident-form-about")).toBeNull();
  });

  test("the tab is named after the form, and named back on the way out", async () => {
    document.title = "OneUptime Accounts";

    await renderForm(FULL_FORM);

    expect(document.title).toBe("Report a Problem");

    cleanup();

    expect(document.title).toBe("OneUptime Accounts");
  });

  test("a form that cannot be opened leaves the tab's name alone", async () => {
    document.title = "OneUptime Accounts";
    serveForm({ status: 404, data: { error: NOT_AVAILABLE } });

    await renderPage();

    expect(
      screen.getByTestId("incident-form-load-failure"),
    ).toBeInTheDocument();
    expect(document.title).toBe("OneUptime Accounts");
  });

  test("while the form loads, the page shows a loader and no form", async () => {
    let releaseForm: () => void = (): void => {};
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseForm = resolve;
    });

    serveForm({
      status: 200,
      data: MINIMAL_FORM as unknown as JSONObject,
      gate: gate,
    });

    await renderPage();

    expect(screen.queryByTestId("incident-form-title")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();

    releaseForm();
    await flush();

    expect(screen.getByTestId("incident-form-title")).toBeInTheDocument();
  });
});

describe("the questions are the form's", () => {
  test("the title is always asked, required, with its help text and limit", async () => {
    await renderForm(MINIMAL_FORM);

    expect(screen.getByLabelText(/^Title/)).toBe(
      screen.getByTestId("incident-form-title"),
    );
    expect(
      screen.getByText("A short summary of what is wrong."),
    ).toBeInTheDocument();

    typeInto(screen.getByTestId("incident-form-title"), "x".repeat(501));
    await submit();

    expect(
      screen.getByText("Title cannot be more than 500 characters."),
    ).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });

  test("every custom field type is drawn with its own input", async () => {
    await renderForm(FULL_FORM);

    expect(screen.getByLabelText(/^Impact/)).toHaveAttribute("type", "text");
    expect(screen.getByText("Who is affected?")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Users Affected/)).toHaveAttribute(
      "type",
      "number",
    );
    expect(
      screen.getByRole("switch", { name: /Acknowledged/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /^Region/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /^Services/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Started On/)).toHaveAttribute(
      "type",
      "date",
    );
    expect(screen.getByLabelText(/^Started At/)).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByLabelText(/^Details/).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toHaveAttribute(
      "contenteditable",
      "true",
    );
    // The field called "title" is its own input, not the title's.
    expect(screen.getByLabelText(/^title/)).not.toBe(
      screen.getByTestId("incident-form-title"),
    );
  });

  test("required and optional follow the form", async () => {
    await renderForm(FULL_FORM);

    const labelOf: (text: RegExp) => string = (text: RegExp): string => {
      return screen.getByText(text, { selector: "label *" }).closest("label")!
        .textContent as string;
    };

    // Required: no "(Optional)" next to the label.
    expect(labelOf(/^Title/)).not.toContain("(Optional)");
    expect(labelOf(/^Impact/)).not.toContain("(Optional)");
    expect(labelOf(/^Acknowledged/)).not.toContain("(Optional)");
    expect(labelOf(/^Your Name/)).not.toContain("(Optional)");
    expect(labelOf(/^Your Email/)).not.toContain("(Optional)");

    expect(labelOf(/^Description/)).toContain("(Optional)");
    expect(labelOf(/^Severity/)).toContain("(Optional)");
    expect(labelOf(/^Users Affected/)).toContain("(Optional)");
    expect(labelOf(/^Notes/)).toContain("(Optional)");
  });

  test("a Required description must be written, and a blank one is refused in the browser", async () => {
    await renderForm({
      ...MINIMAL_FORM,
      descriptionSetting: IncidentFormFieldSetting.Required,
    });

    fillMinimalForm();
    await submit();

    expect(screen.getByText("Description is required.")).toBeInTheDocument();

    typeMarkdown(descriptionEditor(), "<p>   </p>");
    await submit();

    expect(submittedBodies()).toEqual([]);
  });

  test("a Hidden description is not asked, and not sent", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm(MINIMAL_FORM);

    expect(screen.queryByTestId("incident-form-description")).toBeNull();

    fillMinimalForm();
    await submit();

    expect(submittedBodies()).toHaveLength(1);
    expect(Object.keys(submittedBodies()[0]!["data"] as JSONObject)).toEqual([
      "title",
      "reporterName",
      "reporterEmail",
    ]);
  });

  test("the severity is only asked when the form offers a choice", async () => {
    await renderForm(MINIMAL_FORM);

    expect(screen.queryByTestId("incident-form-severity")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Severity/ })).toBeNull();
  });

  test("the offered severities are listed in order, the form's own preselected", async () => {
    await renderForm(FULL_FORM);

    const severity: HTMLElement = screen.getByRole("combobox", {
      name: /^Severity/,
    });

    // The form's own severity is what is showing.
    expect(severity.closest(".ou-select__control")).toHaveTextContent("Minor");

    fireEvent.keyDown(severity, { key: "ArrowDown" });

    const options: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });

    expect(options).toEqual(["Critical", "Minor"]);
  });

  test("reporter details are optional when the form says so", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm({ ...MINIMAL_FORM, isReporterDetailsRequired: false });

    typeInto(screen.getByTestId("incident-form-title"), "Checkout is down");
    await submit();

    expect(submittedBodies()).toEqual([
      { data: { title: "Checkout is down" } },
    ]);
  });

  test("required reporter details are asked for, and the email must be one", async () => {
    await renderForm(MINIMAL_FORM);

    typeInto(screen.getByTestId("incident-form-title"), "Checkout is down");
    await submit();

    expect(screen.getByText("Your Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Your Email is required.")).toBeInTheDocument();

    typeInto(screen.getByTestId("incident-form-reporter-name"), "   ");
    typeInto(
      screen.getByTestId("incident-form-reporter-email"),
      "not-an-email",
    );
    await submit();

    expect(screen.getByText("Your Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Email is not valid.")).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });

  test("a title of nothing but spaces is refused in the browser", async () => {
    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    typeInto(screen.getByTestId("incident-form-title"), "    ");
    await submit();

    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });

  test("a required custom field and a required yes/no are asked for", async () => {
    await renderForm(FULL_FORM);

    typeInto(screen.getByTestId("incident-form-title"), "Checkout is down");
    await submit();

    expect(screen.getByText("Impact is required.")).toBeInTheDocument();
    // Never touched: it has no answer at all yet.
    expect(screen.getByText("Acknowledged is required.")).toBeInTheDocument();

    // Ticked and unticked again: an answer, and the wrong one.
    const acknowledged: HTMLElement = screen.getByRole("switch", {
      name: /Acknowledged/,
    });

    fireEvent.click(acknowledged);
    fireEvent.click(acknowledged);
    await submit();

    expect(
      screen.getByText("Acknowledged must be checked."),
    ).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);
  });
});

describe("no Markdown editor on the page can upload an image", () => {
  test("not the description's, and not a Markdown custom field's", async () => {
    await renderForm(FULL_FORM);

    // Both editors are there...
    expect(screen.getByTestId("incident-form-description")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toBeInTheDocument();

    // ...and neither offers an image.
    expect(screen.queryAllByTitle("Image")).toEqual([]);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });
});

describe("the captcha", () => {
  test("is shown when the server asks for one and this install can draw one", async () => {
    setCaptcha(true, "site-key-1");

    await renderForm({ ...MINIMAL_FORM, isCaptchaRequired: true });

    expect(screen.getByTestId("captcha")).toHaveAttribute(
      "data-site-key",
      "site-key-1",
    );
    expect(screen.getByText("Human Verification")).toBeInTheDocument();
  });

  test.each([
    ["the form does not ask for one", true, "site-key-1", false],
    ["captcha is turned off here", false, "site-key-1", true],
    ["there is no site key", true, "", true],
  ])(
    "is not shown when %s",
    async (
      _case: string,
      enabled: boolean,
      siteKey: string,
      isCaptchaRequired: boolean,
    ) => {
      setCaptcha(enabled, siteKey);

      await renderForm({ ...MINIMAL_FORM, isCaptchaRequired });

      expect(screen.queryByTestId("captcha")).toBeNull();
      expect(screen.queryByText("Human Verification")).toBeNull();
    },
  );

  test("must be solved, its token is sent, and a failed submit gets a fresh challenge", async () => {
    setCaptcha(true, "site-key-1");

    await renderForm({ ...MINIMAL_FORM, isCaptchaRequired: true });

    fillMinimalForm();
    await submit();

    expect(
      screen.getByText("Human Verification is required."),
    ).toBeInTheDocument();
    expect(submittedBodies()).toEqual([]);

    // Solved: the token rides with the answers.
    serveSubmit({ status: 400, data: { error: CAPTCHA_FAILED } });
    fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
    await submit();

    expect(submittedBodies()).toHaveLength(1);
    expect(submittedBodies()[0]!["captchaToken"]).toBe("captcha-token-0");
    expect(screen.getByTestId("incident-form-submit-error")).toHaveTextContent(
      CAPTCHA_FAILED,
    );

    // The token is spent: a new challenge, and the old answer is gone.
    expect(screen.getByTestId("captcha")).toHaveAttribute(
      "data-reset-signal",
      "1",
    );

    await submit();

    expect(submittedBodies()).toHaveLength(1);
    expect(
      screen.getByText("Human Verification is required."),
    ).toBeInTheDocument();

    serveSubmit({ status: 200, data: { incidentNumber: "INC-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
    await submit();

    expect(submittedBodies()).toHaveLength(2);
    expect(submittedBodies()[1]!["captchaToken"]).toBe("captcha-token-1");
    expect(screen.getByTestId("incident-form-success")).toBeInTheDocument();
  });

  test("any failed submit resets it - answers refused, not only the captcha", async () => {
    setCaptcha(true, "site-key-1");

    await renderForm({ ...MINIMAL_FORM, isCaptchaRequired: true });

    serveSubmit({ status: 500, data: { error: "Server Error" } });
    fillMinimalForm();
    fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
    await submit();

    expect(screen.getByTestId("captcha")).toHaveAttribute(
      "data-reset-signal",
      "1",
    );
  });

  test("with no captcha, no token is sent at all", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    expect(Object.keys(submittedBodies()[0]!)).toEqual(["data"]);
  });
});

describe("what the page sends", () => {
  test("the answers, each custom field under its name - and nothing else", async () => {
    serveSubmit({ status: 200, data: { incidentNumber: "INC-42" } });

    await renderForm(FULL_FORM);

    typeInto(
      screen.getByTestId("incident-form-title"),
      "   Checkout is down   ",
    );
    typeMarkdown(
      descriptionEditor(),
      "<p>Payments fail with <strong>500</strong></p>",
    );
    pickOption(screen.getByRole("combobox", { name: /^Severity/ }), "Critical");
    typeInto(screen.getByLabelText(/^Impact/), "Every customer");
    typeInto(screen.getByLabelText(/^Users Affected/), "0");
    fireEvent.click(screen.getByRole("switch", { name: /Acknowledged/ }));
    pickOption(screen.getByRole("combobox", { name: /^Region/ }), "EU");
    pickOption(screen.getByRole("combobox", { name: /^Services/ }), "API");
    typeInto(screen.getByLabelText(/^Started On/), "2026-09-29");
    typeInto(screen.getByLabelText(/^Details/), "Line one\nLine two");
    typeMarkdown(
      screen.getByRole("textbox", { name: /^Notes/ }),
      "<p>See <em>logs</em></p>",
    );
    typeInto(screen.getByLabelText(/^title/), "Not the title");
    typeInto(
      screen.getByTestId("incident-form-reporter-name"),
      "  Ada Lovelace ",
    );
    typeInto(
      screen.getByTestId("incident-form-reporter-email"),
      "Ada@Example.com",
    );

    await submit();

    expect(submittedBodies()).toEqual([
      {
        data: {
          title: "Checkout is down",
          description: "Payments fail with **500**",
          incidentSeverityId: CRITICAL_ID,
          reporterName: "Ada Lovelace",
          reporterEmail: "ada@example.com",
          customFields: {
            Impact: "Every customer",
            "Users Affected": "0",
            Acknowledged: true,
            Region: "EU",
            Services: ["API"],
            "Started On": OneUptimeDate.toString(
              OneUptimeDate.fromDateTimeLocalString("2026-09-29"),
            ),
            Details: "Line one\nLine two",
            Notes: "See *logs*",
            title: "Not the title",
          },
        },
      },
    ]);
  });

  test("the form's own severity is sent when the reporter leaves it", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm({ ...FULL_FORM, customFields: [] });

    fillMinimalForm();
    await submit();

    expect(
      (submittedBodies()[0]!["data"] as JSONObject)["incidentSeverityId"],
    ).toBe(MINOR_ID);
  });

  test("with no severity preselected and none picked, none is sent", async () => {
    serveSubmit({ status: 200, data: {} });

    const form: PublicIncidentForm = { ...FULL_FORM, customFields: [] };
    delete form.defaultIncidentSeverityId;

    await renderForm(form);

    fillMinimalForm();
    await submit();

    expect(
      Object.keys(submittedBodies()[0]!["data"] as JSONObject),
    ).not.toContain("incidentSeverityId");
  });

  test("an unticked optional yes/no is an answer: No", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm({
      ...MINIMAL_FORM,
      customFields: [
        {
          name: "Customer Facing",
          customFieldType: CustomFieldType.Boolean,
          isRequired: false,
        },
      ],
    });

    fillMinimalForm();
    await submit();

    expect(
      (submittedBodies()[0]!["data"] as JSONObject)["customFields"],
    ).toEqual({ "Customer Facing": false });
  });

  test("a submit that is still in flight cannot be sent twice", async () => {
    let releaseSubmit: () => void = (): void => {};
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseSubmit = resolve;
    });

    serveSubmit({ status: 200, data: {}, gate: gate });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    /*
     * The button is disabled while the report is on its way, but Enter in a
     * text field still submits the form - the page must not send it again.
     */
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("incident-form-title"), {
        key: "Enter",
      });
    });
    await flush();

    expect(submittedBodies()).toHaveLength(1);

    releaseSubmit();
    await flush();

    expect(screen.getByTestId("incident-form-success")).toBeInTheDocument();
  });
});

describe("after the report is sent", () => {
  test("the thank-you screen names the incident and shows the form's message", async () => {
    serveSubmit({
      status: 200,
      data: {
        incidentNumber: "INC-42",
        successMessage: "We are **on it**.",
      },
    });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    const success: HTMLElement = screen.getByTestId("incident-form-success");

    expect(
      within(success).getByRole("heading", {
        name: "Thank you — your report was submitted.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("incident-form-incident-number"),
    ).toHaveTextContent("Your report is incident INC-42.");

    await waitFor(() => {
      expect(
        within(screen.getByTestId("incident-form-success-message")).getByTestId(
          "react-markdown",
        ),
      ).toHaveTextContent("We are **on it**.");
    });

    // Still under the form's name; the form itself is gone.
    expect(
      screen.getByRole("heading", { level: 1, name: "Minimal" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("incident-form-title")).toBeNull();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  test("a project without a prefix gets its incident as #42", async () => {
    serveSubmit({ status: 200, data: { incidentNumber: "#42" } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    expect(
      screen.getByTestId("incident-form-incident-number"),
    ).toHaveTextContent("Your report is incident #42.");
  });

  test("with no number and no message, it simply says thank you", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    expect(screen.getByTestId("incident-form-success")).toBeInTheDocument();
    expect(screen.queryByTestId("incident-form-incident-number")).toBeNull();
    expect(screen.queryByTestId("incident-form-success-message")).toBeNull();
  });

  /*
   * The form, and the Submit button that had focus, are gone. Unless focus
   * moves to what replaced them, it falls to <body> and a screen reader user
   * hears nothing - not that the report went through, not its number.
   */
  test("focus moves to the thank-you heading, which is read out with the incident number", async () => {
    serveSubmit({ status: 200, data: { incidentNumber: "INC-42" } });

    await renderForm(MINIMAL_FORM);

    // Nothing takes focus on arrival: the reporter reads the form first.
    expect(document.body).toHaveFocus();

    fillMinimalForm();
    screen.getByRole("button", { name: "Submit" }).focus();
    await submit();

    const heading: HTMLElement = within(
      screen.getByTestId("incident-form-success"),
    ).getByRole("heading", { name: "Thank you — your report was submitted." });

    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(
      "Your report is incident INC-42.",
    );
  });

  test("with no incident number, the heading still takes focus, with nothing read out after it", async () => {
    serveSubmit({ status: 200, data: {} });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    screen.getByRole("button", { name: "Submit" }).focus();
    await submit();

    const heading: HTMLElement = within(
      screen.getByTestId("incident-form-success"),
    ).getByRole("heading", { name: "Thank you — your report was submitted." });

    expect(heading).toHaveFocus();
    expect(heading).not.toHaveAttribute("aria-describedby");
  });

  test("another report starts with focus on its first question", async () => {
    serveSubmit({ status: 200, data: { incidentNumber: "INC-42" } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    const another: HTMLElement = screen.getByTestId(
      "incident-form-submit-another",
    );

    another.focus();

    await act(async () => {
      fireEvent.click(another);
    });
    await flush();

    expect(screen.getByTestId("incident-form-title")).toHaveFocus();
  });

  test("another report starts from an empty form, without reading it again", async () => {
    serveSubmit({ status: 200, data: { incidentNumber: "INC-42" } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    await act(async () => {
      fireEvent.click(screen.getByTestId("incident-form-submit-another"));
    });
    await flush();

    expect(screen.getByTestId("incident-form-title")).toHaveValue("");
    expect(screen.getByTestId("incident-form-reporter-email")).toHaveValue("");
    expect(screen.queryByTestId("incident-form-submit-error")).toBeNull();

    // The form was read once; nothing else was asked of the server.
    expect(sentRequests()).toEqual([`GET ${FORM_URL}`, `POST ${SUBMIT_URL}`]);

    serveSubmit({ status: 200, data: { incidentNumber: "INC-43" } });
    fillMinimalForm();
    await submit();

    expect(
      screen.getByTestId("incident-form-incident-number"),
    ).toHaveTextContent("Your report is incident INC-43.");
  });
});

describe("a form that cannot be opened says why, on the page", () => {
  test.each([
    ["404", { status: 404, data: { error: NOT_AVAILABLE } }, NOT_AVAILABLE],
    [
      "404 with a body that is not the server's",
      { status: 404, data: { error: "Route not found" } },
      NOT_AVAILABLE,
    ],
    [
      "403",
      { status: 403, data: { error: NETWORK_NOT_ALLOWED } },
      NETWORK_NOT_ALLOWED,
    ],
  ])(
    "%s: no way to try again, because trying again changes nothing",
    async (_case: string, reply: FakeReply, message: string) => {
      serveForm(reply);

      await renderPage();

      const failure: HTMLElement = screen.getByTestId(
        "incident-form-load-failure",
      );

      expect(
        within(failure).getByRole("heading", { level: 1 }),
      ).toHaveTextContent(message);
      expect(screen.queryByTestId("incident-form-try-again")).toBeNull();
      expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);
      expectNoNavigationOrLogout();
    },
  );

  test.each([
    [
      "429 with Retry-After",
      {
        status: 429,
        data: { message: TOO_MANY_REQUESTS },
        headers: { "retry-after": "120" },
      },
      TOO_MANY_REQUESTS,
      "You can try again in 2 minutes.",
    ],
    [
      "429 with no Retry-After",
      { status: 429, data: { message: TOO_MANY_REQUESTS } },
      TOO_MANY_REQUESTS,
      null,
    ],
    [
      "429 from something that is not the form's limiter",
      { status: 429, data: { message: "Slow down" } },
      TOO_MANY_REQUESTS,
      null,
    ],
    [
      "500",
      { status: 500, data: { error: "Server Error" } },
      LOAD_FAILED,
      null,
    ],
    [
      "502 from a proxy, as HTML",
      {
        status: 502,
        data: "<html>Bad Gateway</html>" as unknown as JSONObject,
      },
      LOAD_FAILED,
      null,
    ],
    [
      "no answer at all",
      { networkErrorCode: "ECONNREFUSED" },
      LOAD_FAILED,
      null,
    ],
    [
      "a 200 that is not a form",
      { status: 200, data: "<html>Welcome</html>" as unknown as JSONObject },
      LOAD_FAILED,
      null,
    ],
    [
      "401 - which the routes never answer, but a proxy might",
      { status: 401, data: { message: "Unauthorized" } },
      LOAD_FAILED,
      null,
    ],
    [
      "405",
      { status: 405, data: { message: "Tenant not found" } },
      LOAD_FAILED,
      null,
    ],
  ])(
    "%s: says so, and offers to try again",
    async (
      _case: string,
      reply: FakeReply,
      message: string,
      retryAfter: string | null,
    ) => {
      serveForm(reply);

      await renderPage();

      const failure: HTMLElement = screen.getByTestId(
        "incident-form-load-failure",
      );

      expect(
        within(failure).getByRole("heading", { level: 1 }),
      ).toHaveTextContent(message);

      if (retryAfter) {
        expect(failure).toHaveTextContent(retryAfter);
      } else {
        expect(failure).not.toHaveTextContent("You can try again");
      }

      expect(screen.getByTestId("incident-form-try-again")).toBeInTheDocument();
      // One request: no session refresh, no logout request, no retry loop.
      expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);
      expectNoNavigationOrLogout();
    },
  );

  test("Try again reads the form again", async () => {
    serveForm({ status: 503, data: { message: "Unavailable" } });

    await renderPage();

    serveForm({ status: 200, data: MINIMAL_FORM as unknown as JSONObject });

    await act(async () => {
      fireEvent.click(screen.getByTestId("incident-form-try-again"));
    });
    await flush();

    expect(screen.getByTestId("incident-form-title")).toBeInTheDocument();
    expect(sentRequests()).toEqual([`GET ${FORM_URL}`, `GET ${FORM_URL}`]);
  });

  /*
   * "Try again" leaves with the failure it was on, and whatever loads next
   * starts at its heading - the form's name, or what went wrong this time -
   * rather than leaving focus on <body>.
   */
  test("after Try again, focus is on the heading of the form that loaded", async () => {
    serveForm({ status: 503, data: { message: "Unavailable" } });

    await renderPage();

    // A form that fails on arrival takes no focus: nothing had it.
    expect(document.body).toHaveFocus();

    serveForm({ status: 200, data: MINIMAL_FORM as unknown as JSONObject });

    const tryAgain: HTMLElement = screen.getByTestId("incident-form-try-again");

    tryAgain.focus();

    await act(async () => {
      fireEvent.click(tryAgain);
    });
    await flush();

    expect(
      screen.getByRole("heading", { level: 1, name: "Minimal" }),
    ).toHaveFocus();
  });

  test("after a Try again that fails again, focus is on the new failure", async () => {
    serveForm({ status: 503, data: { message: "Unavailable" } });

    await renderPage();

    serveForm({ status: 429, data: { message: TOO_MANY_REQUESTS } });

    const tryAgain: HTMLElement = screen.getByTestId("incident-form-try-again");

    tryAgain.focus();

    await act(async () => {
      fireEvent.click(tryAgain);
    });
    await flush();

    const heading: HTMLElement = within(
      screen.getByTestId("incident-form-load-failure"),
    ).getByRole("heading", { level: 1 });

    expect(heading).toHaveTextContent(TOO_MANY_REQUESTS);
    expect(heading).toHaveFocus();
  });

  test.each([
    ["a word", "not-a-key"],
    ["a path that climbs out of the route", "..%2F..%2Fuser%2Fget-list"],
    ["a key with the submit route glued on", `${SHARE_KEY}%2Fsubmit`],
    ["a key that is almost a UUID", `${SHARE_KEY}0`],
  ])(
    "%s is not a link to a form, and the page never asks the server about it",
    async (_case: string, shareKey: string) => {
      await renderPage(shareKey);

      expect(
        within(screen.getByTestId("incident-form-load-failure")).getByRole(
          "heading",
          { level: 1 },
        ),
      ).toHaveTextContent(NOT_AVAILABLE);
      expect(sentRequests()).toEqual([]);
    },
  );

  test("an upper-case key is the same key", async () => {
    serveForm({ status: 200, data: MINIMAL_FORM as unknown as JSONObject });

    await renderPage(SHARE_KEY.toUpperCase());

    expect(screen.getByTestId("incident-form-title")).toBeInTheDocument();
    expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);
  });
});

describe("a report that is refused says why, next to the form", () => {
  test.each([
    [
      "400 with the answers it refused",
      {
        status: 400,
        data: { error: "Impact is required. Title is required." },
      },
      "Impact is required. Title is required.",
      null,
    ],
    [
      "400 about the captcha",
      { status: 400, data: { error: CAPTCHA_FAILED } },
      CAPTCHA_FAILED,
      null,
    ],
    [
      "400 that does not say why",
      { status: 400, data: {} },
      SUBMIT_FAILED,
      null,
    ],
    [
      "403",
      { status: 403, data: { error: NETWORK_NOT_ALLOWED } },
      NETWORK_NOT_ALLOWED,
      null,
    ],
    [
      "404",
      { status: 404, data: { error: NOT_AVAILABLE } },
      NOT_AVAILABLE,
      null,
    ],
    [
      "429 for this network",
      {
        status: 429,
        data: { message: TOO_MANY_SUBMISSIONS },
        headers: { "Retry-After": "900" },
      },
      TOO_MANY_SUBMISSIONS,
      "You can try again in 15 minutes.",
    ],
    [
      "429 for the whole form",
      {
        status: 429,
        data: { message: FORM_BUSY },
        headers: { "retry-after": "3600" },
      },
      FORM_BUSY,
      "You can try again in 1 hour.",
    ],
    [
      "429 without the limiter's words",
      { status: 429, data: {} },
      TOO_MANY_SUBMISSIONS,
      null,
    ],
    [
      "500 when the incident could not be declared",
      { status: 500, data: { error: SUBMIT_FAILED } },
      SUBMIT_FAILED,
      null,
    ],
    [
      "500 with the server's generic words",
      { status: 500, data: { error: "Server Error" } },
      SUBMIT_FAILED,
      null,
    ],
    [
      "503 when submits are refused",
      { status: 503, data: { message: REPORTS_UNAVAILABLE } },
      REPORTS_UNAVAILABLE,
      null,
    ],
    [
      "no answer at all",
      { networkErrorCode: "ECONNRESET" },
      SUBMIT_FAILED,
      null,
    ],
  ])(
    "%s",
    async (
      _case: string,
      reply: FakeReply,
      message: string,
      retryAfter: string | null,
    ) => {
      serveSubmit(reply);

      await renderForm(MINIMAL_FORM);

      fillMinimalForm();
      await submit();

      const error: HTMLElement = screen.getByTestId(
        "incident-form-submit-error",
      );

      expect(error).toHaveTextContent(message);

      if (retryAfter) {
        expect(error).toHaveTextContent(retryAfter);
      } else {
        expect(error).not.toHaveTextContent("You can try again");
      }

      // The report is still there to send again.
      expect(screen.getByTestId("incident-form-title")).toHaveValue(
        "Checkout is down",
      );
      expect(screen.queryByTestId("incident-form-success")).toBeNull();

      expect(sentRequests()).toEqual([`GET ${FORM_URL}`, `POST ${SUBMIT_URL}`]);
      expectNoNavigationOrLogout();
    },
  );

  test("sending it again clears the last refusal", async () => {
    serveSubmit({ status: 503, data: { message: REPORTS_UNAVAILABLE } });
    serveSubmit({ status: 200, data: { incidentNumber: "INC-9" } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    expect(
      screen.getByTestId("incident-form-submit-error"),
    ).toBeInTheDocument();

    await submit();

    expect(screen.queryByTestId("incident-form-submit-error")).toBeNull();
    expect(
      screen.getByTestId("incident-form-incident-number"),
    ).toHaveTextContent("INC-9");
  });

  test("a server message that quotes a field is shown as it came, never looked up", async () => {
    const quoted: string =
      '"{{field}} is required." holds a number, but was sent "x".';

    serveSubmit({ status: 400, data: { error: quoted } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    expect(screen.getByTestId("incident-form-submit-error")).toHaveTextContent(
      quoted,
    );
  });
});

describe("a visitor who is signed in to OneUptime on this host", () => {
  const USER_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );

  beforeEach(() => {
    User.setUserId(USER_ID);
    User.setEmail(new Email("grace@example.com"));

    // What the page must leave alone.
    expect(User.isLoggedIn()).toBe(true);
  });

  test("is still signed in after the form's routes refuse with a 401", async () => {
    serveForm({ status: 401, data: { message: "Unauthorized" } });

    await renderPage();

    expect(User.isLoggedIn()).toBe(true);
    expect(User.getUserId().toString()).toBe(USER_ID.toString());
    // Not even a refresh was tried: the only request is the form's.
    expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);
    expectNoNavigationOrLogout();
  });

  test("is still signed in after a submit refused with a 401, a 403 or a 405", async () => {
    serveSubmit({ status: 401, data: { message: "Unauthorized" } });
    serveSubmit({ status: 403, data: { error: NETWORK_NOT_ALLOWED } });
    serveSubmit({ status: 405, data: { message: "Tenant not found" } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();
    await submit();
    await submit();

    expect(User.isLoggedIn()).toBe(true);
    expect(sentRequests()).toEqual([
      `GET ${FORM_URL}`,
      `POST ${SUBMIT_URL}`,
      `POST ${SUBMIT_URL}`,
      `POST ${SUBMIT_URL}`,
    ]);
    expectNoNavigationOrLogout();
  });

  test("reports through the same form as anybody else", async () => {
    serveSubmit({ status: 200, data: { incidentNumber: "INC-1" } });

    await renderForm(MINIMAL_FORM);

    fillMinimalForm();
    await submit();

    expect(screen.getByTestId("incident-form-success")).toBeInTheDocument();
    expect(User.isLoggedIn()).toBe(true);
  });
});

describe("the page speaks the reporter's language", () => {
  test("in Persian, its questions, the server's refusals and the wait", async () => {
    await act(async () => {
      await i18n.changeLanguage("fa");
    });

    serveSubmit({
      status: 429,
      data: { message: TOO_MANY_SUBMISSIONS },
      headers: { "retry-after": "900" },
    });

    serveForm({ status: 200, data: MINIMAL_FORM as unknown as JSONObject });
    await renderPage();

    // The page's own copy is nested; a sentence is its own (flat) key.
    const fa: (key: string) => string = (key: string): string => {
      return i18n.t(key);
    };

    const faSentence: (sentence: string) => string = (
      sentence: string,
    ): string => {
      return i18n.t(sentence, { keySeparator: false, nsSeparator: false });
    };

    expect(fa("incidentForm.title")).toBe("عنوان");
    expect(
      screen.getByLabelText(new RegExp(`^${fa("incidentForm.title")}`)),
    ).toBe(screen.getByTestId("incident-form-title"));
    expect(
      screen.getByText(fa("incidentForm.titleDescription")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: fa("common.submit") }),
    ).toBeInTheDocument();

    fillMinimalForm();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: fa("common.submit") }),
      );
    });
    await flush();

    const error: HTMLElement = screen.getByTestId("incident-form-submit-error");

    expect(faSentence(TOO_MANY_SUBMISSIONS)).not.toBe(TOO_MANY_SUBMISSIONS);
    expect(error).toHaveTextContent(faSentence(TOO_MANY_SUBMISSIONS));
    // "in 15 minutes", worded and numbered in Persian.
    expect(error).toHaveTextContent("۱۵ دقیقه بعد");
  });

  test("in German, a required question left empty is asked for in German", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });

    serveForm({ status: 200, data: MINIMAL_FORM as unknown as JSONObject });
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    });
    await flush();

    expect(screen.getByText("Titel ist erforderlich.")).toBeInTheDocument();
    expect(screen.getByText("Ihr Name ist erforderlich.")).toBeInTheDocument();
  });

  test("switching language mid-report relabels the form and keeps the answers", async () => {
    await renderForm(MINIMAL_FORM);

    typeInto(screen.getByTestId("incident-form-title"), "Checkout is down");

    expect(screen.getByLabelText(/^Title/)).toBe(
      screen.getByTestId("incident-form-title"),
    );

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    await flush();

    expect(screen.getByLabelText(/^Titel/)).toBe(
      screen.getByTestId("incident-form-title"),
    );
    expect(screen.getByTestId("incident-form-title")).toHaveValue(
      "Checkout is down",
    );
    expect(screen.getByRole("button", { name: "Senden" })).toBeInTheDocument();
  });
});
