import Email from "../Email";
import { JSONObject } from "../JSON";

/*
 * HELP AND SUPPORT: WHERE A SERVER SENDS ITS PEOPLE FOR HELP (issues
 * #10864, #10865, #10866).
 *
 * Out of the box every place that offers help points at OneUptime: Help's
 * Support Email, Chat on Slack and Request Demo, the footer's Help and
 * Support link (Contact, on the sign-in pages), the address an error screen
 * asks for a support bundle at, the Get the mobile app prompts and the
 * products menu's Report a bug or request a feature on GitHub. A
 * self-hosted server's people are better served by its own team, so Admin
 * Dashboard > Settings > Help and Support points each one at the server's
 * own address or link, or hides it.
 *
 * Each place is an item (HelpItem), and an item is a choice (HelpChoice)
 * with the value it needs:
 *
 *   Default  what OneUptime does out of the box: exactly what every server
 *            did before the page existed. OneUptime Cloud, and any server
 *            that never saves the page, stays on it.
 *   Email    an email address of the server's own.
 *   Link     a link of the server's own: https, http or mailto, and nothing
 *            else. javascript:, data: and every other scheme are refused.
 *   Text     words of the server's own (the single sign-on screen's
 *            message): plain text, never HTML.
 *   Hidden   not shown at all.
 *
 * Kept on the server's global configuration (GlobalConfig.helpAndSupport)
 * as { [item]: { choice, value } }, holding only the items that are not on
 * their default. Written only through the page's own route, which checks
 * every value (readHelpItemChange). Read back with readHelpAndSupportSettings,
 * which takes nothing it would not have written: a value changed by hand in
 * the database that is not a safe link or a valid address reads as the
 * item's default, never as a link.
 *
 * Pure: the server checks and stores it, env.js and the server's routes
 * carry it to the frontends, and the frontends read it with the same rules.
 */

export enum HelpItem {
  // Help > Support Email, an error screen's support address, Page not found's Contact Support.
  SupportEmail = "supportEmail",
  // Help > Chat on Slack.
  Chat = "chat",
  // The footer's Help and Support link; Contact on the sign-in pages.
  HelpLink = "helpLink",
  // Help > Request Demo.
  RequestDemo = "requestDemo",
  // Help > Give feedback: where what people write goes.
  GiveFeedback = "giveFeedback",
  // The single sign-on screen that says "You need to be invited."
  InviteMessage = "inviteMessage",
  // The Get the mobile app prompts.
  MobileApp = "mobileApp",
  // Report a bug or request a feature, and the feedback's GitHub issue.
  GitHub = "gitHub",
}

export enum HelpChoice {
  Default = "default",
  Email = "email",
  Link = "link",
  Text = "text",
  Hidden = "hidden",
}

// Every item, in the order the settings page lists them.
export const HELP_ITEMS: ReadonlyArray<HelpItem> = [
  HelpItem.SupportEmail,
  HelpItem.Chat,
  HelpItem.RequestDemo,
  HelpItem.GiveFeedback,
  HelpItem.HelpLink,
  HelpItem.GitHub,
  HelpItem.MobileApp,
  HelpItem.InviteMessage,
];

// The choices each item has, its default first.
export const HELP_ITEM_CHOICES: Readonly<
  Record<HelpItem, ReadonlyArray<HelpChoice>>
> = {
  [HelpItem.SupportEmail]: [
    HelpChoice.Default,
    HelpChoice.Email,
    HelpChoice.Hidden,
  ],
  [HelpItem.Chat]: [HelpChoice.Default, HelpChoice.Link, HelpChoice.Hidden],
  [HelpItem.HelpLink]: [HelpChoice.Default, HelpChoice.Link, HelpChoice.Hidden],
  [HelpItem.RequestDemo]: [HelpChoice.Default, HelpChoice.Hidden],
  [HelpItem.GiveFeedback]: [
    HelpChoice.Default,
    HelpChoice.Email,
    HelpChoice.Link,
    HelpChoice.Hidden,
  ],
  [HelpItem.InviteMessage]: [HelpChoice.Default, HelpChoice.Text],
  [HelpItem.MobileApp]: [
    HelpChoice.Default,
    HelpChoice.Link,
    HelpChoice.Hidden,
  ],
  [HelpItem.GitHub]: [HelpChoice.Default, HelpChoice.Hidden],
};

