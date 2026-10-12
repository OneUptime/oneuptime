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
 * Forms, end to end against a real stack.
 *
 * An admin builds a form in the Forms product; anyone holding its link - no
 * OneUptime account, no session - opens /accounts/form/<shareKey>, answers
 * the questions the admin chose, and the submission creates an incident or
 * a scheduled maintenance event. The unit suites mock every hop of that:
 * the Accounts page against a fake API, the public routes against stubbed
 * services, the builder and the cards against mocked ModelAPI calls. This
 * spec is the one place the hops meet:
 *
 *   A. setup through the same CRUD API the dashboard uses: incident custom
 *      fields, a label, a template with owners, and an incident form whose
 *      questions are the form's own, the incident's fields, its custom
 *      fields and the submitter's details;
 *   B. an anonymous submitter, in a browser context with no cookies at all,
 *      opens the link, sees exactly the form's questions, is stopped by the
 *      browser's own checks, then submits and gets the incident's number;
 *   C. what that submission became, read back through the API - the
 *      incident, its answers, labels, owners and private note, and the
 *      submission - and what the public routes do with a caller who goes
 *      around the page, and with the old incident form link;
 *   D. the dashboard: Forms in the product menu, its list and every
 *      submission; the builder (add, word, move and save a question, and the
 *      preview); the On Submit page and its settings; Reset Link, Accepting
 *      Submissions and the IP allowlist - each checked from the submitter's
 *      side of the link;
 *   E. a form made in the dashboard's Create Form dialog that schedules
 *      maintenance events, filled in by a submitter;
 *   E2. a form whose templates ask its questions their own way (required,
 *      optional, hidden), on the page and on the server;
 *   F. the submit rate limit, as the submitter sees it.
 *
 * Anti-flake notes:
 * - one fresh user and project per run, and run-unique names, so a re-run
 *   never meets another run's forms, incidents or events
 * - no fixed sleeps: every wait is a Playwright expectation or a poll
 * - chromium only: this is server behaviour and one set of pages, not
 *   rendering quirks
 * - the rate limit test (F) runs last and uses a form of its own, so the
 *   budget it spends cannot refuse the submissions the other tests make. The
 *   group retries once at most: the submissions of two attempts stay inside
 *   the per-network budget (30 per 15 minutes by default) until F, which
 *   only needs some limit to refuse it
 *
 * To run locally against a full stack, with HOST and HTTP_PROTOCOL set to
 * the stack's own (its config.env values), not merely to an address that
 * reaches it: the public form's routes refuse a browser request sent from
 * any origin but the stack's configured HTTP_PROTOCOL + HOST, so from any
 * other the page loads a form and every submission is refused. The group's
 * beforeAll compares the two first and stops, saying so, when they differ.
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/Forms.spec.ts --project=chromium
 *
 * F reaches the limit sooner on a stack started with a lower
 * FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW (default 10).
 */

// The public page's copy (Accounts locales, en) and the server's messages.
const SUCCESS_HEADING: string = "Thank you — your response was submitted.";
const NOT_AVAILABLE_MESSAGE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";
const NETWORK_NOT_ALLOWED_MESSAGE: string =
  "This form can only be opened from an allowed network.";
const SUBMIT_RATE_LIMIT_MESSAGE: string =
  "Too many submissions from your network. Please wait a few minutes and try again.";
const FOREIGN_PAGE_MESSAGE: string =
  "This form can only be used from its own page.";
const SUBMISSION_BODY_MESSAGE: string =
  'The request must be a JSON object holding the form\'s answers in "data".';
const PREVIEW_SUBMITTED_MESSAGE: string =
  "Looks good. This is a preview, so nothing was submitted.";

/*
 * The header the public page's client adds to every request it makes
 * (FORM_PAGE_HEADER in Common/Types/Form/FormPublic): the read route
 * answers only a request that carries it.
 */
const FORM_PAGE_HEADER: string = "x-oneuptime-form";
const FORM_PAGE_HEADER_VALUE: string = "1";

// Forms and incident custom fields are Growth features.
const PREFERRED_PLAN_NAME: string = "Growth";

/*
 * TEST-NET-3 (RFC 5737): documentation space, never routed, so it is never
 * the address this run reaches the stack from - whatever network CI uses.
 */
const ALLOWLIST_THAT_EXCLUDES_US: string = "203.0.113.7";

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The incident form's questions, by the ids the API gives them (A).
const QUESTION_IDS: {
  title: string;
  description: string;
  severity: string;
  impact: string;
  region: string;
  office: string;
  name: string;
  email: string;
} = {
  title: "what",
  description: "details",
  severity: "how-bad",
  impact: "impact",
  region: "region",
  office: "office",
  name: "name",
  email: "email",
};

// How the questions read, as the form words them.
const LABELS: {
  title: string;
  description: string;
  severity: string;
  impact: string;
  region: string;
  office: string;
  name: string;
  email: string;
} = {
  title: "What is wrong?",
  description: "Describe what you see",
  severity: "How bad is it?",
  impact: "Impact",
  region: "Region",
  office: "Which office are you in?",
  name: "Your Name",
  email: "Your Email",
};

// The incident custom fields the project gets.
const IMPACT_FIELD_NAME: string = "Impact";
const REGION_FIELD_NAME: string = "Region";
const REGION_OPTIONS: string = "EU\nUS\nAPAC";
// Never asked: on the form's incidents its value comes from the template.
const INTERNAL_REFERENCE_FIELD_NAME: string = "Internal Reference";
const TEMPLATE_INTERNAL_REFERENCE: string = "REF-FORMS";

// What the submitter types (B).
const SUBMITTER_NAME: string = "Ada Submitter";
const SUBMITTER_EMAIL: string = "ada.submitter@example.com";
const SUBMITTED_IMPACT: string = "Checkout fails for every customer in the US";
const SUBMITTED_REGION: string = "US";
const SUBMITTED_OFFICE: string = "Berlin";

interface Ctx {
  page: Page;
  submitterContext: BrowserContext | null;
  submitter: Page;
  projectId: string;
  user: SessionUser;
  unique: string;
  formSeverityId: string;
  formSeverityName: string;
  chosenSeverityId: string;
  chosenSeverityName: string;
  settingsLabelId: string;
  templateLabelId: string;
  teamId: string;
  impactFieldId: string;
  regionFieldId: string;
  templateId: string;
  formId: string;
  formName: string;
  shareKey: string;
  submittedTitle: string;
  submittedDescription: string;
  reference: string;
  incidentId: string;
}

const ctx: Ctx = {
  page: null as unknown as Page,
  submitterContext: null,
  submitter: null as unknown as Page,
  projectId: "",
  user: { userId: "", email: "" },
  unique: "",
  formSeverityId: "",
  formSeverityName: "",
  chosenSeverityId: "",
  chosenSeverityName: "",
  settingsLabelId: "",
  templateLabelId: "",
  teamId: "",
  impactFieldId: "",
  regionFieldId: "",
  templateId: "",
  formId: "",
  formName: "",
  shareKey: "",
  submittedTitle: "",
  submittedDescription: "",
  reference: "",
  incidentId: "",
};

type ShareLinkFunction = (shareKey: string) => string;

// Exactly what the dashboard hands out: <ACCOUNTS_URL>/form/<shareKey>.
const shareLinkFor: ShareLinkFunction = (shareKey: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/accounts/form/${shareKey}`)
    .toString();
};

// An incident form's link from before Forms replaced incident forms.
const legacyShareLinkFor: ShareLinkFunction = (shareKey: string): string => {
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
 * It does not make a stack whose own HOST differs usable: the public form's
 * routes refuse a browser request whose Origin is not the stack's own
 * HTTP_PROTOCOL + HOST, and the page's submit carries its Origin.
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
 * port, another host name) refuses every submission the page sends, and B
 * would fail later with a 403 that says nothing of the cause.
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

    if (!served) {
      throw new Error(
        `Forms.spec could not read the stack's HOST and HTTP_PROTOCOL from ${envUrl} (HTTP ${response.status()}, not the frontend environment script). A OneUptime stack serves that script only under its own HOST, so ${testedOrigin} is most likely not the stack's own address. Run the spec with the stack's own HOST and HTTP_PROTOCOL (its config.env values): the public form's routes refuse a browser request from any origin but the stack's own.`,
      );
    }

    const env: Record<string, unknown> = JSON.parse(served[1]!) as Record<
      string,
      unknown
    >;
    const host: string = String(env["HOST"] || "");
    const httpProtocol: string = String(env["HTTP_PROTOCOL"] || "");
    const stackOrigin: string | null = originOf(
      `${httpProtocol === "https" ? "https" : "http"}://${host}`,
    );

    if (!stackOrigin || stackOrigin !== testedOrigin) {
      throw new Error(
        `Forms.spec tests ${testedOrigin} (this run's HTTP_PROTOCOL and HOST), but the stack there is configured as ${stackOrigin || "no address"} (HTTP_PROTOCOL=${httpProtocol}, HOST=${host}, as its /accounts/env.js says). The public form's routes refuse a browser request from any origin but the stack's own, so every submission would be refused with 403 "${FOREIGN_PAGE_MESSAGE}". Run the spec with the stack's own HOST and HTTP_PROTOCOL, or start the stack with this run's.`,
      );
    }
  };

