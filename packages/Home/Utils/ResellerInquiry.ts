import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import SafeHtml from "Common/Types/SafeHtml";

/*
 * THE FORM ON THE RESELLERS PAGE: WHAT IT ASKS, AND THE EMAIL IT SENDS.
 *
 * A company that wants to sell OneUptime fills in the form on /resellers;
 * the page posts it as JSON to RESELLER_INQUIRY_PATH (API/ResellerInquiryAPI.ts)
 * and this turns it into one email to one inbox:
 *
 *  - The inbox is fixed. It is RESELLER_INQUIRY_EMAIL from the environment
 *    of the Home service, or sales@oneuptime.com - never an address from
 *    the request. Nothing is sent to the person who wrote, so the form
 *    cannot be used to send email to anyone else.
 *
 *  - Every value is checked and cleaned here, on the server: the page's own
 *    checks are for the person typing, not a defence. A one-line value
 *    loses its control characters and line breaks (the company's name is
 *    in the subject), and every value is capped in length.
 *
 *  - Every value is placed in the email as text. The template
 *    (ResellerInquiry.hbs) escapes each one; the message keeps its line
 *    breaks as <br/> between lines this escapes first (getMessageHtml).
 *
 *  - Nothing is stored. The email is the only record of an inquiry.
 *
 * A filled-in RESELLER_INQUIRY_HONEYPOT_FIELD - an input people never see -
 * marks a form filled in by a program; it is answered as if it were sent,
 * and nothing is sent.
 */

export const RESELLER_INQUIRY_PATH: string = "/resellers/contact";

export const RESELLER_INQUIRY_INBOX_VARIABLE: string = "RESELLER_INQUIRY_EMAIL";

export const DEFAULT_RESELLER_INQUIRY_INBOX: string = "sales@oneuptime.com";

/*
 * Off the screen and out of the tab order, so a person never fills it in;
 * a name no browser autofills.
 */
export const RESELLER_INQUIRY_HONEYPOT_FIELD: string = "contactPreference";

export type ResellerInquiryField =
  | "name"
  | "email"
  | "company"
  | "website"
  | "regions"
  | "message";

export interface ResellerInquiryFieldRule {
  field: ResellerInquiryField;
  label: string;
  required: boolean;
  maxLength: number;
  // A message keeps its line breaks; every other value is one line.
  multiline: boolean;
  // What the form says when a required field is left empty.
  missingMessage: string;
}

export const ResellerInquiryFieldRules: Record<
  ResellerInquiryField,
  ResellerInquiryFieldRule
> = {
  name: {
    field: "name",
    label: "Your name",
    required: true,
    maxLength: 100,
    multiline: false,
    missingMessage: "Please enter your name.",
  },
  email: {
    field: "email",
    label: "Work email",
    required: true,
    maxLength: 254,
    multiline: false,
    missingMessage: "Please enter your work email.",
  },
  company: {
    field: "company",
    label: "Company",
    required: true,
    maxLength: 150,
    multiline: false,
    missingMessage: "Please enter your company's name.",
  },
  website: {
    field: "website",
    label: "Company website",
    required: false,
    maxLength: 200,
    multiline: false,
    missingMessage: "",
  },
  regions: {
    field: "regions",
    label: "Countries or regions you sell in",
    required: true,
    maxLength: 200,
    multiline: false,
    missingMessage: "Please tell us which countries or regions you sell in.",
  },
  message: {
    field: "message",
    label: "Message",
    required: false,
    maxLength: 3000,
    multiline: true,
    missingMessage: "",
  },
};

// The fields in the order the form asks them, and the email lists them.
export const ResellerInquiryFieldOrder: ReadonlyArray<ResellerInquiryField> = [
  "name",
  "email",
  "company",
  "website",
  "regions",
  "message",
];

export interface ResellerInquiry {
  name: string;
  email: string;
  company: string;
  // As written ("acme.com"), or "" when left empty.
  website: string;
  regions: string;
  // Lines joined with "\n", or "" when left empty.
  message: string;
}

export type ResellerInquiryParseResult =
  | { kind: "valid"; inquiry: ResellerInquiry }
  | {
      kind: "invalid";
      // The field to fix, or null when the request itself is wrong.
      field: ResellerInquiryField | null;
      message: string;
    }
  // The honeypot was filled in: a program sent this.
  | { kind: "trap" };

export const UNREADABLE_INQUIRY_MESSAGE: string =
  "We could not read your message. Please reload the page and try again.";

export const INVALID_EMAIL_MESSAGE: string =
  "Please enter a valid email address, like name@company.com.";

export const INVALID_WEBSITE_MESSAGE: string =
  "Please enter your company's website, like company.com.";