export interface HelpItemSetting {
  choice: HelpChoice;
  /*
   * The address, link or words an Email, Link or Text choice needs; null
   * for Default and Hidden. Also null for a Link carried by env.js, which
   * holds only the values pages anyone can open show (see
   * HELP_AND_SUPPORT_ENVIRONMENT_KEY): the frontend reads it from the server.
   */
  value: string | null;
}

export type HelpAndSupportSettings = Record<HelpItem, HelpItemSetting>;

/*
 * OneUptime's own, as every server had them before the page existed. They
 * are what the Default choice shows.
 */
export const ONEUPTIME_SUPPORT_EMAIL: string = "support@oneuptime.com";
export const ONEUPTIME_CHAT_URL: string =
  "https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA";
export const ONEUPTIME_HELP_URL: string = "https://oneuptime.com/support";
export const ONEUPTIME_DEMO_URL: string =
  "https://oneuptime.com/enterprise/demo";
export const ONEUPTIME_REPORT_ISSUE_URL: string =
  "https://github.com/OneUptime/oneuptime/issues/new/choose";

/*
 * What the single sign-on screen says to someone who needs an invitation,
 * word for word as it always has, until the server's admins write their own.
 */
export const DEFAULT_INVITE_MESSAGE: string =
  "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.";

// The same, for someone with an account who is a member of no project.
export const DEFAULT_NO_PROJECT_MESSAGE: string =
  "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.";

/*
 * The two screens' titles, which stay as they are whatever the message
 * says. The screens are drawn by the server in English, so the settings
 * page's preview shows them as they read.
 */
export const SSO_INVITE_SCREEN_TITLE: string = "You need to be invited.";
export const SSO_NO_PROJECT_SCREEN_TITLE: string = "No project access.";

/*
 * The longest link: room for a help desk's address with a query, far more
 * than a link anyone types needs.
 */
export const HELP_LINK_MAX_LENGTH: number = 2000;

/*
 * The longest message on the sign-in screen: a few sentences with an
 * address and a phone number, short enough to read on a phone.
 */
export const INVITE_MESSAGE_MAX_LENGTH: number = 1000;

// The schemes a link may have, as the URL parser writes them.
export const SAFE_LINK_PROTOCOLS: ReadonlyArray<string> = [
  "https:",
  "http:",
  "mailto:",
];

/*
 * The words a refusal says, each a key of the Admin Dashboard's locales: the
 * page shows them in the admin's language, and the server refuses a write
 * with the English, so the two never say different things.
 */
export const HelpAndSupportProblems: {
  unknownItem: string;
  unknownChoice: string;
  emailMissing: string;
  emailInvalid: string;
  linkMissing: string;
  linkTooLong: string;
  linkInvalid: string;
  linkScheme: string;
  textMissing: string;
  textTooLong: string;
  textHtml: string;
  textControlCharacters: string;
} = {
  unknownItem: "Pick one of the places this page lists, then save again.",
  unknownChoice: "Pick one of the choices this setting has, then save again.",
  emailMissing: "Enter the email address people should write to.",
  emailInvalid:
    "Enter one email address, written as name@example.com, without a name or angle brackets.",
  linkMissing: "Enter the link people should open.",
  linkTooLong: "The link can be at most 2000 characters.",
  linkInvalid:
    "Enter a whole link, such as https://help.example.com, without spaces or quotes.",
  linkScheme:
    "Use a link that starts with https://, http:// or mailto:. Other kinds of links can run code in the browser, so they are refused.",
  textMissing: "Write the message, or go back to the default.",
  textTooLong: "The message can be at most 1000 characters.",
  textHtml:
    "The message is shown as plain text, so it can't contain < or >. Links and email addresses in it become links by themselves.",
  textControlCharacters:
    "The message can hold letters, numbers, punctuation and line breaks only.",
};