type ReadFormFunction = (formId: string) => Promise<JSONish>;

const readForm: ReadFormFunction = async (formId: string): Promise<JSONish> => {
  return getItem({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/form",
    id: formId,
    select: {
      _id: true,
      name: true,
      shareKey: true,
      isEnabled: true,
      targetType: true,
      fields: true,
      targetSettings: true,
      ipWhitelist: true,
    },
  });
};

type ReadShareKeyFunction = (formId: string) => Promise<string>;

const readShareKey: ReadShareKeyFunction = async (
  formId: string,
): Promise<string> => {
  return toId((await readForm(formId))["shareKey"]);
};

type UpdateFormFunction = (data: JSONish) => Promise<void>;

const updateForm: UpdateFormFunction = async (data: JSONish): Promise<void> => {
  await requestJson({
    page: ctx.page,
    projectId: ctx.projectId,
    path: `/api/form/${ctx.formId}`,
    method: "put",
    body: { data },
  });
};

type QuestionLabelsFunction = (fields: unknown) => Array<string>;

// A stored form's questions, by how they read.
const questionLabels: QuestionLabelsFunction = (
  fields: unknown,
): Array<string> => {
  return ((fields as Array<JSONish>) || []).map((field: JSONish): string => {
    return String(field["label"] || "");
  });
};

type FieldLabelsFunction = (scope: Locator) => Promise<Array<string>>;

/*
 * The visible field labels inside a form, in order, whitespace collapsed:
 * "Region (Optional)" for an optional question, the bare label for a
 * required one - that suffix is the form's required marker.
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

type ReadTimeFunction = (value: unknown) => number;

// A DateTime column comes back bare or as { _type: "DateTime", value }.
const readTime: ReadTimeFunction = (value: unknown): number => {
  const raw: string =
    typeof value === "string"
      ? value
      : String((value as JSONish | null)?.["value"] || "");

  return new Date(raw).getTime();
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

type OpenSubmitterPageFunction = (url: string) => Promise<void>;

// The submitter opens a link fresh, as someone following it from chat would.
const openSubmitterPage: OpenSubmitterPageFunction = async (
  url: string,
): Promise<void> => {
  await ctx.submitter.goto(url, { waitUntil: "domcontentloaded" });
};

type ExpectFormNotAvailableFunction = (message?: string) => Promise<void>;

const expectFormNotAvailable: ExpectFormNotAvailableFunction = async (
  message?: string,
): Promise<void> => {
  const failure: Locator = ctx.submitter.getByTestId("form-load-failure");

  await expect(failure).toBeVisible({ timeout: 60000 });
  await expect(failure).toContainText(message || NOT_AVAILABLE_MESSAGE);
  // No form behind the message: no heading, no questions, no Submit.
  await expect(
    ctx.submitter.getByRole("heading", { level: 1, name: ctx.formName }),
  ).toHaveCount(0);
  await expect(ctx.submitter.locator("#public-form")).toHaveCount(0);
};

type ExpectFormShownFunction = (formName?: string) => Promise<void>;

const expectFormShown: ExpectFormShownFunction = async (
  formName?: string,
): Promise<void> => {
  await expect(
    ctx.submitter.getByRole("heading", {
      level: 1,
      name: formName || ctx.formName,
    }),
  ).toBeVisible({ timeout: 60000 });
  await expect(ctx.submitter.locator("#public-form")).toBeVisible();
  await expect(ctx.submitter.getByTestId("form-load-failure")).toHaveCount(0);
};

type SubmitFormFunction = (data: {
  submitter: Page;
  shareKey: string;
}) => Promise<JSONish>;

/*
 * Presses Submit on a filled-in public form, waits for the server's answer
 * and the thank-you card, and returns what the server said.
 */
const submitForm: SubmitFormFunction = async (data: {
  submitter: Page;
  shareKey: string;
}): Promise<JSONish> => {
  const responsePromise: Promise<Response> = data.submitter.waitForResponse(
    (response: Response): boolean => {
      return (
        response.url().includes(`/form/public/${data.shareKey}/submit`) &&
        response.request().method() === "POST"
      );
    },
    { timeout: 120000 },
  );
  await data.submitter.locator("#public-form-submit-button").click();
  const response: Response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);

  const success: Locator = data.submitter.getByTestId("form-success");
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
      createdIncidentTemplateId: true,
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

type OpenFormPageFunction = (data: {
  path?: string | undefined;
  formId?: string | undefined;
  ready: (page: Page) => Locator;
}) => Promise<void>;

// One of a form's pages: Build (no path), on-submit, share or submissions.
const openFormPage: OpenFormPageFunction = async (data: {
  path?: string | undefined;
  formId?: string | undefined;
  ready: (page: Page) => Locator;
}): Promise<void> => {
  const suffix: string = data.path ? `/${data.path}` : "";

  await gotoProjectPage({
    page: ctx.page,
    projectId: ctx.projectId,
    url: dashboardUrl(
      ctx.projectId,
      `/forms/${data.formId || ctx.formId}${suffix}`,
    ),
    ready: data.ready(ctx.page),
  });
};

