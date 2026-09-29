import IncidentFormMessage from "../../../FeatureSet/Accounts/src/Utils/IncidentFormMessage";
import IncidentCustomFieldCreateSettingsCopy from "../../../FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import IncidentFormCopy from "../../../FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormCopy";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, {
  LocalizedNavGroup,
  LocalizedNavLink,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentFormSubmission from "Common/Models/DatabaseModels/IncidentFormSubmission";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import {
  INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH,
  INCIDENT_FORM_FOREIGN_PAGE_MESSAGE,
  INCIDENT_FORM_SUBMISSION_BODY_MESSAGE,
} from "Common/Server/API/IncidentFormAPI";
import IncidentFormRateLimit, {
  INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
  IncidentFormRateLimitBucket,
  IncidentFormRateLimitBucketConfig,
} from "Common/Server/Middleware/IncidentFormRateLimit";
import {
  INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  INCIDENT_FORM_NO_SEVERITY_MESSAGE,
  INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
  INCIDENT_FORM_TITLE_TOO_LONG_MESSAGE,
  getIncidentFormReporterNote,
} from "Common/Server/Services/IncidentFormService";
import slugify from "Common/Server/Types/MarkdownSlugify";
import SameOriginRequest from "Common/Server/Utils/SameOriginRequest";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldValueValidationError,
  validateCustomFieldValues,
} from "Common/Types/CustomField/CustomFieldValueValidator";
import { isValidCustomFieldVariableKey } from "Common/Types/CustomField/CustomFieldVariableKey";
import { validateIncidentFormIpAllowlist } from "Common/Types/Incident/IncidentFormIpAllowlist";
import {
  INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
  INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
  INCIDENT_FORM_MULTI_SELECT_MAX_CHOICES,
  INCIDENT_FORM_QUESTION_LABELS,
  INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
  INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
  INCIDENT_FORM_TITLE_MAX_LENGTH,
  IncidentFormAskedDefinition,
  IncidentFormSubmissionValidationResult,
  validateIncidentFormSubmission,
} from "Common/Types/Incident/IncidentFormPublic";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import { neutralizeUntrustedMarkdown } from "Common/Utils/Markdown/UntrustedMarkdown";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Incident Forms page, and the incident pages that point at it, against
 * the product they describe: public incident forms, and an incident
 * template's per-field Custom Fields on Create settings.
 *
 * Markdown is not compiled, so nothing else notices when the nav loses the
 * page, the Persian translation falls behind the English one, a UI name the
 * dashboard, the public page and the docs share drifts, or a page goes back
 * to telling API users they can declare from a template. The UI names below
 * are the feature's copy glossary: the dashboard pages and the public form
 * page render the same English strings.
 *
 * Everything the pages state that lives in code is read from it, so a change
 * there fails here until the docs follow: who may set
 * createdIncidentTemplateId, how workflows create incidents, which roles may
 * edit a template or a custom field; every limit an answer is held to; every
 * sentence a refusal is worded with, from the server, the public page's
 * locale and the dashboard's copy; the rate limiter's environment variables
 * and their defaults; the private note a report leaves; and what a report's
 * Markdown is stored as.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const LOCALES_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Locales");

// Creates any model a workflow's "Create One ..." component names.
const WORKFLOW_CREATE_COMPONENT_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel.ts",
);
const INCIDENT_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentService.ts",
);
// Reads its limits from the environment, each with a default.
const RATE_LIMIT_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Middleware/IncidentFormRateLimit.ts",
);
// Takes a deleted field off every form's questions.
const INCIDENT_CUSTOM_FIELD_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentCustomFieldService.ts",
);
// The public form page's own words, keyed by the page's lookups.
const ACCOUNTS_ENGLISH_LOCALE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Accounts/src/Locales/en.json",
);
// Where a self-hosted installation's app container gets its environment.
const DOCKER_COMPOSE_FILE: string = path.join(
  REPO_ROOT,
  "..",
  "docker-compose.base.yml",
);
const HELM_TEMPLATES_DIR: string = path.join(
  REPO_ROOT,
  "..",
  "HelmChart/Public/oneuptime/templates",
);

const FORMS_PAGE: string = "incidents/forms";
const SETTINGS_PAGE: string = "incidents/settings";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const OVERVIEW_PAGE: string = "incidents/index";
const NOTES_PAGE: string = "incidents/notes-owners-and-feed";
const STATUS_PAGE_SCOPE_PAGE: string =
  "status-pages/one-status-page-per-audience";

const FORMS_TITLE: string = "Incident Forms";
const FORMS_URL: string = `/docs/${FORMS_PAGE}`;
const NAV_GROUP_TITLE: string = "Incidents";
// The nav entry the forms page follows: forms build on templates and custom fields.
const PRECEDING_NAV_TITLE: string = "Incident Settings & Automation";

// `fa` is the only translated corpus; every other language falls back to English.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

