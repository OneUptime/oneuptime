import {
  filterPaletteCommands,
  getHighlightSegments,
  getPaletteQueryWords,
  getPaletteSectionId,
  getSharedTitlePenalty,
  isCompactWordPrefix,
  isSubsequenceMatch,
  matchPaletteCommand,
  normalizePaletteQuery,
  PaletteCommandMatch,
  PaletteHighlightSegment,
  PaletteMatchRank,
  rankPaletteCommand,
} from "../../../../UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "../../../../UI/Components/CommandPalette/Types";
import { describe, expect, test } from "@jest/globals";

/*
 * The palette's search, pinned by what a person types and what they expect
 * to find first. The words and pages are the Dashboard's own (API Keys,
 * Danger Zone, On-Call Schedules...), so a change that makes the real
 * catalog worse fails here.
 */

type MakeCommandFunction = (
  id: string,
  title: string,
  category: string,
  keywords?: Array<string>,
) => PaletteCommand;

const makeCommand: MakeCommandFunction = (
  id: string,
  title: string,
  category: string,
  keywords?: Array<string>,
): PaletteCommand => {
  return {
    id,
    title,
    category,
    keywords,
    onSelect: (): void => {},
  };
};

// A page as Search lists it: titled, with where it lives.
const makePage: (
  id: string,
  title: string,
  breadcrumb: Array<string>,
  keywords?: Array<string>,
) => PaletteCommand = (
  id: string,
  title: string,
  breadcrumb: Array<string>,
  keywords?: Array<string>,
): PaletteCommand => {
  return {
    id,
    title,
    category: "Pages",
    breadcrumb,
    keywords,
    isSearchOnly: true,
    onSelect: (): void => {},
  };
};

const ids: (matches: Array<PaletteCommandMatch>) => Array<string> = (
  matches: Array<PaletteCommandMatch>,
): Array<string> => {
  return matches.map((match: PaletteCommandMatch): string => {
    return match.command.id;
  });
};

describe("normalizePaletteQuery", () => {
  test("trims whitespace and lowercases", () => {
    expect(normalizePaletteQuery("  MoNiToRs  ")).toBe("monitors");
    expect(normalizePaletteQuery("   ")).toBe("");
  });

  test("drops accents, so résumé and resume are one word", () => {
    expect(normalizePaletteQuery("Résumé")).toBe("resume");
    expect(normalizePaletteQuery("Benachrichtigungsmethoden Ü")).toBe(
      "benachrichtigungsmethoden u",
    );
  });

  test("turns punctuation and runs of spaces into single spaces", () => {
    expect(normalizePaletteQuery("On-Call   Policies")).toBe(
      "on call policies",
    );
    expect(normalizePaletteQuery("Telemetry & APM")).toBe("telemetry apm");
    expect(normalizePaletteQuery("  --  ")).toBe("");
  });

  test("keeps the letters and vowel signs of every script", () => {
    // й is a letter of its own in Russian, not an accented и.
    expect(normalizePaletteQuery("Настройки проекта")).toBe(
      "настройки проекта",
    );
    expect(normalizePaletteQuery("用户设置")).toBe("用户设置");
    expect(normalizePaletteQuery("사용자 설정")).toBe("사용자 설정");
    expect(normalizePaletteQuery("ユーザー設定")).toBe("ユーザー設定");
    // Hindi vowel signs are combining marks: they stay inside the word.
    expect(normalizePaletteQuery("उपयोगकर्ता सेटिंग्स")).toBe(
      "उपयोगकर्ता सेटिंग्स",
    );
  });
});

describe("getPaletteQueryWords", () => {
  test("splits the normalized query into words", () => {
    expect(getPaletteQueryWords("  API-Keys  ")).toEqual(["api", "keys"]);
    expect(getPaletteQueryWords("")).toEqual([]);
  });
});

