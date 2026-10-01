import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIResponse,
  Browser,
  BrowserContext,
  Locator,
  Page,
  Request,
  Response,
  Route,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  JSONish,
  SessionUser,
  buildUrl,
  createItem,
  getItem,
  getSessionUser,
  listItems,
  pollUntil,
  requestJson,
  toId,
} from "./Helpers/MonitorAlerting";

/*
 * Incident forms (#4114), end to end against a real stack.
 *
 * An admin builds a form under Incidents > Settings > Forms; anyone holding
 * its link - no OneUptime account, no session - opens
 * /accounts/incident-form/<shareKey>, answers the questions the admin chose,
 * and the submission declares an incident. The unit suites mock every hop of
 * that: the Accounts page against a fake API, the public routes against
 * stubbed services, the dashboard cards against mocked ModelAPI calls. This
 * spec is the one place the hops meet:
 *
 *   A. setup through the same CRUD API the dashboard uses: incident custom
 *      fields of several types, a template (severity, label, owner user and
 *      team, values, Custom Fields on Create settings) and a form using it;
 *   B. an anonymous reporter, in a browser context with no cookies at all,
 *      opens the link, sees exactly the questions the form asks, is stopped by
 *      the browser's own validation, then submits and gets the incident number;
 *   C. what that submission became, read back through the API: the incident
 *      and its answers, the template's label and owners, the private note
 *      naming the reporter, and the submission row - and what the public
 *      routes do with a caller who goes around the page;
 *   D. the dashboard side: the Forms page and the form's Submissions, Reset
 *      Link (the old link must die at once), the Enabled switch, the IP
 *      allowlist, the Questions and Form Settings cards, and a form made in
 *      the dashboard's own wizard and tried out by a signed-in admin - each
 *      checked from the reporter's side of the link;
 *   E. an incident template's Custom Fields on Create - the wizard step that
 *      sets them, the card that edits them, and the Declare Incident page
 *      they shape - and the template owners that page used to drop;
 *   F. the submit rate limit, as the reporter sees it;
 *   G. (its own group) the order a form asks fields that have no sort order.
 *
 * Anti-flake notes:
 * - one fresh user and project per run, and run-unique names, so a re-run
 *   never meets another run's forms or incidents
 * - no fixed sleeps: every wait is a Playwright expectation or a poll
 * - chromium only: this is server behaviour and one set of pages, not
 *   rendering quirks
 * - the rate limit test (F) runs last in its group and uses a form of its
 *   own, so the budget it spends cannot refuse the reports the other tests
 *   make. The group retries once at most: the reports of two attempts stay
 *   inside the per-network budget (30 per 15 minutes by default) until F,
 *   which only needs some limit to refuse it
 *
 * To run locally against a full stack, with HOST and HTTP_PROTOCOL set to
 * the stack's own (its config.env values), not merely to an address that
 * reaches it: the public form's routes refuse a browser request sent from
 * any origin but the stack's configured HTTP_PROTOCOL + HOST, so from any
 * other the page loads a form and every report is refused. The group's
 * beforeAll compares the two first and stops, saying so, when they differ.
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/IncidentForms.spec.ts --project=chromium
 *
 * F reaches the limit sooner on a stack started with a lower
 * INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW (default 10).
 */

// The public page's copy (Accounts locales, en) and the server's messages.
const SUCCESS_HEADING: string = "Thank you — your report was submitted.";
const NOT_AVAILABLE_MESSAGE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";
const NETWORK_NOT_ALLOWED_MESSAGE: string =
  "This form can only be opened from an allowed network.";
const SUBMIT_RATE_LIMIT_MESSAGE: string =
  "Too many submissions from your network. Please wait a few minutes and try again.";
const FOREIGN_PAGE_MESSAGE: string =
  "This form can only be used from its own page.";

/*
 * The header the public page's client adds to every request it makes
 * (INCIDENT_FORM_PAGE_HEADER in Common/Types/Incident/IncidentFormPublic):
 * the read route answers only a request that carries it.
 */
const FORM_PAGE_HEADER: string = "x-oneuptime-incident-form";
const FORM_PAGE_HEADER_VALUE: string = "1";

// Incident forms and incident custom fields are Growth features.
const PREFERRED_PLAN_NAME: string = "Growth";

/*
 * TEST-NET-3 (RFC 5737): documentation space, never routed, so it is never
 * the address this run reaches the stack from - whatever network CI uses.
 */
const ALLOWLIST_THAT_EXCLUDES_US: string = "203.0.113.7";

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The incident custom fields the project gets, and what each one is for.
interface FieldSpec {
  name: string;
  customFieldType: string;
  dropdownOptions?: string | undefined;
  /*
   * The project's own "Sort Order", "Show on Create" and "Required on
   * Create". Every field here has a sort order, so every page asks them in
   * the same, deterministic order (fields without one: see G).
   */
  sortOrder: number;
  showOnCreate: boolean;
  isRequiredOnCreate: boolean;
}