// Arabic-script letters, which every Persian sentence contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;
const FENCE_LINE: RegExp = /^\s*```/;
const ANY_HEADING: RegExp = /^(#{1,6}) (.*)$/;
// The right-to-left mark the Persian pages put before a heading that starts with a Latin word.
const RIGHT_TO_LEFT_MARK: RegExp = /^‏/;

/*
 * The on-screen names the forms page uses, as the dashboard's Forms pages
 * and the public form page show them. UI names stay English, in bold, in
 * every language.
 */
const FORM_UI_NAMES: ReadonlyArray<string> = [
  // Incidents > Settings > Forms, and its list card.
  "Forms",
  "Incident Forms",
  // The form's page.
  "Form Details",
  "Enabled",
  "Share Link",
  "Copy Link",
  "Open Form",
  "Reset Link",
  "Incident Settings",
  "Severity",
  "Let Reporter Choose Severity",
  "Incident Template",
  "Form Settings",
  "Description Question",
  "Require Reporter Details",
  "Success Message",
  "Questions",
  "Not Asked",
  "Optional",
  "Required",
  "Hidden",
  "Access",
  "IP Allowlist",
  "Submissions",
  "Submitted At",
  "Reporter Name",
  "Reporter Email",
  "Incident",
  "View Incident",
  // The public form page.
  "Title",
  "Description",
  "Your Name",
  "Your Email",
  "Submit",
];

// The incident number the page's thank-you line is quoted with.
const EXAMPLE_INCIDENT_NUMBER: string = "INC-42";

/*
 * The refusals the forms page quotes as the server words them, for a request
 * that is not the page's own. The public page never meets these - it is
 * served from the instance's own address and always sends JSON.
 */
const SERVER_ONLY_SENTENCES: ReadonlyArray<string> = [
  INCIDENT_FORM_FOREIGN_PAGE_MESSAGE,
  INCIDENT_FORM_SUBMISSION_BODY_MESSAGE,
];

/*
 * The server's refusals the forms page says a reporter sees. The page shows
 * each one as the server sends it (and translates it): IncidentFormMessage
 * holds every sentence it knows, and IncidentFormServerMessages.test.ts in
 * Common keeps those equal to the server's constants.
 */
const SENTENCES_THE_PAGE_SHOWS: ReadonlyArray<string> = [
  INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
  INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  INCIDENT_FORM_NO_SEVERITY_MESSAGE,
  INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  IncidentFormMessage.CaptchaFailed,
];

// The API routes the page names: the two resources, and the public page's own two.
const API_ROUTES: ReadonlyArray<string> = [
  "/api/incident-form",
  "/api/incident-form-submission",
  "GET /api/incident-form/public/<shareKey>",
  "POST /api/incident-form/public/<shareKey>/submit",
];

const FORM_PERMISSIONS: ReadonlyArray<string> = [
  "Create Incident Form",
  "Edit Incident Form",
  "Delete Incident Form",
  "Read Incident Form",
  "Delete Incident Form Submission",
  "Read Incident Form Submission",
];

// Only incident admins manage forms: a form lets anyone page the on-call team.
const FORM_ADMIN_ROLES: ReadonlyArray<string> = [
  "Incident Admin",
  "Project Admin",
  "Project Owner",
];

// The template setting, and the options each field can take.
const TEMPLATE_SETTING_NAME: string = "Custom Fields on Create";
const TEMPLATE_SETTING_OPTIONS: ReadonlyArray<string> = [
  "Default",
  "Required",
  "Optional",
  "Hidden",
];

// Each language's headings for the sections checked below.
const TEMPLATES_SECTION: Record<string, string> = {
  en: "Incident templates",
  fa: "قالب‌های حادثه",
};
const TEMPLATE_SETTING_SECTION: Record<string, string> = {
  en: "Custom fields on create",
  fa: "فیلدهای سفارشی هنگام ساخت",
};
const DASHBOARD_ONLY_SECTION: Record<string, string> = {
  en: "Required on Create is checked by the dashboard only",
  fa: "Required on Create فقط در داشبورد بررسی می‌شود",
};
const DETAILS_SECTION: Record<string, string> = {
  en: "Details — your incident custom fields",
  fa: "Details — فیلدهای سفارشی حادثه شما",
};
const STEP_ONE_SECTION: Record<string, string> = {
  en: "Step 1 — Incident Details",
  fa: "گام ۱ — Incident Details",
};
const WAYS_SECTION: Record<string, string> = {
  en: "Five ways an incident gets declared",
  fa: "پنج راه اعلام حادثه",
};
const SETTINGS_TABLE_SECTION: Record<string, string> = {
  en: "Where incident settings live",
  fa: "تنظیمات حادثه کجا زندگی می‌کنند",
};
const OVERVIEW_TABLE_SECTION: Record<string, string> = {
  en: "Where incidents live in the dashboard",
  fa: "حادثه‌ها در داشبورد کجا زندگی می‌کنند",
};

// How each language says the facts the page must state.
const HIDDEN_UNTIL_PUBLISHED: Record<string, string> = {
  en: "Until a responder publishes it, nothing about the incident reaches a status page or a subscriber",
  fa: "تا وقتی پاسخ‌دهنده‌ای منتشرش نکند، هیچ‌چیز از حادثه به صفحه وضعیت یا مشترکی نمی‌رسد",
};
const OFF_WORD: Record<string, string> = {
  en: "is off",
  fa: "خاموش است",
};
const NO_CUSTOM_FIELD_UNTIL_ADDED: Record<string, string> = {
  en: "A form asks no incident custom field until you add it.",
  fa: "فرم هیچ فیلد سفارشی حادثه‌ای را تا وقتی آن را نیفزایید نمی‌پرسد.",
};
const NOT_ASKED_IS_DEFAULT: Record<string, string> = {
  en: "- **Not Asked** — the default.",
  fa: "- **Not Asked** — پیش‌فرض.",
};
// Why: a public form shows every field it asks, with every dropdown option.
const PUBLIC_FORM_SHOWS_OPTIONS: Record<string, string> = {
  en: "a dropdown shows every one of its options",
  fa: "فهرست کشویی همه گزینه‌هایش را نشان می‌دهد",
};
const NO_ACCOUNT_NEEDED: Record<string, string> = {
  en: "Anyone with the link can open the form and submit it, without a OneUptime account and without signing in.",
  fa: "هر کسی که پیوند را دارد می‌تواند فرم را باز و ارسال کند، بدون حساب OneUptime و بدون ورود.",
};
const PUBLIC_ROUTES_ARE_THE_PAGES_OWN: Record<string, string> = {
  en: "They are the page's own endpoints, not an API to build on",
  fa: "این‌ها نقطه‌های پایانی خود صفحه‌اند، نه APIای برای ساختن چیزی روی آن",
};
const ONLY_THE_DASHBOARD_APPLIES_THEM: Record<string, string> = {
  en: "**Only the dashboard applies them.**",
  fa: "**فقط داشبورد آن‌ها را اعمال می‌کند.**",
};
const HIDDEN_KEEPS_TEMPLATE_VALUE: Record<string, string> = {
  en: "The template's own value for it is still applied.",
  fa: "مقدار خود قالب برای آن همچنان اعمال می‌شود.",
};
const TEMPLATE_EDITORS_CAN_CHANGE_THEM: Record<string, string> = {
  en: "**Anyone who can edit incident templates can change them**",
  fa: "**هر کسی که بتواند قالب‌های حادثه را ویرایش کند می‌تواند آن‌ها را تغییر دهد**",
};
const DETAILS_STEP_IS_DASHBOARD_ONLY_TOO: Record<string, string> = {
  en: "**Required on Create** is checked by the dashboard only, and so is a template's **Custom Fields on Create**.",
  fa: "**Required on Create** فقط در داشبورد بررسی می‌شود، و **Custom Fields on Create** یک قالب هم همین‌طور.",
};

/*
 * createdIncidentTemplateId: the wording that told API users to send it, and
 * the words every remaining mention must carry instead - that a workflow or
 * an incident form sets it, or that a request sending it is refused.
 */
const STALE_TEMPLATE_ID_CLAIMS: Record<string, ReadonlyArray<string>> = {
  en: [
    "pass `createdIncidentTemplateId` on `POST /api/incident`",
    "`createdIncidentTemplateId` — apply a saved template",
    "if `createdIncidentTemplateId` was supplied",
    "**From the API**",
  ],
  fa: [
    "مقدار `createdIncidentTemplateId` را در `POST /api/incident` بدهید",
    "`createdIncidentTemplateId` — قالبی ذخیره‌شده را اعمال کنید",
    "اگر `createdIncidentTemplateId` داده شده باشد",
    "**از API**",
  ],
};
const TEMPLATE_ID_SETTERS: Record<string, ReadonlyArray<string>> = {
  en: ["workflow", "is refused"],
  fa: ["گردش کار", "رد می‌شود"],
};
const TEMPLATE_ID_REFUSED: Record<string, string> = {
  en: "a request that sends `createdIncidentTemplateId` is refused",
  fa: "درخواستی که `createdIncidentTemplateId` بفرستد رد می‌شود",
};
// How the declaring page's note on it starts: a paragraph after the field list.
const TEMPLATE_ID_NOTE_START: Record<string, string> = {
  en: "An API key cannot declare from a template",
  fa: "کلید API نمی‌تواند از روی قالب اعلام کند",
};
/*
 * The status page guide's paragraph on a template whose pages were all
 * deleted, and how it used to say such an incident is declared.
 */
const TEMPLATES_WORK_THE_SAME_WAY: Record<string, string> = {
  en: "Incident templates work the same way.",
  fa: "قالب‌های حادثه هم همین‌گونه کار می‌کنند.",
};
const STALE_TEMPLATE_API_DECLARATIONS: Record<string, string> = {
  en: "declared from it through the API",
  fa: "از راه API از روی آن اعلام",
};

// The forms page's sections the checks below read, in each language.
const THE_INCIDENT_TEMPLATE_SECTION: Record<string, string> = {
  en: "The incident template",
  fa: "قالب حادثه",
};
const FORM_CUSTOM_FIELDS_SECTION: Record<string, string> = {
  en: "Custom fields",
  fa: "فیلدهای سفارشی",
};
const TEXT_A_REPORTER_WRITES_SECTION: Record<string, string> = {
  en: "Text a reporter writes",
  fa: "متنی که گزارش‌دهنده می‌نویسد",
};
const IP_ALLOWLIST_SECTION: Record<string, string> = {
  en: "IP allowlist",
  fa: "فهرست مجاز IP",
};
const OTHER_WEBSITES_SECTION: Record<string, string> = {
  en: "Requests from other websites",
  fa: "درخواست‌هایی از وب‌سایت‌های دیگر",
};
const RATE_LIMITS_SECTION: Record<string, string> = {
  en: "Rate limits",
  fa: "محدودیت‌های نرخ",
};
const SIZE_LIMITS_SECTION: Record<string, string> = {
  en: "Size limits",
  fa: "محدودیت‌های اندازه",
};
const SUBMISSIONS_SECTION: Record<string, string> = {
  en: "Submissions",
  fa: "ارسال‌ها",
};
const PUBLIC_ENDPOINTS_SECTION: Record<string, string> = {
  en: "The public page's own endpoints",
  fa: "نقطه‌های پایانی خود صفحه عمومی",
};
// And the settings page's.
const RENAMING_A_FIELD_SECTION: Record<string, string> = {
  en: "Renaming a field",
  fa: "تغییر نام فیلد",
};
const API_VALUES_SECTION: Record<string, string> = {
  en: "Custom field values through the API",
  fa: "مقادیر فیلدهای سفارشی از راه API",
};

// The Size limits rows whose first cell is not a question's on-screen name.
const CUSTOM_FIELD_ANSWER_ROW: Record<string, string> = {
  en: "A custom field's answer",
  fa: "پاسخ یک فیلد سفارشی",
};
const MULTI_SELECT_ANSWER_ROW: Record<string, string> = {
  en: "A multi-select answer",
  fa: "پاسخ فیلد چندانتخابی",
};

/*
 * With a template, an optional question the reporter left empty takes the
 * template's value too (the validator leaves an empty answer out, and the
 * template's values are merged under the answers) - not only the fields the
 * form does not ask, as the page once said.
 */
const TEMPLATE_FILLS_UNANSWERED_QUESTIONS: Record<string, string> = {
  en: "the fields the form does not ask, and optional questions left empty",
  fa: "فیلدهایی که فرم نمی‌پرسد، و پرسش‌های اختیاری‌ای که خالی مانده‌اند",
};
const STALE_TEMPLATE_FILL_CLAIMS: Record<string, string> = {
  en: "the template's values fill in the fields the form does not ask, and the reporter's answers win over them",
  fa: "مقادیر قالب فیلدهایی را که فرم نمی‌پرسد پر می‌کنند، و پاسخ‌های گزارش‌دهنده بر آن‌ها برنده‌اند",
};
const MAPPED_FIELD_NOT_ASKED: Record<string, string> = {
  en: "**A field copied from a monitor custom field is not asked when the form's incident template attaches monitors.**",
  fa: "**فیلدی که از فیلد سفارشی مانیتور کپی می‌شود، وقتی قالب حادثه فرم مانیتورهایی پیوست می‌کند پرسیده نمی‌شود.**",
};
const DELETED_FIELD_LEAVES_EVERY_FORM: Record<string, string> = {
  en: "Deleting an incident custom field takes it off the questions of every form in the project",
  fa: "حذف یک فیلد سفارشی حادثه آن را از پرسش‌های همه فرم‌های پروژه برمی‌دارد",
};
const DELETED_FIELD_LEAVES_EVERY_FORM_ON_SETTINGS: Record<string, string> = {
  en: "Deleting a field also takes it off the questions of every [incident form](/docs/incidents/forms) in the project",
  fa: "حذف یک فیلد همچنین آن را از پرسش‌های همه [فرم‌های حادثه](/docs/incidents/forms) پروژه برمی‌دارد",
};
const DELETED_INCIDENT_SUBMISSIONS_FOR_ADMINS: Record<string, string> = {
  en: "only project owners and project admins see the submission",
  fa: "فقط مالکان پروژه و مدیران پروژه ارسال را می‌بینند",
};
// How the settings page says how many refused multi-select entries a refusal names.
const LISTED_REFUSED_ENTRIES: Record<string, (count: number) => string> = {
  en: (count: number): string => {
    return `the refusal names the first ${count} entries that are not among its options`;
  },
  fa: (count: number): string => {
    return `پیام رد ${count} مدخل نخستی را که در میان گزینه‌هایش نیستند نام می‌برد`;
  },
};

// The report the forms page shows the private note for.
const EXAMPLE_NOTE_REPORT: {
  formName: string;
  reporterName: string;
  reporterEmail: string;
} = {
  formName: "Report a problem",
  reporterName: "Ada Lovelace",
  reporterEmail: "ada@example.com",
};
// An image in a report's description, as the forms page shows it written.
const EXAMPLE_REPORT_IMAGE: string = "![](https://example.com/status.png)";
// An IP allowlist whose second line can never match: the page quotes its refusal.
const EXAMPLE_REFUSED_IP_ALLOWLIST: string = "10.0.0.0/8\n2001:db8::/32";
// Inline code that is an address or a range: the entries the page offers as examples.
const IP_ALLOWLIST_ENTRY_PATTERN: RegExp =
  /^[0-9a-f:.]*[0-9][0-9a-f:.]*(\/\d+)?$/i;
// The instance address the page describes the own-page check with.
const EXAMPLE_INSTANCE_ORIGIN: string = "https://oneuptime.example.com";
// The two questions the page quotes the list refusals for.
const EXAMPLE_DROPDOWN_QUESTION: IncidentFormAskedDefinition = {
  name: "Impact",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "High\nLow",
  isRequiredOnCreate: false,
};
const EXAMPLE_MULTI_SELECT_QUESTION: IncidentFormAskedDefinition = {
  name: "Affected Systems",
  customFieldType: CustomFieldType.MultiSelectDropdown,
  dropdownOptions: "API\nWeb\nMobile",
  isRequiredOnCreate: false,
};

// The old count of ways in, before incident forms.
const STALE_WAY_COUNTS: Record<string, ReadonlyArray<string>> = {
  en: ["Four ways", "four ways", "all four", "All four", "Four routes"],
  fa: ["چهار راه", "هر چهار", "چهار مسیر"],
};
const FIVE_WAYS_IN: Record<string, string> = {
  en: "**Five ways in**",
  fa: "**پنج راه ورود**",
};
const FIVE_ROUTES: Record<string, string> = {
  en: "Five routes lead to the same object:",
  fa: "پنج مسیر به همان شیء می‌رسند:",
};

// Where the Markdown editor's list and paste handling is mentioned.
const EDITOR_WORDS: ReadonlyArray<string> = [
  "**Indent**",
  "**Outdent**",
  "Tab",
  "Shift+Tab",
  "Word",
  "Google Docs",
];

interface MarkdownParts {
  prose: Array<string>;
  codeBlocks: Array<string>;
}

interface Heading {
  level: number;
  text: string;
  slug: string;
}

type PageFileFunction = (language: string, relative: string) => string;

const pageFile: PageFileFunction = (
  language: string,
  relative: string,
): string => {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
};

type ReadPageFunction = (relative: string, language: string) => string;

const readPage: ReadPageFunction = (
  relative: string,
  language: string,
): string => {
  return fs.readFileSync(pageFile(language, relative), "utf8");
};

type ReadSourceFunction = (file: string) => string;

const readSource: ReadSourceFunction = (file: string): string => {
  return fs.readFileSync(file, "utf8");
};

type SplitMarkdownFunction = (markdown: string) => MarkdownParts;

// Prose lines and fenced code blocks, kept apart so nothing is read out of a fence.
const splitMarkdown: SplitMarkdownFunction = (
  markdown: string,
): MarkdownParts => {
  const prose: Array<string> = [];
  const codeBlocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        codeBlocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    } else {
      prose.push(line);
    }
  }

  return { prose: prose, codeBlocks: codeBlocks };
};

type HeadingsFunction = (markdown: string) => Array<Heading>;

// Every heading outside a fence, with the id the docs renderer gives it.
const headingsOf: HeadingsFunction = (markdown: string): Array<Heading> => {
  const headings: Array<Heading> = [];

  for (const line of splitMarkdown(markdown).prose) {
    const match: RegExpMatchArray | null = line.match(ANY_HEADING);

    if (match) {
      const text: string = (match[2] as string).trim();

      headings.push({
        level: (match[1] as string).length,
        text: text,
        slug: slugify(text),
      });
    }
  }

  return headings;
};

type SectionFunction = (
  markdown: string,
  level: number,
  headingText: string,
) => string;

/*
 * The markdown under a heading of this level and text, code blocks included,
 * down to the next heading of the same or a higher level (so an H2's section
 * includes its H3s). A `#` inside a fence is not a heading. A leading
 * right-to-left mark is ignored when matching.
 */
