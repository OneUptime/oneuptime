import {
  MenuSection,
  developerSection,
  menuSections,
  readDashboardSource,
  startsCollapsed,
  workspaceSection,
} from "../FeatureSet/Docs/DocsDashboardMenus";
import { replaceHtmlMarkup } from "Common/Types/HtmlMarkup";

/*
 * MENU PATHS IN ONEUPTIME'S OWN WORDS.
 *
 * A text that sends somebody somewhere - an email's footer, a refusal, an
 * empty table - writes the way there as a path: "User Settings > Notification
 * Settings", "Project Settings > Workspace > Slack". Nothing compiles such a
 * sentence, so when a menu changes, the sentence goes on pointing at a page
 * that is not there: the owner emails said "Dashboard > More > User Settings"
 * long after User Settings moved onto the bar, and the Slack account card sent
 * people to "User Settings > Slack Integration" long after that page became
 * the Slack entry of the folded Workspace section.
 *
 * These read the two settings menus from their sources, as the side menus
 * draw them, and walk a written path through them. A path is one a reader can
 * follow when:
 *
 *   - its first step is a page of the menu, or a section and then a page in
 *     it ("User Settings > Calendar > Calendar Feed");
 *   - a page in a section that starts folded is named with its section, since
 *     the page is not on screen until the section is opened ("User Settings >
 *     Workspace > Slack", not "User Settings > Slack"); a section whose page
 *     has its name ("On-Call Logs") is named once;
 *   - nothing but OneUptime or its Dashboard comes before "User Settings",
 *     which is on the bar itself, or before "Project Settings", where a path
 *     through it starts ("More -> Project Settings" names a menu the bar has
 *     not had for a long time);
 *   - it calls Project Settings by its name: "Settings > Domains" sends the
 *     reader looking for a menu called Settings, and every product's menu
 *     has a Settings section of its own.
 *
 * What follows a page (a tab, a card) is not checked. Every Project Settings
 * path is walked: all of its sections but Basic start folded, so nearly every
 * page in it is named with its section ("Project Settings > Notifications >
 * Notification Settings", "Project Settings > Billing and Invoices >
 * Billing").
 *
 * A product's own menu is walked the same way, from the product's name on
 * the bar: On-Call Duty's ("On-Call Duty > Advanced > User Overrides",
 * OnCallDutyMenuPathsInProductText).
 *
 * App tests must not import the Dashboard's React modules, so the menus are
 * read as text, with the readers the docs suites use (DocsDashboardMenus).
 */

export const USER_SETTINGS: string = "User Settings";
export const PROJECT_SETTINGS: string = "Project Settings";
/*
 * What a text calls Project Settings when it leaves out "Project": "Settings
 * > Domains". Every product menu has a Settings section, so the reader cannot
 * tell which menu that is.
 */
export const BARE_SETTINGS: string = "Settings";

/*
 * What a text may name before "User Settings" or "Project Settings": the
 * product, or its Dashboard ("OneUptime Dashboard > User Settings"), or a
 * value a template puts in.
 */
export const ALLOWED_BEFORE_SETTINGS_MENU: ReadonlyArray<string> = [
  "Dashboard",
  "OneUptime",
  "}",
];

// Where each settings menu is, said when a text puts a menu before it.
const WHERE_THE_MENU_IS: Record<string, string> = {
  [USER_SETTINGS]: "which is on the bar itself",
  [PROJECT_SETTINGS]: "where a path through it starts",
};

export interface SettingsMenuSection extends MenuSection {
  // Whether the section starts folded, so that a path has to name it.
  folded: boolean;
}

export interface SettingsMenu {
  // How a text names the menu: "User Settings", "Project Settings".
  name: string;
  sections: Array<SettingsMenuSection>;
}

// The title of the Workspace section's entry that connects a workspace.
const CONNECT_ENTRY_TITLE: RegExp =
  /\[WorkspaceMenuEntry\.Connect\]:\s*"([^"]+)"/;

function withFolds(
  source: string,
  sections: Array<MenuSection>,
): Array<SettingsMenuSection> {
  return sections.map((section: MenuSection): SettingsMenuSection => {
    return {
      title: section.title,
      items: [...section.items],
      folded: startsCollapsed(source, section.title),
    };
  });
}

/*
 * User Settings, with the Workspace section where the menu adds it. User
 * Settings has no page to connect a workspace, so that section lists the
 * workspaces themselves.
 */