const FIELDS: {
  impact: FieldSpec;
  region: FieldSpec;
  customerFacing: FieldSpec;
  affectedUsers: FieldSpec;
  targetDate: FieldSpec;
  internalReference: FieldSpec;
} = {
  // Asked by the form (Required) and by the template (Required).
  impact: {
    name: "Impact",
    customFieldType: "Text",
    sortOrder: 1,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  // Asked by the form (Optional); the template leaves it on Default.
  region: {
    name: "Region",
    customFieldType: "Dropdown",
    dropdownOptions: "EU\nUS\nAPAC",
    sortOrder: 2,
    showOnCreate: true,
    isRequiredOnCreate: false,
  },
  // Asked by the form (Optional) and by the template (Optional).
  customerFacing: {
    name: "Customer Facing",
    customFieldType: "Boolean",
    sortOrder: 3,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  // Asked by the form; the template starts it on Default (E2 changes that).
  affectedUsers: {
    name: "Affected Users",
    customFieldType: "Number",
    sortOrder: 4,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  // Asked by the form until D5 stops asking it.
  targetDate: {
    name: "Target Date",
    customFieldType: "Date",
    sortOrder: 5,
    showOnCreate: false,
    isRequiredOnCreate: false,
  },
  /*
   * Not asked by the form (until D5 adds it), and Hidden by the template
   * although the project marks it Show on Create and Required on Create: on
   * the template's incidents its value comes from the template.
   */
  internalReference: {
    name: "Internal Reference",
    customFieldType: "Text",
    sortOrder: 6,
    showOnCreate: true,
    isRequiredOnCreate: true,
  },
};

// What the template declares with.
const TEMPLATE_TITLE: string = "Customer reported problem";
const TEMPLATE_DESCRIPTION: string =
  "A customer reported a problem through the form.";
const TEMPLATE_REGION: string = "EU";
const TEMPLATE_INTERNAL_REFERENCE: string = "REF-4114";

// What the anonymous reporter types (B).
const REPORTER_NAME: string = "Ada Reporter";
const REPORTER_EMAIL: string = "ada.reporter@example.com";
const REPORT_IMPACT: string = "Checkout fails for every customer in the US";
const REPORT_REGION: string = "US";
const REPORT_AFFECTED_USERS: number = 250;
const REPORT_TARGET_DATE: string = "2026-10-15";

// A report with no name and no email, once the form allows that (D5).
const ANONYMOUS_IMPACT: string = "Every office printer is offline";
const ANONYMOUS_INTERNAL_REFERENCE: string = "DESK-7";

// The admin trying a new form out while signed in (D6).
const PREVIEW_REPORTER_NAME: string = "Grace Preview";
const PREVIEW_REPORTER_EMAIL: string = "grace.preview@example.com";

interface Ctx {
  page: Page;
  reporterContext: BrowserContext | null;
  reporter: Page;
  projectId: string;
  user: SessionUser;
  unique: string;
  formSeverityId: string;
  formSeverityName: string;
  reporterSeverityId: string;
  reporterSeverityName: string;
  labelId: string;
  labelName: string;
  teamId: string;
  teamName: string;
  variableKeys: Record<string, string>;
  templateId: string;
  templateName: string;
  templateSettings: Record<string, string>;
  formId: string;
  formName: string;
  formSettings: Record<string, string>;
  shareKey: string;
  reportTitle: string;
  reportDescription: string;
  incidentNumberShown: string;
  incidentId: string;
}

const ctx: Ctx = {
  page: null as unknown as Page,
  reporterContext: null,
  reporter: null as unknown as Page,
  projectId: "",
  user: { userId: "", email: "" },
  unique: "",
  formSeverityId: "",
  formSeverityName: "",
  reporterSeverityId: "",
  reporterSeverityName: "",
  labelId: "",
  labelName: "",
  teamId: "",
  teamName: "",
  variableKeys: {},
  templateId: "",
  templateName: "",
  templateSettings: {},
  formId: "",
  formName: "",
  formSettings: {},
  shareKey: "",
  reportTitle: "",
  reportDescription: "",
  incidentNumberShown: "",
  incidentId: "",
};

type KeyOfFunction = (field: FieldSpec) => string;

// A field's template key, as the server made it from the field's name (A).
const keyOf: KeyOfFunction = (field: FieldSpec): string => {
  return ctx.variableKeys[field.name] || "";
};

type ShareLinkFunction = (shareKey: string) => string;

// Exactly what the dashboard hands out: <ACCOUNTS_URL>/incident-form/<shareKey>.
const shareLinkFor: ShareLinkFunction = (shareKey: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/accounts/incident-form/${shareKey}`)
    .toString();
};

type DashboardUrlFunction = (projectId: string, path: string) => string;

const dashboardUrl: DashboardUrlFunction = (
  projectId: string,
  path: string,
): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}${path}`)
    .toString();
};

type PointFrontendAtTestTargetFunction = (
  target: Page | BrowserContext,
) => Promise<void>;

/*
 * The public page builds its API URL from the HOST and HTTP_PROTOCOL in
 * /accounts/env.js. This points them at the origin this run tests, as
 * registerAndCreateProject does for the signed-in page, so the page's
 * requests stay on the origin it was loaded from. Everything else in env.js
 * is left as the server wrote it. A whole context can be pointed too, for
 * the tabs the dashboard opens itself (Open Form).
 *
 * It does not make a stack whose own HOST differs usable. The public form's
 * routes refuse a browser request whose Origin is not the stack's own
 * HTTP_PROTOCOL + HOST (SameOriginRequest; forms.md, "Requests from other
 * websites"), and the page's submit carries its Origin: from any other
 * origin the form loads, and every report gets 403 "This form can only be
 * used from its own page.", which the page words as a network that is not
 * allowed. So the stack must be configured with the origin this run tests;
 * expectStackToBeConfiguredForThisRun checks that before anything else.
 */
const pointFrontendAtTestTarget: PointFrontendAtTestTargetFunction = async (
  target: Page | BrowserContext,
): Promise<void> => {
  const testTarget: globalThis.URL = new globalThis.URL(BASE_URL.toString());
  const overrides: Record<string, string> = {
    HOST: testTarget.host,
    HTTP_PROTOCOL: testTarget.protocol.replace(":", ""),
  };

  await target.route(
    /\/(?:accounts|dashboard)\/env\.js(?:\?.*)?$/,
    async (route: Route): Promise<void> => {
      const response: APIResponse = await route.fetch();
      const script: string = await response.text();

      await route.fulfill({
        response,
        body: `${script}\nObject.assign(window.process.env, ${JSON.stringify(overrides)});\n`,
      });
    },
  );
};

type OriginOfFunction = (url: string) => string | null;

// The origin a URL names, as a browser writes it in an Origin header.
const originOf: OriginOfFunction = (url: string): string | null => {
  try {
    return new globalThis.URL(url).origin;
  } catch {
    return null;
  }
};

type ExpectStackToBeConfiguredForThisRunFunction = (
  page: Page,
) => Promise<void>;

/*
 * Stops the run, and says why, when the stack is not configured with the
 * origin this run tests. The stack's server compares a browser's Origin
 * with its own HTTP_PROTOCOL + HOST - the values it serves its frontends in
 * /accounts/env.js - so a stack reached at another address (a remapped
 * port, another host name) refuses every report the page sends, and B would
 * fail later with a 403 the page words as "This form can only be opened
 * from an allowed network.", which says nothing of the cause. Read through
 * the page's API client, which no route of pointFrontendAtTestTarget
 * rewrites.
 */
const expectStackToBeConfiguredForThisRun: ExpectStackToBeConfiguredForThisRunFunction =
  async (page: Page): Promise<void> => {
    const envUrl: string = buildUrl("/accounts/env.js");
    const testedOrigin: string | null = originOf(BASE_URL.toString());
    const response: APIResponse = await page.request.get(envUrl);
    const script: string = response.ok() ? await response.text() : "";
    const served: RegExpMatchArray | null = script.match(
      /window\.process\.env = (\{.*\});/,
    );

    /*
     * The stack serves its frontends' environment only under its own host
     * name: it answers any other one as a status page's custom domain, with
     * that page instead of the script.
     */
    if (!served) {
      throw new Error(
        `IncidentForms.spec could not read the stack's HOST and HTTP_PROTOCOL from ${envUrl} (HTTP ${response.status()}, not the frontend environment script). A OneUptime stack serves that script only under its own HOST, and answers any other host name as a status page's domain, so ${testedOrigin} is most likely not the stack's own address. Run the spec with the stack's own HOST and HTTP_PROTOCOL (its config.env values): the public form's routes refuse a browser request from any origin but the stack's own.`,
      );
    }

    const env: Record<string, unknown> = JSON.parse(served[1]!) as Record<
      string,
      unknown
    >;
    const host: string = String(env["HOST"] || "");
    const httpProtocol: string = String(env["HTTP_PROTOCOL"] || "");
    // The server reads any HTTP_PROTOCOL but "https" as plain HTTP.
    const stackOrigin: string | null = originOf(
      `${httpProtocol === "https" ? "https" : "http"}://${host}`,
    );

    if (!stackOrigin || stackOrigin !== testedOrigin) {
      throw new Error(
        `IncidentForms.spec tests ${testedOrigin} (this run's HTTP_PROTOCOL and HOST), but the stack there is configured as ${stackOrigin || "no address"} (HTTP_PROTOCOL=${httpProtocol}, HOST=${host}, as its /accounts/env.js says). The public form's routes refuse a browser request from any origin but the stack's own, so every report would be refused with 403 "${FOREIGN_PAGE_MESSAGE}". Run the spec with the stack's own HOST and HTTP_PROTOCOL, or start the stack with this run's.`,
      );
    }
  };

type ReadShareKeyFunction = (formId: string) => Promise<string>;

const readShareKey: ReadShareKeyFunction = async (
  formId: string,
): Promise<string> => {
  const form: JSONish = await getItem({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/incident-form",
    id: formId,
    select: { _id: true, shareKey: true },
  });

  return toId(form["shareKey"]);
};

type UpdateFormFunction = (data: JSONish) => Promise<void>;

const updateForm: UpdateFormFunction = async (data: JSONish): Promise<void> => {
  await requestJson({
    page: ctx.page,
    projectId: ctx.projectId,
    path: `/api/incident-form/${ctx.formId}`,
    method: "put",
    body: { data },
  });
};

type FieldLabelsFunction = (scope: Locator) => Promise<Array<string>>;

/*
 * The visible field labels inside a form, in order, whitespace collapsed:
 * "Region (Optional)" for an optional field, the bare name for a required one
 * - that suffix is the form's required marker.
 */
const fieldLabels: FieldLabelsFunction = async (
  scope: Locator,
): Promise<Array<string>> => {
  const texts: Array<string> = await scope
    .locator("label:visible")
    .allInnerTexts();

  return texts
    .map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
};

type ReadEmailFunction = (value: unknown) => string;

// An Email column comes back bare or as { _type: "Email", value }.
const readEmail: ReadEmailFunction = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return String((value as JSONish | null)?.["value"] || "");
};

type CardFunction = (page: Page, title: string) => Locator;

// A card on a dashboard page, by its heading.
const card: CardFunction = (page: Page, title: string): Locator => {
  return page.getByTestId("card").filter({
    has: page.getByTestId("card-details-heading").getByText(title, {
      exact: true,
    }),
  });
};

type SettingLabelFunction = (page: Page, field: FieldSpec) => Locator;

/*
 * What a Custom Fields on Create card (a template's) or a Questions card (a
 * form's) says about one field: "Required", "Not Asked", "Default
 * (Optional)"...
 */
const settingLabel: SettingLabelFunction = (
  page: Page,
  field: FieldSpec,
): Locator => {
  return page
    .getByTestId("incident-custom-field-settings-list")
    .getByTestId(`incident-custom-field-setting-${keyOf(field)}`)
    .getByTestId("incident-custom-field-setting-value");
};

type ChooseOptionFunction = (data: {
  page: Page;
  scope: Locator;
  field: RegExp;
  option: string;
}) => Promise<void>;

// Opens a dropdown by its label and picks one of its options by its text.
const chooseOption: ChooseOptionFunction = async (data: {
  page: Page;
  scope: Locator;
  field: RegExp;
  option: string;
}): Promise<void> => {
  await data.scope.getByRole("combobox", { name: data.field }).click();
  await data.page
    .getByRole("option", { name: data.option, exact: true })
    .click();
};

type SaveModalFunction = (page: Page) => Promise<void>;

// Presses the open modal's primary button and waits until it has closed.
const saveModal: SaveModalFunction = async (page: Page): Promise<void> => {
  await page
    .getByTestId("modal")
    .getByTestId("modal-footer-submit-button")
    .click();
  await expect(page.getByTestId("modal")).toHaveCount(0, { timeout: 60000 });
};

type IsOnStepFunction = (form: Locator, title?: string) => Promise<boolean>;

/*
 * Whether a multi-step form shows the step with this title - or, with no
 * title, its last step - read from the form's own progress list, where the
 * step being filled in is marked aria-current. Not from the button's label:
 * in a modal that label follows the step a render later, so on the last
 * step it can still say "Next" - and pressing it then submits the form.
 */
const isOnStep: IsOnStepFunction = async (
  form: Locator,
  title?: string,
): Promise<boolean> => {
  const steps: Locator = form
    .getByRole("navigation", { name: "Progress" })
    .getByRole("listitem");
  const step: Locator = title
    ? steps.filter({ has: form.page().getByText(title, { exact: true }) })
    : steps.last();

  return (await step.locator('[aria-current="step"]').count()) > 0;
};

type StepThroughFunction = (data: {
  form: Locator;
  next: Locator;
  // The step to stop at, by its title; the last step when left out.
  stepTitle?: string | undefined;
}) => Promise<void>;

/*
 * Presses a multi-step form's Next until the step the caller is after
 * shows, waiting after each press for the step to change. Bounded: no form
 * here has ten steps. It never presses the button on the step it stops at,
 * so it never submits; the caller asserts where it ended up.
 */
const stepThrough: StepThroughFunction = async (data: {
  form: Locator;
  next: Locator;
  stepTitle?: string | undefined;
}): Promise<void> => {
  // Without its progress list there is no telling the last step: stop here.
  await expect(
    data.form.getByRole("navigation", { name: "Progress" }),
  ).toBeVisible();

  for (let step: number = 0; step < 10; step++) {
    if (await isOnStep(data.form, data.stepTitle)) {
      return;
    }

    const before: string = await data.form.innerText();
    await data.next.click();
    await expect
      .poll(
        async () => {
          return await data.form.innerText();
        },
        { timeout: 30000 },
      )
      .not.toBe(before);
  }
};

type OpenReporterPageFunction = (url: string) => Promise<void>;

// The reporter opens a link fresh, as someone following it from chat would.
const openReporterPage: OpenReporterPageFunction = async (
  url: string,
): Promise<void> => {
  await ctx.reporter.goto(url, { waitUntil: "domcontentloaded" });
};

type ExpectFormNotAvailableFunction = () => Promise<void>;

const expectFormNotAvailable: ExpectFormNotAvailableFunction =
  async (): Promise<void> => {
    const failure: Locator = ctx.reporter.getByTestId(
      "incident-form-load-failure",
    );

    await expect(failure).toBeVisible({ timeout: 60000 });
    await expect(failure).toContainText(NOT_AVAILABLE_MESSAGE);
    // No form behind the message: no heading, no questions, no Submit.
    await expect(
      ctx.reporter.getByRole("heading", { level: 1, name: ctx.formName }),
    ).toHaveCount(0);
    await expect(ctx.reporter.getByTestId("incident-form-title")).toHaveCount(
      0,
    );
  };

type ExpectFormShownFunction = () => Promise<void>;

const expectFormShown: ExpectFormShownFunction = async (): Promise<void> => {
  await expect(
    ctx.reporter.getByRole("heading", { level: 1, name: ctx.formName }),
  ).toBeVisible({ timeout: 60000 });
  await expect(ctx.reporter.getByTestId("incident-form-title")).toBeVisible();
  await expect(
    ctx.reporter.getByTestId("incident-form-load-failure"),
  ).toHaveCount(0);
};

type SubmitReportFunction = (data: {
  reporter: Page;
  shareKey: string;
}) => Promise<JSONish>;

/*
 * Presses Submit on a filled-in public form, waits for the server's answer
 * and the thank-you card, and returns what the server said.
 */
const submitReport: SubmitReportFunction = async (data: {
  reporter: Page;
  shareKey: string;
}): Promise<JSONish> => {
  const responsePromise: Promise<Response> = data.reporter.waitForResponse(
    (response: Response): boolean => {
      return (
        response
          .url()
          .includes(`/incident-form/public/${data.shareKey}/submit`) &&
        response.request().method() === "POST"
      );
    },
    { timeout: 120000 },
  );
  await data.reporter.locator("#incident-form-submit-button").click();
  const response: Response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);

  const success: Locator = data.reporter.getByTestId("incident-form-success");
  await expect(success).toBeVisible({ timeout: 60000 });
  await expect(success).toContainText(SUCCESS_HEADING);

  return (await response.json()) as JSONish;
};