describe("isCompactWordPrefix", () => {
  test.each([
    // Typed without spaces, across whole words.
    [["on", "call", "duty"], "oncall", true],
    [["on", "call", "duty"], "oncal", true],
    [["api", "keys"], "apikeys", true],
    [["alert", "state"], "alertst", true],
    // Stopping inside the first word.
    [["monitors"], "mon", true],
    // A plural "s" is not the start of the next word.
    [["alert", "state"], "alerts", false],
    [["monitor", "status"], "monitors", false],
    // One letter into a later word is too little to mean it.
    [["api", "keys"], "apik", false],
    // Longer than the title, or not its start.
    [["api", "keys"], "apikeysx", false],
    [["api", "keys"], "keys", false],
  ])(
    "%j / %s: %s",
    (words: Array<string>, query: string, expected: boolean) => {
      expect(isCompactWordPrefix(words, query)).toBe(expected);
    },
  );
});

describe("isSubsequenceMatch", () => {
  test("matches characters in order with gaps", () => {
    expect(isSubsequenceMatch("mtr", "monitors")).toBe(true);
  });

  test("rejects characters out of order", () => {
    expect(isSubsequenceMatch("rtm", "monitors")).toBe(false);
  });

  test("rejects characters that are missing entirely", () => {
    expect(isSubsequenceMatch("xyz", "monitors")).toBe(false);
  });

  test("an empty needle matches anything", () => {
    expect(isSubsequenceMatch("", "monitors")).toBe(true);
  });
});

describe("getSharedTitlePenalty", () => {
  test("a title of its own costs nothing", () => {
    expect(getSharedTitlePenalty(0)).toBe(0);
    expect(getSharedTitlePenalty(1)).toBe(0);
  });

  test("a shared title costs more the more pages share it, up to a cap", () => {
    expect(getSharedTitlePenalty(2)).toBe(25);
    expect(getSharedTitlePenalty(8)).toBe(35);
    expect(getSharedTitlePenalty(30)).toBeCloseTo(44.53, 2);
    expect(getSharedTitlePenalty(64)).toBe(45);
    expect(getSharedTitlePenalty(1000)).toBe(45);
  });
});

describe("rankPaletteCommand", () => {
  const apiKeys: PaletteCommand = makePage(
    "api-keys",
    "API Keys",
    ["Project Settings", "Advanced"],
    ["access token"],
  );

  test.each([
    ["api keys", PaletteMatchRank.TitleExact],
    ["API-Keys", PaletteMatchRank.TitleExact],
    ["apikeys", PaletteMatchRank.TitleExact],
    ["api key", PaletteMatchRank.TitleExact],
    ["api", PaletteMatchRank.TitlePrefix],
    ["api k", PaletteMatchRank.TitlePrefix],
    ["keys api", PaletteMatchRank.TitleWords],
    ["keys", PaletteMatchRank.TitleWords],
    ["ak", PaletteMatchRank.TitleInitials],
    ["access token", PaletteMatchRank.Keyword],
    ["access", PaletteMatchRank.Keyword],
    ["project api", PaletteMatchRank.Context],
    ["advanced keys", PaletteMatchRank.Context],
    ["eys", PaletteMatchRank.Substring],
    ["acess token", PaletteMatchRank.Fuzzy],
    ["aik", PaletteMatchRank.Fuzzy],
  ])(
    '"%s" matches API Keys as rank %s',
    (query: string, rank: PaletteMatchRank) => {
      expect(rankPaletteCommand(apiKeys, query)).toBe(rank);
    },
  );

  test.each(["billing", "settings", "project", "advanced", "zzz"])(
    '"%s" does not find API Keys: one word that only names where it lives is not enough',
    (query: string) => {
      expect(rankPaletteCommand(apiKeys, query)).toBeNull();
    },
  );

  test("a command without a breadcrumb is still found by the group it is listed under", () => {
    const logs: PaletteCommand = makeCommand("logs", "Logs", "Observability");

    expect(rankPaletteCommand(logs, "observability")).toBe(
      PaletteMatchRank.Category,
    );
    // With a word of its own name, the group narrows the search instead.
    expect(rankPaletteCommand(logs, "logs observability")).toBe(
      PaletteMatchRank.Context,
    );
  });

  test("a title alias is matched as the title is", () => {
    const translated: PaletteCommand = {
      ...makePage("api-keys", "API-Schlüssel", ["Projekteinstellungen"]),
      titleAliases: ["API Keys"],
    };

    expect(rankPaletteCommand(translated, "api keys")).toBe(
      PaletteMatchRank.TitleExact,
    );
    expect(rankPaletteCommand(translated, "schlüssel")).toBe(
      PaletteMatchRank.TitleWords,
    );
    expect(rankPaletteCommand(translated, "api")).toBe(
      PaletteMatchRank.TitlePrefix,
    );
  });

  test("a command with a breadcrumb is not found by its category heading", () => {
    // Every page sits under "Pages": the word must not list them all.
    expect(rankPaletteCommand(apiKeys, "pages")).toBeNull();
  });

  test("search-only words of the breadcrumb count like the breadcrumb", () => {
    const translated: PaletteCommand = {
      ...makePage("custom-fields", "Benutzerdefinierte Felder", [
        "Vorfälle",
        "Einstellungen",
      ]),
      breadcrumbKeywords: ["Incidents", "Settings"],
      keywords: ["Custom Fields"],
    };

    expect(rankPaletteCommand(translated, "incident custom fields")).toBe(
      PaletteMatchRank.Context,
    );
    expect(rankPaletteCommand(translated, "custom fields")).toBe(
      PaletteMatchRank.Keyword,
    );
    expect(rankPaletteCommand(translated, "vorfälle felder")).toBe(
      PaletteMatchRank.Context,
    );
  });

  test("matching is case-insensitive", () => {
    const command: PaletteCommand = makeCommand("a", "MONITORS", "Other");
    expect(rankPaletteCommand(command, "mon")).toBe(
      PaletteMatchRank.TitlePrefix,
    );
  });

  test("an empty query matches anything, unranked", () => {
    expect(matchPaletteCommand(apiKeys, "  ")).toEqual({
      command: apiKeys,
      rank: PaletteMatchRank.TitleExact,
      score: 0,
    });
  });
});