export function userSettingsMenu(): SettingsMenu {
  const file: string = readDashboardSource("Pages/UserSettings/SideMenu.tsx");
  const source: string = file.slice(
    file.indexOf("const sections: SideMenuSectionProps[]"),
  );
  const workspace: MenuSection = workspaceSection();
  const connect: string =
    CONNECT_ENTRY_TITLE.exec(
      readDashboardSource("Components/Workspace/WorkspaceSideMenuSection.ts"),
    )?.[1] || "";

  return {
    name: USER_SETTINGS,
    sections: withFolds(
      source,
      menuSections(source, {
        "...(workspaceSection ?": {
          title: workspace.title,
          items: workspace.items.filter((item: string): boolean => {
            return item !== connect;
          }),
        },
      }),
    ),
  };
}

// The On-Call Duty product, as the bar names it.
export const ON_CALL_DUTY: string = "On-Call Duty";

/*
 * The On-Call Duty product's side menu, as it draws it: its own sections,
 * the Workspace section where the menu adds it (with every entry it can
 * show: the connected workspaces, or the one that connects a workspace), and
 * the Developer section every product menu ends with.
 */
export function onCallDutyMenu(): SettingsMenu {
  const file: string = readDashboardSource("Pages/OnCallDuty/SideMenu.tsx");
  // The sections on: the "Timeline" above is Execution Logs' sub-entry.
  const source: string = file.slice(
    file.indexOf("const sections: SideMenuSectionProps[]"),
  );

  return {
    name: ON_CALL_DUTY,
    sections: withFolds(
      source,
      menuSections(source, {
        "...(workspaceSection ?": workspaceSection(),
        "addDeveloperSideMenuSection(sections": developerSection(),
      }),
    ),
  };
}

/*
 * Project Settings, with every section the menu can show: Billing and
 * Invoices, and AI Credits in the AI section, only where billing is on,
 * which is where a text sends people to them.
 */
export function projectSettingsMenu(): SettingsMenu {
  const source: string = readDashboardSource("Pages/Settings/SideMenu.tsx");

  return {
    name: PROJECT_SETTINGS,
    sections: withFolds(source, menuSections(source)),
  };
}

// A Project Settings page's breadcrumb: "Project", "Settings", its title.
const PROJECT_SETTINGS_BREADCRUMB: RegExp =
  /"Project",\s*"Settings",\s*"([^"]+)"/g;

/*
 * The titles Project Settings' pages go by in their breadcrumbs, some of
 * them not the menu's ("Telemetry Ingestion Keys" for the Ingestion Keys
 * entry): a text that names a page by one, after "Settings", still means
 * Project Settings.
 */