export const getTooLongMessage: (rule: ResellerInquiryFieldRule) => string = (
  rule: ResellerInquiryFieldRule,
): string => {
  return `"${rule.label}" is too long. Please keep it to ${rule.maxLength} characters or fewer.`;
};

/*
 * ---------------------------------------------------------------------------
 * Cleaning. Loops rather than regular expressions: every value here comes
 * from outside, and a loop reads it in one pass whatever its shape.
 * ---------------------------------------------------------------------------
 */

// C0 and C1 control characters, and DEL.
const isControlCharacter: (code: number) => boolean = (
  code: number,
): boolean => {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

/*
 * The bidirectional embeddings, overrides and isolates, which can make text
 * read in an order other than the one it was written in (a company name that
 * shows one thing in the subject and is another).
 */
const isBidiControl: (code: number) => boolean = (code: number): boolean => {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
};

// Spaces and line breaks, as String.prototype.trim reads them.
const isWhitespace: (character: string) => boolean = (
  character: string,
): boolean => {
  return character.trim() === "";
};

/*
 * One line: every run of whitespace (line breaks and tabs included) becomes
 * one space, control and bidirectional control characters go, and so does
 * the space at either end.
 */
export const cleanSingleLine: (value: string) => string = (
  value: string,
): string => {
  let cleaned: string = "";
  let spacePending: boolean = false;

  for (const character of value) {
    if (isWhitespace(character)) {
      spacePending = cleaned.length > 0;
      continue;
    }

    const code: number = character.codePointAt(0) || 0;

    if (isControlCharacter(code) || isBidiControl(code)) {
      continue;
    }

    if (spacePending) {
      cleaned += " ";
      spacePending = false;
    }

    cleaned += character;
  }

  return cleaned;
};

const LINE_FEED: string = "\n";

// Every way a line can end, as one line feed.
const LINE_ENDINGS: ReadonlyArray<string> = [
  "\r\n",
  "\r",
  String.fromCodePoint(0x2028),
  String.fromCodePoint(0x2029),
];

/*
 * A message: its lines cleaned as one-line values, no blank lines at either
 * end, and at most one blank line between paragraphs.
 */
export const cleanMultiline: (value: string) => string = (
  value: string,
): string => {
  let normalized: string = value;

  for (const ending of LINE_ENDINGS) {
    normalized = normalized.split(ending).join(LINE_FEED);
  }

  const lines: Array<string> = [];
  let blankLinePending: boolean = false;

  for (const rawLine of normalized.split(LINE_FEED)) {
    const line: string = cleanSingleLine(rawLine);

    if (line === "") {
      blankLinePending = lines.length > 0;
      continue;
    }

    if (blankLinePending) {
      lines.push("");
      blankLinePending = false;
    }

    lines.push(line);
  }

  return lines.join(LINE_FEED);
};

/*
 * ---------------------------------------------------------------------------
 * Checks.
 * ---------------------------------------------------------------------------
 */

// Characters an address may not hold anywhere (RFC 5322's specials).
const EMAIL_SPECIALS: string = '<>()[]\\,;:"';

const isAsciiLetterOrDigit: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9")
  );
};

// A letter, digit or hyphen of a host name; any non-ASCII letter (IDN) too.
const isDomainCharacter: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    isAsciiLetterOrDigit(character) ||
    character === "-" ||
    (character.codePointAt(0) || 0) > 0x7f
  );
};

const isAllDigits: (text: string) => boolean = (text: string): boolean => {
  for (const character of text) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return true;
};

/*
 * An address someone can be written to at: one "@" with a local part
 * before it and a host name of two labels or more after it, no spaces, no
 * control characters and none of the characters an address may not hold.
 * Deliberately simple: it is there to catch a slip, and a reply will tell
 * whether the address works.
 */
export const isAcceptableEmailAddress: (value: string) => boolean = (
  value: string,
): boolean => {
  if (value.length < 6 || value.length > 254) {
    return false;
  }

  const at: number = value.indexOf("@");

  if (at < 1 || at !== value.lastIndexOf("@")) {
    return false;
  }

  for (const character of value) {
    const code: number = character.codePointAt(0) || 0;

    if (
      isWhitespace(character) ||
      isControlCharacter(code) ||
      isBidiControl(code) ||
      EMAIL_SPECIALS.includes(character)
    ) {
      return false;
    }
  }

  const localPart: string = value.slice(0, at);
  const domain: string = value.slice(at + 1);

  if (
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..")
  ) {
    return false;
  }

  const labels: Array<string> = domain.split(".");

  if (labels.length < 2) {
    return false;
  }

  for (const label of labels) {
    if (
      label.length === 0 ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      return false;
    }

    for (const character of label) {
      if (!isDomainCharacter(character)) {
        return false;
      }
    }
  }

  const topLevelDomain: string = labels[labels.length - 1] || "";

  return topLevelDomain.length >= 2 && !isAllDigits(topLevelDomain);
};