describe("matchPaletteCommand scores", () => {
  test("an exact keyword is worth more than a keyword that starts with the query", () => {
    const dangerZone: PaletteCommand = makePage(
      "danger",
      "Danger Zone",
      ["Project Settings"],
      ["delete project", "remove project"],
    );

    const exact: PaletteCommandMatch = matchPaletteCommand(
      dangerZone,
      "delete project",
    )!;
    const prefix: PaletteCommandMatch = matchPaletteCommand(
      dangerZone,
      "delete pro",
    )!;

    expect(exact.rank).toBe(PaletteMatchRank.Keyword);
    expect(prefix.rank).toBe(PaletteMatchRank.Keyword);
    expect(exact.score).toBeGreaterThan(prefix.score);
  });

  test("a page whose title is shared gives way; a product with the same title does not", () => {
    const product: PaletteCommand = makeCommand(
      "monitors",
      "Monitors",
      "Essentials",
    );
    const page: PaletteCommand = makePage("security-monitors", "Monitors", [
      "Security Events",
    ]);

    expect(matchPaletteCommand(product, "monitors", 2)!.score).toBe(100);
    expect(matchPaletteCommand(page, "monitors", 2)!.score).toBe(75);
  });

  test("a context match that names one place is worth more than words scattered over the trail", () => {
    const userSettingsPage: PaletteCommand = makePage(
      "calendar",
      "Calendar Feed",
      ["User Settings", "Calendar"],
    );
    const rumSettingsPage: PaletteCommand = makePage(
      "rum-owner-rules",
      "Owner Rules",
      ["Real User Monitoring", "Settings"],
    );

    expect(
      matchPaletteCommand(userSettingsPage, "user settings")!.score,
    ).toBeGreaterThan(
      matchPaletteCommand(rumSettingsPage, "user settings")!.score,
    );
  });

  test("one word in the trail names no place: the bonus needs two", () => {
    // Both words name User Settings: 50 for the context match, +4 for one place.
    const notificationMethods: PaletteCommand = makePage(
      "notification-methods",
      "Notification Methods",
      ["User Settings", "Alerts & Notifications"],
    );
    // "settings" is its title (+4); "user" alone in the trail earns nothing more.
    const rumSettings: PaletteCommand = makePage("rum-settings", "Settings", [
      "Real User Monitoring",
    ]);

    expect(matchPaletteCommand(notificationMethods, "user settings")).toEqual({
      command: notificationMethods,
      rank: PaletteMatchRank.Context,
      score: 54,
    });
    expect(matchPaletteCommand(rumSettings, "user settings")).toEqual({
      command: rumSettings,
      rank: PaletteMatchRank.Context,
      score: 54,
    });
  });
});