/*
 * Characters a link never needs as they are (a real one percent-encodes
 * them), and which would let a value break out of where it is written:
 * whitespace, quotes, angle brackets, a backtick and a backslash.
 */
const UNSAFE_LINK_CHARACTER: RegExp = /[\s"'<>`\\]/;

/*
 * Characters an address never holds here: whitespace, quotes and angle
 * brackets. The shared check (Email.isValid) allows a quoted local part,
 * which may hold them; an address of the server's own never needs one.
 */
const UNSAFE_EMAIL_CHARACTER: RegExp = /[\s"'<>`\\]/;

// A link written with its scheme, as a person writes it.
const WHOLE_LINK: RegExp = /^(?:https?:\/\/[^/?#]|mailto:)/i;

// C0 and C1 control characters, but for a line break.
const hasControlCharacter: (
  value: string,
  allowLineBreaks: boolean,
) => boolean = (value: string, allowLineBreaks: boolean): boolean => {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (allowLineBreaks && code === 0x0a) {
      continue;
    }

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }

  return false;
};

// Why `value` is not an address people can write to, or null when it is.
export const getHelpEmailProblem: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || !value.trim()) {
    return HelpAndSupportProblems.emailMissing;
  }

  const address: string = value.trim();

  if (
    UNSAFE_EMAIL_CHARACTER.test(address) ||
    hasControlCharacter(address, false) ||
    !Email.isValid(address)
  ) {
    return HelpAndSupportProblems.emailInvalid;
  }

  return null;
};

// The address as it is kept: trimmed and in lower case, as Email keeps one.
export const toHelpEmail: (value: string) => string = (
  value: string,
): string => {
  return value.trim().toLowerCase();
};

/*
 * The addresses of a mailto: link: before its query, split at commas, each
 * a valid address. Null when there is none, or one is not an address.
 */
const getMailtoAddresses: (link: string) => Array<string> | null = (
  link: string,
): Array<string> | null => {
  const withoutScheme: string = link.slice("mailto:".length);
  const beforeQuery: string = withoutScheme.split("?")[0] || "";

  let decoded: string = "";

  try {
    decoded = decodeURIComponent(beforeQuery);
  } catch {
    return null;
  }

  const addresses: Array<string> = decoded
    .split(",")
    .map((address: string): string => {
      return address.trim();
    });

  if (
    addresses.length === 0 ||
    addresses.some((address: string): boolean => {
      return getHelpEmailProblem(address) !== null;
    })
  ) {
    return null;
  }

  return addresses;
};

/*
 * Why `value` is not a link this page may show, or null when it is: a whole
 * https, http or mailto link, written with its scheme, with no whitespace,
 * quotes, angle brackets, backslash or control characters, no name and
 * password before its host, and at most HELP_LINK_MAX_LENGTH long. Every
 * other scheme - javascript:, data:, vbscript:, file: - is refused.
 */
export const getHelpLinkProblem: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || !value.trim()) {
    return HelpAndSupportProblems.linkMissing;
  }

  const link: string = value.trim();

  if (link.length > HELP_LINK_MAX_LENGTH) {
    return HelpAndSupportProblems.linkTooLong;
  }

  let url: URL | null = null;

  try {
    url = new URL(link);
  } catch {
    url = null;
  }

  // A scheme that is not one of the three says so, whatever else is wrong.
  if (url && !SAFE_LINK_PROTOCOLS.includes(url.protocol.toLowerCase())) {
    return HelpAndSupportProblems.linkScheme;
  }

  if (
    !url ||
    UNSAFE_LINK_CHARACTER.test(link) ||
    hasControlCharacter(link, false)
  ) {
    return HelpAndSupportProblems.linkInvalid;
  }

  if (!WHOLE_LINK.test(link)) {
    // "https:help.example.com", "http:/x": a parser fills in what is missing.
    return HelpAndSupportProblems.linkInvalid;
  }

  if (url.protocol.toLowerCase() === "mailto:") {
    return getMailtoAddresses(link) ? null : HelpAndSupportProblems.linkInvalid;
  }

  // "https://oneuptime.com@other.example": a name before the host misleads.
  if (!url.hostname || url.username || url.password) {
    return HelpAndSupportProblems.linkInvalid;
  }

  return null;
};