type FindIncidentByTitleFunction = (title: string) => Promise<JSONish>;

// The one incident with this (run-unique) title.
const findIncidentByTitle: FindIncidentByTitleFunction = async (
  title: string,
): Promise<JSONish> => {
  const incidents: Array<JSONish> = await listItems({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/incident",
    query: { title },
    select: { _id: true },
  });
  expect(incidents, `exactly one incident titled "${title}"`).toHaveLength(1);

  return getItem({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/incident",
    id: toId(incidents[0]!["_id"]),
    select: {
      _id: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      customFields: true,
      isVisibleOnStatusPage: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      isPrivate: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      createdByUserId: true,
      labels: { _id: true, name: true },
    },
  });
};

type ReadNotesFunction = (incidentId: string) => Promise<Array<string>>;

// The incident's private (internal) notes, as written.
const readInternalNotes: ReadNotesFunction = async (
  incidentId: string,
): Promise<Array<string>> => {
  const notes: Array<JSONish> = await listItems({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/incident-internal-note",
    query: { incidentId },
    select: { _id: true, note: true },
  });

  return notes.map((row: JSONish): string => {
    return String(row["note"] || "");
  });
};

interface IncidentOwners {
  userIds: Array<string>;
  teamIds: Array<string>;
}

type WaitForOwnersFunction = (data: {
  incidentId: string;
  description: string;
}) => Promise<IncidentOwners>;

/*
 * The incident's owner users and teams, once both are there. Owners are
 * added after the incident is created, so this polls.
 */
const waitForOwners: WaitForOwnersFunction = async (data: {
  incidentId: string;
  description: string;
}): Promise<IncidentOwners> => {
  return pollUntil<IncidentOwners>({
    page: ctx.page,
    description: data.description,
    timeoutMs: 60000,
    check: async (): Promise<IncidentOwners | null> => {
      const users: Array<JSONish> = await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/incident-owner-user",
        query: { incidentId: data.incidentId },
        select: { _id: true, userId: true },
      });
      const teams: Array<JSONish> = await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/incident-owner-team",
        query: { incidentId: data.incidentId },
        select: { _id: true, teamId: true },
      });

      if (users.length === 0 || teams.length === 0) {
        return null;
      }

      return {
        userIds: users.map((row: JSONish): string => {
          return toId(row["userId"]);
        }),
        teamIds: teams.map((row: JSONish): string => {
          return toId(row["teamId"]);
        }),
      };
    },
  });
};

type OpenFormViewPageFunction = (formId?: string | undefined) => Promise<void>;

// A form's own page: Incidents > Settings > Forms > the form.
const openFormViewPage: OpenFormViewPageFunction = async (
  formId?: string | undefined,
): Promise<void> => {
  await gotoProjectPage({
    page: ctx.page,
    projectId: ctx.projectId,
    url: dashboardUrl(
      ctx.projectId,
      `/incidents/settings/forms/${formId || ctx.formId}`,
    ),
    ready: ctx.page.getByTestId("incident-form-share-link"),
  });
};