export function projectSettingsBreadcrumbTitles(): Array<string> {
  return Array.from(
    readDashboardSource("Utils/Breadcrumbs/SettingsBreadcrumbs.ts").matchAll(
      PROJECT_SETTINGS_BREADCRUMB,
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

// The chat workspaces' entries: "Slack", "Microsoft Teams".
export function chatWorkspaceTitles(): Array<string> {
  const connect: string =
    CONNECT_ENTRY_TITLE.exec(
      readDashboardSource("Components/Workspace/WorkspaceSideMenuSection.ts"),
    )?.[1] || "";

  return workspaceSection().items.filter((item: string): boolean => {
    return item !== connect;
  });
}

/*
 * A text as a reader sees it: its HTML tags gone ("<strong>Project
 * Settings</strong> > <strong>API Keys</strong>"), with a "<" that starts no
 * tag kept as text, HTML's "&gt;", "&rsaquo;" and "&amp;" as the characters
 * they stand for, and Markdown's bold markers gone.
 */
export function readableText(text: string): string {
  return replaceHtmlMarkup(
    text,
    (): string => {
      return "";
    },
    { lessThanAsText: true },
  )
    .split("&gt;")
    .join(">")
    .split("&rsaquo;")
    .join("›")
    .split("&amp;")
    .join("&")
    .split("**")
    .join("");
}

// A separator between two steps of a path: ">", "→", "->" or "›".
const SEPARATOR_AHEAD: RegExp = /^\s*(?:->|>|→|›)\s*/;
const SEPARATOR_BEHIND: RegExp = /\s*(?:->|>|→|›)\s*$/;
/*
 * A value a template puts in: "{value}" where the scan reads a template
 * literal, "{{workspace}}" in a translation.
 */
const PLACEHOLDER_AHEAD: RegExp = /^\{\{?[A-Za-z_. ]*\}\}?/;
const LETTER_OR_DIGIT: RegExp = /[\p{L}\p{N}]/u;
// A capital letter: the start of a longer name ("Slack Integration").
const CAPITAL_AHEAD: RegExp = /^\s+\p{Lu}/u;
const NAME_CONTINUES: RegExp = /^[-_]/;

/*
 * Whether a name ends where `after` starts: at the end, before punctuation,
 * a separator or a lower-case word ("Notification Settings to choose ..."),
 * but not before a capital, which continues the name ("Slack Integration").
 */
function endsName(after: string): boolean {
  if (!after) {
    return true;
  }

  if (LETTER_OR_DIGIT.test(after.charAt(0)) || NAME_CONTINUES.test(after)) {
    return false;
  }

  return !CAPITAL_AHEAD.test(after);
}

export interface WrittenPath {
  // The menu the path starts in.
  menu: string;
  /*
   * The steps after the menu's name, as the menu titles them; a value a
   * template puts in is written as it stands ("{value}").
   */
  steps: Array<string>;
  // What makes it a path a reader cannot follow; empty when they can.
  problems: Array<string>;
  // The text from the menu's name on, for messages.
  text: string;
}

interface Step {
  title?: string | undefined;
  placeholder?: string | undefined;
}

/*
 * The title among `titles` that `text` starts with, as a whole name - the
 * longest one, so "Calendar Feed" wins over "Calendar" - or a placeholder.
 * "Slack Integration" is not "Slack": the name goes on.
 */
function stepAt(text: string, titles: ReadonlyArray<string>): Step {
  const placeholder: RegExpExecArray | null = PLACEHOLDER_AHEAD.exec(text);

  if (placeholder) {
    return { placeholder: placeholder[0] };
  }

  let found: string | undefined = undefined;

  for (const title of titles) {
    if (!text.startsWith(title) || !endsName(text.slice(title.length))) {
      continue;
    }

    if (!found || title.length > found.length) {
      found = title;
    }
  }

  return { title: found };
}

function preview(text: string): string {
  return text.slice(0, 40);
}

function allTitles(menu: SettingsMenu): Array<string> {
  return menu.sections.flatMap(
    (section: SettingsMenuSection): Array<string> => {
      return [section.title, ...section.items];
    },
  );
}

/*
 * Walks the steps after a menu's name through that menu: a page, or a
 * section and a page in it, and nothing folded left out.
 */
function walk(
  menu: SettingsMenu,
  rest: string,
): { steps: Array<string>; problems: Array<string> } {
  const steps: Array<string> = [];
  const problems: Array<string> = [];
  const first: Step = stepAt(rest, allTitles(menu));

  if (first.placeholder) {
    steps.push(first.placeholder);
    return { steps, problems };
  }

  if (!first.title) {
    problems.push(
      `names no section or page of ${menu.name}: "${preview(rest)}"`,
    );
    return { steps, problems };
  }

  steps.push(first.title);

  const section: SettingsMenuSection | undefined = menu.sections.find(
    (candidate: SettingsMenuSection): boolean => {
      return candidate.title === first.title;
    },
  );

  if (section) {
    const afterSection: string = rest.slice(first.title.length);
    const separator: RegExpExecArray | null =
      SEPARATOR_AHEAD.exec(afterSection);

    // A section alone, or the page that has its name ("On-Call Logs").
    if (!separator) {
      return { steps, problems };
    }

    const inSection: string = afterSection.slice(separator[0].length);
    const second: Step = stepAt(inSection, section.items);

    if (second.placeholder) {
      steps.push(second.placeholder);
      return { steps, problems };
    }

    if (second.title) {
      steps.push(second.title);
      return { steps, problems };
    }

    // The page that has its section's name, then one of its tabs.
    if (section.items.includes(section.title)) {
      return { steps, problems };
    }

    problems.push(
      `names no page of its ${section.title} section: "${preview(inSection)}"`,
    );
    return { steps, problems };
  }

  const home: SettingsMenuSection | undefined = menu.sections.find(
    (candidate: SettingsMenuSection): boolean => {
      return candidate.items.includes(first.title as string);
    },
  );

  if (home && home.folded) {
    problems.push(
      `names "${first.title}" without "${home.title}", the folded section it is in: write ${menu.name} > ${home.title} > ${first.title}`,
    );
  }

  return { steps, problems };
}

// Every place `name` is followed by a separator in `text`, with what follows.
function pathStarts(
  text: string,
  name: string,
): Array<{ index: number; rest: string }> {
  const starts: Array<{ index: number; rest: string }> = [];
  let index: number = text.indexOf(name);

  while (index >= 0) {
    const after: string = text.slice(index + name.length);
    const separator: RegExpExecArray | null = SEPARATOR_AHEAD.exec(after);

    if (separator) {
      starts.push({ index, rest: after.slice(separator[0].length) });
    }

    index = text.indexOf(name, index + name.length);
  }

  return starts;
}

/*
 * Every path a text writes through a product's menu - each place the menu's
 * name is followed by a separator, "On-Call Duty > Advanced > User
 * Overrides" - walked as the menu draws it.
 */
export function pathsThrough(
  text: string,
  menu: SettingsMenu,
): Array<WrittenPath> {
  const readable: string = readableText(text);

  return pathStarts(readable, menu.name).map(
    (start: { index: number; rest: string }): WrittenPath => {
      const walked: { steps: Array<string>; problems: Array<string> } = walk(
        menu,
        start.rest,
      );

      return {
        menu: menu.name,
        steps: walked.steps,
        problems: walked.problems,
        text: preview(readable.slice(start.index)),
      };
    },
  );
}

/*
 * Where a text starts a path at a name no menu has - "Open On-Call >
 * Readiness", when the bar's entry is On-Call Duty - as the text from the
 * name on. A name that goes on ("On-Call Duty") is another name, and one
 * with a separator before it is a step of a longer path (a member's page
 * has an On-Call section), not where a path starts.
 */
export function pathsStartingAt(text: string, name: string): Array<string> {
  const readable: string = readableText(text);

  return pathStarts(readable, name)
    .filter((start: { index: number; rest: string }): boolean => {
      const before: string = readable.slice(0, start.index);
      const previous: string = before.slice(-1) || " ";

      return (
        !SEPARATOR_BEHIND.test(before) &&
        !LETTER_OR_DIGIT.test(previous) &&
        !NAME_CONTINUES.test(previous)
      );
    })
    .map((start: { index: number; rest: string }): string => {
      return preview(readable.slice(start.index));
    });
}

export interface SettingsMenus {
  userSettings: SettingsMenu;
  projectSettings: SettingsMenu;
  // The titles Project Settings' pages go by in their breadcrumbs.
  projectSettingsBreadcrumbs: ReadonlyArray<string>;
  // The Workspace section's title, in both menus.
  workspace: string;
  // The chat workspaces' pages: "Slack", "Microsoft Teams".
  chatWorkspaces: ReadonlyArray<string>;
}

export function settingsMenus(): SettingsMenus {
  return {
    userSettings: userSettingsMenu(),
    projectSettings: projectSettingsMenu(),
    projectSettingsBreadcrumbs: projectSettingsBreadcrumbTitles(),
    workspace: workspaceSection().title,
    chatWorkspaces: chatWorkspaceTitles(),
  };
}

/*
 * What is wrong with what a text names before a settings menu's name, if it
 * names anything: "More > User Settings", "More -> Project Settings".
 */
function problemBefore(
  readable: string,
  index: number,
  menu: string,
): string | null {
  const before: string = readable.slice(0, index);
  const separatorBefore: RegExpExecArray | null = SEPARATOR_BEHIND.exec(before);

  if (!separatorBefore) {
    return null;
  }

  const named: string = before
    .slice(0, before.length - separatorBefore[0].length)
    .trimEnd();
  const allowed: boolean = ALLOWED_BEFORE_SETTINGS_MENU.some(
    (word: string): boolean => {
      return named.endsWith(word);
    },
  );

  return allowed
    ? null
    : `puts "${named.split(" ").pop()}" before ${menu}, ${WHERE_THE_MENU_IS[menu]}`;
}

// The word right before a name, as written: "in", "iOS", "phone's".
const WORD_BEHIND: RegExp = /([\p{L}\p{N}'’]+)\s*$/u;
const POSSESSIVE: RegExp = /['’]/;

/*
 * Capitalised words that start an instruction rather than a longer name:
 * "Open Settings > SCIM" is a path from "Settings", "iOS Settings >
 * Notifications" and "Business Settings → Accounts" are other menus.
 */
const INSTRUCTION_WORDS: ReadonlyArray<string> = [
  "Check",
  "From",
  "Go",
  "In",
  "Open",
  "See",
  "Under",
  "Use",
  "Via",
  "Visit",
];

/*
 * Whether the "Settings" at `index` starts a path on its own, rather than
 * ending a longer name ("User Settings", "Notification Settings", "iOS
 * Settings", "the phone's Settings") or being a step of a longer path
 * ("Audit Logs > Settings").
 */
function startsBareSettingsPath(readable: string, index: number): boolean {
  const before: string = readable.slice(0, index);
  const previous: string = before.slice(-1) || " ";

  if (
    SEPARATOR_BEHIND.test(before) ||
    LETTER_OR_DIGIT.test(previous) ||
    NAME_CONTINUES.test(previous)
  ) {
    return false;
  }

  const word: RegExpExecArray | null = WORD_BEHIND.exec(before);

  if (!word) {
    return true;
  }

  const written: string = word[1] as string;

  if (POSSESSIVE.test(written)) {
    return false;
  }

  return (
    written === written.toLowerCase() || INSTRUCTION_WORDS.includes(written)
  );
}

/*
 * Whether the steps after a bare "Settings" are Project Settings': one of its
 * pages (by its menu entry or its breadcrumb), or one of its sections and a
 * page in it. A section alone ("Settings → Basic", Meta's app settings) is
 * not enough to tell.
 */
function namesProjectSettingsPage(rest: string, menus: SettingsMenus): boolean {
  const menu: SettingsMenu = menus.projectSettings;
  const pages: Array<string> = [
    ...menu.sections.flatMap((section: SettingsMenuSection): Array<string> => {
      return section.items;
    }),
    ...menus.projectSettingsBreadcrumbs,
  ];

  if (stepAt(rest, pages).title) {
    return true;
  }

  const section: SettingsMenuSection | undefined = menu.sections.find(
    (candidate: SettingsMenuSection): boolean => {
      return candidate.title === stepAt(rest, [candidate.title]).title;
    },
  );

  if (!section) {
    return false;
  }

  const afterSection: string = rest.slice(section.title.length);
  const separator: RegExpExecArray | null = SEPARATOR_AHEAD.exec(afterSection);

  return Boolean(
    separator &&
      stepAt(afterSection.slice(separator[0].length), section.items).title,
  );
}

/*
 * Every path a text writes through User Settings or Project Settings, with
 * what is wrong with each - and every one it writes through Project Settings
 * calling it "Settings", which is always wrong.
 */
export function writtenPaths(
  text: string,
  menus: SettingsMenus,
): Array<WrittenPath> {
  const readable: string = readableText(text);
  const paths: Array<WrittenPath> = [];

  for (const menu of [menus.userSettings, menus.projectSettings]) {
    for (const start of pathStarts(readable, menu.name)) {
      const walked: { steps: Array<string>; problems: Array<string> } = walk(
        menu,
        start.rest,
      );
      const before: string | null = problemBefore(
        readable,
        start.index,
        menu.name,
      );

      paths.push({
        menu: menu.name,
        steps: walked.steps,
        problems: before ? [...walked.problems, before] : walked.problems,
        text: preview(readable.slice(start.index)),
      });
    }
  }

  for (const start of pathStarts(readable, BARE_SETTINGS)) {
    if (
      !startsBareSettingsPath(readable, start.index) ||
      !namesProjectSettingsPage(start.rest, menus)
    ) {
      continue;
    }

    const walked: { steps: Array<string>; problems: Array<string> } = walk(
      menus.projectSettings,
      start.rest,
    );

    paths.push({
      menu: PROJECT_SETTINGS,
      steps: walked.steps,
      problems: [
        `calls ${PROJECT_SETTINGS} "${BARE_SETTINGS}", a section every product's menu has: write ${[PROJECT_SETTINGS, ...walked.steps].join(" > ")}`,
        ...walked.problems,
      ],
      text: preview(readable.slice(start.index)),
    });
  }

  return paths;
}

/*
 * What a language's Dashboard draws for an English title: the locale's
 * translation, or the English where it has none.
 */
export function drawnTitle(
  locale: Record<string, unknown>,
  english: string,
): string {
  const value: unknown = locale[english];

  return typeof value === "string" && value.trim() ? value : english;
}

/*
 * The steps of a path a translation must name, in order, as its language's
 * Dashboard draws them: the menu, then each step that is a title (a value a
 * template puts in is the template's).
 */
export function drawnSteps(
  locale: Record<string, unknown>,
  path: WrittenPath,
): Array<string> {
  return [path.menu, ...path.steps]
    .filter((step: string): boolean => {
      return !step.startsWith("{");
    })
    .map((step: string): string => {
      return drawnTitle(locale, step);
    });
}

// Whether a text names each of these, in this order.
export function namesInOrder(
  text: string,
  names: ReadonlyArray<string>,
): boolean {
  let from: number = 0;

  for (const name of names) {
    const at: number = text.indexOf(name, from);

    if (at < 0) {
      return false;
    }

    from = at + name.length;
  }

  return true;
}