export const isSafeHelpLink: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return getHelpLinkProblem(value) === null;
};

/*
 * A link of the server's own, named the way a person recognizes it: an
 * https or http link by its host ("help.example.com"), a mailto: link by
 * its address ("it-help@example.com"). Read as written in every language,
 * so a page names it without a sentence of its own.
 */
export const getHelpLinkLabel: (link: string) => string = (
  link: string,
): string => {
  const trimmed: string = link.trim();

  if (trimmed.toLowerCase().startsWith("mailto:")) {
    const addresses: Array<string> | null = getMailtoAddresses(trimmed);

    return addresses ? addresses.join(", ") : trimmed;
  }

  try {
    return new URL(trimmed).hostname || trimmed;
  } catch {
    return trimmed;
  }
};

/*
 * Why `value` cannot be the sign-in screen's message, or null when it can:
 * plain text of at most INVITE_MESSAGE_MAX_LENGTH characters, with line
 * breaks but no other control characters, and no < or >, so nothing in it
 * reads as HTML anywhere it is shown. Links and addresses in it become links
 * on the screen by themselves (InviteMessage).
 */
export const getInviteMessageProblem: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || !value.trim()) {
    return HelpAndSupportProblems.textMissing;
  }

  const text: string = toInviteMessage(value);

  if (text.length > INVITE_MESSAGE_MAX_LENGTH) {
    return HelpAndSupportProblems.textTooLong;
  }

  if (text.includes("<") || text.includes(">")) {
    return HelpAndSupportProblems.textHtml;
  }

  if (hasControlCharacter(text, true)) {
    return HelpAndSupportProblems.textControlCharacters;
  }

  return null;
};

/*
 * The message as it is kept: Windows and old Mac line ends as one line
 * break, a tab as a space, each line's trailing spaces and the whole
 * message's blank lines at either end dropped.
 */
export const toInviteMessage: (value: string) => string = (
  value: string,
): string => {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line: string): string => {
      return line.trimEnd();
    })
    .join("\n")
    .trim();
};

// Why `choice` and `value` cannot be kept for `item`, or null when they can.
export const getHelpItemProblem: (
  item: HelpItem,
  choice: unknown,
  value: unknown,
) => string | null = (
  item: HelpItem,
  choice: unknown,
  value: unknown,
): string | null => {
  if (
    typeof choice !== "string" ||
    !(HELP_ITEM_CHOICES[item] as ReadonlyArray<string>).includes(choice)
  ) {
    return HelpAndSupportProblems.unknownChoice;
  }

  switch (choice as HelpChoice) {
    case HelpChoice.Email:
      return getHelpEmailProblem(value);
    case HelpChoice.Link:
      return getHelpLinkProblem(value);
    case HelpChoice.Text:
      return getInviteMessageProblem(value);
    default:
      return null;
  }
};

export const isHelpItem: (value: unknown) => value is HelpItem = (
  value: unknown,
): value is HelpItem => {
  return (
    typeof value === "string" &&
    (Object.values(HelpItem) as Array<string>).includes(value)
  );
};

// The setting as it is kept: the value tidied the way its choice keeps it.
const toKeptSetting: (choice: HelpChoice, value: unknown) => HelpItemSetting = (
  choice: HelpChoice,
  value: unknown,
): HelpItemSetting => {
  switch (choice) {
    case HelpChoice.Email:
      return { choice: choice, value: toHelpEmail(value as string) };
    case HelpChoice.Link:
      return { choice: choice, value: (value as string).trim() };
    case HelpChoice.Text:
      return { choice: choice, value: toInviteMessage(value as string) };
    default:
      return { choice: choice, value: null };
  }
};

export interface HelpItemChange {
  item: HelpItem;
  setting: HelpItemSetting;
}

/*
 * One change the settings page posts - { item, choice, value } - checked,
 * or the sentence that says why it cannot be kept. A value is read only
 * when the choice needs one.
 */