test.describe("Incident forms", () => {
  /*
   * One story, told in order: each test builds on what the one before it
   * left. Retried once at most - see the anti-flake notes at the top.
   */
  test.describe.configure({ mode: "serial", retries: 1 });

  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour and one set of pages, one engine is enough");

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(360000);

    ctx.page = await browser.newPage();

    // First: on a stack configured for another origin every report is refused.
    await expectStackToBeConfiguredForThisRun(ctx.page);

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "Incident Forms E2E",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });
    ctx.user = await getSessionUser({ page: ctx.page });

    // Open Form opens the public page in a new tab of this same context.
    await pointFrontendAtTestTarget(ctx.page.context());

    // Letters and digits only: the private note escapes Markdown characters.
    ctx.unique = `${Date.now().toString(36)}${Math.floor(
      Math.random() * 1e6,
    ).toString(36)}`;
    ctx.formName = `Customer Problem Report ${ctx.unique}`;
    ctx.templateName = `Customer Report Template ${ctx.unique}`;
    ctx.labelName = `Reported by customers ${ctx.unique}`;
    ctx.teamName = "Admin";
    ctx.reportTitle = `Checkout is down ${ctx.unique}`;
    ctx.reportDescription = `Every payment fails with an error page ${ctx.unique}`;
  });

  test.afterAll(async () => {
    await ctx.reporterContext?.close();
    await ctx.page?.close();
  });

  test("A. an admin sets up custom fields, a template and a form", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    /*
     * Severities are seeded after the project is created. The form declares
     * with one of them and the reporter picks another, so the incident's
     * severity shows whose choice won.
     */
    const severities: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page,
      description: "the project's incident severities to be seeded",
      timeoutMs: 120000,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId: ctx.projectId,
          path: "/api/incident-severity",
          select: { _id: true, name: true, order: true },
        });

        return rows.length >= 2 ? rows : null;
      },
    });

    ctx.formSeverityId = toId(severities[0]!["_id"]);
    ctx.formSeverityName = String(severities[0]!["name"]);
    ctx.reporterSeverityId = toId(severities[1]!["_id"]);
    ctx.reporterSeverityName = String(severities[1]!["name"]);

    for (const field of Object.values(FIELDS)) {
      await createItem({
        page,
        projectId: ctx.projectId,
        path: "/api/incident-custom-field",
        item: {
          projectId: ctx.projectId,
          name: field.name,
          description: `${field.name} of the reported problem`,
          customFieldType: field.customFieldType,
          dropdownOptions: field.dropdownOptions,
          sortOrder: field.sortOrder,
          showOnCreate: field.showOnCreate,
          isRequiredOnCreate: field.isRequiredOnCreate,
        },
      });
    }

    /*
     * The settings are keyed by each field's template key, which the server
     * makes from the name - read them back rather than guess the spelling.
     */
    const fieldRows: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-custom-field",
      select: { _id: true, name: true, variableKey: true },
    });

    for (const field of Object.values(FIELDS)) {
      const row: JSONish | undefined = fieldRows.find((candidate: JSONish) => {
        return candidate["name"] === field.name;
      });
      const variableKey: string = String(row?.["variableKey"] || "");

      expect(
        variableKey,
        `the server should give "${field.name}" a template key`,
      ).not.toBe("");
      ctx.variableKeys[field.name] = variableKey;
    }

    const label: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/label",
      item: {
        projectId: ctx.projectId,
        name: ctx.labelName,
        color: { _type: "Color", value: "#6366f1" },
      },
    });
    ctx.labelId = toId(label["_id"]);
    expect(ctx.labelId, "the label should have been created").not.toBe("");

    /*
     * A team to own the template's incidents next to the admin. The admin
     * alone would prove little on the dashboard's Declare Incident page (E2):
     * whoever declares an incident there becomes one of its owners anyway.
     * The team gets there only as the template's owner.
     *
     * Every project starts with an Admin team, which the admin who created
     * the project is not in. It is used instead of a new team because
     * creating a team needs the Scale plan on a billing install, and this
     * project is on Growth.
     */
    const teams: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/team",
      select: { _id: true, name: true },
    });
    const adminTeams: Array<JSONish> = teams.filter((team: JSONish) => {
      return team["name"] === ctx.teamName;
    });

    expect(
      adminTeams,
      `every project should start with one "${ctx.teamName}" team`,
    ).toHaveLength(1);
    ctx.teamId = toId(adminTeams[0]!["_id"]);
    expect(ctx.teamId, "the Admin team should have an id").not.toBe("");

    /*
     * The template's Custom Fields on Create (TEMPLATE semantics): Impact
     * Required and Customer Facing Optional although the project does not
     * show either on create; Internal Reference Hidden although the project
     * requires it; Region, Affected Users and Target Date left on Default.
     */
    ctx.templateSettings = {
      [keyOf(FIELDS.impact)]: "Required",
      [keyOf(FIELDS.customerFacing)]: "Optional",
      [keyOf(FIELDS.internalReference)]: "Hidden",
    };

    const template: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      item: {
        projectId: ctx.projectId,
        templateName: ctx.templateName,
        templateDescription: "Declared for problems customers report.",
        title: TEMPLATE_TITLE,
        description: TEMPLATE_DESCRIPTION,
        incidentSeverityId: ctx.formSeverityId,
        isScopedToStatusPages: false,
        labels: [{ _id: ctx.labelId }],
        customFields: {
          [FIELDS.region.name]: TEMPLATE_REGION,
          [FIELDS.internalReference.name]: TEMPLATE_INTERNAL_REFERENCE,
        },
        customFieldSettings: ctx.templateSettings,
      },
    });
    ctx.templateId = toId(template["_id"]);
    expect(ctx.templateId, "the template should have been created").not.toBe(
      "",
    );

    // The template's owners own what it declares: the admin and the team.
    await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-template-owner-user",
      item: {
        projectId: ctx.projectId,
        incidentTemplateId: ctx.templateId,
        userId: ctx.user.userId,
      },
    });
    await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-template-owner-team",
      item: {
        projectId: ctx.projectId,
        incidentTemplateId: ctx.templateId,
        teamId: ctx.teamId,
      },
    });

    const storedTemplate: JSONish = await getItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      id: ctx.templateId,
      select: {
        _id: true,
        customFieldSettings: true,
        labels: { _id: true },
      },
    });

    // Stored exactly as sent: nothing rewritten, nothing dropped.
    expect(storedTemplate["customFieldSettings"]).toEqual(ctx.templateSettings);
    expect(
      ((storedTemplate["labels"] as Array<JSONish>) || []).map(
        (row: JSONish) => {
          return toId(row["_id"]);
        },
      ),
    ).toEqual([ctx.labelId]);

    /*
     * The form's questions (FORM semantics): only Required and Optional
     * fields are asked. Internal Reference is left out on purpose - a public
     * form must never show a field the admin did not add.
     */
    ctx.formSettings = {
      [keyOf(FIELDS.impact)]: "Required",
      [keyOf(FIELDS.region)]: "Optional",
      [keyOf(FIELDS.customerFacing)]: "Optional",
      [keyOf(FIELDS.affectedUsers)]: "Optional",
      [keyOf(FIELDS.targetDate)]: "Optional",
    };

    const form: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form",
      item: {
        projectId: ctx.projectId,
        name: ctx.formName,
        description:
          "Tell us what is broken. **Our on-call team reads every report.**",
        incidentSeverityId: ctx.formSeverityId,
        allowReporterToChooseSeverity: true,
        incidentTemplateId: ctx.templateId,
        descriptionSetting: "Required",
        customFieldSettings: ctx.formSettings,
        isReporterDetailsRequired: true,
        successMessage: "Thanks for telling us. **We are on it.**",
        // A key the client picks must never be kept: the server mints one.
        shareKey: "11111111-1111-4111-8111-111111111111",
      },
    });
    ctx.formId = toId(form["_id"]);
    expect(ctx.formId, "the form should have been created").not.toBe("");

    const storedForm: JSONish = await getItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form",
      id: ctx.formId,
      select: {
        _id: true,
        shareKey: true,
        isEnabled: true,
        customFieldSettings: true,
        descriptionSetting: true,
      },
    });

    ctx.shareKey = toId(storedForm["shareKey"]);
    expect(ctx.shareKey).toMatch(UUID_PATTERN);
    expect(ctx.shareKey).not.toBe("11111111-1111-4111-8111-111111111111");
    // A new form takes reports straight away.
    expect(storedForm["isEnabled"]).toBe(true);
    expect(storedForm["descriptionSetting"]).toBe("Required");
    expect(storedForm["customFieldSettings"]).toEqual(ctx.formSettings);
  });

  test("B. an anonymous reporter answers exactly the form's questions and submits", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(240000);

    // A context of its own: none of the admin's cookies, no session at all.
    ctx.reporterContext = await browser.newContext();
    expect(await ctx.reporterContext.cookies()).toEqual([]);
    ctx.reporter = await ctx.reporterContext.newPage();
    await pointFrontendAtTestTarget(ctx.reporter);

    const reporter: Page = ctx.reporter;
    const submitRequests: Array<string> = [];
    reporter.on("request", (request: Request): void => {
      if (
        request.url().includes("/incident-form/public/") &&
        request.method() === "POST"
      ) {
        submitRequests.push(request.url());
      }
    });

    const formResponsePromise: Promise<Response> = reporter.waitForResponse(
      (response: Response): boolean => {
        return (
          response.url().endsWith(`/incident-form/public/${ctx.shareKey}`) &&
          response.request().method() === "GET"
        );
      },
      { timeout: 60000 },
    );
    await openReporterPage(shareLinkFor(ctx.shareKey));
    const formResponse: Response = await formResponsePromise;
    expect(formResponse.status(), await formResponse.text()).toBe(200);
    // The page reads the form with its own header, which the read route requires.
    expect((await formResponse.request().allHeaders())[FORM_PAGE_HEADER]).toBe(
      FORM_PAGE_HEADER_VALUE,
    );
    const publicForm: JSONish = (await formResponse.json()) as JSONish;

    expect(
      publicForm["isCaptchaRequired"],
      "this spec cannot solve hCaptcha: run it against a stack with CAPTCHA_ENABLED=false",
    ).toBe(false);

    /*
     * What the page is told is a hand-built subset: the asked fields and
     * nothing else - not the field the form leaves out, not the form's,
     * project's or template's ids, not the success message before a report.
     */
    expect(
      ((publicForm["customFields"] as Array<JSONish>) || []).map(
        (field: JSONish) => {
          return field["name"];
        },
      ),
    ).toEqual([
      FIELDS.impact.name,
      FIELDS.region.name,
      FIELDS.customerFacing.name,
      FIELDS.affectedUsers.name,
      FIELDS.targetDate.name,
    ]);
    const publicFormText: string = JSON.stringify(publicForm);
    for (const secret of [
      FIELDS.internalReference.name,
      TEMPLATE_INTERNAL_REFERENCE,
      ctx.projectId,
      ctx.formId,
      ctx.templateId,
      ctx.shareKey,
      "We are on it.",
    ]) {
      expect(publicFormText).not.toContain(secret);
    }

    await expectFormShown();

    // The tab is named after the form, and its description is on top.
    await expect(reporter).toHaveTitle(ctx.formName);
    await expect(reporter.getByTestId("incident-form-about")).toContainText(
      "Our on-call team reads every report.",
    );

    /*
     * Exactly the configured questions, in order, with the required marker
     * where the form requires an answer: optional ones read "(Optional)".
     * Internal Reference is not among them, and must not appear anywhere on
     * the page - not as a field, not as a hidden option.
     */
    const form: Locator = reporter.locator("#incident-form");
    await expect
      .poll(
        async () => {
          return await fieldLabels(form);
        },
        { timeout: 30000 },
      )
      .toEqual([
        "Title",
        "Description",
        "Severity (Optional)",
        FIELDS.impact.name,
        `${FIELDS.region.name} (Optional)`,
        `${FIELDS.customerFacing.name} (Optional)`,
        `${FIELDS.affectedUsers.name} (Optional)`,
        `${FIELDS.targetDate.name} (Optional)`,
        "Your Name",
        "Your Email",
      ]);
    await expect(reporter.getByText(FIELDS.internalReference.name)).toHaveCount(
      0,
    );
    expect(await reporter.content()).not.toContain(TEMPLATE_INTERNAL_REFERENCE);

    /*
     * The description editor has its toolbar, but no image upload: an
     * upload needs a signed-in user, and a reporter may be nobody.
     */
    const descriptionEditor: Locator = reporter.getByTestId(
      "incident-form-description",
    );
    await expect(
      descriptionEditor.getByRole("button", { name: "Link", exact: true }),
    ).toBeVisible();
    await expect(
      descriptionEditor.getByRole("button", { name: "Image", exact: true }),
    ).toHaveCount(0);

    // The form's own severity is preselected; the reporter may change it.
    await expect(form).toContainText(ctx.formSeverityName);

    /*
     * The browser refuses an empty report on its own: every required
     * question says so, and nothing is sent.
     */
    const submit: Locator = reporter.locator("#incident-form-submit-button");
    await submit.click();
    await expect(form.getByText("Title is required.")).toBeVisible();
    await expect(form.getByText("Description is required.")).toBeVisible();
    await expect(
      form.getByText(`${FIELDS.impact.name} is required.`),
    ).toBeVisible();
    await expect(form.getByText("Your Name is required.")).toBeVisible();
    await expect(form.getByText("Your Email is required.")).toBeVisible();
    // Optional questions do not complain.
    await expect(
      form.getByText(`${FIELDS.region.name} is required.`),
    ).toHaveCount(0);
    expect(submitRequests, "an invalid report must not be sent").toEqual([]);

    /*
     * A title of nothing but spaces is refused in the browser too (the
     * server trims every answer), and so is an address that is not one.
     */
    const title: Locator = reporter.getByTestId("incident-form-title");
    await title.fill("Checkout");
    await title.press("Tab");
    await expect(form.getByText("Title is required.")).toHaveCount(0);
    await title.fill("   ");
    await title.press("Tab");
    await expect(form.getByText("Title is required.")).toBeVisible();

    const email: Locator = reporter.getByTestId("incident-form-reporter-email");
    await email.fill("not-an-email");
    await email.press("Tab");
    await expect(form.getByText("Email is not valid.")).toBeVisible();
    expect(submitRequests, "an invalid report must not be sent").toEqual([]);

    // Now a real report.
    await title.fill(ctx.reportTitle);
    await descriptionEditor.getByRole("textbox").fill(ctx.reportDescription);

    await chooseOption({
      page: reporter,
      scope: form,
      field: /^Severity/,
      option: ctx.reporterSeverityName,
    });

    await reporter
      .getByLabel(FIELDS.impact.name, { exact: true })
      .fill(REPORT_IMPACT);

    await chooseOption({
      page: reporter,
      scope: form,
      field: new RegExp(`^${FIELDS.region.name}`),
      option: REPORT_REGION,
    });

    const customerFacing: Locator = reporter.getByRole("switch", {
      name: new RegExp(`^${FIELDS.customerFacing.name}`),
    });
    await customerFacing.click();
    await expect(customerFacing).toHaveAttribute("aria-checked", "true");

    await reporter
      .getByLabel(new RegExp(`^${FIELDS.affectedUsers.name}`))
      .fill(String(REPORT_AFFECTED_USERS));
    await reporter
      .getByLabel(new RegExp(`^${FIELDS.targetDate.name}`))
      .fill(REPORT_TARGET_DATE);

    await reporter
      .getByTestId("incident-form-reporter-name")
      .fill(REPORTER_NAME);
    await email.fill(REPORTER_EMAIL);
    /*
     * Leave the last field before pressing Submit, and let the form settle:
     * a field that re-validates on blur moves the button between the
     * pointer's press and its release otherwise.
     */
    await email.press("Tab");
    await expect(form.getByTestId("error-message")).toHaveCount(0);
    await expect(form.getByText(/is required\.$/)).toHaveCount(0);

    const result: JSONish = await submitReport({
      reporter,
      shareKey: ctx.shareKey,
    });

    // The thank-you card: the incident's number and the success message.
    ctx.incidentNumberShown = String(result["incidentNumber"] || "");
    expect(ctx.incidentNumberShown).toMatch(/^(?:#\d+|\S+-?\d+)$/);
    await expect(
      reporter.getByTestId("incident-form-incident-number"),
    ).toHaveText(`Your report is incident ${ctx.incidentNumberShown}.`);
    await expect(
      reporter.getByTestId("incident-form-success-message"),
    ).toContainText("We are on it.");
    // The form is gone: a second click cannot send the report twice.
    await expect(submit).toHaveCount(0);
    expect(submitRequests).toHaveLength(1);
  });

  test("C. the submission declared the incident the form describes", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    const incident: JSONish = await findIncidentByTitle(ctx.reportTitle);
    ctx.incidentId = toId(incident["_id"]);

    expect(String(incident["description"] || "")).toContain(
      ctx.reportDescription,
    );
    // The reporter's choice beat the form's own severity.
    expect(toId(incident["incidentSeverityId"])).toBe(ctx.reporterSeverityId);

    // The number the reporter was shown is this incident's.
    const expectedNumber: string =
      String(incident["incidentNumberWithPrefix"] || "") ||
      `#${incident["incidentNumber"]}`;
    expect(ctx.incidentNumberShown).toBe(expectedNumber);

    /*
     * The answers, keyed by field name, over the template's values: the
     * reporter's Region wins over the template's, and Internal Reference -
     * never asked - comes from the template.
     */
    const customFields: JSONish = (incident["customFields"] as JSONish) || {};
    expect(customFields[FIELDS.impact.name]).toBe(REPORT_IMPACT);
    expect(customFields[FIELDS.region.name]).toBe(REPORT_REGION);
    expect(customFields[FIELDS.customerFacing.name]).toBe(true);
    expect(Number(customFields[FIELDS.affectedUsers.name])).toBe(
      REPORT_AFFECTED_USERS,
    );
    expect(String(customFields[FIELDS.targetDate.name])).toContain(
      REPORT_TARGET_DATE,
    );
    expect(customFields[FIELDS.internalReference.name]).toBe(
      TEMPLATE_INTERNAL_REFERENCE,
    );

    /*
     * A stranger's report stays off every status page until responders have
     * looked at it - but it is not private, and no user declared it.
     */
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect(
      incident["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
    ).toBe(false);
    expect(incident["isPrivate"]).not.toBe(true);
    expect(toId(incident["createdByUserId"])).toBe("");

    // Everything the template sets applies: its label...
    expect(
      ((incident["labels"] as Array<JSONish>) || []).map((row: JSONish) => {
        return toId(row["_id"]);
      }),
    ).toContain(ctx.labelId);

    // ...and its owners - the admin and the team - become the incident's.
    const owners: IncidentOwners = await waitForOwners({
      incidentId: ctx.incidentId,
      description:
        "the template's owner user and team on the reported incident",
    });
    expect(owners.userIds).toEqual([ctx.user.userId]);
    expect(owners.teamIds).toEqual([ctx.teamId]);

    /*
     * Who reported it, where only the responders read it. The address is an
     * autolink, so the owners' "note posted" email and Slack link all of it.
     */
    expect(await readInternalNotes(ctx.incidentId)).toContain(
      `Reported through the incident form **${ctx.formName}** by ${REPORTER_NAME} (<${REPORTER_EMAIL}>).`,
    );

    // And the row the form's Submissions table lists.
    const submissions: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form-submission",
      query: { incidentFormId: ctx.formId },
      select: {
        _id: true,
        reporterName: true,
        reporterEmail: true,
        incidentId: true,
        incidentFormId: true,
      },
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!["reporterName"]).toBe(REPORTER_NAME);
    expect(readEmail(submissions[0]!["reporterEmail"])).toBe(REPORTER_EMAIL);
    expect(toId(submissions[0]!["incidentId"])).toBe(ctx.incidentId);
  });

  test("C2. the submit route takes the form's questions and nothing else, whatever a caller sends", async () => {
    test.setTimeout(120000);

    /*
     * Straight to the API, around the page, from the reporter's context -
     * still no session. Everything the form requires is answered.
     */
    const submitUrl: string = buildUrl(
      `/api/incident-form/public/${ctx.shareKey}/submit`,
    );
    const headers: Record<string, string> = {
      "content-type": "application/json",
      tenantid: "",
    };
    const smuggledTitle: string = `Sent around the page ${ctx.unique}`;
    const answers: JSONish = {
      title: smuggledTitle,
      description: "Sent straight to the API, with keys no question asks for.",
      reporterName: "Mallory Direct",
      reporterEmail: "mallory.direct@example.com",
    };
    const smuggledImpact: string = "Smuggled past the page";

    /*
     * A severity the form does not list and a Region that is not one of its
     * options are refused, with the reasons, and declare nothing...
     */
    const refused: APIResponse = await ctx.reporter.request.post(submitUrl, {
      headers,
      data: {
        data: {
          ...answers,
          incidentSeverityId: "00000000-0000-4000-8000-000000000000",
          customFields: {
            [FIELDS.impact.name]: smuggledImpact,
            [FIELDS.region.name]: "Mars",
          },
        },
      },
    });
    expect(refused.status()).toBe(400);
    const refusal: string = await refused.text();
    expect(refusal).toContain(
      "Severity must be one of the severities this form lists.",
    );
    expect(refusal).toContain("is not one of the options for");
    expect(
      await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/incident",
        query: { title: smuggledTitle },
        select: { _id: true },
      }),
    ).toHaveLength(0);

    /*
     * ...while an answer to a question the form does not ask, and incident
     * columns no question sets, are dropped without a word: the incident is
     * declared in the form's project, exactly as the page would have had it.
     */
    const accepted: APIResponse = await ctx.reporter.request.post(submitUrl, {
      headers,
      data: {
        data: {
          ...answers,
          customFields: {
            [FIELDS.impact.name]: smuggledImpact,
            [FIELDS.internalReference.name]: "Chosen by the caller",
          },
          projectId: "00000000-0000-4000-8000-000000000001",
          isVisibleOnStatusPage: true,
          isPrivate: true,
          createdByUserId: ctx.user.userId,
          labels: [],
        },
      },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);

    const incident: JSONish = await findIncidentByTitle(smuggledTitle);
    const customFields: JSONish = (incident["customFields"] as JSONish) || {};
    expect(customFields[FIELDS.impact.name]).toBe(smuggledImpact);
    expect(customFields[FIELDS.internalReference.name]).toBe(
      TEMPLATE_INTERNAL_REFERENCE,
    );
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect(incident["isPrivate"]).not.toBe(true);
    expect(toId(incident["createdByUserId"])).toBe("");
    expect(
      ((incident["labels"] as Array<JSONish>) || []).map((row: JSONish) => {
        return toId(row["_id"]);
      }),
    ).toContain(ctx.labelId);
  });

  test("C3. the read route answers only a request carrying the form page's header", async () => {
    test.setTimeout(120000);

    /*
     * What another site's <img> or link makes a browser send over plain
     * HTTP: a GET with no header of a page's own. Refused before anything
     * counts it, with the answer every foreign page gets.
     */
    const readUrl: string = buildUrl(
      `/api/incident-form/public/${ctx.shareKey}`,
    );
    const refused: APIResponse = await ctx.reporter.request.get(readUrl);
    expect(refused.status(), await refused.text()).toBe(403);
    expect(await refused.text()).toContain(FOREIGN_PAGE_MESSAGE);

    // A caller going around the page that sends what the page sends is answered.
    const answered: APIResponse = await ctx.reporter.request.get(readUrl, {
      headers: { [FORM_PAGE_HEADER]: FORM_PAGE_HEADER_VALUE },
    });
    expect(answered.status(), await answered.text()).toBe(200);
    expect(((await answered.json()) as JSONish)["name"]).toBe(ctx.formName);
  });

  test("D1. the Forms page lists the form, and its Submissions lead to the incident", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    // Incidents > Settings > Forms, through the side menu.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/incidents/settings/templates"),
      ready: page.getByRole("link", { name: "Forms", exact: true }),
    });
    await page.getByRole("link", { name: "Forms", exact: true }).click();
    await expect(page).toHaveURL(/\/incidents\/settings\/forms$/, {
      timeout: 60000,
    });

    const formRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.formName });
    await expect(formRow).toBeVisible({ timeout: 60000 });
    await formRow
      .getByRole("button", { name: "View Incident Form", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/incidents/settings/forms/${ctx.formId}$`),
      { timeout: 60000 },
    );

    /*
     * The link on the Share Link card is the one the reporter used, and Open
     * Form opens exactly that, in a new tab.
     */
    await expect(page.getByTestId("incident-form-share-link")).toHaveText(
      shareLinkFor(ctx.shareKey),
      { timeout: 60000 },
    );
    const openForm: Locator = page.locator("#incident-form-open-form");
    await expect(openForm).toHaveAttribute("href", shareLinkFor(ctx.shareKey));
    await expect(openForm).toHaveAttribute("target", "_blank");
    await expect(
      page.getByTestId("incident-form-share-link-turned-off"),
    ).toHaveCount(0);

    // The Questions card says what the reporter was asked, field by field.
    const expectedQuestions: Array<[FieldSpec, string]> = [
      [FIELDS.impact, "Required"],
      [FIELDS.region, "Optional"],
      [FIELDS.customerFacing, "Optional"],
      [FIELDS.affectedUsers, "Optional"],
      [FIELDS.targetDate, "Optional"],
      [FIELDS.internalReference, "Not Asked"],
    ];
    for (const [field, setting] of expectedQuestions) {
      await expect(settingLabel(page, field)).toHaveText(setting, {
        timeout: 60000,
      });
    }

    // The report is in Submissions, with who sent it and its incident.
    const submissionRow: Locator = page
      .getByRole("row")
      .filter({ hasText: REPORTER_EMAIL });
    await expect(submissionRow).toBeVisible({ timeout: 60000 });
    await expect(submissionRow).toContainText(REPORTER_NAME);
    await expect(
      submissionRow.getByRole("link", { name: ctx.incidentNumberShown }),
    ).toBeVisible();

    await submissionRow
      .getByRole("button", { name: "View Incident", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${ctx.projectId}/incidents/${ctx.incidentId}`),
      { timeout: 60000 },
    );
    await expect(page.getByText(ctx.reportTitle).first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("D2. Reset Link retires the old link at once, and the new one works", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    const oldShareKey: string = ctx.shareKey;

    await openFormViewPage();
    await expect(page.getByTestId("incident-form-share-link")).toHaveText(
      shareLinkFor(oldShareKey),
    );

    await page.getByRole("button", { name: "Reset Link", exact: true }).click();
    const confirm: Locator = page.getByTestId("modal");
    await expect(confirm).toContainText(
      "the current one stops working at once",
    );
    await confirm.getByTestId("modal-footer-submit-button").click();

    // The result says what happened; closing it shows the new link.
    await expect(page.getByTestId("modal")).toContainText(
      "The old link no longer works.",
      { timeout: 60000 },
    );
    await saveModal(page);

    await expect
      .poll(
        async () => {
          return await readShareKey(ctx.formId);
        },
        { timeout: 30000 },
      )
      .not.toBe(oldShareKey);
    ctx.shareKey = await readShareKey(ctx.formId);
    expect(ctx.shareKey).toMatch(UUID_PATTERN);
    await expect(page.getByTestId("incident-form-share-link")).toHaveText(
      shareLinkFor(ctx.shareKey),
    );

    // The reporter's old link: the one "not available" answer.
    await openReporterPage(shareLinkFor(oldShareKey));
    await expectFormNotAvailable();

    // The new link opens the form.
    await openReporterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
  });

  test("D3. turning the form off takes its link down until it is on again", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await openFormViewPage();

    const formDetails: Locator = card(page, "Form Details");
    await formDetails
      .getByRole("button", { name: "Edit Form Details", exact: true })
      .click();
    const enabled: Locator = page
      .getByTestId("modal")
      .getByRole("switch", { name: /^Enabled/ });
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    await enabled.click();
    await expect(enabled).toHaveAttribute("aria-checked", "false");
    await saveModal(page);

    // The Share Link card says what a reporter now sees.
    await expect(
      page.getByTestId("incident-form-share-link-turned-off"),
    ).toContainText(
      "This form is turned off, so its link shows a 'not available' message.",
      { timeout: 60000 },
    );

    await openReporterPage(shareLinkFor(ctx.shareKey));
    await expectFormNotAvailable();

    // And back on: the same link works again.
    await formDetails
      .getByRole("button", { name: "Edit Form Details", exact: true })
      .click();
    await expect(enabled).toHaveAttribute("aria-checked", "false");
    await enabled.click();
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    await saveModal(page);
    await expect(
      page.getByTestId("incident-form-share-link-turned-off"),
    ).toHaveCount(0, { timeout: 60000 });

    await openReporterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
  });

  test("D4. an IP allowlist that leaves this network out shuts the form to it", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await openFormViewPage();

    const access: Locator = card(page, "Access");
    await access
      .getByRole("button", { name: "Edit IP Allowlist", exact: true })
      .click();
    const modal: Locator = page.getByTestId("modal");
    await modal
      .getByRole("textbox", { name: /^IP Allowlist/ })
      .fill(ALLOWLIST_THAT_EXCLUDES_US);
    await modal.getByTestId("modal-footer-submit-button").click();

    /*
     * Changing the allowlist needs the Scale plan (as a public dashboard's
     * does). On a billing install this project is on Growth, so the save is
     * refused - which is the plan gate working, not this feature failing.
     * Wait for either outcome: the modal closing, or its refusal.
     */
    await expect
      .poll(
        async (): Promise<string> => {
          if ((await page.getByTestId("modal").count()) === 0) {
            return "saved";
          }

          return (await modal.getByRole("alert").count()) > 0
            ? "refused"
            : "pending";
        },
        { timeout: 60000 },
      )
      .not.toBe("pending");

    if ((await page.getByTestId("modal").count()) > 0) {
      const refusal: string = (await modal.innerText()).replace(/\s+/g, " ");
      expect(
        IS_BILLING_ENABLED,
        `Saving the IP allowlist failed on an install without billing: ${refusal}`,
      ).toBe(true);
      test.info().annotations.push({
        type: "skipped-check",
        description: `IP allowlist not saved on this billing install (the project is on Growth): ${refusal}`,
      });
      await modal.getByTestId("modal-footer-close-button").click();
      await expect(page.getByTestId("modal")).toHaveCount(0);
      test.skip(true, "Editing the IP allowlist needs the Scale plan here.");
      return;
    }

    await expect(access.getByTestId("incident-form-ip-allowlist")).toHaveText(
      ALLOWLIST_THAT_EXCLUDES_US,
    );

    // The reporter's network is not on the list: a clear message, no form.
    await openReporterPage(shareLinkFor(ctx.shareKey));
    const failure: Locator = ctx.reporter.getByTestId(
      "incident-form-load-failure",
    );
    await expect(failure).toBeVisible({ timeout: 60000 });
    await expect(failure).toContainText(NETWORK_NOT_ALLOWED_MESSAGE);
    await expect(ctx.reporter.getByTestId("incident-form-title")).toHaveCount(
      0,
    );

    // The submit route refuses too, whatever the page does.
    const refused: APIResponse = await ctx.reporter.request.post(
      buildUrl(`/api/incident-form/public/${ctx.shareKey}/submit`),
      {
        headers: { "content-type": "application/json", tenantid: "" },
        data: { data: { title: "Sent around the page" } },
      },
    );
    expect(refused.status()).toBe(403);

    // Open again for everyone.
    await updateForm({ ipWhitelist: "" });
    await openReporterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
  });

  test("D5. the Questions and Form Settings cards decide what the next reporter is asked", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await openFormViewPage();

    /*
     * Questions: stop asking Target Date, and start asking Internal
     * Reference - required - which no reporter has seen so far.
     */
    await card(page, "Questions")
      .getByRole("button", { name: "Edit Questions", exact: true })
      .click();
    const questions: Locator = page.getByTestId("modal");
    await chooseOption({
      page,
      scope: questions,
      field: new RegExp(`^${FIELDS.targetDate.name}`),
      option: "Not Asked",
    });
    await chooseOption({
      page,
      scope: questions,
      field: new RegExp(`^${FIELDS.internalReference.name}`),
      option: "Required",
    });
    await saveModal(page);
    await expect(settingLabel(page, FIELDS.targetDate)).toHaveText("Not Asked");
    await expect(settingLabel(page, FIELDS.internalReference)).toHaveText(
      "Required",
    );

    // Form Settings: no description question, and no name or email needed.
    await card(page, "Form Settings")
      .getByRole("button", { name: "Edit Form Settings", exact: true })
      .click();
    const settings: Locator = page.getByTestId("modal");
    await chooseOption({
      page,
      scope: settings,
      field: /^Description Question/,
      option: "Hidden",
    });
    const requireDetails: Locator = settings.getByRole("switch", {
      name: /^Require Reporter Details/,
    });
    await expect(requireDetails).toHaveAttribute("aria-checked", "true");
    await requireDetails.click();
    await expect(requireDetails).toHaveAttribute("aria-checked", "false");
    await saveModal(page);
    await expect(
      page.getByTestId("incident-form-description-setting"),
    ).toHaveText("Hidden", { timeout: 60000 });

    /*
     * Saved the way the public routes read it: keyed by template key, and a
     * field that is not asked left out rather than stored as "Hidden".
     */
    const stored: JSONish = await getItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form",
      id: ctx.formId,
      select: {
        _id: true,
        customFieldSettings: true,
        descriptionSetting: true,
        isReporterDetailsRequired: true,
      },
    });
    ctx.formSettings = {
      [keyOf(FIELDS.impact)]: "Required",
      [keyOf(FIELDS.region)]: "Optional",
      [keyOf(FIELDS.customerFacing)]: "Optional",
      [keyOf(FIELDS.affectedUsers)]: "Optional",
      [keyOf(FIELDS.internalReference)]: "Required",
    };
    expect(stored["customFieldSettings"]).toEqual(ctx.formSettings);
    expect(stored["descriptionSetting"]).toBe("Hidden");
    expect(stored["isReporterDetailsRequired"]).toBe(false);

    // The very next reporter is asked exactly that.
    await openReporterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
    const form: Locator = ctx.reporter.locator("#incident-form");
    await expect
      .poll(
        async () => {
          return await fieldLabels(form);
        },
        { timeout: 30000 },
      )
      .toEqual([
        "Title",
        "Severity (Optional)",
        FIELDS.impact.name,
        `${FIELDS.region.name} (Optional)`,
        `${FIELDS.customerFacing.name} (Optional)`,
        `${FIELDS.affectedUsers.name} (Optional)`,
        FIELDS.internalReference.name,
        "Your Name (Optional)",
        "Your Email (Optional)",
      ]);
    // The template's value of a field is never shown to a reporter.
    await expect(
      ctx.reporter.getByLabel(FIELDS.internalReference.name, { exact: true }),
    ).toHaveValue("");

    // A report with no name and no email.
    const anonymousTitle: string = `Printers are down ${ctx.unique}`;
    await ctx.reporter.getByTestId("incident-form-title").fill(anonymousTitle);
    await ctx.reporter
      .getByLabel(FIELDS.impact.name, { exact: true })
      .fill(ANONYMOUS_IMPACT);
    const internalReference: Locator = ctx.reporter.getByLabel(
      FIELDS.internalReference.name,
      { exact: true },
    );
    await internalReference.fill(ANONYMOUS_INTERNAL_REFERENCE);
    await internalReference.press("Tab");
    await expect(form.getByText(/is required\.$/)).toHaveCount(0);
    await submitReport({ reporter: ctx.reporter, shareKey: ctx.shareKey });

    /*
     * The description the reporter was not asked for comes from the
     * template, and so does the Region they left empty; the Internal
     * Reference they typed beats the template's.
     */
    const incident: JSONish = await findIncidentByTitle(anonymousTitle);
    const incidentId: string = toId(incident["_id"]);
    expect(String(incident["description"] || "")).toBe(TEMPLATE_DESCRIPTION);
    expect(toId(incident["incidentSeverityId"])).toBe(ctx.formSeverityId);
    const customFields: JSONish = (incident["customFields"] as JSONish) || {};
    expect(customFields[FIELDS.impact.name]).toBe(ANONYMOUS_IMPACT);
    expect(customFields[FIELDS.internalReference.name]).toBe(
      ANONYMOUS_INTERNAL_REFERENCE,
    );
    expect(customFields[FIELDS.region.name]).toBe(TEMPLATE_REGION);
    expect(customFields[FIELDS.targetDate.name] ?? null).toBeNull();

    // The note says nobody left their name; the submission row agrees.
    expect(await readInternalNotes(incidentId)).toContain(
      `Reported anonymously through the incident form **${ctx.formName}**.`,
    );
    const submissions: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form-submission",
      query: { incidentId },
      select: { _id: true, reporterName: true, reporterEmail: true },
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!["reporterName"] || "").toBe("");
    expect(readEmail(submissions[0]!["reporterEmail"])).toBe("");
  });

  test("D6. a form made in the dashboard's wizard works for a signed-in admin, who stays signed in", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;
    const quickFormName: string = `Quick Report ${ctx.unique}`;

    // Incidents > Settings > Forms > Create Incident Form.
    const createButton: Locator = page.getByRole("button", {
      name: "Create Incident Form",
      exact: true,
    });
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/incidents/settings/forms"),
      ready: createButton,
    });
    await createButton.click();
    const wizard: Locator = page.getByTestId("modal");

    // Form Details: the name is all this step needs.
    await wizard.getByRole("textbox", { name: /^Name/ }).fill(quickFormName);
    await wizard.getByTestId("modal-footer-submit-button").click();

    /*
     * Incident Settings: a form cannot declare anything without a severity,
     * so the wizard asks for one before it sends anything.
     */
    await expect(
      wizard.getByRole("combobox", { name: /^Severity/ }),
    ).toBeVisible();
    await wizard.getByTestId("modal-footer-submit-button").click();
    await expect(wizard.getByText("Severity is required.")).toBeVisible();
    await chooseOption({
      page,
      scope: wizard,
      field: /^Severity/,
      option: ctx.formSeverityName,
    });
    await saveModal(page);

    const row: Locator = page
      .getByRole("row")
      .filter({ hasText: quickFormName });
    await expect(row).toBeVisible({ timeout: 60000 });

    /*
     * What a new form starts as: switched on, with its own link, asking only
     * the questions every form has.
     */
    const forms: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form",
      query: { name: quickFormName },
      select: {
        _id: true,
        shareKey: true,
        isEnabled: true,
        incidentSeverityId: true,
        allowReporterToChooseSeverity: true,
        descriptionSetting: true,
        isReporterDetailsRequired: true,
      },
    });
    expect(forms).toHaveLength(1);
    const quickFormId: string = toId(forms[0]!["_id"]);
    const quickShareKey: string = toId(forms[0]!["shareKey"]);
    expect(quickShareKey).toMatch(UUID_PATTERN);
    expect(forms[0]!["isEnabled"]).toBe(true);
    expect(toId(forms[0]!["incidentSeverityId"])).toBe(ctx.formSeverityId);
    expect(forms[0]!["allowReporterToChooseSeverity"]).toBe(false);
    expect(forms[0]!["descriptionSetting"]).toBe("Optional");
    expect(forms[0]!["isReporterDetailsRequired"]).toBe(true);

    await row
      .getByRole("button", { name: "View Incident Form", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/incidents/settings/forms/${quickFormId}$`),
      { timeout: 60000 },
    );
    await expect(page.getByTestId("incident-form-share-link")).toHaveText(
      shareLinkFor(quickShareKey),
      { timeout: 60000 },
    );

    /*
     * A new form asks no custom field - not even the two the project shows
     * on Declare Incident: a public form only shows what an admin added.
     */
    for (const field of Object.values(FIELDS)) {
      await expect(settingLabel(page, field)).toHaveText("Not Asked", {
        timeout: 60000,
      });
    }

    /*
     * Open Form, as the signed-in admin trying it out. The public page never
     * reads who is asking, and must not touch the admin's session either.
     */
    const previewPromise: Promise<Page> = page.waitForEvent("popup");
    await page.locator("#incident-form-open-form").click();
    const preview: Page = await previewPromise;
    await expect(preview).toHaveURL(shareLinkFor(quickShareKey));
    await expect(
      preview.getByRole("heading", { level: 1, name: quickFormName }),
    ).toBeVisible({ timeout: 60000 });
    const previewForm: Locator = preview.locator("#incident-form");
    await expect
      .poll(
        async () => {
          return await fieldLabels(previewForm);
        },
        { timeout: 30000 },
      )
      .toEqual(["Title", "Description (Optional)", "Your Name", "Your Email"]);

    const previewTitle: string = `Trying the new form ${ctx.unique}`;
    await preview.getByTestId("incident-form-title").fill(previewTitle);
    await preview
      .getByTestId("incident-form-reporter-name")
      .fill(PREVIEW_REPORTER_NAME);
    const previewEmail: Locator = preview.getByTestId(
      "incident-form-reporter-email",
    );
    await previewEmail.fill(PREVIEW_REPORTER_EMAIL);
    await previewEmail.press("Tab");
    await expect(previewForm.getByText(/is required\.$/)).toHaveCount(0);
    await submitReport({ reporter: preview, shareKey: quickShareKey });
    await preview.close();

    // Still signed in: the form's page loads, and lists the report.
    await openFormViewPage(quickFormId);
    const submissionRow: Locator = page
      .getByRole("row")
      .filter({ hasText: PREVIEW_REPORTER_EMAIL });
    await expect(submissionRow).toBeVisible({ timeout: 60000 });
    await expect(submissionRow).toContainText(PREVIEW_REPORTER_NAME);

    /*
     * And the report is as anonymous as any other: no creating user, and the
     * admin was not made its owner - only what was typed names the reporter.
     */
    const incident: JSONish = await findIncidentByTitle(previewTitle);
    const incidentId: string = toId(incident["_id"]);
    expect(toId(incident["createdByUserId"])).toBe("");
    const ownerUsers: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-owner-user",
      query: { incidentId },
      select: { _id: true, userId: true },
    });
    expect(ownerUsers).toEqual([]);
    expect(await readInternalNotes(incidentId)).toContain(
      `Reported through the incident form **${quickFormName}** by ${PREVIEW_REPORTER_NAME} (<${PREVIEW_REPORTER_EMAIL}>).`,
    );
  });

  test("E1. a new template's Custom Fields on Create step stores what it is set to", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    const wizardTemplateName: string = `Wizard Template ${ctx.unique}`;

    // Incidents > Settings > Incident Templates > Create Incident Template.
    const createButton: Locator = page.getByRole("button", {
      name: "Create Incident Template",
      exact: true,
    });
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/incidents/settings/templates"),
      ready: createButton,
    });
    await createButton.click();
    const wizard: Locator = page.getByTestId("modal");
    const next: Locator = wizard.getByTestId("modal-footer-submit-button");

    // Only the template's name, description and incident title are required.
    await wizard
      .getByRole("textbox", { name: /^Template Name/ })
      .fill(wizardTemplateName);
    await wizard
      .getByRole("textbox", { name: /^Template Description/ })
      .fill("Made in the wizard.");
    await next.click();
    await wizard
      .getByRole("textbox", { name: /^Title/ })
      .fill("Declared from the wizard's template");

    // On to its own step, after the field values: one dropdown per field.
    await stepThrough({
      form: wizard,
      next,
      stepTitle: "Custom Fields on Create",
    });
    expect(await isOnStep(wizard, "Custom Fields on Create")).toBe(true);
    await expect(
      wizard.getByRole("combobox", {
        name: new RegExp(`^${FIELDS.targetDate.name}`),
      }),
    ).toBeVisible();

    // Require Target Date, and hide Region; the rest stay on Default.
    await chooseOption({
      page,
      scope: wizard,
      field: new RegExp(`^${FIELDS.targetDate.name}`),
      option: "Required",
    });
    await chooseOption({
      page,
      scope: wizard,
      field: new RegExp(`^${FIELDS.region.name}`),
      option: "Hidden",
    });

    // The steps after it (On-Call, Owners, Labels) are optional.
    await stepThrough({ form: wizard, next });
    expect(await isOnStep(wizard)).toBe(true);
    await expect(next).toHaveText("Create Incident Template");
    await saveModal(page);

    /*
     * Stored under each field's template key, Default left out - and none of
     * the step's own form keys leaked into the template.
     */
    const templates: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      query: { templateName: wizardTemplateName },
      select: { _id: true, customFieldSettings: true, customFields: true },
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]!["customFieldSettings"]).toEqual({
      [keyOf(FIELDS.targetDate)]: "Required",
      [keyOf(FIELDS.region)]: "Hidden",
    });
    expect(JSON.stringify(templates[0]!["customFields"] || {})).not.toContain(
      "customFieldSettings",
    );

    // And the template's own page says so.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(
        ctx.projectId,
        `/incidents/settings/templates/${toId(templates[0]!["_id"])}`,
      ),
      ready: page.getByTestId("incident-custom-field-settings-list"),
    });
    await expect(settingLabel(page, FIELDS.targetDate)).toHaveText("Required", {
      timeout: 60000,
    });
    await expect(settingLabel(page, FIELDS.region)).toHaveText("Hidden");
    await expect(settingLabel(page, FIELDS.impact)).toHaveText(
      "Default (Not Shown)",
    );
  });

  test("E2. a template's Custom Fields on Create shape Declare Incident, and its owners stay", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;

    /*
     * The template's page lists every field with what the template does with
     * it - a field on Default says what the project's own switches make it.
     */
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(
        ctx.projectId,
        `/incidents/settings/templates/${ctx.templateId}`,
      ),
      ready: page.getByTestId("incident-custom-field-settings-list"),
    });
    const expectedSettings: Array<[FieldSpec, string]> = [
      [FIELDS.impact, "Required"],
      [FIELDS.region, "Default (Optional)"],
      [FIELDS.customerFacing, "Optional"],
      [FIELDS.affectedUsers, "Default (Not Shown)"],
      [FIELDS.targetDate, "Default (Not Shown)"],
      [FIELDS.internalReference, "Hidden"],
    ];
    for (const [field, setting] of expectedSettings) {
      await expect(settingLabel(page, field)).toHaveText(setting, {
        timeout: 60000,
      });
    }

    // Ask for Affected Users too, from the card's own editor.
    await card(page, "Custom Fields on Create")
      .getByRole("button", {
        name: "Edit Custom Fields on Create",
        exact: true,
      })
      .click();
    await chooseOption({
      page,
      scope: page.getByTestId("modal"),
      field: new RegExp(`^${FIELDS.affectedUsers.name}`),
      option: "Optional",
    });
    await saveModal(page);
    await expect(settingLabel(page, FIELDS.affectedUsers)).toHaveText(
      "Optional",
    );

    // Stored with the other settings, which the save left as they were.
    ctx.templateSettings = {
      ...ctx.templateSettings,
      [keyOf(FIELDS.affectedUsers)]: "Optional",
    };
    const storedTemplate: JSONish = await getItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      id: ctx.templateId,
      select: { _id: true, customFieldSettings: true },
    });
    expect(storedTemplate["customFieldSettings"]).toEqual(ctx.templateSettings);

    /*
     * Incidents > Create from Template > this template. Declare Incident is
     * the card's one button; Create from Template sits in its ⋯ menu.
     */
    const moreActions: Locator = card(page, "Incidents").getByRole("button", {
      name: "More options",
    });
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/incidents"),
      ready: moreActions,
    });
    await moreActions.click();
    await expect(moreActions).toHaveAttribute("aria-expanded", "true");
    const menuId: string =
      (await moreActions.getAttribute("aria-controls")) || "";
    expect(menuId, "the ⋯ button should name the menu it opened").not.toBe("");
    await page
      .locator(`[id="${menuId}"]`)
      .getByRole("menuitem", { name: "Create from Template" })
      .click();
    const picker: Locator = page.getByTestId("modal");
    await chooseOption({
      page,
      scope: picker,
      field: /^Select Incident Template/,
      option: ctx.templateName,
    });
    await picker.getByTestId("modal-footer-submit-button").click();

    await expect(page).toHaveURL(
      new RegExp(`/incidents/create\\?incidentTemplateId=${ctx.templateId}`),
      { timeout: 60000 },
    );

    const createForm: Locator = page.locator("#create-incident-form");
    const next: Locator = page.locator("#create-incident-form-submit-button");

    // Incident Details, prefilled from the template.
    const title: Locator = createForm.getByRole("textbox", { name: /^Title/ });
    await expect(title).toHaveValue(TEMPLATE_TITLE, { timeout: 60000 });
    const declaredTitle: string = `Declared from the template ${ctx.unique}`;
    await title.fill(declaredTitle);

    // Incident Details -> Resources Affected -> Details.
    await next.click();
    await expect(
      createForm.getByText("Resources Affected", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await next.click();

    /*
     * Details asks exactly what the template's settings say: Impact
     * (Required, although the project does not show it on create), Region (the
     * template leaves it on Default, and the project shows it), Customer Facing
     * and Affected Users (Optional). Internal Reference is Hidden by the
     * template although the project requires it, and Target Date stays on the
     * project's own "not on create".
     */
    await expect
      .poll(
        async () => {
          return await fieldLabels(createForm);
        },
        { timeout: 30000 },
      )
      .toEqual([
        FIELDS.impact.name,
        `${FIELDS.region.name} (Optional)`,
        `${FIELDS.customerFacing.name} (Optional)`,
        `${FIELDS.affectedUsers.name} (Optional)`,
      ]);
    for (const absent of [FIELDS.internalReference, FIELDS.targetDate]) {
      await expect(createForm.getByText(absent.name)).toHaveCount(0);
    }
    // Region starts from the template's value.
    await expect(createForm).toContainText(TEMPLATE_REGION);

    // Required is enforced: the step does not move on without Impact.
    await next.click();
    const impact: Locator = createForm.getByLabel(FIELDS.impact.name, {
      exact: true,
    });
    await expect(
      createForm.getByText(`${FIELDS.impact.name} is required.`),
    ).toBeVisible();
    await expect(impact).toBeVisible();

    const declaredImpact: string = "Declared by the on-call team";
    await impact.fill(declaredImpact);
    await impact.press("Tab");
    await expect(
      createForm.getByText(`${FIELDS.impact.name} is required.`),
    ).toHaveCount(0);

    // On through the remaining steps to the last, where the button declares.
    await stepThrough({ form: createForm, next });
    expect(await isOnStep(createForm)).toBe(true);
    await expect(next).toHaveText("Declare Incident");
    await next.click();

    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/${ctx.projectId}/incidents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
        "i",
      ),
      { timeout: 120000 },
    );

    const declared: JSONish = await findIncidentByTitle(declaredTitle);
    const declaredIncidentId: string = toId(declared["_id"]);
    expect(page.url()).toContain(declaredIncidentId);

    const customFields: JSONish = (declared["customFields"] as JSONish) || {};
    expect(customFields[FIELDS.impact.name]).toBe(declaredImpact);
    // The Hidden field still gets the template's value.
    expect(customFields[FIELDS.internalReference.name]).toBe(
      TEMPLATE_INTERNAL_REFERENCE,
    );
    expect(customFields[FIELDS.region.name]).toBe(TEMPLATE_REGION);

    /*
     * The template's owners are the incident's owners. Declaring from a
     * template used to drop them silently (the page read them and never sent
     * them). The admin who declared would be an owner either way; the team
     * is one only because the template's owners were sent.
     */
    const owners: IncidentOwners = await waitForOwners({
      incidentId: declaredIncidentId,
      description:
        "the template's owner team on the incident declared from the dashboard",
    });
    expect(owners.teamIds).toEqual([ctx.teamId]);
    expect(owners.userIds).toEqual([ctx.user.userId]);
  });

  test("F. past the submit limit the reporter is told to wait", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    /*
     * A form of its own, so the budget spent here is this form's and no
     * earlier report counts towards it. The limit is per form and network
     * (INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW, 10 in 15
     * minutes unless the stack lowers it), and refused reports count too.
     */
    const limitedForm: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-form",
      item: {
        projectId: ctx.projectId,
        name: `Rate Limited Form ${ctx.unique}`,
        incidentSeverityId: ctx.formSeverityId,
        descriptionSetting: "Hidden",
        isReporterDetailsRequired: false,
      },
    });
    const limitedShareKey: string = await readShareKey(
      toId(limitedForm["_id"]),
    );
    expect(limitedShareKey).toMatch(UUID_PATTERN);

    await openReporterPage(shareLinkFor(limitedShareKey));
    await expect(ctx.reporter.getByTestId("incident-form-title")).toBeVisible({
      timeout: 60000,
    });

    /*
     * Spend the budget from the reporter's own network with reports the
     * server refuses (no title), which declare nothing. Bounded: the default
     * limit is 10, so no 429 within 20 tries means there is no limit at all.
     */
    let attempts: number = 0;
    let lastStatus: number = 0;
    while (attempts < 20) {
      attempts++;
      const response: APIResponse = await ctx.reporter.request.post(
        buildUrl(`/api/incident-form/public/${limitedShareKey}/submit`),
        {
          headers: { "content-type": "application/json", tenantid: "" },
          data: { data: { title: "" } },
        },
      );
      lastStatus = response.status();

      if (lastStatus === 429) {
        expect(response.headers()["retry-after"]).toMatch(/^\d+$/);
        break;
      }

      expect(lastStatus, await response.text()).toBe(400);
    }
    expect(lastStatus, `no 429 after ${attempts} submissions`).toBe(429);

    // The reporter, from the same network, fills the form in and is told why.
    const title: Locator = ctx.reporter.getByTestId("incident-form-title");
    const typedTitle: string = `One report too many ${ctx.unique}`;
    await title.fill(typedTitle);
    await title.press("Tab");
    await ctx.reporter.locator("#incident-form-submit-button").click();

    const submitError: Locator = ctx.reporter.getByTestId(
      "incident-form-submit-error",
    );
    await expect(submitError).toBeVisible({ timeout: 60000 });
    await expect(submitError).toContainText(SUBMIT_RATE_LIMIT_MESSAGE);
    await expect(submitError).toContainText(/You can try again in/);

    // What they typed is still there to send later, and nothing was declared.
    await expect(title).toHaveValue(typedTitle);
    const declared: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/incident",
      query: { title: typedTitle },
      select: { _id: true },
    });
    expect(declared).toHaveLength(0);
  });
});

/*
 * Its own group, with its own project: it needs six fields with no sort
 * order, which would change the questions every test in the serial group
 * above asks, and a failure there would skip - and, retried, repeat - every
 * test after it.
 */
test.describe("Incident form question order", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour and one set of pages, one engine is enough");

  test("G. fields without a sort order are asked in the order the form's Questions card lists them", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(360000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Incident Form Order E2E",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });

    const severities: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page,
      description: "the project's incident severities to be seeded",
      timeoutMs: 120000,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId,
          path: "/api/incident-severity",
          select: { _id: true },
        });

        return rows.length > 0 ? rows : null;
      },
    });

    /*
     * Sort Order is optional in the dashboard, so fields without one are the
     * common case. Six of them, made one after the other: the dashboard lists
     * such fields by id, which has nothing to do with when they were made, so
     * six of them are all but certain to come out in an order of their own.
     */
    const names: Array<string> = [
      "Reported From",
      "Contact Phone",
      "Building",
      "Floor",
      "Room",
      "Desk",
    ];
    for (const name of names) {
      await createItem({
        page,
        projectId,
        path: "/api/incident-custom-field",
        item: { projectId, name, customFieldType: "Text" },
      });
    }

    const rows: Array<JSONish> = await listItems({
      page,
      projectId,
      path: "/api/incident-custom-field",
      select: { _id: true, name: true, variableKey: true, sortOrder: true },
    });
    const nameByKey: Record<string, string> = {};
    for (const row of rows) {
      expect(row["sortOrder"] ?? null).toBeNull();
      nameByKey[String(row["variableKey"])] = String(row["name"]);
    }
    expect(Object.values(nameByKey).sort()).toEqual([...names].sort());

    // A form that asks all six.
    const customFieldSettings: Record<string, string> = {};
    for (const variableKey of Object.keys(nameByKey)) {
      customFieldSettings[variableKey] = "Optional";
    }
    const form: JSONish = await createItem({
      page,
      projectId,
      path: "/api/incident-form",
      item: {
        projectId,
        name: `Unordered Questions ${Date.now().toString(36)}`,
        incidentSeverityId: toId(severities[0]!["_id"]),
        descriptionSetting: "Hidden",
        isReporterDetailsRequired: false,
        customFieldSettings,
      },
    });
    const formId: string = toId(form["_id"]);
    const shareKey: string = toId(
      (
        await getItem({
          page,
          projectId,
          path: "/api/incident-form",
          id: formId,
          select: { _id: true, shareKey: true },
        })
      )["shareKey"],
    );
    expect(shareKey).toMatch(UUID_PATTERN);

    // What the admin sees: the form's Questions card, in the dashboard's order.
    const questions: Locator = page.getByTestId(
      "incident-custom-field-settings-list",
    );
    await gotoProjectPage({
      page,
      projectId,
      url: dashboardUrl(projectId, `/incidents/settings/forms/${formId}`),
      ready: questions,
    });
    await expect(questions.locator("li")).toHaveCount(names.length, {
      timeout: 60000,
    });
    const cardOrder: Array<string> = (
      await questions
        .locator("li")
        .evaluateAll((items: Array<Element>): Array<string> => {
          return items.map((item: Element): string => {
            return item.getAttribute("data-testid") || "";
          });
        })
    ).map((testId: string): string => {
      return nameByKey[testId.replace("incident-custom-field-setting-", "")]!;
    });

    // What a reporter is asked.
    const reporterContext: BrowserContext = await browser.newContext();
    const reporter: Page = await reporterContext.newPage();
    await pointFrontendAtTestTarget(reporter);
    await reporter.goto(shareLinkFor(shareKey), {
      waitUntil: "domcontentloaded",
    });
    const reporterForm: Locator = reporter.locator("#incident-form");
    // Title, the six fields, Your Name and Your Email.
    await expect
      .poll(
        async () => {
          return (await fieldLabels(reporterForm)).length;
        },
        { timeout: 60000 },
      )
      .toBe(names.length + 3);
    const askedOrder: Array<string> = (await fieldLabels(reporterForm))
      .map((label: string): string => {
        return label.replace(/ \(Optional\)$/, "");
      })
      .filter((label: string): boolean => {
        return names.includes(label);
      });
    await reporterContext.close();

    /*
     * The reporter is asked the questions in the order the admin set them
     * up in - the order of the form's Questions card, which is also the
     * Declare Incident page's. For fields without a sort order that order
     * is only the database's tie-break: the dashboard reads them by
     * sortOrder (IncidentCustomFieldDefinitions.ts
     * fetchIncidentCustomFieldDefinitions, ties broken by id), and so must
     * IncidentFormService.getAskedCustomFields - with no sort it read them
     * newest first, which is the bug this test first caught.
     */
    expect(askedOrder).toEqual(cardOrder);
  });
});