test.describe("Forms", () => {
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

    // First: on a stack configured for another origin every submission is refused.
    await expectStackToBeConfiguredForThisRun(ctx.page);

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "Forms E2E",
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
    ctx.submittedTitle = `Checkout is down ${ctx.unique}`;
    ctx.submittedDescription = `Every payment fails with an error page ${ctx.unique}`;
  });

  test.afterAll(async () => {
    await ctx.submitterContext?.close();
    await ctx.page?.close();
  });

  test("A. an admin sets up custom fields, a template and an incident form", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    /*
     * Severities are seeded after the project is created. The form's
     * settings name one of them and the submitter picks another, so the
     * incident's severity shows whose choice won.
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
    ctx.chosenSeverityId = toId(severities[1]!["_id"]);
    ctx.chosenSeverityName = String(severities[1]!["name"]);

    const impact: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-custom-field",
      item: {
        projectId: ctx.projectId,
        name: IMPACT_FIELD_NAME,
        description: "What the problem stops people doing",
        customFieldType: "Text",
        sortOrder: 1,
      },
    });
    ctx.impactFieldId = toId(impact["_id"]);

    const region: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-custom-field",
      item: {
        projectId: ctx.projectId,
        name: REGION_FIELD_NAME,
        description: "Where the problem is",
        customFieldType: "Dropdown",
        dropdownOptions: REGION_OPTIONS,
        sortOrder: 2,
      },
    });
    ctx.regionFieldId = toId(region["_id"]);

    // Not asked by the form: on its incidents the template sets it.
    await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-custom-field",
      item: {
        projectId: ctx.projectId,
        name: INTERNAL_REFERENCE_FIELD_NAME,
        customFieldType: "Text",
        sortOrder: 3,
      },
    });

    expect(ctx.impactFieldId).toMatch(UUID_PATTERN);
    expect(ctx.regionFieldId).toMatch(UUID_PATTERN);

    // A label the form always adds, and one the template has.
    const settingsLabel: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/label",
      item: {
        projectId: ctx.projectId,
        name: `Submitted through a form ${ctx.unique}`,
        color: { _type: "Color", value: "#6366f1" },
      },
    });
    ctx.settingsLabelId = toId(settingsLabel["_id"]);

    const templateLabel: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/label",
      item: {
        projectId: ctx.projectId,
        name: `From the template ${ctx.unique}`,
        color: { _type: "Color", value: "#16a34a" },
      },
    });
    ctx.templateLabelId = toId(templateLabel["_id"]);

    /*
     * Every project starts with an Admin team, which the admin who created
     * the project is not in: it owns the template's incidents next to the
     * admin, so the owners prove they came from the template.
     */
    const teams: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/team",
      select: { _id: true, name: true },
    });
    const adminTeams: Array<JSONish> = teams.filter((team: JSONish) => {
      return team["name"] === "Admin";
    });

    expect(
      adminTeams,
      'every project should start with one "Admin" team',
    ).toHaveLength(1);
    ctx.teamId = toId(adminTeams[0]!["_id"]);

    const template: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/incident-templates",
      item: {
        projectId: ctx.projectId,
        templateName: `Form Template ${ctx.unique}`,
        templateDescription: "Declared for problems submitted through a form.",
        title: "Submitted through a form",
        description: "The template's own description.",
        incidentSeverityId: ctx.formSeverityId,
        isScopedToStatusPages: false,
        labels: [{ _id: ctx.templateLabelId }],
        customFields: {
          [INTERNAL_REFERENCE_FIELD_NAME]: TEMPLATE_INTERNAL_REFERENCE,
        },
      },
    });
    ctx.templateId = toId(template["_id"]);

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

    /*
     * The form, through the API: the incident's own fields, two of its
     * custom fields, a question of the form's own and who is submitting.
     * Internal Reference is left out on purpose - a public form must never
     * show a field the admin did not add.
     */
    const fields: Array<JSONish> = [
      {
        id: QUESTION_IDS.title,
        source: "TargetField",
        targetField: "title",
        label: LABELS.title,
        isRequired: true,
      },
      {
        id: QUESTION_IDS.description,
        source: "TargetField",
        targetField: "description",
        label: LABELS.description,
        helpText: "What you were doing, and what happened.",
        isRequired: true,
      },
      {
        id: QUESTION_IDS.severity,
        source: "TargetField",
        targetField: "incidentSeverityId",
        label: LABELS.severity,
        isRequired: false,
      },
      {
        id: QUESTION_IDS.impact,
        source: "TargetCustomField",
        customFieldId: ctx.impactFieldId,
        label: LABELS.impact,
        isRequired: true,
      },
      {
        id: QUESTION_IDS.region,
        source: "TargetCustomField",
        customFieldId: ctx.regionFieldId,
        label: LABELS.region,
        isRequired: false,
      },
      {
        id: QUESTION_IDS.office,
        source: "Question",
        type: "Dropdown",
        label: LABELS.office,
        dropdownOptions: "Berlin\nLondon",
        isRequired: false,
      },
      {
        id: QUESTION_IDS.name,
        source: "Submitter",
        submitterField: "Name",
        label: LABELS.name,
        isRequired: true,
      },
      {
        id: QUESTION_IDS.email,
        source: "Submitter",
        submitterField: "Email",
        label: LABELS.email,
        isRequired: true,
      },
    ];

    const form: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/form",
      item: {
        projectId: ctx.projectId,
        name: ctx.formName,
        description:
          "Tell us what is broken. **Our on-call team reads every submission.**",
        targetType: "Incident",
        fields,
        targetSettings: {
          incidentSeverityId: ctx.formSeverityId,
          incidentTemplateId: ctx.templateId,
          labelIds: [ctx.settingsLabelId],
        },
        successMessage: "Thanks for telling us. **We are on it.**",
        // A key the client picks must never be kept: the server mints one.
        shareKey: "11111111-1111-4111-8111-111111111111",
      },
    });
    ctx.formId = toId(form["_id"]);
    expect(ctx.formId, "the form should have been created").toMatch(
      UUID_PATTERN,
    );

    const stored: JSONish = await readForm(ctx.formId);

    ctx.shareKey = toId(stored["shareKey"]);
    expect(ctx.shareKey).toMatch(UUID_PATTERN);
    expect(ctx.shareKey).not.toBe("11111111-1111-4111-8111-111111111111");
    // A new form takes submissions straight away.
    expect(stored["isEnabled"]).toBe(true);
    expect(stored["targetType"]).toBe("Incident");
    expect(questionLabels(stored["fields"])).toEqual(
      fields.map((field: JSONish): string => {
        return String(field["label"]);
      }),
    );
    expect(stored["targetSettings"]).toEqual(
      expect.objectContaining({
        incidentSeverityId: ctx.formSeverityId,
        incidentTemplateId: ctx.templateId,
        labelIds: [ctx.settingsLabelId],
      }),
    );

    // A form whose questions break a rule is refused, and names the problem.
    const refused: APIResponse = await page.request.post(
      buildUrl("/api/form"),
      {
        headers: {
          "content-type": "application/json",
          tenantid: ctx.projectId,
          projectid: ctx.projectId,
        },
        data: {
          data: {
            projectId: ctx.projectId,
            name: `Two titles ${ctx.unique}`,
            targetType: "Incident",
            fields: [fields[0], { ...fields[0], id: "again" }],
          },
        },
      },
    );
    expect(refused.status()).toBe(400);
  });

  test("B. an anonymous submitter answers exactly the form's questions and submits", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(240000);

    // A context of its own: none of the admin's cookies, no session at all.
    ctx.submitterContext = await browser.newContext();
    expect(await ctx.submitterContext.cookies()).toEqual([]);
    ctx.submitter = await ctx.submitterContext.newPage();
    await pointFrontendAtTestTarget(ctx.submitter);

    const submitter: Page = ctx.submitter;
    const submitRequests: Array<string> = [];
    submitter.on("request", (request: Request): void => {
      if (
        request.url().includes("/form/public/") &&
        request.method() === "POST"
      ) {
        submitRequests.push(request.url());
      }
    });

    const formResponsePromise: Promise<Response> = submitter.waitForResponse(
      (response: Response): boolean => {
        return (
          response.url().endsWith(`/form/public/${ctx.shareKey}`) &&
          response.request().method() === "GET"
        );
      },
      { timeout: 60000 },
    );
    await openSubmitterPage(shareLinkFor(ctx.shareKey));
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
     * What the page is told: the questions and nothing else - not the field
     * the form leaves out, not the form's, project's or template's ids, not
     * the thank-you message before a submission.
     */
    expect(
      ((publicForm["fields"] as Array<JSONish>) || []).map((field: JSONish) => {
        return field["label"];
      }),
    ).toEqual([
      LABELS.title,
      LABELS.description,
      LABELS.severity,
      LABELS.impact,
      LABELS.region,
      LABELS.office,
      LABELS.name,
      LABELS.email,
    ]);
    const publicFormText: string = JSON.stringify(publicForm);
    for (const secret of [
      INTERNAL_REFERENCE_FIELD_NAME,
      TEMPLATE_INTERNAL_REFERENCE,
      ctx.projectId,
      ctx.formId,
      ctx.templateId,
      ctx.shareKey,
      ctx.settingsLabelId,
      "We are on it.",
    ]) {
      expect(publicFormText).not.toContain(secret);
    }

    await expectFormShown();

    // The tab is named after the form, and its description is on top.
    await expect(submitter).toHaveTitle(ctx.formName);
    await expect(submitter.getByTestId("form-about")).toContainText(
      "Our on-call team reads every submission.",
    );

    /*
     * Exactly the form's questions, in its order, with the required marker
     * where the form requires an answer: optional ones read "(Optional)".
     */
    const form: Locator = submitter.locator("#public-form");
    await expect
      .poll(
        async () => {
          return await fieldLabels(form);
        },
        { timeout: 30000 },
      )
      .toEqual([
        LABELS.title,
        LABELS.description,
        `${LABELS.severity} (Optional)`,
        LABELS.impact,
        `${LABELS.region} (Optional)`,
        `${LABELS.office} (Optional)`,
        LABELS.name,
        LABELS.email,
      ]);
    await expect(
      submitter.getByText(INTERNAL_REFERENCE_FIELD_NAME),
    ).toHaveCount(0);
    expect(await submitter.content()).not.toContain(
      TEMPLATE_INTERNAL_REFERENCE,
    );
    await expect(form).toContainText("What you were doing, and what happened.");

    /*
     * The description editor has its toolbar, but no image upload: an
     * upload needs a signed-in user, and a submitter may be nobody.
     *
     * The toolbar keeps to one line (MarkdownToolbarLayout): the buttons
     * that do not fit wait, in order, under More formatting, and this page
     * is a reading column narrower than the whole toolbar. What the editor
     * offers is its line and that menu together, so both are read.
     */
    const descriptionEditor: Locator = submitter.getByTestId(
      `form-field-${QUESTION_IDS.description}`,
    );
    const toolbar: Locator = descriptionEditor.getByTestId(
      "markdown-editor-toolbar",
    );
    await expect(toolbar.getByRole("button", { name: /^Bold/ })).toBeVisible();
    const moreFormatting: Locator = toolbar.getByRole("button", {
      name: "More formatting",
      exact: true,
    });
    const formattingMenu: Locator = submitter.getByRole("menu", {
      name: "More formatting",
      exact: true,
    });
    if ((await moreFormatting.count()) > 0) {
      await moreFormatting.click();
      await expect(formattingMenu).toBeVisible();
    }
    await expect(
      toolbar
        .getByRole("button", { name: "Link", exact: true })
        .or(
          formattingMenu.getByRole("menuitem", { name: "Link", exact: true }),
        ),
    ).toBeVisible();
    await expect(toolbar.getByRole("button", { name: /Image/ })).toHaveCount(0);
    await expect(
      formattingMenu.getByRole("menuitem", { name: /Image/ }),
    ).toHaveCount(0);
    // Nor a way to drop or pick a file: the editor has no file input at all.
    await expect(descriptionEditor.locator('input[type="file"]')).toHaveCount(
      0,
    );
    if ((await moreFormatting.count()) > 0) {
      await submitter.keyboard.press("Escape");
      await expect(formattingMenu).toHaveCount(0);
    }

    // The form's own severity is preselected; the submitter may change it.
    await expect(form).toContainText(ctx.formSeverityName);

    /*
     * The browser refuses an empty submission on its own: every required
     * question says so, and nothing is sent.
     */
    const submit: Locator = submitter.locator("#public-form-submit-button");
    await submit.click();
    for (const label of [
      LABELS.title,
      LABELS.description,
      LABELS.impact,
      LABELS.name,
      LABELS.email,
    ]) {
      await expect(form.getByText(`${label} is required.`)).toBeVisible();
    }
    // Optional questions do not complain.
    await expect(form.getByText(`${LABELS.region} is required.`)).toHaveCount(
      0,
    );
    expect(submitRequests, "an invalid submission must not be sent").toEqual(
      [],
    );

    /*
     * An answer of nothing but spaces is refused in the browser too (the
     * server trims every answer), and so is an address that is not one.
     */
    const title: Locator = submitter.getByTestId(
      `form-field-${QUESTION_IDS.title}`,
    );
    await title.fill("Checkout");
    await title.press("Tab");
    await expect(form.getByText(`${LABELS.title} is required.`)).toHaveCount(0);
    await title.fill("   ");
    await title.press("Tab");
    await expect(form.getByText(`${LABELS.title} is required.`)).toBeVisible();

    const email: Locator = submitter.getByTestId(
      `form-field-${QUESTION_IDS.email}`,
    );
    await email.fill("Ada <ada@example.com>");
    await email.press("Tab");
    await expect(form.getByText("Email is not valid.")).toBeVisible();
    expect(submitRequests, "an invalid submission must not be sent").toEqual(
      [],
    );

    // Now a real submission.
    await title.fill(ctx.submittedTitle);
    await descriptionEditor
      .getByRole("textbox")
      .first()
      .fill(ctx.submittedDescription);

    await chooseOption({
      page: submitter,
      scope: form,
      field: /^How bad is it\?/,
      option: ctx.chosenSeverityName,
    });

    await submitter
      .getByTestId(`form-field-${QUESTION_IDS.impact}`)
      .fill(SUBMITTED_IMPACT);

    await chooseOption({
      page: submitter,
      scope: form,
      field: new RegExp(`^${LABELS.region}`),
      option: SUBMITTED_REGION,
    });
    await chooseOption({
      page: submitter,
      scope: form,
      field: /^Which office are you in\?/,
      option: SUBMITTED_OFFICE,
    });

    await submitter
      .getByTestId(`form-field-${QUESTION_IDS.name}`)
      .fill(SUBMITTER_NAME);
    await email.fill(SUBMITTER_EMAIL);
    /*
     * Leave the last field before pressing Submit, and let the form settle:
     * a field that re-validates on blur moves the button between the
     * pointer's press and its release otherwise.
     */
    await email.press("Tab");
    await expect(form.getByTestId("error-message")).toHaveCount(0);
    await expect(form.getByText(/is required\.$/)).toHaveCount(0);

    const result: JSONish = await submitForm({
      submitter,
      shareKey: ctx.shareKey,
    });

    // The thank-you card: the incident's number and the thank-you message.
    ctx.reference = String(result["reference"] || "");
    expect(ctx.reference).toMatch(/^(?:#\d+|\S+-?\d+)$/);
    await expect(submitter.getByTestId("form-reference")).toHaveText(
      `Your reference number is ${ctx.reference}.`,
    );
    await expect(submitter.getByTestId("form-success-message")).toContainText(
      "We are on it.",
    );
    // The form is gone: a second click cannot send the submission twice.
    await expect(submit).toHaveCount(0);
    expect(submitRequests).toHaveLength(1);

    // Submit another response opens an empty form.
    await submitter.getByTestId("form-submit-another").click();
    await expect(
      submitter.getByTestId(`form-field-${QUESTION_IDS.title}`),
    ).toHaveValue("");
  });

  test("C. the submission created the incident the form describes", async () => {
    test.setTimeout(180000);

    const incident: JSONish = await findIncidentByTitle(ctx.submittedTitle);
    ctx.incidentId = toId(incident["_id"]);

    // The number the submitter was shown is this incident's.
    expect(
      String(incident["incidentNumberWithPrefix"] || "") ||
        `#${String(incident["incidentNumber"])}`,
    ).toBe(ctx.reference);

    // The answers, where each question puts them.
    expect(String(incident["description"])).toContain(ctx.submittedDescription);
    expect(toId(incident["incidentSeverityId"])).toBe(ctx.chosenSeverityId);

    const customFields: JSONish = (incident["customFields"] as JSONish) || {};
    expect(customFields[IMPACT_FIELD_NAME]).toBe(SUBMITTED_IMPACT);
    expect(customFields[REGION_FIELD_NAME]).toBe(SUBMITTED_REGION);
    // The field nobody was asked comes from the template.
    expect(customFields[INTERNAL_REFERENCE_FIELD_NAME]).toBe(
      TEMPLATE_INTERNAL_REFERENCE,
    );
    expect(toId(incident["createdIncidentTemplateId"])).toBe(ctx.templateId);

    // The label the settings always add; the template's only applies with none.
    const labels: Array<string> = (
      (incident["labels"] as Array<JSONish>) || []
    ).map((row: JSONish): string => {
      return toId(row["_id"]);
    });
    expect(labels).toEqual([ctx.settingsLabelId]);

    // Hidden until a responder publishes it, and declared by nobody.
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect(
      incident["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
    ).toBe(false);
    expect(incident["isPrivate"]).not.toBe(true);
    expect(toId(incident["createdByUserId"])).toBe("");

    // The template's owners own it.
    const owners: IncidentOwners = await waitForOwners({
      incidentId: ctx.incidentId,
      description: "the template's owners on the form's incident",
    });
    expect(owners.teamIds).toEqual([ctx.teamId]);
    expect(owners.userIds).toEqual([ctx.user.userId]);

    // A private note names the form, who submitted it and the other answers.
    const notes: Array<string> = await pollUntil<Array<string>>({
      page: ctx.page,
      description: "the private note the submission leaves",
      timeoutMs: 60000,
      check: async (): Promise<Array<string> | null> => {
        const found: Array<string> = await readInternalNotes(ctx.incidentId);

        return found.length > 0 ? found : null;
      },
    });
    const note: string = notes.join("\n");
    expect(note).toContain(
      `Submitted through the form **${ctx.formName}** by ${SUBMITTER_NAME} (<${SUBMITTER_EMAIL}>).`,
    );
    expect(note).toContain(`**${LABELS.office}**`);
    expect(note).toContain(SUBMITTED_OFFICE);

    // The submission, with its answers and what it created.
    const submissions: Array<JSONish> = await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/form-submission",
      query: { formId: ctx.formId },
      select: {
        _id: true,
        targetType: true,
        incidentId: true,
        scheduledMaintenanceId: true,
        submitterName: true,
        submitterEmail: true,
        answers: true,
      },
    });
    expect(submissions).toHaveLength(1);
    const submission: JSONish = submissions[0]!;
    expect(submission["targetType"]).toBe("Incident");
    expect(toId(submission["incidentId"])).toBe(ctx.incidentId);
    expect(toId(submission["scheduledMaintenanceId"])).toBe("");
    expect(submission["submitterName"]).toBe(SUBMITTER_NAME);
    expect(readEmail(submission["submitterEmail"])).toBe(SUBMITTER_EMAIL);
    const answers: string = JSON.stringify(submission["answers"]);
    expect(answers).toContain(SUBMITTED_OFFICE);
    expect(answers).toContain(SUBMITTED_IMPACT);
  });

  test("C2. the submit route takes the form's questions and nothing else, whatever a caller sends", async () => {
    test.setTimeout(120000);

    /*
     * Straight to the API, around the page, from the submitter's context -
     * still no session. Everything the form requires is answered.
     */
    const submitUrl: string = buildUrl(
      `/api/form/public/${ctx.shareKey}/submit`,
    );
    const headers: Record<string, string> = {
      "content-type": "application/json",
      tenantid: "",
    };
    const smuggledTitle: string = `Sent around the page ${ctx.unique}`;
    const answers: JSONish = {
      [QUESTION_IDS.title]: smuggledTitle,
      [QUESTION_IDS.description]: "Sent straight to the API.",
      [QUESTION_IDS.impact]: "Smuggled past the page",
      [QUESTION_IDS.name]: "Mallory Direct",
      [QUESTION_IDS.email]: "mallory.direct@example.com",
    };

    // An answer outside the options offered is refused, and creates nothing.
    const refused: APIResponse = await ctx.submitter.request.post(submitUrl, {
      headers,
      data: {
        data: {
          answers: {
            ...answers,
            [QUESTION_IDS.region]: "Mars",
            [QUESTION_IDS.severity]: "00000000-0000-4000-8000-000000000000",
          },
        },
      },
    });
    expect(refused.status()).toBe(400);
    const refusal: string = await refused.text();
    expect(refusal).toContain(
      `${LABELS.region} must be one of the options the form lists.`,
    );
    expect(refusal).toContain(
      `${LABELS.severity} must be one of the options the form lists.`,
    );
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
     * ...while answers to questions the form does not ask, and keys no
     * question has, are dropped without a word: the incident is created in
     * the form's project, exactly as the page would have had it.
     */
    const accepted: APIResponse = await ctx.submitter.request.post(submitUrl, {
      headers,
      data: {
        data: {
          answers: {
            ...answers,
            internalReference: "Chosen by the caller",
            projectId: "00000000-0000-4000-8000-000000000001",
          },
          projectId: "00000000-0000-4000-8000-000000000001",
          isVisibleOnStatusPage: true,
          createdByUserId: ctx.user.userId,
        },
      },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);

    const incident: JSONish = await findIncidentByTitle(smuggledTitle);
    const customFields: JSONish = (incident["customFields"] as JSONish) || {};
    expect(customFields[INTERNAL_REFERENCE_FIELD_NAME]).toBe(
      TEMPLATE_INTERNAL_REFERENCE,
    );
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect(toId(incident["createdByUserId"])).toBe("");
    // No severity was answered: the form's settings name it.
    expect(toId(incident["incidentSeverityId"])).toBe(ctx.formSeverityId);
  });

  test("C3. the public routes answer only the form's own page", async () => {
    test.setTimeout(120000);

    /*
     * What another site's <img> or link makes a browser send over plain
     * HTTP: a GET with no header of a page's own. Refused before anything
     * counts it, with the answer every foreign page gets.
     */
    const readUrl: string = buildUrl(`/api/form/public/${ctx.shareKey}`);
    const refused: APIResponse = await ctx.submitter.request.get(readUrl);
    expect(refused.status(), await refused.text()).toBe(403);
    expect(await refused.text()).toContain(FOREIGN_PAGE_MESSAGE);

    // A caller going around the page that sends what the page sends is answered.
    const answered: APIResponse = await ctx.submitter.request.get(readUrl, {
      headers: { [FORM_PAGE_HEADER]: FORM_PAGE_HEADER_VALUE },
    });
    expect(answered.status(), await answered.text()).toBe(200);
    expect(((await answered.json()) as JSONish)["name"]).toBe(ctx.formName);

    // Another website's page cannot submit through a visitor's browser.
    const foreign: APIResponse = await ctx.submitter.request.post(
      buildUrl(`/api/form/public/${ctx.shareKey}/submit`),
      {
        headers: {
          "content-type": "application/json",
          origin: "https://forms-e2e.example.com",
        },
        data: { data: { answers: {} } },
      },
    );
    expect(foreign.status()).toBe(403);
    expect(await foreign.text()).toContain(FOREIGN_PAGE_MESSAGE);

    // Nor post a plain HTML form at it.
    const notJson: APIResponse = await ctx.submitter.request.post(
      buildUrl(`/api/form/public/${ctx.shareKey}/submit`),
      {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        data: `data[answers][${QUESTION_IDS.title}]=Posted`,
      },
    );
    expect(notJson.status()).toBe(400);
    /*
     * Read as JSON, not searched as text: the message quotes "data", and
     * the response body escapes those quotes.
     */
    expect(((await notJson.json()) as JSONish)["message"]).toBe(
      SUBMISSION_BODY_MESSAGE,
    );
  });

  test("C4. an incident form link from before Forms opens the same form", async () => {
    test.setTimeout(120000);

    await openSubmitterPage(legacyShareLinkFor(ctx.shareKey));
    await expect(ctx.submitter).toHaveURL(shareLinkFor(ctx.shareKey), {
      timeout: 60000,
    });
    await expectFormShown();
  });

  test("D1. Forms is a product: its list, every submission, and each form's submissions lead to what was created", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    const formRow: Locator = page.getByRole("row").filter({
      hasText: ctx.formName,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/forms"),
      ready: formRow,
    });

    // The list says what each submission creates, and that it is on.
    await expect(formRow.getByTestId("form-creates")).toHaveText("Incident");
    await expect(formRow.getByTestId("form-status")).toContainText(
      "Accepting submissions",
    );

    // Forms > Submissions: every form's submissions, with the form's name.
    await page
      .getByRole("link", { name: "Submissions", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/forms\/submissions$/, { timeout: 60000 });
    const everySubmission: Locator = page
      .getByRole("row")
      .filter({ hasText: SUBMITTER_EMAIL });
    await expect(everySubmission).toBeVisible({ timeout: 60000 });
    await expect(everySubmission).toContainText(ctx.formName);
    await expect(everySubmission).toContainText(SUBMITTER_NAME);

    // A form's own Submissions: its answers, and a link to the incident.
    await openFormPage({
      path: "submissions",
      ready: (target: Page): Locator => {
        return target.getByRole("row").filter({ hasText: SUBMITTER_EMAIL });
      },
    });
    const submissionRow: Locator = page
      .getByRole("row")
      .filter({ hasText: SUBMITTER_EMAIL });
    await expect(
      submissionRow.getByRole("link", { name: `Incident ${ctx.reference}` }),
    ).toBeVisible();

    await submissionRow
      .getByRole("button", { name: "View Answers", exact: true })
      .click();
    const answers: Locator = page.getByTestId("form-submission-answers");
    await expect(answers).toBeVisible({ timeout: 60000 });
    await expect(answers).toContainText(LABELS.office);
    await expect(answers).toContainText(SUBMITTED_OFFICE);
    await expect(answers).toContainText(SUBMITTED_IMPACT);
    await page
      .getByTestId("modal")
      .getByTestId("modal-footer-close-button")
      .click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    await submissionRow
      .getByRole("link", { name: `Incident ${ctx.reference}` })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${ctx.projectId}/incidents/${ctx.incidentId}`),
      { timeout: 60000 },
    );
    await expect(page.getByText(ctx.submittedTitle).first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("D2. the builder: a question added, worded, moved and saved is what the next submitter is asked", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;

    await openFormPage({
      ready: (target: Page): Locator => {
        return target.getByTestId("form-questions");
      },
    });

    // Every question is there, in the form's order.
    for (const id of Object.values(QUESTION_IDS)) {
      await expect(page.getByTestId(`form-question-${id}`)).toBeVisible();
    }

    // A short answer from the palette: added and opened for editing.
    await page.getByTestId("form-palette-question-Text").click();
    const editor: Locator = page.locator(
      '[data-testid^="form-question-editor-"]',
    );
    await expect(editor).toHaveCount(1, { timeout: 30000 });
    const newId: string = (
      (await editor.getAttribute("data-testid")) || ""
    ).replace("form-question-editor-", "");
    expect(newId).not.toBe("");

    await page
      .getByTestId(`form-question-label-${newId}`)
      .fill("Ticket number");
    await expect(page.getByTestId("form-builder-status")).toContainText(
      "Unsaved changes",
    );

    const questions: Locator = card(page, "Questions");
    await questions
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(page.getByTestId("form-builder-status")).toContainText(
      "All changes saved",
      { timeout: 60000 },
    );

    const saved: Array<string> = questionLabels(
      (await readForm(ctx.formId))["fields"],
    );
    const at: number = saved.indexOf("Ticket number");
    expect(
      at,
      `the new question should be saved: ${saved.join(", ")}`,
    ).toBeGreaterThan(0);

    // One place up, and saved again.
    await page.getByTestId(`form-question-move-up-${newId}`).click();
    await expect(page.getByTestId("form-builder-status")).toContainText(
      "Unsaved changes",
    );
    await questions
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(page.getByTestId("form-builder-status")).toContainText(
      "All changes saved",
      { timeout: 60000 },
    );

    const moved: Array<string> = questionLabels(
      (await readForm(ctx.formId))["fields"],
    );
    expect(moved.indexOf("Ticket number")).toBe(at - 1);

    // The preview draws the same questions, and submits nothing.
    await questions
      .getByRole("button", { name: "Preview", exact: true })
      .click();
    const preview: Locator = page.locator("#form-preview-form");
    await expect(preview).toBeVisible({ timeout: 60000 });
    const expectedLabels: Array<string> = moved.map((label: string): string => {
      return [
        LABELS.severity,
        LABELS.region,
        LABELS.office,
        "Ticket number",
      ].includes(label)
        ? `${label} (Optional)`
        : label;
    });
    await expect
      .poll(
        async () => {
          return await fieldLabels(preview);
        },
        { timeout: 30000 },
      )
      .toEqual(expectedLabels);
    // Its checks are the public page's: an empty required answer is refused.
    await page.locator("#form-preview-form-submit-button").click();
    await expect(
      preview.getByText(`${LABELS.title} is required.`),
    ).toBeVisible();
    await expect(page.getByTestId("form-preview-submitted")).toHaveCount(0);

    // Filled in, it says so - and sends nothing anywhere.
    const previewRequests: Array<string> = [];
    const onRequest: (request: Request) => void = (request: Request): void => {
      if (request.url().includes("/form/public/")) {
        previewRequests.push(request.url());
      }
    };
    page.on("request", onRequest);
    await page
      .getByTestId(`form-preview-field-${QUESTION_IDS.title}`)
      .fill("Previewing the form");
    await page
      .getByTestId(`form-preview-field-${QUESTION_IDS.description}`)
      .getByRole("textbox")
      .first()
      .fill("Only a preview.");
    await page
      .getByTestId(`form-preview-field-${QUESTION_IDS.impact}`)
      .fill("None");
    await page
      .getByTestId(`form-preview-field-${QUESTION_IDS.name}`)
      .fill("Grace Preview");
    const previewEmail: Locator = page.getByTestId(
      `form-preview-field-${QUESTION_IDS.email}`,
    );
    await previewEmail.fill("grace.preview@example.com");
    await previewEmail.press("Tab");
    await page.locator("#form-preview-form-submit-button").click();
    await expect(page.getByTestId("form-preview-submitted")).toContainText(
      PREVIEW_SUBMITTED_MESSAGE,
    );
    page.off("request", onRequest);
    expect(previewRequests).toEqual([]);
    await page
      .getByTestId("modal")
      .getByTestId("modal-footer-close-button")
      .click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    // The submitter is asked the same, in the same order.
    await openSubmitterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
    await expect
      .poll(
        async () => {
          return await fieldLabels(ctx.submitter.locator("#public-form"));
        },
        { timeout: 30000 },
      )
      .toEqual(expectedLabels);

    // Nothing the preview did was submitted.
    expect(
      await listItems({
        page,
        projectId: ctx.projectId,
        path: "/api/form-submission",
        query: { formId: ctx.formId },
        select: { _id: true },
      }),
    ).toHaveLength(2);
  });

  test("D3. On Submit shows where each field comes from, and a change on its first step saves from the last", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await openFormPage({
      path: "on-submit",
      ready: (target: Page): Locator => {
        return target.getByTestId("form-mapping-rows");
      },
    });

    const mapping: Locator = card(page, "How a Submission Becomes an Incident");
    await expect(mapping.getByTestId("form-mapping-row-title")).toContainText(
      LABELS.title,
    );
    // An optional severity question, and what applies when it is left empty.
    const severityRow: Locator = mapping.getByTestId(
      "form-mapping-row-severity",
    );
    await expect(severityRow).toContainText(LABELS.severity);
    await expect(severityRow).toContainText(ctx.formSeverityName);
    await expect(mapping.getByTestId("form-mapping-row-labels")).toBeVisible();

    /*
     * Edit Settings: the Default Title on the first step. Save Changes is on
     * the last step only - the first shows a plain Next - and every step is
     * filled in already, so the step list opens the last one (Owners) to
     * save from.
     */
    await mapping
      .getByRole("button", { name: "Edit Settings", exact: true })
      .click();
    const modal: Locator = page.getByTestId("modal");
    const defaultTitle: string = `Reported through the form ${ctx.unique}`;
    await modal
      .getByRole("textbox", { name: /^Default Title/ })
      .fill(defaultTitle);
    await expect(modal.getByTestId("modal-footer-submit-button")).toHaveCount(
      0,
    );
    await expect(modal.getByTestId("modal-footer-next-button")).toHaveText(
      "Next",
    );
    await modal
      .getByRole("navigation", { name: "Progress" })
      .getByText("Owners", { exact: true })
      .click();
    await expect(modal.getByTestId("modal-footer-submit-button")).toHaveText(
      "Save Changes",
    );
    await saveModal(page);

    // Saved, and nothing else the settings held was lost.
    await expect
      .poll(
        async () => {
          return ((await readForm(ctx.formId))["targetSettings"] as JSONish)?.[
            "defaultTitle"
          ];
        },
        { timeout: 30000 },
      )
      .toBe(defaultTitle);
    expect((await readForm(ctx.formId))["targetSettings"]).toEqual(
      expect.objectContaining({
        incidentSeverityId: ctx.formSeverityId,
        incidentTemplateId: ctx.templateId,
        labelIds: [ctx.settingsLabelId],
      }),
    );
  });

  test("D4. Reset Link retires the old link at once, and the new one works", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    const oldShareKey: string = ctx.shareKey;

    await openFormPage({
      path: "share",
      ready: (target: Page): Locator => {
        return target.getByTestId("form-share-link");
      },
    });
    await expect(page.getByTestId("form-share-link")).toHaveText(
      shareLinkFor(oldShareKey),
    );

    // Open Form opens exactly that link, in a new tab.
    const openForm: Locator = page.locator("#form-open-form");
    await expect(openForm).toHaveAttribute("href", shareLinkFor(oldShareKey));
    await expect(openForm).toHaveAttribute("target", "_blank");

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
    await expect(page.getByTestId("form-share-link")).toHaveText(
      shareLinkFor(ctx.shareKey),
    );

    // The submitter's old link: the one "not available" answer.
    await openSubmitterPage(shareLinkFor(oldShareKey));
    await expectFormNotAvailable();

    // The new link opens the form.
    await openSubmitterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
  });

  test("D5. turning Accepting Submissions off takes the link down until it is on again", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await openFormPage({
      path: "share",
      ready: (target: Page): Locator => {
        return target.getByTestId("form-share-link");
      },
    });

    const accepting: Locator = page.getByRole("switch", {
      name: "Accepting Submissions",
    });
    await expect(accepting).toHaveAttribute("aria-checked", "true");
    await accepting.click();
    await expect(accepting).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });
    await expect
      .poll(
        async () => {
          return (await readForm(ctx.formId))["isEnabled"];
        },
        { timeout: 30000 },
      )
      .toBe(false);

    // The Share Link card says what a submitter now sees.
    await expect(page.getByTestId("form-share-link-turned-off")).toContainText(
      "This form is turned off, so its link shows a 'not available' message.",
      { timeout: 60000 },
    );

    await openSubmitterPage(shareLinkFor(ctx.shareKey));
    await expectFormNotAvailable();

    // And back on: the same link works again.
    await accepting.click();
    await expect(accepting).toHaveAttribute("aria-checked", "true", {
      timeout: 30000,
    });
    await expect(page.getByTestId("form-share-link-turned-off")).toHaveCount(
      0,
      {
        timeout: 60000,
      },
    );

    await openSubmitterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
  });

  test("D6. an IP allowlist that leaves this network out shuts the form to it", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await openFormPage({
      path: "share",
      ready: (target: Page): Locator => {
        return card(target, "Access");
      },
    });

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
      await modal.getByTestId("modal-footer-close-button").click();
      await expect(page.getByTestId("modal")).toHaveCount(0);
      // The card says why.
      await expect(
        access.getByTestId("form-ip-allowlist-plan-note"),
      ).toBeVisible();
      test.skip(true, "Editing the IP allowlist needs the Scale plan here.");
      return;
    }

    await expect(access.getByTestId("form-ip-allowlist")).toHaveText(
      ALLOWLIST_THAT_EXCLUDES_US,
    );

    // The submitter's network is not on the list: a clear message, no form.
    await openSubmitterPage(shareLinkFor(ctx.shareKey));
    await expectFormNotAvailable(NETWORK_NOT_ALLOWED_MESSAGE);

    // The submit route refuses too, whatever the page does.
    const refused: APIResponse = await ctx.submitter.request.post(
      buildUrl(`/api/form/public/${ctx.shareKey}/submit`),
      {
        headers: { "content-type": "application/json", tenantid: "" },
        data: {
          data: { answers: { [QUESTION_IDS.title]: "Around the page" } },
        },
      },
    );
    expect(refused.status()).toBe(403);

    // Open again for everyone.
    await updateForm({ ipWhitelist: "" });
    await openSubmitterPage(shareLinkFor(ctx.shareKey));
    await expectFormShown();
  });

  test("E. a form made in the dashboard schedules maintenance events", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;
    const maintenanceFormName: string = `Maintenance Request ${ctx.unique}`;
    const requestedTitle: string = `Upgrade the database ${ctx.unique}`;

    // Forms > Create Form: a name, and what each submission creates.
    const createButton: Locator = page
      .getByTestId("card-button")
      .filter({ hasText: "Create Form" });
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: dashboardUrl(ctx.projectId, "/forms"),
      ready: createButton,
    });
    await createButton.click();
    const modal: Locator = page.getByTestId("modal");
    await modal
      .getByRole("textbox", { name: /^Name/ })
      .fill(maintenanceFormName);
    await modal.getByTestId("card-select-option-ScheduledMaintenance").click();
    await expect(
      modal.getByTestId("card-select-option-ScheduledMaintenance"),
    ).toHaveAttribute("aria-checked", "true");
    await saveModal(page);

    // It opens on its builder, already asking when the maintenance starts and ends.
    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/${ctx.projectId}/forms/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
        "i",
      ),
      { timeout: 60000 },
    );
    const maintenanceFormId: string =
      page.url().split("/forms/")[1]?.split(/[?#/]/)[0] || "";
    await expect(page.getByTestId("form-questions")).toContainText(
      "Starts At",
      {
        timeout: 60000,
      },
    );
    await expect(page.getByTestId("form-questions")).toContainText("Ends At");

    const stored: JSONish = await readForm(maintenanceFormId);
    expect(stored["targetType"]).toBe("ScheduledMaintenance");
    expect(questionLabels(stored["fields"])).toEqual([
      "Title",
      "Description",
      "Starts At",
      "Ends At",
      "Your Name",
      "Your Email",
    ]);
    const idOf: (targetField: string) => string = (
      targetField: string,
    ): string => {
      const field: JSONish | undefined = (
        (stored["fields"] as Array<JSONish>) || []
      ).find((candidate: JSONish): boolean => {
        return (
          candidate["targetField"] === targetField ||
          candidate["submitterField"] === targetField
        );
      });

      return String(field?.["id"] || "");
    };
    const shareKey: string = toId(stored["shareKey"]);

    // A submitter asks for a two-hour window.
    await openSubmitterPage(shareLinkFor(shareKey));
    await expectFormShown(maintenanceFormName);
    await ctx.submitter
      .getByTestId(`form-field-${idOf("title")}`)
      .fill(requestedTitle);
    await ctx.submitter
      .getByTestId(`form-field-${idOf("startsAt")}`)
      .fill("2031-03-04T09:00");
    await ctx.submitter
      .getByTestId(`form-field-${idOf("endsAt")}`)
      .fill("2031-03-04T11:00");
    await ctx.submitter
      .getByTestId(`form-field-${idOf("Name")}`)
      .fill(SUBMITTER_NAME);
    const email: Locator = ctx.submitter.getByTestId(
      `form-field-${idOf("Email")}`,
    );
    await email.fill(SUBMITTER_EMAIL);
    await email.press("Tab");

    const result: JSONish = await submitForm({
      submitter: ctx.submitter,
      shareKey,
    });
    const reference: string = String(result["reference"] || "");
    expect(reference).not.toBe("");

    // The event: the window asked for, off its status pages, nobody told.
    const events: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/scheduled-maintenance",
      query: { title: requestedTitle },
      select: {
        _id: true,
        startsAt: true,
        endsAt: true,
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
        scheduledMaintenanceNumber: true,
        scheduledMaintenanceNumberWithPrefix: true,
      },
    });
    expect(events).toHaveLength(1);
    const event: JSONish = events[0]!;
    expect(readTime(event["endsAt"]) - readTime(event["startsAt"])).toBe(
      2 * 60 * 60 * 1000,
    );
    expect(event["isVisibleOnStatusPage"]).toBe(false);
    expect(event["shouldStatusPageSubscribersBeNotifiedOnEventCreated"]).toBe(
      false,
    );
    expect(
      String(event["scheduledMaintenanceNumberWithPrefix"] || "") ||
        `#${String(event["scheduledMaintenanceNumber"])}`,
    ).toBe(reference);

    // The submission says what it created.
    const submissions: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/form-submission",
      query: { formId: maintenanceFormId },
      select: {
        _id: true,
        targetType: true,
        incidentId: true,
        scheduledMaintenanceId: true,
      },
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!["targetType"]).toBe("ScheduledMaintenance");
    expect(toId(submissions[0]!["scheduledMaintenanceId"])).toBe(
      toId(event["_id"]),
    );
    expect(toId(submissions[0]!["incidentId"])).toBe("");
  });

  /*
   * Issue #4563: a template asks the form's questions its own way. One form
   * serves two cases - Application Outage requires the application and
   * hides the maintenance window, Planned Maintenance asks the window the
   * form hides and requires it - on the public page, and on the server
   * whatever sends the submission. Four submissions in all, well inside the
   * per-network budget F relies on.
   */
  test("E2. a form's templates ask its questions their own way, and the server holds each submission to them", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    const templatedFormName: string = `Department Form ${ctx.unique}`;
    const outageTitle: string = `Application outage ${ctx.unique}`;
    const plannedTitle: string = `Planned maintenance ${ctx.unique}`;

    const created: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/form",
      item: {
        projectId: ctx.projectId,
        name: templatedFormName,
        targetType: "Incident",
        fields: [
          {
            id: "what",
            source: "TargetField",
            targetField: "title",
            label: "What is happening?",
            isRequired: true,
          },
          {
            id: "app",
            source: "Question",
            type: "Text",
            label: "Application Name",
            isRequired: false,
          },
          {
            id: "window",
            source: "Question",
            type: "Text",
            label: "Maintenance Window",
            isRequired: false,
            isHidden: true,
          },
        ],
        targetSettings: { incidentSeverityId: ctx.formSeverityId },
        templates: [
          {
            id: "outage",
            name: "Application Outage",
            answers: { what: outageTitle, window: "Not planned" },
            fieldSettings: { app: "Required", window: "Hidden" },
          },
          {
            id: "planned",
            name: "Planned Maintenance",
            answers: { what: plannedTitle, window: "Saturday 02:00" },
            fieldSettings: { app: "Optional", window: "Required" },
          },
        ],
      },
    });
    const formId: string = toId(created["_id"]);
    const shareKey: string = await readShareKey(formId);
    expect(shareKey).toMatch(UUID_PATTERN);

    // The link that names Application Outage opens the form as it asks it.
    const formResponsePromise: Promise<Response> =
      ctx.submitter.waitForResponse(
        (response: Response): boolean => {
          return (
            response.url().endsWith(`/form/public/${shareKey}`) &&
            response.request().method() === "GET"
          );
        },
        { timeout: 60000 },
      );
    await openSubmitterPage(`${shareLinkFor(shareKey)}?template=outage`);
    const publicForm: JSONish = (await (
      await formResponsePromise
    ).json()) as JSONish;
    await expectFormShown(templatedFormName);

    // The page is told how each template asks, and only answers it may show.
    expect(
      ((publicForm["templates"] as Array<JSONish>) || []).map(
        (template: JSONish): unknown => {
          return [template["id"], template["fieldSettings"]];
        },
      ),
    ).toEqual([
      ["outage", { app: "Required", window: "Hidden" }],
      ["planned", { app: "Optional", window: "Required" }],
    ]);
    expect(JSON.stringify(publicForm)).not.toContain("Not planned");

    const form: Locator = ctx.submitter.locator("#public-form");
    await expect
      .poll(
        async (): Promise<Array<string>> => {
          return fieldLabels(form);
        },
        { timeout: 60000 },
      )
      .toEqual(["What is happening?", "Application Name"]);
    await expect(ctx.submitter.getByTestId("form-field-what")).toHaveValue(
      outageTitle,
    );
    await expect(ctx.submitter.getByTestId("form-field-window")).toHaveCount(0);

    // Required by the template: refused in the browser, and nothing is sent.
    const submits: Array<string> = [];
    const recordSubmit: (request: Request) => void = (
      request: Request,
    ): void => {
      if (
        request.url().includes(`/form/public/${shareKey}/submit`) &&
        request.method() === "POST"
      ) {
        submits.push(request.url());
      }
    };
    ctx.submitter.on("request", recordSubmit);
    await ctx.submitter.locator("#public-form-submit-button").click();
    await expect(
      ctx.submitter.getByText("Application Name is required."),
    ).toBeVisible({ timeout: 60000 });
    expect(submits).toEqual([]);
    ctx.submitter.off("request", recordSubmit);

    // Answered, it is created, and the submission keeps exactly what was asked.
    const app: Locator = ctx.submitter.getByTestId("form-field-app");
    await app.fill("Checkout");
    await app.press("Tab");
    const result: JSONish = await submitForm({
      submitter: ctx.submitter,
      shareKey,
    });
    expect(String(result["reference"] || "")).not.toBe("");
    await findIncidentByTitle(outageTitle);

    // Around the page, the server holds each submission to its template.
    const submitUrl: string = buildUrl(`/api/form/public/${shareKey}/submit`);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      tenantid: "",
    };
    /*
     * A title no other test in this file uses: C2's smuggledTitle is "Sent
     * around the page ..." and C2's submission creates that incident, so
     * reusing it here found C2's incident and blamed these refused ones.
     */
    const aroundThePage: string = `Refused by its template ${ctx.unique}`;

    const noApp: APIResponse = await ctx.submitter.request.post(submitUrl, {
      headers,
      data: {
        data: { templateId: "outage", answers: { what: aroundThePage } },
      },
    });
    expect(noApp.status()).toBe(400);
    expect(await noApp.text()).toContain("Application Name is required.");

    // Planned Maintenance asks the window the form hides, and requires it.
    const noWindow: APIResponse = await ctx.submitter.request.post(submitUrl, {
      headers,
      data: {
        data: { templateId: "planned", answers: { what: aroundThePage } },
      },
    });
    expect(noWindow.status()).toBe(400);
    expect(await noWindow.text()).toContain("Maintenance Window is required.");
    expect(
      await listItems({
        page,
        projectId: ctx.projectId,
        path: "/api/incident",
        query: { title: aroundThePage },
        select: { _id: true },
      }),
    ).toHaveLength(0);

    const planned: APIResponse = await ctx.submitter.request.post(submitUrl, {
      headers,
      data: {
        data: {
          templateId: "planned",
          answers: { what: plannedTitle, window: "Sunday 03:00" },
        },
      },
    });
    expect(planned.status(), await planned.text()).toBe(200);

    /*
     * What each submission kept: the questions its template asked, and -
     * for Application Outage, which hides the window - the template's own
     * answer to it, never shown to the submitter.
     */
    const submissions: Array<JSONish> = await listItems({
      page,
      projectId: ctx.projectId,
      path: "/api/form-submission",
      query: { formId },
      select: { _id: true, answers: true },
    });
    expect(
      submissions
        .map((submission: JSONish): string => {
          return JSON.stringify(
            ((submission["answers"] as Array<JSONish>) || []).map(
              (answer: JSONish): unknown => {
                return [answer["fieldId"], answer["value"]];
              },
            ),
          );
        })
        .sort(),
    ).toEqual(
      [
        JSON.stringify([
          ["what", outageTitle],
          ["app", "Checkout"],
          ["window", "Not planned"],
        ]),
        JSON.stringify([
          ["what", plannedTitle],
          ["window", "Sunday 03:00"],
        ]),
      ].sort(),
    );
  });

  test("F. past the submit limit the submitter is told to wait", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    /*
     * A form of its own, so the budget spent here is this form's and no
     * earlier submission counts towards it. The limit is per form and
     * network (FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW, 10 in 15
     * minutes unless the stack lowers it), and refused submissions count too.
     */
    const limitedForm: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/form",
      item: {
        projectId: ctx.projectId,
        name: `Rate Limited Form ${ctx.unique}`,
        targetType: "Incident",
        fields: [
          {
            id: "what",
            source: "TargetField",
            targetField: "title",
            label: "What is wrong?",
            isRequired: true,
          },
        ],
        targetSettings: { incidentSeverityId: ctx.formSeverityId },
      },
    });
    const limitedShareKey: string = await readShareKey(
      toId(limitedForm["_id"]),
    );
    expect(limitedShareKey).toMatch(UUID_PATTERN);

    await openSubmitterPage(shareLinkFor(limitedShareKey));
    const title: Locator = ctx.submitter.getByTestId("form-field-what");
    await expect(title).toBeVisible({ timeout: 60000 });

    /*
     * Spend the budget from the submitter's own network with submissions
     * the server refuses (no title), which create nothing. Bounded: the
     * default limit is 10, so no 429 within 20 tries means there is no limit
     * at all.
     */
    let attempts: number = 0;
    let lastStatus: number = 0;
    while (attempts < 20) {
      attempts++;
      const response: APIResponse = await ctx.submitter.request.post(
        buildUrl(`/api/form/public/${limitedShareKey}/submit`),
        {
          headers: { "content-type": "application/json", tenantid: "" },
          data: { data: { answers: { what: "" } } },
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

    // The submitter, from the same network, fills the form in and is told why.
    const typedTitle: string = `One submission too many ${ctx.unique}`;
    await title.fill(typedTitle);
    await title.press("Tab");
    await ctx.submitter.locator("#public-form-submit-button").click();

    const submitError: Locator = ctx.submitter.getByTestId("form-submit-error");
    await expect(submitError).toBeVisible({ timeout: 60000 });
    await expect(submitError).toContainText(SUBMIT_RATE_LIMIT_MESSAGE);
    await expect(submitError).toContainText(/You can try again in/);

    // What they typed is still there to send later, and nothing was created.
    await expect(title).toHaveValue(typedTitle);
    expect(
      await listItems({
        page,
        projectId: ctx.projectId,
        path: "/api/incident",
        query: { title: typedTitle },
        select: { _id: true },
      }),
    ).toHaveLength(0);
  });
});