export const readHelpItemChange: (body: unknown) => HelpItemChange | string = (
  body: unknown,
): HelpItemChange | string => {
  const data: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const item: unknown = data["item"];

  if (!isHelpItem(item)) {
    return HelpAndSupportProblems.unknownItem;
  }

  const problem: string | null = getHelpItemProblem(
    item,
    data["choice"],
    data["value"],
  );

  if (problem) {
    return problem;
  }

  return {
    item: item,
    setting: toKeptSetting(data["choice"] as HelpChoice, data["value"]),
  };
};

const DEFAULT_SETTING: HelpItemSetting = {
  choice: HelpChoice.Default,
  value: null,
};

// Every item on its default: what a server that never saved the page shows.
export const getDefaultHelpAndSupportSettings: () => HelpAndSupportSettings =
  (): HelpAndSupportSettings => {
    const settings: Partial<HelpAndSupportSettings> = {};

    for (const item of HELP_ITEMS) {
      settings[item] = { ...DEFAULT_SETTING };
    }

    return settings as HelpAndSupportSettings;
  };

const readObject: (value: unknown) => Record<string, unknown> = (
  value: unknown,
): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

/*
 * The settings kept on the server (GlobalConfig.helpAndSupport), each item
 * read on its own: a choice the item does not have, or a value its choice
 * would refuse, reads as the item's default. Nothing read here is ever an
 * unsafe link, an invalid address or text with markup in it.
 */
export const readHelpAndSupportSettings: (
  value: unknown,
) => HelpAndSupportSettings = (value: unknown): HelpAndSupportSettings => {
  const stored: Record<string, unknown> = readObject(value);
  const settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();

  for (const item of HELP_ITEMS) {
    const entry: Record<string, unknown> = readObject(stored[item]);

    if (getHelpItemProblem(item, entry["choice"], entry["value"]) !== null) {
      continue;
    }

    settings[item] = toKeptSetting(
      entry["choice"] as HelpChoice,
      entry["value"],
    );
  }

  return settings;
};

/*
 * The settings as they are kept and sent: only the items that are not on
 * their default, each { choice } or { choice, value }. {} when every item
 * is on its default.
 */
export const toHelpAndSupportJSON: (
  settings: HelpAndSupportSettings,
  items?: ReadonlyArray<HelpItem> | undefined,
) => JSONObject = (
  settings: HelpAndSupportSettings,
  items?: ReadonlyArray<HelpItem> | undefined,
): JSONObject => {
  const json: JSONObject = {};

  for (const item of items || HELP_ITEMS) {
    const setting: HelpItemSetting = settings[item];

    if (setting.choice === HelpChoice.Default) {
      continue;
    }

    json[item] =
      setting.value === null
        ? { choice: setting.choice }
        : { choice: setting.choice, value: setting.value };
  }

  return json;
};

// The settings with one item changed.
export const withHelpItemChanged: (
  settings: HelpAndSupportSettings,
  change: HelpItemChange,
) => HelpAndSupportSettings = (
  settings: HelpAndSupportSettings,
  change: HelpItemChange,
): HelpAndSupportSettings => {
  return { ...settings, [change.item]: { ...change.setting } };
};

export const isOnDefault: (
  settings: HelpAndSupportSettings,
  item: HelpItem,
) => boolean = (settings: HelpAndSupportSettings, item: HelpItem): boolean => {
  return settings[item].choice === HelpChoice.Default;
};

/*
 * HOW THE FRONTENDS LEARN THE SETTINGS.
 *
 * The settings reach the Dashboard and the sign-in pages (Accounts) in
 * env.js, as one JSON string under HELP_AND_SUPPORT_ENVIRONMENT_KEY, so a
 * page knows them before it draws, and an error screen knows them however
 * the page broke. env.js is served to anybody who asks, so it carries every
 * item's choice but only the values pages anyone can open show: the support
 * address (an error screen on the sign-in pages names it) and the help link
 * (the sign-in pages' footer shows it). A chat link - often an invitation
 * into a workspace - and the mobile app's page are sent to signed-in people
 * only (HELP_AND_SUPPORT_LINKS_ROUTE). Give feedback goes with the feedback
 * settings, and the sign-in screen's message is shown by the server, so
 * neither is in env.js.
 *
 * The key is not there at all while every item is on its default: env.js
 * reads exactly as it did before, on OneUptime Cloud and on every server
 * that never changed the page. The status pages, public dashboards and the
 * Admin Dashboard never carry it: their visitors are not this server's
 * people, and its admins get help from OneUptime.
 */
