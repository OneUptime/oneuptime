import IncidentCustomFieldCreateSettingsCopy from "../../../FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldValueValidationError,
  validateCustomFieldValues,
} from "Common/Types/CustomField/CustomFieldValueValidator";
import { isValidCustomFieldVariableKey } from "Common/Types/CustomField/CustomFieldVariableKey";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident pages against the product they describe: an incident
 * template's per-field Custom Fields on Create settings, who may set
 * createdIncidentTemplateId, how custom field values sent through the API
 * are refused, how an incident's title is escaped in the feed and in chat
 * messages, the ways an incident gets declared, and the Markdown editor's
 * list and paste handling.
 *
 * These were written with the incident forms page (issue #4114), and kept
 * when incident forms became the Forms product with docs of their own
 * (FormsDocs.test.ts): the incident pages still say all of this.
 *
 * Markdown is not compiled, so nothing else notices when the Persian
 * translation falls behind the English one, or a page goes back to telling
 * API users they can declare from a template. Everything the pages state
 * that lives in code is read from it: who may set createdIncidentTemplateId,
 * how workflows create incidents, which roles may edit a template or a
 * custom field, which characters of a title the feed escapes, and which of
 * the Markdown editor's edits split a line, or can be undone, in which of
 * its modes.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

// Creates any model a workflow's "Create One ..." component names.
const WORKFLOW_CREATE_COMPONENT_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel.ts",
);

const INCIDENT_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentService.ts",
);

// The Markdown editor, and the viewer that draws a note's diagrams.
const MARKDOWN_EDITOR_FILE: string = path.join(
  REPO_ROOT,
  "Common/UI/Components/Markdown.tsx/MarkdownEditor.tsx",
);

/*
 * Places, besides IncidentService's feed items, that put a title into Markdown.
 * Writes the lines of an incident's (and an alert's) "updated" feed item.
 */
const EVENT_FIELD_CHANGE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Utils/EventFieldChange.ts",
);

const EPISODE_MEMBER_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentEpisodeMemberService.ts",
);

const SLA_NOTE_REMINDERS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Workers/Jobs/IncidentSla/SendNoteReminders.ts",
);

const TEAMS_INCIDENT_ACTIONS_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
);

const USER_NOTIFICATION_RULE_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/UserNotificationRuleService.ts",
);

// And those that make a title the text of a link.
const WORKSPACE_SUMMARY_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/WorkspaceNotificationSummaryService.ts",
);

const TEAMS_WORKSPACE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
);

const SETTINGS_PAGE: string = "incidents/settings";

const DECLARING_PAGE: string = "incidents/declaring-incidents";

const OVERVIEW_PAGE: string = "incidents/index";

const NOTES_PAGE: string = "incidents/notes-owners-and-feed";

const STATUS_PAGE_SCOPE_PAGE: string =
  "status-pages/one-status-page-per-audience";

// `fa` is the only translated corpus; every other language falls back to English.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const FENCE_LINE: RegExp = /^\s*```/;

const ANY_HEADING: RegExp = /^(#{1,6}) (.*)$/;

// The right-to-left mark the Persian pages put before a heading that starts with a Latin word.
const RIGHT_TO_LEFT_MARK: RegExp = /^‏/;

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
 * the words every remaining mention must carry instead - that an incident
 * form sets it, or that a request sending it is refused. A workflow step
 * acts as a Project Admin of its project (WorkflowPrincipal), and no role
 * may send the column, so a step is refused it too.
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
  en: ["form", "is refused"],
  fa: ["فرم", "رد می‌شود"],
};

const TEMPLATE_ID_REFUSED: Record<string, string> = {
  en: "a request that sends `createdIncidentTemplateId` is refused",
  fa: "درخواستی که `createdIncidentTemplateId` بفرستد رد می‌شود",
};

/*
 * How the declaring page's note on it starts: a paragraph after the field
 * list. A workflow step declares from a template again (its Incident
 * Template setting), so the English note names the API key alone; the
 * Persian one follows when the translations catch up.
 */