const HTTP_SCHEME: string = "http://";
const HTTPS_SCHEME: string = "https://";

/*
 * A website's address, with or without its scheme ("acme.com",
 * "https://www.acme.com/en"): an http(s) address of a host name with a dot
 * in it, and no user name or password.
 */
export const isAcceptableWebsite: (value: string) => boolean = (
  value: string,
): boolean => {
  const lowerCase: string = value.toLowerCase();
  const address: string =
    lowerCase.startsWith(HTTP_SCHEME) || lowerCase.startsWith(HTTPS_SCHEME)
      ? value
      : `${HTTPS_SCHEME}${value}`;

  let url: URL;

  try {
    url = new URL(address);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  if (url.username || url.password) {
    return false;
  }

  const labels: Array<string> = url.hostname.split(".");

  return (
    labels.length >= 2 &&
    labels.every((label: string): boolean => {
      return label.length > 0;
    })
  );
};

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/*
 * A value as the form sent it: text, or nothing. Anything else - a number,
 * a list, an object - is not something the form sends.
 */
const readText: (
  body: Record<string, unknown>,
  key: string,
) => string | null = (
  body: Record<string, unknown>,
  key: string,
): string | null => {
  const value: unknown = Object.prototype.hasOwnProperty.call(body, key)
    ? body[key]
    : undefined;

  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "string" ? value : null;
};

/*
 * The form's answers, checked: the inquiry to send, what to fix, or a form
 * a program filled in. Keys the form does not send are left behind.
 */
export const parseResellerInquiry: (
  body: unknown,
) => ResellerInquiryParseResult = (
  body: unknown,
): ResellerInquiryParseResult => {
  if (!isPlainObject(body)) {
    return { kind: "invalid", field: null, message: UNREADABLE_INQUIRY_MESSAGE };
  }

  const honeypot: string | null = readText(body, RESELLER_INQUIRY_HONEYPOT_FIELD);

  if (honeypot === null || honeypot.trim() !== "") {
    return { kind: "trap" };
  }

  const values: Partial<Record<ResellerInquiryField, string>> = {};

  for (const field of ResellerInquiryFieldOrder) {
    const rule: ResellerInquiryFieldRule = ResellerInquiryFieldRules[field];
    const raw: string | null = readText(body, field);

    if (raw === null) {
      return {
        kind: "invalid",
        field: field,
        message: UNREADABLE_INQUIRY_MESSAGE,
      };
    }

    /*
     * A value far longer than the field takes is refused before it is
     * read: the page's maxlength never lets a person type one.
     */
    if (raw.length > rule.maxLength * 2) {
      return { kind: "invalid", field: field, message: getTooLongMessage(rule) };
    }

    const value: string = rule.multiline
      ? cleanMultiline(raw)
      : cleanSingleLine(raw);

    if (rule.required && value === "") {
      return { kind: "invalid", field: field, message: rule.missingMessage };
    }

    if (value.length > rule.maxLength) {
      return { kind: "invalid", field: field, message: getTooLongMessage(rule) };
    }

    values[field] = value;
  }

  const inquiry: ResellerInquiry = {
    name: values.name || "",
    email: values.email || "",
    company: values.company || "",
    website: values.website || "",
    regions: values.regions || "",
    message: values.message || "",
  };

  if (!isAcceptableEmailAddress(inquiry.email)) {
    return { kind: "invalid", field: "email", message: INVALID_EMAIL_MESSAGE };
  }

  if (inquiry.website && !isAcceptableWebsite(inquiry.website)) {
    return {
      kind: "invalid",
      field: "website",
      message: INVALID_WEBSITE_MESSAGE,
    };
  }

  return { kind: "valid", inquiry: inquiry };
};

/*
 * ---------------------------------------------------------------------------
 * The email.
 * ---------------------------------------------------------------------------
 */

// How much of the company's name the subject shows.
export const SUBJECT_COMPANY_LIMIT: number = 80;

export const RESELLER_INQUIRY_SUBJECT_PREFIX: string = "Reseller inquiry: ";

// The subject a reply from the email's Reply button starts with.
export const REPLY_SUBJECT: string = "Your reseller inquiry";

const ELLIPSIS: string = "…";

// At most `limit` characters, counted as a reader counts them.
export const truncateText: (text: string, limit: number) => string = (
  text: string,
  limit: number,
): string => {
  const characters: Array<string> = Array.from(text);

  if (characters.length <= limit) {
    return text;
  }

  return `${characters.slice(0, limit - 1).join("").trimEnd()}${ELLIPSIS}`;
};

/*
 * The subject, final text: the company's name is one line already
 * (cleanSingleLine), so it can never start a header of its own.
 */
export const getResellerInquirySubject: (inquiry: ResellerInquiry) => string = (
  inquiry: ResellerInquiry,
): string => {
  return `${RESELLER_INQUIRY_SUBJECT_PREFIX}${truncateText(
    inquiry.company,
    SUBJECT_COMPANY_LIMIT,
  )}`;
};

/*
 * The message as HTML: each line escaped (SafeHtml.escape), and a <br/>
 * between lines. The only markup in it is the <br/> this adds.
 */
export const getMessageHtml: (message: string) => string = (
  message: string,
): string => {
  if (!message) {
    return "";
  }

  return message
    .split(LINE_FEED)
    .map((line: string): string => {
      return SafeHtml.escape(line);
    })
    .join("<br/>");
};

/*
 * A mailto: link that starts a reply to the person who wrote. Each part of
 * the address is percent-encoded, so nothing in it - a "?" or a "&" in the
 * local part - can add a header or a recipient to the reply.
 */
export const getReplyMailtoUrl: (email: string) => string = (
  email: string,
): string => {
  const at: number = email.lastIndexOf("@");

  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(
    email.slice(at + 1),
  )}?subject=${encodeURIComponent(REPLY_SUBJECT)}`;
};

export const getResellerInquiryEmailVariables: (
  inquiry: ResellerInquiry,
) => Dictionary<string | JSONObject> = (
  inquiry: ResellerInquiry,
): Dictionary<string | JSONObject> => {
  return {
    companyName: inquiry.company,
    companyWebsite: inquiry.website,
    regions: inquiry.regions,
    contactName: inquiry.name,
    contactEmail: inquiry.email,
    messageHtml: getMessageHtml(inquiry.message),
    replyUrl: getReplyMailtoUrl(inquiry.email),
  };
};

// The one email an inquiry sends, to the one inbox inquiries go to.
export const buildResellerInquiryEmail: (
  inquiry: ResellerInquiry,
  inbox: Email,
) => EmailMessage = (inquiry: ResellerInquiry, inbox: Email): EmailMessage => {
  return {
    toEmail: inbox,
    templateType: EmailTemplateType.ResellerInquiry,
    subject: getResellerInquirySubject(inquiry),
    isSubjectLiteral: true,
    vars: getResellerInquiryEmailVariables(inquiry),
  };
};

/*
 * ---------------------------------------------------------------------------
 * The inbox.
 * ---------------------------------------------------------------------------
 */

export interface ResellerInquiryInbox {
  inbox: Email;
  // The configured value, when it was set but is no address.
  ignoredValue: string | null;
}

/*
 * Where inquiries go: the configured address, or the default when none is
 * configured or the configured one is no address.
 */
export const readResellerInquiryInbox: (
  configured: string | undefined,
) => ResellerInquiryInbox = (
  configured: string | undefined,
): ResellerInquiryInbox => {
  const value: string = (configured || "").trim();

  if (value && isAcceptableEmailAddress(value) && Email.isValid(value)) {
    return { inbox: new Email(value), ignoredValue: null };
  }

  return {
    inbox: new Email(DEFAULT_RESELLER_INQUIRY_INBOX),
    ignoredValue: value || null,
  };
};

export const getConfiguredResellerInquiryInbox: () => ResellerInquiryInbox =
  (): ResellerInquiryInbox => {
    return readResellerInquiryInbox(
      process.env[RESELLER_INQUIRY_INBOX_VARIABLE],
    );
  };

/*
 * ---------------------------------------------------------------------------
 * What the page needs to draw the form.
 * ---------------------------------------------------------------------------
 */

export interface ResellerInquiryFormContent {
  endpoint: string;
  // Shown under the form for people who would rather write an email.
  fallbackEmail: string;
  honeypotField: string;
  fields: Record<ResellerInquiryField, ResellerInquiryFieldRule>;
}

export const getResellerInquiryFormContent: (
  inbox?: string | undefined,
) => ResellerInquiryFormContent = (
  inbox?: string | undefined,
): ResellerInquiryFormContent => {
  return {
    endpoint: RESELLER_INQUIRY_PATH,
    fallbackEmail:
      inbox || getConfiguredResellerInquiryInbox().inbox.toString(),
    honeypotField: RESELLER_INQUIRY_HONEYPOT_FIELD,
    fields: ResellerInquiryFieldRules,
  };
};