export const HELP_AND_SUPPORT_ENVIRONMENT_KEY: string = "HELP_AND_SUPPORT";

// The frontends whose env.js carries it.
export const HELP_AND_SUPPORT_FRONTENDS: ReadonlyArray<string> = [
  "dashboard",
  "accounts",
];

// The items env.js carries, and of those, the ones it carries a value for.
export const HELP_AND_SUPPORT_ENVIRONMENT_ITEMS: ReadonlyArray<HelpItem> = [
  HelpItem.SupportEmail,
  HelpItem.Chat,
  HelpItem.HelpLink,
  HelpItem.RequestDemo,
  HelpItem.MobileApp,
  HelpItem.GitHub,
];

export const HELP_AND_SUPPORT_PUBLIC_VALUE_ITEMS: ReadonlyArray<HelpItem> = [
  HelpItem.SupportEmail,
  HelpItem.HelpLink,
];

// The items signed-in people read from the server, with their values.
export const HELP_AND_SUPPORT_LINKS_ITEMS: ReadonlyArray<HelpItem> =
  HELP_AND_SUPPORT_ENVIRONMENT_ITEMS;

// GET: what signed-in people see, with every value. Any signed-in person.
export const HELP_AND_SUPPORT_LINKS_ROUTE: string =
  "/global-config/help-and-support/links";

// GET and POST: Admin Dashboard > Settings > Help and Support. Master admins.
export const HELP_AND_SUPPORT_SETTINGS_ROUTE: string =
  "/global-config/help-and-support";

export const shouldCarryHelpAndSupport: (frontend: string) => boolean = (
  frontend: string,
): boolean => {
  return HELP_AND_SUPPORT_FRONTENDS.includes(
    frontend.replace(/^\/+/, "").toLowerCase(),
  );
};

/*
 * What env.js carries, as one JSON string, or null when every item it
 * carries is on its default (the key is then left out).
 */
export const toHelpAndSupportEnvironmentValue: (
  settings: HelpAndSupportSettings,
) => string | null = (settings: HelpAndSupportSettings): string | null => {
  const json: JSONObject = {};

  for (const item of HELP_AND_SUPPORT_ENVIRONMENT_ITEMS) {
    const setting: HelpItemSetting = settings[item];

    if (setting.choice === HelpChoice.Default) {
      continue;
    }

    json[item] =
      setting.value !== null &&
      HELP_AND_SUPPORT_PUBLIC_VALUE_ITEMS.includes(item)
        ? { choice: setting.choice, value: setting.value }
        : { choice: setting.choice };
  }

  return Object.keys(json).length > 0 ? JSON.stringify(json) : null;
};

/*
 * The settings env.js carried, as a frontend reads them: every item it
 * carries on the choice it says, with a value where env.js has one. A Link
 * whose value env.js holds back reads as { Link, null }: the page knows the
 * server has a link of its own, and reads it from the server before it
 * shows it. Anything else env.js could not have written reads as the
 * default, and nothing (an empty or broken value) reads as every default.
 */
export const fromHelpAndSupportEnvironmentValue: (
  raw: unknown,
) => HelpAndSupportSettings = (raw: unknown): HelpAndSupportSettings => {
  const settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();

  if (typeof raw !== "string" || !raw.trim()) {
    return settings;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return settings;
  }

  const carried: Record<string, unknown> = readObject(parsed);

  for (const item of HELP_AND_SUPPORT_ENVIRONMENT_ITEMS) {
    const entry: Record<string, unknown> = readObject(carried[item]);
    const choice: unknown = entry["choice"];

    if (
      choice === HelpChoice.Link &&
      entry["value"] === undefined &&
      !HELP_AND_SUPPORT_PUBLIC_VALUE_ITEMS.includes(item) &&
      HELP_ITEM_CHOICES[item].includes(HelpChoice.Link)
    ) {
      settings[item] = { choice: HelpChoice.Link, value: null };
      continue;
    }

    if (getHelpItemProblem(item, choice, entry["value"]) !== null) {
      continue;
    }

    settings[item] = toKeptSetting(choice as HelpChoice, entry["value"]);
  }

  return settings;
};