const TEMPLATE_ID_NOTE_START: Record<string, string> = {
  en: "An API key cannot declare from a template",
  fa: "کلید API یا گام یک گردش کار نمی‌تواند از روی قالب اعلام کند",
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

// The notes page's.
const FEED_RECORDS_SECTION: Record<string, string> = {
  en: "What the feed records",
  fa: "خوراک چه چیزی را ثبت می‌کند",
};

const API_VALUES_SECTION: Record<string, string> = {
  en: "Custom field values through the API",
  fa: "مقادیر فیلدهای سفارشی از راه API",
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

// The characters a feed item escapes in a title: it shows as typed.
const TITLE_ESCAPED_CHARACTERS: ReadonlyArray<string> = [
  "\\",
  "[",
  "]",
  "*",
  "_",
  "~",
  "`",
  "<",
];

const EXAMPLE_TITLE_ADDRESS: string = "https://example.com/reset";

// ASCII punctuation, which a feed item escapes a part of in a title.
const ASCII_PUNCTUATION: string = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

// A mention the page names, which is broken.
const EXAMPLE_MENTION: string = "<!here>";

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

// How each language names the editor's two modes, as a sentence starts.
const VISUAL_MODE: Record<string, string> = {
  en: "In visual mode",
  fa: "در حالت دیداری",
};

const MARKDOWN_MODE: Record<string, string> = {
  en: "In Markdown mode",
  fa: "در حالت مارک‌داون",
};

// What only visual mode does, and what Markdown mode does instead.
const SPLITS_THE_LINE: Record<string, string> = {
  en: "split the line at the cursor",
  fa: "خط را در جای نشانگر می‌شکنند",
};

const PASTED_BLOCK_OF_ITS_OWN: Record<string, string> = {
  en: "pasted into a line becomes a block of its own",
  fa: "درون یک خط چسبانده شود با شکستن خط بلوکی از آن خودش می‌شود",
};

const UNDOES_A_BLOCK_PUT_IN: Record<string, string> = {
  en: "a block it put into a line",
  fa: "بلوکی که در خطی گذاشته",
};

const GOES_IN_AT_THE_CURSOR: Record<string, string> = {
  en: "go in at the cursor",
  fa: "در جای نشانگر گذاشته می‌شوند",
};

// The editor's buttons whose Markdown-mode insert Ctrl+Z cannot take back.
const UNDO_BYPASSING_BUTTONS: ReadonlyArray<string> = [
  "Code Block",
  "Table",
  "Horizontal Rule",
];

// What the feed's escaping of a title leaves as it is, and claims it replaced.
const ADDRESS_STAYS_A_LINK: Record<string, string> = {
  en: "still shows as a link to that same address",
  fa: "همچنان به‌صورت پیوندی به همان نشانی نشان داده می‌شود",
};

/*
 * How the list of a title's escaped characters ends: the backtick named in
 * words (as inline code it needs a longer fence) and the angle bracket as
 * escaped prose.
 */
const ESCAPED_LIST_END: Record<string, string> = {
  en: "`~`, backticks and \\<",
  fa: "`~`، بک‌تیک‌ها و \\<",
};

// What a title no longer does in the feed: it shows as typed.
const STALE_TITLE_FORMATS_CLAIMS: Record<string, ReadonlyArray<string>> = {
  en: ["can still format it", "not always shown exactly as typed"],
  fa: [
    "همچنان می‌توانند قالب‌بندی‌اش کنند",
    "همیشه دقیقاً همان‌طور که تایپ شده نشان داده نمی‌شود",
  ],
};

/*
 * A title as the feed items place one: in a sentence, between words (the
 * Incident Created item bolds it, the episode items put it after a colon).
 */
type PlaceTitleFunction = (title: string) => string;

const placeTitle: PlaceTitleFunction = (title: string): string => {
  return mdText`Added to **Episode EP-7**: ${title}`.toString();
};

const STALE_TITLE_AS_TYPED_CLAIMS: Record<string, ReadonlyArray<string>> = {
  en: [
    "shows as typed and never becomes a link",
    "title as it was typed",
    "an incident title cannot turn into a link, an image or HTML",
  ],
  fa: [
    "عنوان همان‌طور که تایپ شده دیده می‌شود و هرگز پیوند",
    "عنوان حادثه را همان‌طور که تایپ شده نشان می‌دهد",
    "عنوان حادثه نمی‌تواند در یادداشت منتشرشده به پیوند، تصویر یا HTML تبدیل شود",
  ],
};

// Where the incident pages send readers about forms, now a product of its own.
const FORMS_OVERVIEW_PAGE: string = "forms/index";
const FORMS_ON_SUBMIT_PAGE: string = "forms/on-submit";

// A multi-select custom field, and the options it offers.
const EXAMPLE_MULTI_SELECT_FIELD: { name: string; dropdownOptions: string } = {
  name: "Affected Systems",
  dropdownOptions: "API\nWeb\nMobile",
};

type EscapedInProseFunction = (text: string) => string;
const escapedInProse: EscapedInProseFunction = (text: string): string => {
  return text.replace(/[<>]/g, "\\$&");
};

interface MarkdownParts {
  prose: Array<string>;
  codeBlocks: Array<string>;
}

interface Heading {
  level: number;
  text: string;
  slug: string;
}

interface DocsLink {
  page: string;
  anchor: string | undefined;
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

type DocsLinksFunction = (markdown: string) => Array<DocsLink>;

// Every /docs/ link, split into the page and its #anchor, if any.
const docsLinks: DocsLinksFunction = (markdown: string): Array<DocsLink> => {
  return Array.from(
    markdown.matchAll(/\]\(\/docs\/([^)#\s]+)(?:#([^)\s]*))?\)/g),
  ).map((match: RegExpMatchArray): DocsLink => {
    return { page: match[1] as string, anchor: match[2] };
  });
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

type SentencesFunction = (markdown: string) => Array<string>;

/*
 * The sentences of some prose, each ending at its full stop, without the
 * bold lead-in a paragraph may start with ("**Undoing.**").
 */
const sentencesOf: SentencesFunction = (markdown: string): Array<string> => {
  return splitMarkdown(markdown)
    .prose.join("\n")
    .split(/(?<=\.)\s+/)
    .map((sentence: string): string => {
      return sentence.replace(/^\*\*[^*\n]+\.\*\*\s*/, "");
    });
};

type SentenceWithFunction = (markdown: string, text: string) => string;

// The one sentence of some prose that holds a phrase.
const sentenceWith: SentenceWithFunction = (
  markdown: string,
  text: string,
): string => {
  const found: Array<string> = sentencesOf(markdown).filter(
    (sentence: string): boolean => {
      return sentence.includes(text);
    },
  );

  expect({ text: text, sentences: found.length }).toEqual({
    text: text,
    sentences: 1,
  });

  return found[0] || "";
};

type EscapeRegExpFunction = (text: string) => string;

const escapeRegExp: EscapeRegExpFunction = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

type SourceBetweenFunction = (
  source: string,
  start: string,
  end: string,
) => string;

// The source from one marker up to the next marker after it.
const sourceBetween: SourceBetweenFunction = (
  source: string,
  start: string,
  end: string,
): string => {
  const from: number = source.indexOf(start);
  const to: number = source.indexOf(end, from + start.length);

  expect({ start: start, end: end, found: from > -1 && to > from }).toEqual({
    start: start,
    end: end,
    found: true,
  });

  return source.slice(from, to);
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

describe("Incident docs", () => {
  describe("an incident's title in the feed and chat messages", () => {
    it("says which characters of a title are escaped, and that an address in it still works, as the feed places a title, in every language", () => {
      // Each character on its own, between words, where it could act.
      const escaped: Array<string> = Array.from(ASCII_PUNCTUATION).filter(
        (character: string): boolean => {
          return placeTitle(`a ${character} b`).includes(`\\${character}`);
        },
      );

      expect([...escaped].sort()).toEqual([...TITLE_ESCAPED_CHARACTERS].sort());

      // A title reads exactly as typed once the Markdown is read.
      expect(placeTitle("Checkout *down* in eu_west ~1")).toBe(
        "Added to **Episode EP-7**: Checkout \\*down\\* in eu_west \\~1",
      );

      // An address in a title is still an address.
      expect(placeTitle(EXAMPLE_TITLE_ADDRESS)).toBe(
        `Added to **Episode EP-7**: ${EXAMPLE_TITLE_ADDRESS}`,
      );

      for (const language of LANGUAGES) {
        const sections: Array<string> = [
          sectionOf(
            readPage(NOTES_PAGE, language),
            2,
            FEED_RECORDS_SECTION[language] as string,
          ),
        ];

        for (const section of sections) {
          const code: Set<string> = inlineCode(section);

          expect({
            language: language,
            /*
             * The backtick named in words and the angle bracket as escaped
             * prose, where the list ends; the others as inline code.
             */
            escaped: escaped.filter((character: string): boolean => {
              return character === "<" || character === "`"
                ? section.includes(ESCAPED_LIST_END[language] as string)
                : code.has(character);
            }),
            addressStaysALink: section.includes(
              ADDRESS_STAYS_A_LINK[language] as string,
            ),
            mention: section.includes(escapedInProse(EXAMPLE_MENTION)),
            staleFormats: (
              STALE_TITLE_FORMATS_CLAIMS[language] as ReadonlyArray<string>
            ).filter((claim: string): boolean => {
              return section.includes(claim);
            }),
          }).toEqual({
            language: language,
            escaped: escaped,
            addressStaysALink: true,
            mention: true,
            staleFormats: [],
          });
        }

        for (const page of [NOTES_PAGE, SETTINGS_PAGE]) {
          const markdown: string = readPage(page, language);

          expect({
            language: language,
            page: page,
            stale: (
              STALE_TITLE_AS_TYPED_CLAIMS[language] as ReadonlyArray<string>
            ).filter((claim: string): boolean => {
              return markdown.includes(claim);
            }),
          }).toEqual({ language: language, page: page, stale: [] });
        }
      }
    });

    it("names the places that escape a title as their code does", () => {
      const incidentService: string = readSource(INCIDENT_SERVICE_FILE);

      /*
       * Each places the title with mdText, which escapes it as text for
       * where it sits. The Incident Created item, and the item that records
       * a new title:
       */
      expect(incidentService).toMatch(
        /mdText`#### 🚨 Incident \$\{incidentNumberDisplay\} Created:\s*\*\*\$\{incident\.title \|\| "No title provided\."\}\*\*/,
      );
      /*
       * The "updated" item's lines - the new title among them - are written
       * by EventFieldChange, which alerts share: a title is placed as text,
       * at the start of its own line.
       */
      expect(incidentService).toMatch(/EventFieldChange\.getFeedMarkdown\(/);

      const eventFieldChange: string = readSource(EVENT_FIELD_CHANGE_FILE);

      expect(eventFieldChange).toMatch(
        /data\.column === "title" \|\|\s*\(data\.column === "name" && !data\.isMarkdown\)\s*\?\s*text\s*:/,
      );
      expect(eventFieldChange).toMatch(
        /return mdText`\\n\\n\*\*\$\{this\.getHeading\(data\.column, data\.recordName\)\}\*\*: \\n\$\{shown\}\\n`;/,
      );

      // The items for joining or leaving an episode, on both feeds.
      const episodeMembers: string = readSource(EPISODE_MEMBER_SERVICE_FILE);

      /*
       * Each entry names the incident and the episode through one helper,
       * whose title (left out for a private end) goes in as text; joining
       * and leaving each name both sides.
       */
      expect(episodeMembers).toMatch(
        /titleSuffix: mdText`: \$\{data\.title \|\| "No title"\}`/,
      );
      expect(episodeMembers).toMatch(/title: incident\?\.title,/);
      expect(episodeMembers).toMatch(/title: episode\?\.title,/);
      expect(
        (episodeMembers.match(/describeIncident\(incident\)/g) || []).length,
      ).toBe(2);
      expect(
        (episodeMembers.match(/describeEpisode\(episode\)/g) || []).length,
      ).toBe(2);

      /*
       * SLA rules' note reminders place it into the note template a person
       * wrote, as a template value (FeedMarkdown.templateText); Teams bot
       * replies and on-call messages place it with mdText.
       */
      expect(readSource(SLA_NOTE_REMINDERS_FILE)).toMatch(
        /FeedMarkdown\.templateText\(incident\.title \|\| ""\)/,
      );
      expect(readSource(TEAMS_INCIDENT_ACTIONS_FILE)).toMatch(
        /mdText`\*\*Incident Details\*\*\\n\\n\*\*Title:\*\* \$\{incident\.title\}\\n/,
      );
      expect(readSource(USER_NOTIFICATION_RULE_SERVICE_FILE)).toMatch(
        /mdText`📋 \*\*\$\{data\.identifier\}\*\*`/,
      );

      /*
       * Where the title is a link's text - the Slack and Teams summaries,
       * and the Teams bot's list of active incidents - mdText places it as
       * a link's words, where what acts in a link is escaped too.
       */
      const summaries: string = readSource(WORKSPACE_SUMMARY_SERVICE_FILE);

      expect(summaries).toMatch(
        /private static link\(url: string, text: string\): MarkdownText \{\s*return mdText`\[\$\{text\}\]\(\$\{url\}\)`;/,
      );
      expect(summaries).toMatch(
        /Service\.link\(linkUrl, `\$\{display\} — \$\{inc\.title \|\| "Untitled"\}`\)/,
      );
      expect(summaries).toMatch(
        /Service\.link\(linkUrl, ep\.title \|\| "Untitled Episode"\)/,
      );
      expect(readSource(TEAMS_WORKSPACE_FILE)).toMatch(
        /mdText`\$\{severityIcon\} \*\*\[Incident \$\{[^}]*\}: \$\{incident\.title\}\]\(\$\{incidentUrl\.toString\(\)\}\)\*\*/,
      );

      for (const character of ["*", "_", "`", "[", "]", "(", ")", "!", "<"]) {
        expect(mdText`[${character}](https://example.com/i)`.toString()).toBe(
          `[\\${character}](https://example.com/i)`,
        );
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
              name: EXAMPLE_MULTI_SELECT_FIELD.name,
              customFieldType: CustomFieldType.MultiSelectDropdown,
              dropdownOptions: EXAMPLE_MULTI_SELECT_FIELD.dropdownOptions,
            },
          ],
          customFields: {
            [EXAMPLE_MULTI_SELECT_FIELD.name]: refused,
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
    it("can only be set by OneUptime itself: no role may send it; a workflow step names its template under Incident Template, and a state wins over the template's", () => {
      const access: ColumnAccessControl | null =
        new Incident().getColumnAccessControlFor("createdIncidentTemplateId");

      expect(access).not.toBeNull();
      expect(access?.create).toEqual([]);
      expect(access?.update).toEqual([]);

      /*
       * A workflow's create acts as a Project Admin of its project, not as
       * root - with a template picked as without one.
       */
      const createComponent: string = readSource(
        WORKFLOW_CREATE_COMPONENT_FILE,
      );

      expect(createComponent).toMatch(
        /this\.modelService\.create\(\{[\s\S]*?props:\s*await this\.getStepProps\(options\),/,
      );
      expect(createComponent).toMatch(
        /this\.modelService\.createFromTemplate\(\{[\s\S]*?props:\s*await this\.getStepProps\(options\),/,
      );
      expect(createComponent).not.toMatch(/isRoot\s*:/);

      const incidentService: string = readSource(INCIDENT_SERVICE_FILE);

      // The step's template is read as the step; a form's as OneUptime.
      expect(incidentService).toMatch(
        /props:\s*declaredTemplateId\s*\?\s*createBy\.props/,
      );
      // A picked state wins over the template's, and the rest still applies.
      expect(incidentService).toMatch(
        /if \(pickedIncidentStateId\) \{[\s\S]*?\} else if \(incidentTemplate\?\.initialIncidentStateId\) \{/,
      );
      // The column is written once every check on the caller has passed.
      expect(incidentService).toMatch(
        /onCreatePermitted\([\s\S]*?createdIncidentTemplateId = templateId\.toString\(\)/,
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

    it("is not implied by the status page guide either: an incident form declares from a template, and a workflow's Create One Incident step, never the API, in every language", () => {
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
          form: docsLinks(paragraph).some((link: DocsLink): boolean => {
            return link.page === FORMS_ON_SUBMIT_PAGE;
          }),
        }).toEqual({
          language: language,
          stale: false,
          form: true,
        });
      }

      /*
       * A workflow step declares from a template again (Incident Template),
       * and the English guide says so; the translations follow it.
       */
      const englishParagraph: string =
        proseLinesWith(
          readPage(STATUS_PAGE_SCOPE_PAGE, "en"),
          TEMPLATES_WORK_THE_SAME_WAY["en"] as string,
        )[0] || "";

      expect(englishParagraph).toContain("**Create One Incident**");
    });
  });

  describe("the incident pages", () => {
    it("count five ways to declare an incident, the fifth a form, in every language", () => {
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
              return link.page === FORMS_OVERVIEW_PAGE;
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

    it("say which of the Markdown editor's edits split a line, and which Ctrl+Z takes back, in which mode, as the editor makes them, in every language", () => {
      const editor: string = readSource(MARKDOWN_EDITOR_FILE);

      // It opens in visual mode, and its toggle is named for the mode it goes to.
      expect(editor).toMatch(/useState<EditorMode>\("wysiwyg"\)/);
      expect(editor).toMatch(/mode === "wysiwyg" \? "Markdown" : "Visual"/);

      /*
       * The buttons the docs name, by the names the editor gives them: each
       * toolbar action's label is its button's title and its item in the
       * More formatting menu.
       */
      for (const title of [
        ...UNDO_BYPASSING_BUTTONS,
        "Task List",
        "Numbered List",
        "Code",
      ]) {
        expect({
          title: title,
          button: editor.includes(`label: "${title}"`),
        }).toEqual({ title: title, button: true });
      }

      /*
       * In Markdown mode, Code Block, Table and Horizontal Rule put their
       * text in at the caret by setting the text, which the browser's undo
       * never hears of; Task List, like the other list buttons, Tab and a
       * converted paste, edits through execCommand, which it does.
       */
      for (const [action, wysiwyg] of [
        ["codeBlock", "insertWysiwygCodeBlock()"],
        ["table", "insertWysiwygTable()"],
        ["horizontalRule", 'execEditable("insertHorizontalRule")'],
      ] as Array<[string, string]>) {
        expect(editor).toMatch(
          new RegExp(
            `${action}: \\(\\) => \\{\\s*if \\(mode === "wysiwyg"\\) \\{\\s*return ${escapeRegExp(wysiwyg)};\\s*\\}\\s*return insertText\\(`,
          ),
        );
      }

      expect(editor).toMatch(
        /taskList: \(\) => \{\s*if \(mode === "wysiwyg"\) \{\s*return insertWysiwygTaskList\(\);\s*\}\s*return toggleListInTextarea\("task"\);/,
      );

      const insertText: string = sourceBetween(
        editor,
        "const insertText: (",
        "const insertAtLineStart",
      );

      expect(insertText).toContain("handleChange(newText)");
      expect(insertText).not.toContain("execCommand");
      expect(
        sourceBetween(editor, "const applyTextareaEdit", "const editTextarea"),
      ).toMatch(/document\.execCommand\(\s*"insertText"/);
      expect(
        sourceBetween(
          editor,
          "const insertTextInTextarea",
          "const handleTextareaPaste",
        ),
      ).toMatch(/document\.execCommand\("insertText"/);

      // A converted paste goes on lines of its own; inside a code block the text goes in as it is.
      expect(editor).toContain(
        "insertTextInTextarea(onLinesOfItsOwn(textarea, markdown));",
      );
      expect(editor).toMatch(
        /isInFencedCodeBlock\(textarea\.value, textarea\.selectionStart\)/,
      );
      expect(editor).toMatch(
        /if \(codeBlockAtSelection\(\)\) \{\s*const plain: string = clipboardData\.getData\("text\/plain"\)/,
      );

      // Visual mode keeps its own edits undoable after typing: typing only drops what could be redone.
      expect(editor).toMatch(
        /if \(inputType !== "historyUndo" && inputType !== "historyRedo"\) \{\s*history\.clearRedo\(\);/,
      );

      for (const language of LANGUAGES) {
        const stepOne: string = sectionOf(
          readPage(DECLARING_PAGE, language),
          3,
          STEP_ONE_SECTION[language] as string,
        );
        const visual: string = VISUAL_MODE[language] as string;
        const markdownMode: string = MARKDOWN_MODE[language] as string;
        const atTheCursor: string = sentenceWith(
          stepOne,
          GOES_IN_AT_THE_CURSOR[language] as string,
        );
        const markdownUndo: Array<string> = sentencesOf(stepOne).filter(
          (sentence: string): boolean => {
            return (
              sentence.startsWith(markdownMode) && sentence.includes("Ctrl+Z")
            );
          },
        );

        expect({
          language: language,
          toggle: ["Markdown", "Visual"].filter((name: string): boolean => {
            return boldText(stepOne).has(name);
          }),
          splits: sentenceWith(
            stepOne,
            SPLITS_THE_LINE[language] as string,
          ).startsWith(visual),
          pastedBlock: sentenceWith(
            stepOne,
            PASTED_BLOCK_OF_ITS_OWN[language] as string,
          ).startsWith(visual),
          undoesBlocks: sentenceWith(
            stepOne,
            UNDOES_A_BLOCK_PUT_IN[language] as string,
          ).startsWith(visual),
          atTheCursor: atTheCursor.startsWith(markdownMode),
          atTheCursorButtons: ["Code Block", "Table"].filter(
            (name: string): boolean => {
              return boldText(atTheCursor).has(name);
            },
          ),
          markdownUndo: markdownUndo.length,
          notUndone: UNDO_BYPASSING_BUTTONS.filter((name: string): boolean => {
            return boldText(markdownUndo[0] || "").has(name);
          }),
        }).toEqual({
          language: language,
          toggle: ["Markdown", "Visual"],
          splits: true,
          pastedBlock: true,
          undoesBlocks: true,
          atTheCursor: true,
          atTheCursorButtons: ["Code Block", "Table"],
          markdownUndo: 1,
          notUndone: [...UNDO_BYPASSING_BUTTONS],
        });
      }
    });
  });
});