describe("filterPaletteCommands", () => {
  test("orders results exact > prefix > words > keyword > context > substring", () => {
    const commands: Array<PaletteCommand> = [
      // Deliberately listed in reverse rank order to prove sorting happens.
      makeCommand("substring", "Turnkeys", "Zeta"),
      makePage("context", "Owner Rules", ["Keys Area"]),
      makeCommand("keyword", "Tokens", "Other", ["key management"]),
      makeCommand("words", "Rotate Keys", "Other"),
      makeCommand("prefix", "Keys and Secrets", "Other"),
      makeCommand("exact", "Keys", "Other"),
      makeCommand("excluded", "Logs", "Telemetry"),
    ];

    expect(ids(filterPaletteCommands(commands, "keys"))).toEqual([
      "exact",
      "prefix",
      "words",
      "keyword",
      "substring",
    ]);

    // Two words: the breadcrumb may carry one of them.
    expect(ids(filterPaletteCommands(commands, "keys owner"))).toEqual([
      "context",
    ]);
  });

  test("keeps catalog order between equal scores", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("first", "Monitors", "A"),
      makeCommand("second", "Monitor Groups", "B"),
      makeCommand("third", "Monitoring Secrets", "C"),
    ];

    expect(ids(filterPaletteCommands(commands, "mon"))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("an empty or whitespace query matches everything in original order", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("one", "Alpha", "A"),
      makeCommand("two", "Beta", "B"),
    ];

    expect(ids(filterPaletteCommands(commands, "   "))).toEqual(["one", "two"]);
  });

  test("excludes commands that match nowhere", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("only", "Monitors", "Other"),
      makeCommand("gone", "Logs", "Telemetry"),
    ];

    expect(ids(filterPaletteCommands(commands, "monitors"))).toEqual(["only"]);
  });

  test("a title thirty pages share gives way to a distinctive one", () => {
    const developerPages: Array<PaletteCommand> = [
      "Monitors",
      "Incidents",
      "Alerts",
      "Status Pages",
      "Workflows",
    ].map((product: string): PaletteCommand => {
      return makePage(`api-${product}`, "API", [product, "Developer"]);
    });

    const commands: Array<PaletteCommand> = [
      ...developerPages,
      makePage("api-keys", "API Keys", ["Project Settings", "Advanced"]),
    ];

    const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
      commands,
      "api",
    );

    expect(matches[0]!.command.id).toBe("api-keys");
    expect(matches).toHaveLength(6);
  });

  test("a page called Settings gives way to Project Settings", () => {
    const commands: Array<PaletteCommand> = [
      makePage("audit-settings", "Settings", [
        "Project Settings",
        "Audit Logs",
      ]),
      makePage("insights-settings", "Settings", ["Insights"]),
      makeCommand("project-settings", "Project Settings", "Settings"),
    ];

    expect(filterPaletteCommands(commands, "settings")[0]!.command.id).toBe(
      "project-settings",
    );
  });

  test("pages that share a title keep catalog order, so the first area wins ties", () => {
    const commands: Array<PaletteCommand> = [
      makePage("settings-slack", "Slack", ["Project Settings", "Workspace"]),
      makePage("incidents-slack", "Slack", ["Incidents", "Workspace"]),
      makePage("alerts-slack", "Slack", ["Alerts", "Workspace"]),
    ];

    expect(ids(filterPaletteCommands(commands, "slack"))).toEqual([
      "settings-slack",
      "incidents-slack",
      "alerts-slack",
    ]);
  });

  test("the breadcrumb narrows a shared title down to one page", () => {
    const commands: Array<PaletteCommand> = [
      makePage("monitor-fields", "Custom Fields", ["Monitors", "Settings"]),
      makePage("incident-fields", "Custom Fields", ["Incidents", "Settings"]),
      makePage("alert-fields", "Custom Fields", ["Alerts", "Settings"]),
    ];

    expect(
      ids(filterPaletteCommands(commands, "incident custom fields")),
    ).toEqual(["incident-fields"]);
    expect(ids(filterPaletteCommands(commands, "custom fields"))).toEqual([
      "monitor-fields",
      "incident-fields",
      "alert-fields",
    ]);
  });

  test("two words may both be in the breadcrumb: 'incident settings' lists Incidents > Settings", () => {
    const commands: Array<PaletteCommand> = [
      makePage("incident-fields", "Custom Fields", ["Incidents", "Settings"]),
      makePage("incident-rules", "Owner Rules", ["Incidents", "Rules"]),
      makePage("incident-state", "Incident State", ["Incidents", "Settings"]),
    ];

    expect(ids(filterPaletteCommands(commands, "incident settings"))).toEqual([
      "incident-state",
      "incident-fields",
    ]);
    // One word naming only the area finds nothing but titles that say it.
    expect(ids(filterPaletteCommands(commands, "incidents"))).toEqual([
      "incident-state",
    ]);
  });

  test("typos are forgiven only when nothing matches as typed", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("on-call", "On-Call Duty", "Essentials", ["pager"]),
      makeCommand("status-pages", "Status Pages", "Essentials"),
      makeCommand("incidents", "Incidents", "Essentials"),
    ];

    // "pager" is a real word here: Status Pages ("pages") is not offered.
    expect(ids(filterPaletteCommands(commands, "pager"))).toEqual(["on-call"]);

    // "incidnet" matches nothing as typed, so the typo is forgiven.
    expect(ids(filterPaletteCommands(commands, "incidnet"))).toEqual([
      "incidents",
    ]);
  });

  test("a plural query word is the same word, never the start of a longer one", () => {
    const commands: Array<PaletteCommand> = [
      makePage("runners", "Runners", ["Runbooks"]),
      makePage("runbooks", "Runbooks", ["Runbooks"]),
      makePage("runs", "Runs", ["Workflows", "Logs"]),
      makePage("keys", "API Keys", ["Project Settings", "Advanced"]),
    ];

    // "runs" is "run": Runners and Runbooks hold only its letters in order.
    expect(ids(filterPaletteCommands(commands, "runs"))).toEqual(["runs"]);
    expect(rankPaletteCommand(commands[0]!, "runs")).toBe(
      PaletteMatchRank.Fuzzy,
    );
    // "key" and "keys" are one word.
    expect(ids(filterPaletteCommands(commands, "api key"))).toEqual(["keys"]);
  });

  test("a plural query does not start a title that starts with its singular", () => {
    const alertState: PaletteCommand = makePage("alert-state", "Alert State", [
      "Alerts",
      "Settings",
    ]);
    const allAlerts: PaletteCommand = makePage("all-alerts", "All Alerts", [
      "Alerts",
    ]);

    // "alerts" names a word of each title, and starts neither.
    expect(matchPaletteCommand(alertState, "alerts")).toEqual({
      command: alertState,
      rank: PaletteMatchRank.TitleWords,
      score: 80,
    });
    expect(matchPaletteCommand(allAlerts, "alerts")).toEqual({
      command: allAlerts,
      rank: PaletteMatchRank.TitleWords,
      score: 80,
    });
    // Typing on into the next word does start it.
    expect(rankPaletteCommand(alertState, "alert st")).toBe(
      PaletteMatchRank.TitlePrefix,
    );
    expect(rankPaletteCommand(alertState, "alertst")).toBe(
      PaletteMatchRank.TitlePrefix,
    );
  });

  test("repeating a word does not stand in for a second one", () => {
    const commands: Array<PaletteCommand> = [
      makePage("incident-fields", "Custom Fields", ["Incidents", "Settings"]),
    ];

    expect(ids(filterPaletteCommands(commands, "incidents incidents"))).toEqual(
      [],
    );
    expect(ids(filterPaletteCommands(commands, "incident incidents"))).toEqual(
      [],
    );
    expect(ids(filterPaletteCommands(commands, "incident settings"))).toEqual([
      "incident-fields",
    ]);
  });

  test("a query inside a keyword finds the command, below one inside a title", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("on-call", "On-Call Duty", "Essentials", ["pagerduty"]),
      makeCommand("superduty", "Superduty Checks", "Other"),
      makeCommand("duty", "Duty Roster", "Other"),
    ];

    expect(ids(filterPaletteCommands(commands, "erduty"))).toEqual([
      "superduty",
      "on-call",
    ]);
    // One or two letters are inside almost every keyword: not looked for there.
    expect(ids(filterPaletteCommands(commands, "ge"))).toEqual([]);
  });

  test("initials are a fallback: 'ai' lists the AI pages, not Active Incidents", () => {
    const commands: Array<PaletteCommand> = [
      makePage("active-incidents", "Active Incidents", ["Incidents"]),
      makePage("ai", "AI Features", ["Project Settings"]),
    ];

    expect(ids(filterPaletteCommands(commands, "ai"))).toEqual(["ai"]);
    // With nothing better, the initials still find it.
    expect(ids(filterPaletteCommands([commands[0]!], "ai"))).toEqual([
      "active-incidents",
    ]);
  });

  test("a query of only punctuation matches nothing; an empty one matches everything", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("one", "Alpha", "A"),
      makeCommand("two", "Beta", "B"),
    ];

    expect(filterPaletteCommands(commands, "#")).toEqual([]);
    expect(filterPaletteCommands(commands, " ? ")).toEqual([]);
    expect(matchPaletteCommand(commands[0]!, "?")).toBeNull();
    expect(ids(filterPaletteCommands(commands, ""))).toEqual(["one", "two"]);
  });

  test("letters in order are the last resort", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("monitors", "Monitors", "Essentials"),
      makeCommand("metrics", "Metrics", "Observability"),
    ];

    expect(ids(filterPaletteCommands(commands, "mntr"))).toEqual(["monitors"]);
    expect(ids(filterPaletteCommands(commands, "mtr"))).toEqual([
      "monitors",
      "metrics",
    ]);
    // A subsequence must start where a word of the title starts.
    expect(ids(filterPaletteCommands(commands, "trs"))).toEqual([]);
  });

  test("a typo is never forgiven in a short word", () => {
    const commands: Array<PaletteCommand> = [
      makePage("roles", "Incident Roles", ["Incidents", "Settings"]),
    ];

    expect(ids(filterPaletteCommands(commands, "rule"))).toEqual([]);
  });

  test("the group a command is listed under is a fallback, offered only when nothing matches better", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("logs", "Logs", "Observability"),
      makeCommand("metrics", "Metrics", "Observability"),
      makeCommand("users", "Users", "Settings"),
      makeCommand("project-settings", "Project Settings", "Settings"),
    ];

    // Nothing is called "observability": the group lists its products.
    expect(ids(filterPaletteCommands(commands, "observability"))).toEqual([
      "logs",
      "metrics",
    ]);
    // "settings" names Project Settings: Users is not listed for its group.
    expect(ids(filterPaletteCommands(commands, "settings"))).toEqual([
      "project-settings",
    ]);
  });

  test("between equally good matches, the higher searchPriority goes first", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("quick-link", "My On-Call Policies", "Quick links", [
        "pager",
      ]),
      {
        ...makePage("page", "On-Call Policies", ["On-Call Duty"], ["pager"]),
        searchPriority: 1,
      },
      {
        ...makeCommand("product", "On-Call Duty", "Essentials", ["pager"]),
        searchPriority: 2,
      },
    ];

    expect(ids(filterPaletteCommands(commands, "pager"))).toEqual([
      "product",
      "page",
      "quick-link",
    ]);
    // A better match still wins over a higher priority.
    expect(ids(filterPaletteCommands(commands, "my on call"))[0]).toBe(
      "quick-link",
    );
  });

  test("the score is exposed so callers can see how good a match is", () => {
    const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
      [makeCommand("a", "API Keys", "Pages")],
      "api keys",
    );

    expect(matches[0]).toMatchObject({
      rank: PaletteMatchRank.TitleExact,
      score: 100,
    });
  });
});