/*
 * WHAT PEOPLE SEE, item by item: every page asks these, never the choices
 * themselves, so a page cannot show a link it was not given.
 */

// The address people write to for help, or null when it is hidden.
export const getSupportEmailAddress: (
  settings: HelpAndSupportSettings,
) => string | null = (settings: HelpAndSupportSettings): string | null => {
  const setting: HelpItemSetting = settings[HelpItem.SupportEmail];

  if (setting.choice === HelpChoice.Hidden) {
    return null;
  }

  if (setting.choice === HelpChoice.Email && setting.value) {
    return setting.value;
  }

  return setting.choice === HelpChoice.Default ? ONEUPTIME_SUPPORT_EMAIL : null;
};

/*
 * The server's own support address, or null: on OneUptime's default, and
 * hidden. What an account email names where it would otherwise say "Ask
 * your server's admin" (#10941): an address an admin set, never
 * OneUptime's, and nothing at all while the address is hidden.
 */
export const getOwnSupportEmailAddress: (
  settings: HelpAndSupportSettings,
) => string | null = (settings: HelpAndSupportSettings): string | null => {
  const setting: HelpItemSetting = settings[HelpItem.SupportEmail];

  if (
    setting.choice !== HelpChoice.Email ||
    !setting.value ||
    getHelpEmailProblem(setting.value) !== null
  ) {
    return null;
  }

  return setting.value;
};

// Whether the support address is OneUptime's own.
export const isOneUptimeSupportEmail: (
  settings: HelpAndSupportSettings,
) => boolean = (settings: HelpAndSupportSettings): boolean => {
  return settings[HelpItem.SupportEmail].choice === HelpChoice.Default;
};

/*
 * Where a link of the server's own leads, or OneUptime's on the default, or
 * null: hidden, or a link of the server's own not read from the server yet.
 */
const getLink: (
  setting: HelpItemSetting,
  oneUptimeUrl: string,
) => string | null = (
  setting: HelpItemSetting,
  oneUptimeUrl: string,
): string | null => {
  if (setting.choice === HelpChoice.Default) {
    return oneUptimeUrl;
  }

  if (setting.choice === HelpChoice.Link && isSafeHelpLink(setting.value)) {
    return setting.value;
  }

  return null;
};

// What kind of chat a link opens, for Help to name it and draw its mark.
export enum ChatKind {
  Slack = "slack",
  MicrosoftTeams = "microsoft_teams",
  Other = "other",
}

const SLACK_HOST: RegExp = /(^|\.)slack\.com$/i;
const TEAMS_HOST: RegExp = /^teams\.(microsoft|live)\.com$/i;

export const getChatKind: (url: string) => ChatKind = (
  url: string,
): ChatKind => {
  let hostname: string = "";

  try {
    hostname = new URL(url).hostname;
  } catch {
    return ChatKind.Other;
  }

  if (SLACK_HOST.test(hostname)) {
    return ChatKind.Slack;
  }

  if (TEAMS_HOST.test(hostname)) {
    return ChatKind.MicrosoftTeams;
  }

  return ChatKind.Other;
};

export interface ChatLink {
  url: string;
  kind: ChatKind;
  isOneUptime: boolean;
}

// Help's chat entry, or null when there is none to show.
export const getChatLink: (
  settings: HelpAndSupportSettings,
) => ChatLink | null = (settings: HelpAndSupportSettings): ChatLink | null => {
  const setting: HelpItemSetting = settings[HelpItem.Chat];
  const url: string | null = getLink(setting, ONEUPTIME_CHAT_URL);

  if (!url) {
    return null;
  }

  return {
    url: url,
    kind: getChatKind(url),
    isOneUptime: setting.choice === HelpChoice.Default,
  };
};