const sectionOf: SectionFunction = (
  markdown: string,
  level: number,
  headingText: string,
): string => {
  const lines: Array<string> = markdown.split("\n");
  let start: number = -1;
  let inFence: boolean = false;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(ANY_HEADING);

    if (!match) {
      continue;
    }

    const lineLevel: number = (match[1] as string).length;
    const text: string = (match[2] as string)
      .replace(RIGHT_TO_LEFT_MARK, "")
      .trim();

    if (start === -1) {
      if (lineLevel === level && text === headingText) {
        start = index;
      }
      continue;
    }

    if (lineLevel <= level) {
      return lines.slice(start + 1, index).join("\n");
    }
  }

  expect({ heading: headingText, found: start !== -1 }).toEqual({
    heading: headingText,
    found: true,
  });

  return lines.slice(start + 1).join("\n");
};

type SetOfFunction = (markdown: string) => Set<string>;

// Every **bold** span in the prose: how the docs name what is on screen.
const boldText: SetOfFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

// Every `inline code` span in the prose.
const inlineCode: SetOfFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

interface DocsLink {
  page: string;
  anchor: string | undefined;
}

type DocsLinksFunction = (markdown: string) => Array<DocsLink>;

// Every /docs/ link, split into the page and its #anchor, if any.
const docsLinks: DocsLinksFunction = (markdown: string): Array<DocsLink> => {
  return Array.from(
    markdown.matchAll(/\]\(\/docs\/([^)#\s]+)(?:#([^)\s]*))?\)/g),
  ).map((match: RegExpMatchArray): DocsLink => {
    return { page: match[1] as string, anchor: match[2] };
  });
};

type LinkedPagesFunction = (markdown: string) => Array<string>;

const linkedPages: LinkedPagesFunction = (markdown: string): Array<string> => {
  return docsLinks(markdown)
    .map((link: DocsLink): string => {
      return link.page;
    })
    .sort();
};

type InPageLinksFunction = (markdown: string) => Array<string>;

// Every in-page `](#anchor)` link target, in order.
const inPageLinks: InPageLinksFunction = (markdown: string): Array<string> => {
  return Array.from(markdown.matchAll(/\]\(#([^)\s]+)\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

type TitleOfFunction = (markdown: string) => string;

const titleOf: TitleOfFunction = (markdown: string): string => {
  const firstLine: string = markdown.split("\n")[0] || "";

  expect(firstLine.startsWith("# ")).toBe(true);

  return firstLine.slice(2).trim();
};

type TableRowsFunction = (markdown: string) => Array<string>;

// The table rows of some prose, header and divider included.
const tableRows: TableRowsFunction = (markdown: string): Array<string> => {
  return splitMarkdown(markdown).prose.filter((line: string): boolean => {
    return line.trim().startsWith("|");
  });
};

type TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
) => string | undefined;

const tableRowStartingWith: TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
): string | undefined => {
  return tableRows(markdown).find((line: string): boolean => {
    return (line.split("|")[1] || "").trim() === firstCell;
  });
};

type TableCellsFunction = (row: string) => Array<string>;

// The cells of a markdown table row, trimmed, without the empty outer ones.
const tableCells: TableCellsFunction = (row: string): Array<string> => {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
};

type ListedNamesFunction = (cell: string) => Array<string>;

// The names in a comma-separated table cell, in either language's comma.
const listedNames: ListedNamesFunction = (cell: string): Array<string> => {
  return cell
    .split(/[,،]/)
    .map((name: string): string => {
      return name.trim();
    })
    .sort();
};

interface DocsLocale {
  navLinks: { [key: string]: string };
}

type ReadLocaleFunction = (language: string) => DocsLocale;

const readLocale: ReadLocaleFunction = (language: string): DocsLocale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as DocsLocale;
};

type IncidentsGroupFunction = () => NavGroup;

const incidentsGroup: IncidentsGroupFunction = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === NAV_GROUP_TITLE;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
};

type LinesWithFunction = (markdown: string, text: string) => Array<string>;

// The prose lines that contain some text.
const proseLinesWith: LinesWithFunction = (
  markdown: string,
  text: string,
): Array<string> => {
  return splitMarkdown(markdown).prose.filter((line: string): boolean => {
    return line.includes(text);
  });
};

const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

type WesternDigitsFunction = (text: string) => string;

/*
 * Text with its Persian digits written as ASCII ones and the thousands
 * separators between digit groups ("20,000", "۲۰٬۰۰۰") taken out, so a
 * number reads the same in either language.
 */
const westernDigits: WesternDigitsFunction = (text: string): string => {
  return text
    .replace(/[۰-۹]/g, (digit: string): string => {
      return String(PERSIAN_DIGITS.indexOf(digit));
    })
    .replace(/(\d)[,٬](?=\d{3}(?!\d))/g, "$1");
};

type NumbersInFunction = (text: string) => Array<number>;

// Every whole number in some text, in either language's digits.
const numbersIn: NumbersInFunction = (text: string): Array<number> => {
  return Array.from(westernDigits(text).matchAll(/\d+/g)).map(
    (match: RegExpMatchArray): number => {
      return parseInt(match[0], 10);
    },
  );
};

type PageSentenceFunction = (group: string, key: string) => string;

// A sentence of the public form page, from its English locale file.
const pageSentence: PageSentenceFunction = (
  group: string,
  key: string,
): string => {
  const locale: JSONObject = JSON.parse(
    fs.readFileSync(ACCOUNTS_ENGLISH_LOCALE_FILE, "utf8"),
  ) as JSONObject;
  const sentence: JSONValue | undefined = (
    locale[group] as JSONObject | undefined
  )?.[key];

  expect({
    key: `${group}.${key}`,
    isText: typeof sentence === "string",
  }).toEqual({ key: `${group}.${key}`, isText: true });

  return sentence as string;
};

interface LimiterSetting {
  name: string;
  defaultValue: number;
}

/*
 * parsePositiveIntFromEnv("NAME", default): an environment variable the
 * incident form rate limiter reads, and the default it falls back to - a
 * number, or a product of numbers such as 15 * 60.
 */
const LIMITER_SETTING_PATTERN: RegExp =
  /parsePositiveIntFromEnv\(\s*"([A-Z0-9_]+)",\s*([\d\s*]+?)\s*,?\s*\)/g;
const LIMITER_SETTING_CALL_PATTERN: RegExp = /parsePositiveIntFromEnv\(\s*"/g;

type LimiterSettingsFunction = () => Array<LimiterSetting>;

// Every limit the rate limiter reads from the environment, as its source has it.
const limiterSettings: LimiterSettingsFunction = (): Array<LimiterSetting> => {
  const source: string = readSource(RATE_LIMIT_FILE);
  const settings: Array<LimiterSetting> = Array.from(
    source.matchAll(LIMITER_SETTING_PATTERN),
  ).map((match: RegExpMatchArray): LimiterSetting => {
    return {
      name: match[1] as string,
      defaultValue: (match[2] as string)
        .split("*")
        .reduce((product: number, factor: string): number => {
          return product * parseInt(factor.trim(), 10);
        }, 1),
    };
  });

  // Every setting is read: a default written some other way fails here.
  expect(settings.length).toBeGreaterThan(0);
  expect(settings).toHaveLength(
    (source.match(LIMITER_SETTING_CALL_PATTERN) || []).length,
  );

  return settings;
};

type ConfiguredLimitsFunction = (
  config: IncidentFormRateLimitBucketConfig,
) => Array<number>;

// The numbers a bucket of the limiter is configured with.
const configuredLimits: ConfiguredLimitsFunction = (
  config: IncidentFormRateLimitBucketConfig,
): Array<number> => {
  return [
    config.windowSeconds,
    config.perFormAndIpLimit,
    config.perIpLimit,
    ...(config.perForm
      ? [config.perForm.windowSeconds, config.perForm.limit]
      : []),
  ];
};

type ListRefusalsFunction = (customFields: JSONObject) => Array<string>;

// What the submit route refuses a report with these custom field answers for.
const listRefusals: ListRefusalsFunction = (
  customFields: JSONObject,
): Array<string> => {
  const result: IncidentFormSubmissionValidationResult =
    validateIncidentFormSubmission({
      form: { isReporterDetailsRequired: false },
      askedDefinitions: [
        EXAMPLE_DROPDOWN_QUESTION,
        EXAMPLE_MULTI_SELECT_QUESTION,
      ],
      severities: [],
      data: { title: "Checkout is down", customFields: customFields },
    });

  return result.isValid ? [] : result.errors;
};

type CardCopyFunction = (key: string) => string | undefined;

/*
 * A string of the template and form cards' copy, when the copy has it. The
 * Questions card's note on a field copied from a monitor and the template
 * card's project-default labels arrive with those cards' own change: until
 * the copy carries a string there is nothing to hold the docs to, and from
 * then on the docs must quote it exactly.
 */
const cardCopy: CardCopyFunction = (key: string): string | undefined => {
  const value: unknown = (
    IncidentCustomFieldCreateSettingsCopy as unknown as Record<string, unknown>
  )[key];

  return typeof value === "string" ? value : undefined;
};

type ListFilesFunction = (directory: string) => Array<string>;

// Every file under a directory.
const filesUnder: ListFilesFunction = (directory: string): Array<string> => {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      return entry.isDirectory() ? filesUnder(full) : [full];
    });
};