describe("getHighlightSegments", () => {
  test("marks a single case-insensitive occurrence, preserving original casing", () => {
    const segments: Array<PaletteHighlightSegment> = getHighlightSegments(
      "Monitors",
      "mon",
    );

    expect(segments).toEqual([
      { text: "Mon", isMatch: true },
      { text: "itors", isMatch: false },
    ]);
  });

  test("marks every occurrence", () => {
    const segments: Array<PaletteHighlightSegment> = getHighlightSegments(
      "on and on",
      "on",
    );

    expect(segments).toEqual([
      { text: "on", isMatch: true },
      { text: " and ", isMatch: false },
      { text: "on", isMatch: true },
    ]);
  });

  test("marks each query word where it starts a word, in any order", () => {
    expect(
      getHighlightSegments("Monitor Status Settings", "settings mon"),
    ).toEqual([
      { text: "Mon", isMatch: true },
      { text: "itor Status ", isMatch: false },
      { text: "Settings", isMatch: true },
    ]);
  });

  test("a space or hyphen between two marked words is marked with them", () => {
    expect(getHighlightSegments("API Keys", "keys api")).toEqual([
      { text: "API Keys", isMatch: true },
    ]);
    expect(getHighlightSegments("On-Call Duty", "on call")).toEqual([
      { text: "On-Call", isMatch: true },
      { text: " Duty", isMatch: false },
    ]);
  });

  test("a query word is not marked inside another word", () => {
    // "trol" sits inside "Control": only "Mis", where a word starts, is marked.
    expect(getHighlightSegments("Mission Control", "trol mis")).toEqual([
      { text: "Mis", isMatch: true },
      { text: "sion Control", isMatch: false },
    ]);
  });

  test("the whole query may be marked mid-word, when that is where it matched", () => {
    expect(getHighlightSegments("API Keys", "eys")).toEqual([
      { text: "API K", isMatch: false },
      { text: "eys", isMatch: true },
    ]);
  });

  test("no occurrence yields one unmarked segment", () => {
    expect(getHighlightSegments("Monitors", "zzz")).toEqual([
      { text: "Monitors", isMatch: false },
    ]);
  });

  test("an empty query yields one unmarked segment", () => {
    expect(getHighlightSegments("Monitors", "  ")).toEqual([
      { text: "Monitors", isMatch: false },
    ]);
  });

  test("marks the text as shown, whatever its case, accents and punctuation", () => {
    // Typed without the hyphen, or with one for the space.
    expect(getHighlightSegments("On-Call Duty", "oncall")).toEqual([
      { text: "On-Call", isMatch: true },
      { text: " Duty", isMatch: false },
    ]);
    expect(getHighlightSegments("API Keys", "api-keys")).toEqual([
      { text: "API Keys", isMatch: true },
    ]);
    // Typed without the accents.
    expect(getHighlightSegments("Résumé", "resume")).toEqual([
      { text: "Résumé", isMatch: true },
    ]);
    // "İ" lowercases to two code units; the mark still lands on it.
    expect(getHighlightSegments("İstanbul", "ist")).toEqual([
      { text: "İst", isMatch: true },
      { text: "anbul", isMatch: false },
    ]);
  });

  test("a query of only punctuation marks nothing", () => {
    expect(getHighlightSegments("API Keys", "--")).toEqual([
      { text: "API Keys", isMatch: false },
    ]);
  });
});

describe("getPaletteSectionId", () => {
  test("slugs human titles for test ids", () => {
    expect(getPaletteSectionId("Analytics & Automation")).toBe(
      "analytics-automation",
    );
    expect(getPaletteSectionId("Essentials")).toBe("essentials");
    expect(getPaletteSectionId("  Odd  Spacing  ")).toBe("odd-spacing");
  });
});