export interface HelpPageLink {
  url: string;
  isOneUptime: boolean;
}

/*
 * The footer's Help and Support link (Contact, on the sign-in pages), or
 * null when there is none to show. OneUptime's own is left out where the
 * installation goes by another name (ProductBranding: OneUptime's support
 * desk is not its own), as the footer always did; a link of the server's
 * own is shown whatever the name.
 */
export const getHelpPageLink: (
  settings: HelpAndSupportSettings,
  options?: { isProductRenamed?: boolean | undefined } | undefined,
) => HelpPageLink | null = (
  settings: HelpAndSupportSettings,
  options?: { isProductRenamed?: boolean | undefined } | undefined,
): HelpPageLink | null => {
  const setting: HelpItemSetting = settings[HelpItem.HelpLink];

  if (setting.choice === HelpChoice.Default && options?.isProductRenamed) {
    return null;
  }

  const url: string | null = getLink(setting, ONEUPTIME_HELP_URL);

  return url
    ? { url: url, isOneUptime: setting.choice === HelpChoice.Default }
    : null;
};

// Help's Request Demo, or null when it is hidden.
export const getRequestDemoUrl: (
  settings: HelpAndSupportSettings,
) => string | null = (settings: HelpAndSupportSettings): string | null => {
  return settings[HelpItem.RequestDemo].choice === HelpChoice.Hidden
    ? null
    : ONEUPTIME_DEMO_URL;
};

/*
 * Whether OneUptime's GitHub is offered: the products menu's Report a bug or
 * request a feature, and the public GitHub issue offered after feedback.
 */
export const isOneUptimeGitHubShown: (
  settings: HelpAndSupportSettings,
) => boolean = (settings: HelpAndSupportSettings): boolean => {
  return settings[HelpItem.GitHub].choice !== HelpChoice.Hidden;
};

export enum MobileAppOfferKind {
  // The OneUptime On-Call app, from the App Store and Google Play.
  OneUptime = "oneuptime",
  // A page of the server's own: an app catalogue, a device manager.
  OwnPage = "own_page",
}

export interface MobileAppOffer {
  kind: MobileAppOfferKind;
  // The page of the server's own; null on OneUptime's, or until it is read.
  url: string | null;
}

/*
 * How the Get the mobile app prompts offer the app, or null when they are
 * hidden: OneUptime's stores, or the server's own page.
 */
export const getMobileAppOffer: (
  settings: HelpAndSupportSettings,
) => MobileAppOffer | null = (
  settings: HelpAndSupportSettings,
): MobileAppOffer | null => {
  const setting: HelpItemSetting = settings[HelpItem.MobileApp];

  if (setting.choice === HelpChoice.Hidden) {
    return null;
  }

  if (setting.choice === HelpChoice.Link) {
    return {
      kind: MobileAppOfferKind.OwnPage,
      url: isSafeHelpLink(setting.value) ? setting.value : null,
    };
  }

  return { kind: MobileAppOfferKind.OneUptime, url: null };
};

/*
 * What the single sign-on screen says to someone who needs an invitation:
 * the server's own words, or the default for the screen.
 */
export const getInviteMessage: (
  settings: HelpAndSupportSettings,
  defaultMessage: string,
) => string = (
  settings: HelpAndSupportSettings,
  defaultMessage: string,
): string => {
  const setting: HelpItemSetting = settings[HelpItem.InviteMessage];

  if (
    setting.choice === HelpChoice.Text &&
    setting.value &&
    getInviteMessageProblem(setting.value) === null
  ) {
    return setting.value;
  }

  return defaultMessage;
};

// Whether the sign-in screen shows the server's own words.
export const hasOwnInviteMessage: (
  settings: HelpAndSupportSettings,
) => boolean = (settings: HelpAndSupportSettings): boolean => {
  return settings[HelpItem.InviteMessage].choice === HelpChoice.Text;
};