describe("Incident Forms docs", () => {
  describe("navigation", () => {
    it("lists Incident Forms in the Incidents group, right after the settings page it builds on", () => {
      const links: Array<NavLink> = incidentsGroup().links;
      const at: number = links.findIndex((link: NavLink): boolean => {
        return link.url === FORMS_URL;
      });

      expect(at).toBeGreaterThan(0);
      expect(links[at]?.title).toBe(FORMS_TITLE);
      expect(links[at - 1]?.title).toBe(PRECEDING_NAV_TITLE);
    });

    it("has the page in English, and a real Persian translation, each titled like its nav entry", () => {
      for (const language of LANGUAGES) {
        expect({
          language: language,
          exists: fs.existsSync(pageFile(language, FORMS_PAGE)),
        }).toEqual({ language: language, exists: true });

        expect(titleOf(readPage(FORMS_PAGE, language))).toBe(
          readLocale(language).navLinks[FORMS_TITLE],
        );
      }

      const persian: string = readPage(FORMS_PAGE, "fa");

      expect(PERSIAN_LETTER.test(titleOf(persian))).toBe(true);
      expect(persian).not.toEqual(readPage(FORMS_PAGE, "en"));
    });

    it("has a translated nav title in every docs language, linking to that language's page", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const title: string | undefined =
          readLocale(language).navLinks[FORMS_TITLE];

        expect({
          language: language,
          translated:
            typeof title === "string" &&
            title.trim().length > 0 &&
            (language === DEFAULT_DOCS_LANGUAGE) === (title === FORMS_TITLE),
        }).toEqual({ language: language, translated: true });

        const group: LocalizedNavGroup | undefined = getLocalizedNav(
          language,
        ).find((item: LocalizedNavGroup): boolean => {
          return item.key === NAV_GROUP_TITLE;
        });
        const link: LocalizedNavLink | undefined = group?.links.find(
          (item: LocalizedNavLink): boolean => {
            return item.url === `/docs/${language}/${FORMS_PAGE}`;
          },
        );

        expect({ language: language, title: link?.title }).toEqual({
          language: language,
          title: title,
        });
      }
    });

    it("puts the nav title next to its neighbour in every docs locale file", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const keys: Array<string> = Object.keys(readLocale(language).navLinks);

        expect({
          language: language,
          follows: keys[keys.indexOf(FORMS_TITLE) - 1],
        }).toEqual({ language: language, follows: PRECEDING_NAV_TITLE });
      }
    });
  });

  describe("the forms page", () => {
    const english: string = readPage(FORMS_PAGE, "en");
    const persian: string = readPage(FORMS_PAGE, "fa");

    it("keeps the English headings, code blocks, inline code and links in the translation", () => {
      const levels: (markdown: string) => Array<number> = (
        markdown: string,
      ): Array<number> => {
        return headingsOf(markdown).map((heading: Heading): number => {
          return heading.level;
        });
      };

      expect(levels(persian)).toEqual(levels(english));
      expect(splitMarkdown(persian).codeBlocks).toEqual(
        splitMarkdown(english).codeBlocks,
      );
      expect(Array.from(inlineCode(persian)).sort()).toEqual(
        Array.from(inlineCode(english)).sort(),
      );
      expect(linkedPages(persian)).toEqual(linkedPages(english));
      expect(inPageLinks(persian)).toHaveLength(inPageLinks(english).length);
    });

    it("names the Forms pages and the public form by their on-screen names, in every language", () => {
      for (const language of LANGUAGES) {
        const names: Set<string> = boldText(readPage(FORMS_PAGE, language));

        for (const name of FORM_UI_NAMES) {
          expect({
            language: language,
            name: name,
            named: names.has(name),
          }).toEqual({ language: language, name: name, named: true });
        }
      }
    });

    it("quotes the public form's, the server's and the Share Link card's messages as the code words them, in every language", () => {
      const quoted: Array<string> = [
        pageSentence("incidentForm", "titleDescription"),
        pageSentence("incidentForm", "successTitle"),
        pageSentence("incidentForm", "incidentNumber").replace(
          "{{incidentNumber}}",
          EXAMPLE_INCIDENT_NUMBER,
        ),
        ...SENTENCES_THE_PAGE_SHOWS,
        ...SERVER_ONLY_SENTENCES,
        INCIDENT_FORM_TITLE_TOO_LONG_MESSAGE,
        IncidentFormCopy.formTurnedOff,
      ];

      for (const language of LANGUAGES) {
        const markdown: string = readPage(FORMS_PAGE, language);

        for (const message of quoted) {
          expect({
            language: language,
            message: message,
            quoted: markdown.includes(message),
          }).toEqual({ language: language, message: message, quoted: true });
        }

        // The page's button for the next report, by its on-screen name.
        expect(
          boldText(markdown).has(pageSentence("incidentForm", "submitAnother")),
        ).toBe(true);
      }

      // Each server sentence the docs say a reporter sees is one the page shows.
      const pageSentences: Array<string> = Object.values(
        IncidentFormMessage,
      ) as Array<string>;

      expect(
        SENTENCES_THE_PAGE_SHOWS.filter((sentence: string): boolean => {
          return !pageSentences.includes(sentence);
        }),
      ).toEqual([]);
    });

    it("says an incident from a form is hidden from status pages, and tells no subscriber, until a responder publishes it", () => {
      for (const language of LANGUAGES) {
        const markdown: string = readPage(FORMS_PAGE, language);
        const declaredQuiet: Array<string> = proseLinesWith(
          markdown,
          "**Visible on Status Page**",
        ).filter((line: string): boolean => {
          return (
            line.includes("**Notify Status Page Subscribers**") &&
            line.includes(OFF_WORD[language] as string)
          );
        });

        expect({
          language: language,
          hiddenUntilPublished: markdown.includes(
            HIDDEN_UNTIL_PUBLISHED[language] as string,
          ),
          declaredQuiet: declaredQuiet.length > 0,
          // Publishing does not send the incident-created notification.
          renotifyNamed: boldText(markdown).has(
            "Notify subscribers that this incident was created",
          ),
        }).toEqual({
          language: language,
          hiddenUntilPublished: true,
          declaredQuiet: true,
          renotifyNamed: true,
        });
      }
    });

    it("says a form asks no custom field until one is added, and why, in every language", () => {
      for (const language of LANGUAGES) {
        const markdown: string = readPage(FORMS_PAGE, language);

        expect({
          language: language,
          notAskedUntilAdded: markdown.includes(
            NO_CUSTOM_FIELD_UNTIL_ADDED[language] as string,
          ),
          notAskedIsDefault: markdown.includes(
            NOT_ASKED_IS_DEFAULT[language] as string,
          ),
          why: markdown.includes(PUBLIC_FORM_SHOWS_OPTIONS[language] as string),
        }).toEqual({
          language: language,
          notAskedUntilAdded: true,
          notAskedIsDefault: true,
          why: true,
        });
      }
    });

    it("says the link needs no account, in every language", () => {
      for (const language of LANGUAGES) {
        expect({
          language: language,
          noAccount: readPage(FORMS_PAGE, language).includes(
            NO_ACCOUNT_NEEDED[language] as string,
          ),
        }).toEqual({ language: language, noAccount: true });
      }
    });

    it("names the API routes, and the public ones as the page's own, in every language", () => {
      for (const language of LANGUAGES) {
        const markdown: string = readPage(FORMS_PAGE, language);
        const code: Set<string> = inlineCode(markdown);

        for (const route of API_ROUTES) {
          expect({
            language: language,
            route: route,
            named: code.has(route),
          }).toEqual({ language: language, route: route, named: true });
        }

        expect(
          markdown.includes(
            PUBLIC_ROUTES_ARE_THE_PAGES_OWN[language] as string,
          ),
        ).toBe(true);
      }
    });

    it("documents the six permissions, with forms managed by incident admins only, in every language", () => {
      for (const language of LANGUAGES) {
        const markdown: string = readPage(FORMS_PAGE, language);

        for (const permission of FORM_PERMISSIONS) {
          const row: string | undefined = tableRowStartingWith(
            markdown,
            `**${permission}**`,
          );

          expect({
            language: language,
            permission: permission,
            row: Boolean(row),
          }).toEqual({ language: language, permission: permission, row: true });

          if (
            permission.startsWith("Create ") ||
            permission.startsWith("Edit ") ||
            permission.startsWith("Delete ")
          ) {
            expect({
              language: language,
              permission: permission,
              roles: listedNames(tableCells(row as string)[2] || ""),
            }).toEqual({
              language: language,
              permission: permission,
              roles: [...FORM_ADMIN_ROLES],
            });
          }
        }
      }
    });

    it("states the plans forms and their IP allowlist need, in every language", () => {
      for (const language of LANGUAGES) {
        const names: Set<string> = boldText(readPage(FORMS_PAGE, language));

        expect(names.has("Growth")).toBe(true);
        expect(names.has("Scale")).toBe(true);
      }
    });

    it("gives each size limit the server holds an answer to, in every language", () => {
      for (const language of LANGUAGES) {
        const section: string = sectionOf(
          readPage(FORMS_PAGE, language),
          3,
          SIZE_LIMITS_SECTION[language] as string,
        );
        const limits: Array<[string, number]> = [
          [
            `**${INCIDENT_FORM_QUESTION_LABELS.title}**`,
            INCIDENT_FORM_TITLE_MAX_LENGTH,
          ],
          [
            `**${INCIDENT_FORM_QUESTION_LABELS.description}**`,
            INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
          ],
          [
            CUSTOM_FIELD_ANSWER_ROW[language] as string,
            INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
          ],
          [
            MULTI_SELECT_ANSWER_ROW[language] as string,
            INCIDENT_FORM_MULTI_SELECT_MAX_CHOICES,
          ],
          [
            `**${INCIDENT_FORM_QUESTION_LABELS.reporterName}**`,
            INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
          ],
          [
            `**${INCIDENT_FORM_QUESTION_LABELS.reporterEmail}**`,
            INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
          ],
        ];

        // The table's rows, without its header and divider: one per limit.
        expect({
          language: language,
          rows: tableRows(section).length - 2,
        }).toEqual({ language: language, rows: limits.length });

        for (const [question, limit] of limits) {
          const row: string = tableRowStartingWith(section, question) || "";

          expect({
            language: language,
            question: question,
            largest: Math.max(...numbersIn(tableCells(row)[1] || "")),
          }).toEqual({
            language: language,
            question: question,
            largest: limit,
          });
        }
      }
    });

    it("quotes the refusals of a list answer as the validator words them, in every language", () => {
      const refusals: Array<Array<string>> = [
        // A list for a question that takes one answer.
        listRefusals({
          [EXAMPLE_DROPDOWN_QUESTION.name as string]: ["High", "Low"],
        }),
        // A list inside a multi-select's list.
        listRefusals({
          [EXAMPLE_MULTI_SELECT_QUESTION.name as string]: [["API"]],
        }),
        // One entry more than a multi-select with few options may hold.
        listRefusals({
          [EXAMPLE_MULTI_SELECT_QUESTION.name as string]: Array.from(
            { length: INCIDENT_FORM_MULTI_SELECT_MAX_CHOICES + 1 },
            (_entry: unknown, index: number): string => {
              return `System ${index}`;
            },
          ),
        }),
      ];

      for (const refusal of refusals) {
        expect(refusal).toHaveLength(1);

        for (const language of LANGUAGES) {
          expect({
            language: language,
            refusal: refusal[0],
            quoted: readPage(FORMS_PAGE, language).includes(
              refusal[0] as string,
            ),
          }).toEqual({ language: language, refusal: refusal[0], quoted: true });
        }
      }
    });

    it("gives each rate limit's environment variable and default as the limiter reads them, in every language", () => {
      const settings: Array<LimiterSetting> = limiterSettings();
      const byValue: (a: number, b: number) => number = (
        a: number,
        b: number,
      ): number => {
        return a - b;
      };

      // Every limit the limiter runs with comes from one of these settings.
      expect(
        settings
          .map((setting: LimiterSetting): number => {
            return setting.defaultValue;
          })
          .sort(byValue),
      ).toEqual(
        [
          ...configuredLimits(
            IncidentFormRateLimit.getBucketConfig(
              IncidentFormRateLimitBucket.Read,
            ),
          ),
          ...configuredLimits(
            IncidentFormRateLimit.getBucketConfig(
              IncidentFormRateLimitBucket.Submit,
            ),
          ),
        ].sort(byValue),
      );

      for (const language of LANGUAGES) {
        const section: string = sectionOf(
          readPage(FORMS_PAGE, language),
          3,
          RATE_LIMITS_SECTION[language] as string,
        );

        // One row per setting, and no row for a setting the limiter does not read.
        expect(
          tableRows(section)
            .slice(2)
            .map((row: string): string => {
              return tableCells(row)[0] || "";
            })
            .sort(),
        ).toEqual(
          settings
            .map((setting: LimiterSetting): string => {
              return `\`${setting.name}\``;
            })
            .sort(),
        );

        for (const setting of settings) {
          const row: string =
            tableRowStartingWith(section, `\`${setting.name}\``) || "";

          expect({
            language: language,
            setting: setting.name,
            default: tableCells(row)[1],
          }).toEqual({
            language: language,
            setting: setting.name,
            default: `\`${setting.defaultValue}\``,
          });
        }
      }
    });

    it("says the app container needs the rate limit settings passed to it, which neither Docker Compose nor the Helm chart does", () => {
      const settings: Array<LimiterSetting> = limiterSettings();
      const deploymentFiles: Array<string> = [
        DOCKER_COMPOSE_FILE,
        ...filesUnder(HELM_TEMPLATES_DIR),
      ];

      for (const file of deploymentFiles) {
        const text: string = readSource(file);

        expect({
          file: path.basename(file),
          passed: settings
            .filter((setting: LimiterSetting): boolean => {
              return text.includes(setting.name);
            })
            .map((setting: LimiterSetting): string => {
              return setting.name;
            }),
        }).toEqual({ file: path.basename(file), passed: [] });
      }

      for (const language of LANGUAGES) {
        const code: Set<string> = inlineCode(
          sectionOf(
            readPage(FORMS_PAGE, language),
            3,
            RATE_LIMITS_SECTION[language] as string,
          ),
        );

        for (const name of [
          "config.env",
          "app.extraEnv",
          "extraEnv",
          "docker-compose.override.yml",
        ]) {
          expect({
            language: language,
            name: name,
            named: code.has(name),
          }).toEqual({ language: language, name: name, named: true });
        }
      }
    });

    it("shows the reporter's private note as the server writes it, in every language", () => {
      const note: string = getIncidentFormReporterNote(EXAMPLE_NOTE_REPORT);

      for (const language of LANGUAGES) {
        expect({
          language: language,
          note: note,
          shown: readPage(FORMS_PAGE, language).includes(note),
        }).toEqual({ language: language, note: note, shown: true });
      }
    });

    it("shows what a report's image is stored as, as the server stores it, in every language", () => {
      const stored: string = neutralizeUntrustedMarkdown(EXAMPLE_REPORT_IMAGE);

      expect(stored).not.toBe(EXAMPLE_REPORT_IMAGE);

      for (const language of LANGUAGES) {
        const code: Set<string> = inlineCode(
          sectionOf(
            readPage(FORMS_PAGE, language),
            3,
            TEXT_A_REPORTER_WRITES_SECTION[language] as string,
          ),
        );

        expect({
          language: language,
          written: code.has(EXAMPLE_REPORT_IMAGE),
          stored: code.has(stored),
        }).toEqual({ language: language, written: true, stored: true });
      }
    });

    it("describes the check for requests from other websites as the server applies it, in every language", () => {
      const isForeign: (headers: {
        "sec-fetch-site"?: string;
        origin?: string;
      }) => boolean = (headers: {
        "sec-fetch-site"?: string;
        origin?: string;
      }): boolean => {
        return SameOriginRequest.isForeignPageRequest({
          headers: headers,
          instanceOrigin: EXAMPLE_INSTANCE_ORIGIN,
        });
      };

      // The two Sec-Fetch-Site values the page says pass, and two it says do not.
      expect(isForeign({ "sec-fetch-site": "same-origin" })).toBe(false);
      expect(isForeign({ "sec-fetch-site": "none" })).toBe(false);
      expect(isForeign({ "sec-fetch-site": "same-site" })).toBe(true);
      expect(isForeign({ "sec-fetch-site": "cross-site" })).toBe(true);
      // An Origin passes only when it is the instance's own.
      expect(isForeign({ origin: EXAMPLE_INSTANCE_ORIGIN })).toBe(false);
      expect(isForeign({ origin: "https://elsewhere.example" })).toBe(true);
      expect(isForeign({ origin: "null" })).toBe(true);
      // A request with neither header is not a browser page's, and passes.
      expect(isForeign({})).toBe(false);
      // A submission must be JSON; parameters such as a charset are allowed.
      expect(
        SameOriginRequest.isJsonContentType("application/json; charset=utf-8"),
      ).toBe(true);
      expect(
        SameOriginRequest.isJsonContentType(
          "application/x-www-form-urlencoded",
        ),
      ).toBe(false);

      for (const language of LANGUAGES) {
        const code: Set<string> = inlineCode(
          sectionOf(
            readPage(FORMS_PAGE, language),
            3,
            OTHER_WEBSITES_SECTION[language] as string,
          ),
        );

        for (const name of [
          "Sec-Fetch-Site",
          "same-origin",
          "none",
          "Origin",
          "HTTP_PROTOCOL",
          "HOST",
          EXAMPLE_INSTANCE_ORIGIN,
          "application/json",
        ]) {
          expect({
            language: language,
            name: name,
            named: code.has(name),
          }).toEqual({ language: language, name: name, named: true });
        }
      }
    });

    it("quotes an IP allowlist refusal as the server words it, and offers only entries it accepts, in every language", () => {
      const refusal: string | null = validateIncidentFormIpAllowlist(
        EXAMPLE_REFUSED_IP_ALLOWLIST,
      );

      expect(refusal).not.toBeNull();
      // The page says a /0 range is refused rather than allowing every network.
      expect(validateIncidentFormIpAllowlist("0.0.0.0/0")).not.toBeNull();

      for (const language of LANGUAGES) {
        const section: string = sectionOf(
          readPage(FORMS_PAGE, language),
          3,
          IP_ALLOWLIST_SECTION[language] as string,
        );
        const examples: Array<string> = Array.from(inlineCode(section)).filter(
          (code: string): boolean => {
            return IP_ALLOWLIST_ENTRY_PATTERN.test(code);
          },
        );

        expect({
          language: language,
          quoted: section.includes(refusal as string),
          examples: examples.length,
          accepted: validateIncidentFormIpAllowlist(examples.join("\n")),
        }).toEqual({
          language: language,
          quoted: true,
          examples: 3,
          accepted: null,
        });
      }
    });

    it("gives the captcha token's limit on the public endpoints, in every language", () => {
      for (const language of LANGUAGES) {
        const section: string = sectionOf(
          readPage(FORMS_PAGE, language),
          3,
          PUBLIC_ENDPOINTS_SECTION[language] as string,
        );

        expect({
          language: language,
          named: inlineCode(section).has("captchaToken"),
          limit: numbersIn(section).includes(
            INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH,
          ),
        }).toEqual({ language: language, named: true, limit: true });
      }
    });

    it("says a submission follows its incident, and one of a deleted incident is for project owners and admins, as the model says", () => {
      expect(
        new IncidentFormSubmission().getTableColumnMetadata("incidentId")
          .description,
      ).toContain("listed only for project owners and admins");

      for (const language of LANGUAGES) {
        expect({
          language: language,
          said: sectionOf(
            readPage(FORMS_PAGE, language),
            2,
            SUBMISSIONS_SECTION[language] as string,
          ).includes(
            DELETED_INCIDENT_SUBMISSIONS_FOR_ADMINS[language] as string,
          ),
        }).toEqual({ language: language, said: true });
      }
    });

    it("says a template fills optional questions left empty too, not only the questions the form does not ask, in every language", () => {
      // The validator leaves an empty optional answer out, so the template's value applies.
      const result: IncidentFormSubmissionValidationResult =
        validateIncidentFormSubmission({
          form: { isReporterDetailsRequired: false },
          askedDefinitions: [EXAMPLE_DROPDOWN_QUESTION],
          severities: [],
          data: {
            title: "Checkout is down",
            customFields: { [EXAMPLE_DROPDOWN_QUESTION.name as string]: "" },
          },
        });

      expect(result.isValid ? result.value.customFields : null).toEqual({});

      for (const language of LANGUAGES) {
        const markdown: string = readPage(FORMS_PAGE, language);

        expect({
          language: language,
          filled: sectionOf(
            markdown,
            2,
            THE_INCIDENT_TEMPLATE_SECTION[language] as string,
          ).includes(TEMPLATE_FILLS_UNANSWERED_QUESTIONS[language] as string),
          stale: markdown.includes(
            STALE_TEMPLATE_FILL_CLAIMS[language] as string,
          ),
        }).toEqual({ language: language, filled: true, stale: false });
      }
    });

    it("says a field copied from a monitor is not asked when the template attaches monitors, quoting the Questions card, in every language", () => {
      const note: string | undefined = cardCopy("formCopiedFromMonitor");

      for (const language of LANGUAGES) {
        const section: string = sectionOf(
          readPage(FORMS_PAGE, language),
          3,
          FORM_CUSTOM_FIELDS_SECTION[language] as string,
        );

        expect({
          language: language,
          said: section.includes(MAPPED_FIELD_NOT_ASKED[language] as string),
          quoted: note === undefined || section.includes(note),
        }).toEqual({ language: language, said: true, quoted: true });
      }
    });

    it("says deleting a custom field takes it off every form, as the custom field service does, in every language", () => {
      expect(readSource(INCIDENT_CUSTOM_FIELD_SERVICE_FILE)).toMatch(
        /onDeleteSuccess\([\s\S]*?IncidentFormService\.removeCustomFieldFromQuestions\(/,
      );

      for (const language of LANGUAGES) {
        expect({
          language: language,
          forms: sectionOf(
            readPage(FORMS_PAGE, language),
            3,
            FORM_CUSTOM_FIELDS_SECTION[language] as string,
          ).includes(DELETED_FIELD_LEAVES_EVERY_FORM[language] as string),
          settings: sectionOf(
            readPage(SETTINGS_PAGE, language),
            3,
            RENAMING_A_FIELD_SECTION[language] as string,
          ).includes(
            DELETED_FIELD_LEAVES_EVERY_FORM_ON_SETTINGS[language] as string,
          ),
        }).toEqual({ language: language, forms: true, settings: true });
      }
    });
  });

  describe("incident template custom fields on create", () => {
    it("are documented under Incident templates, with every option, in every language", () => {
      for (const language of LANGUAGES) {
        const markdown: string = readPage(SETTINGS_PAGE, language);
        const templates: string = sectionOf(
          markdown,
          2,
          TEMPLATES_SECTION[language] as string,
        );
        const setting: string = sectionOf(
          markdown,
          3,
          TEMPLATE_SETTING_SECTION[language] as string,
        );

        // An H3 of the Incident templates section.
        expect(templates.includes(setting)).toBe(true);

        const names: Set<string> = boldText(setting);

        expect(names.has(TEMPLATE_SETTING_NAME)).toBe(true);

        for (const option of TEMPLATE_SETTING_OPTIONS) {
          expect({
            language: language,
            option: option,
            row: Boolean(tableRowStartingWith(setting, `**${option}**`)),
          }).toEqual({ language: language, option: option, row: true });
        }

        expect(
          setting.includes(HIDDEN_KEEPS_TEMPLATE_VALUE[language] as string),
        ).toBe(true);
        // The wizard step is listed with the template's other steps.
        expect(templates.includes(`- **${TEMPLATE_SETTING_NAME}** — `)).toBe(
          true,
        );
      }
    });

    it("keep a valid customFieldSettings example, the same in every language", () => {
      const blocks: Array<string> = splitMarkdown(
        sectionOf(
          readPage(SETTINGS_PAGE, "en"),
          3,
          TEMPLATE_SETTING_SECTION["en"] as string,
        ),
      ).codeBlocks;

      expect(blocks).toHaveLength(1);

      const example: JSONObject = JSON.parse(blocks[0] as string) as JSONObject;
      const settings: JSONObject = example["customFieldSettings"] as JSONObject;

      expect(Object.keys(settings).length).toBeGreaterThan(0);

      for (const [key, value] of Object.entries(settings)) {
        expect({ key: key, valid: isValidCustomFieldVariableKey(key) }).toEqual(
          {
            key: key,
            valid: true,
          },
        );
        expect(TEMPLATE_SETTING_OPTIONS).toContain(value as string);
      }

      expect(
        splitMarkdown(
          sectionOf(
            readPage(SETTINGS_PAGE, "fa"),
            3,
            TEMPLATE_SETTING_SECTION["fa"] as string,
          ),
        ).codeBlocks,
      ).toEqual(blocks);
    });

    it("are applied by the dashboard only, as the Required on Create section says, in every language", () => {
      // The section the dashboard-only rule has always lived in keeps its id.
      expect(
        headingsOf(readPage(SETTINGS_PAGE, "en")).map(
          (heading: Heading): string => {
            return heading.slug;
          },
        ),
      ).toContain("required-on-create-is-checked-by-the-dashboard-only");

      for (const language of LANGUAGES) {
        const markdown: string = readPage(SETTINGS_PAGE, language);
        const setting: string = sectionOf(
          markdown,
          3,
          TEMPLATE_SETTING_SECTION[language] as string,
        );
        const dashboardOnly: string = sectionOf(
          markdown,
          3,
          DASHBOARD_ONLY_SECTION[language] as string,
        );
        const dashboardOnlySlug: string = slugify(
          DASHBOARD_ONLY_SECTION[language] as string,
        );
        const settingSlug: string = slugify(
          TEMPLATE_SETTING_SECTION[language] as string,
        );

        expect({
          language: language,
          saysDashboardOnly: setting.includes(
            ONLY_THE_DASHBOARD_APPLIES_THEM[language] as string,
          ),
          linksToTheRule: inPageLinks(setting).includes(dashboardOnlySlug),
          ruleLinksBack: inPageLinks(dashboardOnly).includes(settingSlug),
          declarePageSaysSo: readPage(DECLARING_PAGE, language).includes(
            DETAILS_STEP_IS_DASHBOARD_ONLY_TOO[language] as string,
          ),
        }).toEqual({
          language: language,
          saysDashboardOnly: true,
          linksToTheRule: true,
          ruleLinksBack: true,
          declarePageSaysSo: true,
        });
      }
    });

    it("can be changed by whoever edits templates, while the project-wide switches need an admin, as the docs say", () => {
      const templateEditors: Array<Permission> =
        new IncidentTemplate().getUpdatePermissions();

      expect(templateEditors).toContain(Permission.ProjectMember);
      expect(templateEditors).toContain(Permission.IncidentMember);

      const requiredOnCreate: ColumnAccessControl | null =
        new IncidentCustomField().getColumnAccessControlFor(
          "isRequiredOnCreate",
        );

      expect([...(requiredOnCreate?.update || [])].sort()).toEqual(
        [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditIncidentCustomField,
        ].sort(),
      );

      for (const language of LANGUAGES) {
        const setting: string = sectionOf(
          readPage(SETTINGS_PAGE, language),
          3,
          TEMPLATE_SETTING_SECTION[language] as string,
        );
        const line: string =
          proseLinesWith(
            setting,
            TEMPLATE_EDITORS_CAN_CHANGE_THEM[language] as string,
          )[0] || "";

        expect({
          language: language,
          projectMember: line.includes("Project Member"),
          incidentMember: line.includes("Incident Member"),
          customFieldEditors: line.includes("**Edit Incident Custom Field**"),
        }).toEqual({
          language: language,
          projectMember: true,
          incidentMember: true,
          customFieldEditors: true,
        });
      }
    });

    it("shape the Details step when declaring from a template, in every language", () => {
      for (const language of LANGUAGES) {
        const details: string = sectionOf(
          readPage(DECLARING_PAGE, language),
          3,
          DETAILS_SECTION[language] as string,
        );

        expect({
          language: language,
          named: boldText(details).has(TEMPLATE_SETTING_NAME),
          linked: docsLinks(details).some((link: DocsLink): boolean => {
            return (
              link.page === SETTINGS_PAGE &&
              link.anchor ===
                slugify(TEMPLATE_SETTING_SECTION[language] as string)
            );
          }),
        }).toEqual({ language: language, named: true, linked: true });
      }
    });

    it("quote the project-default labels the template card shows beside a setting, in every language", () => {
      const labels: Array<string> = [
        "templateProjectDefaultRequired",
        "templateProjectDefaultOptional",
        "templateProjectDefaultNotShown",
      ]
        .map((key: string): string | undefined => {
          return cardCopy(key);
        })
        .filter((label: string | undefined): label is string => {
          return label !== undefined;
        });

      for (const language of LANGUAGES) {
        const names: Set<string> = boldText(
          sectionOf(
            readPage(SETTINGS_PAGE, language),
            3,
            TEMPLATE_SETTING_SECTION[language] as string,
          ),
        );

        for (const label of labels) {
          expect({
            language: language,
            label: label,
            named: names.has(label),
          }).toEqual({ language: language, label: label, named: true });
        }
      }
    });
  });

  describe("custom field values through the API", () => {
    it("say how many refused entries a multi-select refusal names, as the validator lists them, in every language", () => {
      const refused: Array<string> = Array.from(
        { length: 25 },
        (_entry: unknown, index: number): string => {
          return `Not an option ${index}`;
        },
      );
      const errors: Array<CustomFieldValueValidationError> =
        validateCustomFieldValues({
          definitions: [
            {
              name: EXAMPLE_MULTI_SELECT_QUESTION.name as string,
              customFieldType: CustomFieldType.MultiSelectDropdown,
              dropdownOptions:
                EXAMPLE_MULTI_SELECT_QUESTION.dropdownOptions || undefined,
            },
          ],
          customFields: {
            [EXAMPLE_MULTI_SELECT_QUESTION.name as string]: refused,
          },
          storedCustomFields: {},
        });

      expect(errors).toHaveLength(1);

      const message: string = errors[0]?.message || "";
      const listed: number = refused.filter((entry: string): boolean => {
        return message.includes(`"${entry}"`);
      }).length;

      // The first entries are named, and the rest counted.
      expect(listed).toBeGreaterThan(0);
      expect(listed).toBeLessThan(refused.length);
      expect(message).toContain(`and ${refused.length - listed} more`);

      for (const language of LANGUAGES) {
        expect({
          language: language,
          said: westernDigits(
            sectionOf(
              readPage(SETTINGS_PAGE, language),
              3,
              API_VALUES_SECTION[language] as string,
            ),
          ).includes(
            (LISTED_REFUSED_ENTRIES[language] as (count: number) => string)(
              listed,
            ),
          ),
        }).toEqual({ language: language, said: true });
      }
    });
  });

  describe("createdIncidentTemplateId", () => {
    it("can only be set by OneUptime itself: no role may send it, workflows create as root, and a state skips the template", () => {
      const access: ColumnAccessControl | null =
        new Incident().getColumnAccessControlFor("createdIncidentTemplateId");

      expect(access).not.toBeNull();
      expect(access?.create).toEqual([]);
      expect(access?.update).toEqual([]);

      expect(readSource(WORKFLOW_CREATE_COMPONENT_FILE)).toMatch(
        /this\.modelService\.create\(\{[\s\S]*?props:\s*\{\s*isRoot:\s*true,/,
      );
      expect(readSource(INCIDENT_SERVICE_FILE)).toMatch(
        /if \(createBy\.data\.currentIncidentStateId\) \{[\s\S]*?\} else if \(createBy\.data\.createdIncidentTemplateId\) \{/,
      );
    });

    it("is never documented as something an API request can send, in every language", () => {
      for (const language of LANGUAGES) {
        for (const page of [SETTINGS_PAGE, DECLARING_PAGE]) {
          const markdown: string = readPage(page, language);

          expect({
            language: language,
            page: page,
            stale: (
              STALE_TEMPLATE_ID_CLAIMS[language] as ReadonlyArray<string>
            ).filter((claim: string): boolean => {
              return markdown.includes(claim);
            }),
            refused: markdown.includes(TEMPLATE_ID_REFUSED[language] as string),
          }).toEqual({
            language: language,
            page: page,
            stale: [],
            refused: true,
          });

          // Every mention says who sets it, or that a request sending it is refused.
          for (const line of proseLinesWith(
            markdown,
            "`createdIncidentTemplateId`",
          )) {
            expect({
              language: language,
              page: page,
              line: line,
              saysWho: (
                TEMPLATE_ID_SETTERS[language] as ReadonlyArray<string>
              ).some((words: string): boolean => {
                return line.includes(words);
              }),
            }).toEqual({
              language: language,
              page: page,
              line: line,
              saysWho: true,
            });
          }
        }
      }
    });

    it("gets a paragraph of its own on the declaring page, not a line of the field list above it, in every language", async () => {
      for (const language of LANGUAGES) {
        // Rendered as the docs route renders a page: without its title line.
        const html: string = await DocsRender.render(
          DocsPlaceholders.render(
            readPage(DECLARING_PAGE, language).split("\n").slice(1).join("\n"),
            language,
          ),
        );
        const start: string = TEMPLATE_ID_NOTE_START[language] as string;
        const at: number = html.indexOf(start);

        expect({
          language: language,
          found: at > -1,
          ownParagraph: html.includes(`<p>${start}`),
          inListItem:
            html.lastIndexOf("<li", at) > html.lastIndexOf("</ul>", at),
        }).toEqual({
          language: language,
          found: true,
          ownParagraph: true,
          inListItem: false,
        });
      }
    });

    it("is not implied by the status page guide either: a workflow or an incident form declares from a template, in every language", () => {
      for (const language of LANGUAGES) {
        const markdown: string = readPage(STATUS_PAGE_SCOPE_PAGE, language);
        const paragraph: string =
          proseLinesWith(
            markdown,
            TEMPLATES_WORK_THE_SAME_WAY[language] as string,
          )[0] || "";

        expect({
          language: language,
          stale: markdown.includes(
            STALE_TEMPLATE_API_DECLARATIONS[language] as string,
          ),
          workflow: paragraph.includes("**Create One Incident**"),
          form: docsLinks(paragraph).some((link: DocsLink): boolean => {
            return link.page === FORMS_PAGE;
          }),
        }).toEqual({
          language: language,
          stale: false,
          workflow: true,
          form: true,
        });
      }
    });
  });

  describe("the incident pages", () => {
    it("count five ways to declare an incident, the fifth an incident form, in every language", () => {
      for (const language of LANGUAGES) {
        const declaring: string = readPage(DECLARING_PAGE, language);
        const overview: string = readPage(OVERVIEW_PAGE, language);
        const ways: string = sectionOf(
          declaring,
          2,
          WAYS_SECTION[language] as string,
        );
        // The table's rows, without its header and divider.
        const rows: Array<string> = tableRows(ways).slice(2);

        expect({
          language: language,
          ways: rows.length,
          lastWayIsAForm: docsLinks(rows[rows.length - 1] || "").some(
            (link: DocsLink): boolean => {
              return link.page === FORMS_PAGE;
            },
          ),
          fiveWaysIn: overview.includes(FIVE_WAYS_IN[language] as string),
          fiveRoutes: overview.includes(FIVE_ROUTES[language] as string),
          stale: (STALE_WAY_COUNTS[language] as ReadonlyArray<string>).filter(
            (words: string): boolean => {
              return declaring.includes(words) || overview.includes(words);
            },
          ),
        }).toEqual({
          language: language,
          ways: 5,
          lastWayIsAForm: true,
          fiveWaysIn: true,
          fiveRoutes: true,
          stale: [],
        });
      }
    });

    it("list Forms right after Incident Templates, as the Settings side menu does, in every language", () => {
      for (const language of LANGUAGES) {
        const settingsTable: Array<string> = tableRows(
          sectionOf(
            readPage(SETTINGS_PAGE, language),
            2,
            SETTINGS_TABLE_SECTION[language] as string,
          ),
        ).map((row: string): string => {
          return tableCells(row)[0] || "";
        });
        const overviewRow: string =
          tableRowStartingWith(
            sectionOf(
              readPage(OVERVIEW_PAGE, language),
              2,
              OVERVIEW_TABLE_SECTION[language] as string,
            ),
            "**Settings**",
          ) || "";

        expect({
          language: language,
          settingsTable:
            settingsTable[settingsTable.indexOf("**Incident Templates**") + 1],
          overviewRow: listedNames(tableCells(overviewRow)[1] || "").includes(
            "**Forms**",
          ),
          overviewOrder: (tableCells(overviewRow)[1] || "")
            .replace(/،/g, ",")
            .includes("**Incident Templates**, **Forms**,"),
        }).toEqual({
          language: language,
          settingsTable: "**Forms**",
          overviewRow: true,
          overviewOrder: true,
        });
      }
    });

    it("link the forms page from the overview, declaring and settings pages, in every language", () => {
      for (const language of LANGUAGES) {
        for (const page of [OVERVIEW_PAGE, DECLARING_PAGE, SETTINGS_PAGE]) {
          expect({
            language: language,
            page: page,
            linksToForms: linkedPages(readPage(page, language)).includes(
              FORMS_PAGE,
            ),
          }).toEqual({ language: language, page: page, linksToForms: true });
        }
      }
    });

    it("resolve every in-page and cross-page anchor they use, in every language", () => {
      const pages: Array<string> = [
        FORMS_PAGE,
        SETTINGS_PAGE,
        DECLARING_PAGE,
        OVERVIEW_PAGE,
        NOTES_PAGE,
      ];

      for (const language of LANGUAGES) {
        for (const page of pages) {
          const markdown: string = readPage(page, language);
          const own: Array<string> = headingsOf(markdown).map(
            (heading: Heading): string => {
              return heading.slug;
            },
          );

          for (const anchor of inPageLinks(markdown)) {
            expect({
              language: language,
              page: page,
              anchor: anchor,
              found: own.includes(anchor),
            }).toEqual({
              language: language,
              page: page,
              anchor: anchor,
              found: true,
            });
          }

          for (const link of docsLinks(markdown)) {
            expect({
              language: language,
              page: page,
              link: link.page,
              exists: fs.existsSync(pageFile("en", link.page)),
            }).toEqual({
              language: language,
              page: page,
              link: link.page,
              exists: true,
            });

            if (!link.anchor) {
              continue;
            }

            // A page that is not translated is served in English.
            const targetLanguage: string = fs.existsSync(
              pageFile(language, link.page),
            )
              ? language
              : "en";
            const slugs: Array<string> = headingsOf(
              readPage(link.page, targetLanguage),
            ).map((heading: Heading): string => {
              return heading.slug;
            });

            expect({
              language: language,
              page: page,
              link: `${link.page}#${link.anchor}`,
              found: slugs.includes(link.anchor),
            }).toEqual({
              language: language,
              page: page,
              link: `${link.page}#${link.anchor}`,
              found: true,
            });
          }
        }
      }
    });

    it("mention the Markdown editor's list and paste handling where descriptions and notes are written, in every language", () => {
      for (const language of LANGUAGES) {
        const stepOne: string = sectionOf(
          readPage(DECLARING_PAGE, language),
          3,
          STEP_ONE_SECTION[language] as string,
        );
        const notes: string = readPage(NOTES_PAGE, language);

        for (const words of EDITOR_WORDS) {
          expect({
            language: language,
            words: words,
            description: stepOne.includes(words),
            notes: notes.includes(words),
          }).toEqual({
            language: language,
            words: words,
            description: true,
            notes: true,
          });
        }
      }
    });
  });
});
