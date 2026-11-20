// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MEANING_KEYS, getWordOfMeaningKey } from "../../Types/MeaningKeys";
import { Translator } from "../../Types/Translator";
import { dashboardTranslator } from "../Helpers/DashboardLocales";

/*
 * THE STATES A PAGE DRAWS FOR ONE KIND OF THING AGREE WITH EACH OTHER
 * (#8588).
 *
 * A locale words each English word once, for every place that draws it. In
 * a language whose adjectives take the gender of what they describe, two
 * states of one thing can then disagree: Russian's Active was "Активно"
 * (neuter) and its Inactive "Неактивен" (masculine), and the infrastructure
 * list's Last seen column draws them one above the other, row after row. A
 * host's systemd units drew the same pair in their State column, and the
 * Admin Dashboard drew it on a license's instances and a database's
 * replication slots.
 *
 * Russian words a state on its own in the neuter ("Включено", "Отключено",
 * "Приостановлено"), whatever it describes, so Inactive is "Неактивно" now
 * and every set of states below is worded alike. The sets are the states a
 * page draws together for one kind of thing, each with the files that draw
 * them, so a set names only what is drawn. In each language whose state
 * words show a gender, every word of a set shows the same one.
 *
 * Where a word shared with other pages needs another gender beside one
 * page's states, that page words its state with a key of its own
 * (Common/Types/MeaningKeys), which English reads as the bare word: a
 * threat indicator's and a rule exception's Expired read "Истёк"
 * (masculine, as a token is) beside their neuter "Активно", and a token's
 * and a calendar link's Not fetched yet read "Ещё не запрашивалась"
 * (feminine) beside "Действителен" and "Отключено" (#8659).
 *
 * German and Dutch do not inflect a state on its own. The Nordic languages'
 * participles read the same in every gender (tømt, aktiveret), and Japanese,
 * Korean, Chinese and Persian have no grammatical gender. So the languages
 * held here are Russian, Arabic, French, Spanish, Italian, Portuguese and
 * Hindi.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * The Enterprise Edition's pages are read only where ee/ is checked out:
 * the Common Test job deletes it before it runs, and the Enterprise Edition
 * Test workflow (test.ee.yaml) runs this with it. Their states' words are
 * the core's locales', and are held everywhere.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_ROOT, "ee"),
);

// The files of a set this checkout has: ee/'s only where it is.
function filesDrawingHere(set: StateSet): Array<string> {
  return set.drawnIn.filter((file: string): boolean => {
    return ENTERPRISE_PRESENT || !file.startsWith("ee/");
  });
}

const LOCALE_DIRS: Record<string, string> = {
  Dashboard: "packages/App/FeatureSet/Dashboard/src/Locales",
  AdminDashboard: "packages/App/FeatureSet/AdminDashboard/src/Locales",
};

export interface StateSet {
  // What the states are of, and where they are drawn together.
  thing: string;
  app: keyof typeof LOCALE_DIRS;
  keys: Array<string>;
  /*
   * States the set draws that are a phrase or a sentence of their own in
   * every language ("Refresh failed", "Needs regeneration"): they describe
   * no thing, so they agree with nothing, and are only checked to be drawn.
   */
  phrases?: Array<string>;
  // The files that draw the set: each names every key and phrase of it.
  drawnIn: Array<string>;
}

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src";

export const STATE_SETS: Array<StateSet> = [
  {
    thing:
      "a resource's state: the infrastructure list's Last seen column, the infrastructure map's cards and a host's systemd units",
    app: "Dashboard",
    keys: ["Active", "Inactive"],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Components/Topology/InfrastructureExplorer.tsx`,
      `${DASHBOARD_SOURCE}/Components/Topology/InfrastructureGraph.tsx`,
      `${DASHBOARD_SOURCE}/Pages/Host/Utils/SystemdUnits.ts`,
    ],
  },
  {
    thing:
      "an Enterprise license's instances and a Postgres cluster's replication slots, in the Admin Dashboard",
    app: "AdminDashboard",
    keys: ["Active", "Inactive"],
    drawnIn: [
      "ee/AdminDashboard/EnterpriseLicenses/Components/LicenseUtil.tsx",
      "ee/AdminDashboard/Health/PostgresCluster.tsx",
    ],
  },
  {
    thing:
      "a Docker Swarm node's availability, in the Nodes list and on a node",
    app: "Dashboard",
    keys: ["Active", "Drained", "Paused"],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Pages/DockerSwarm/View/Nodes.tsx`,
      `${DASHBOARD_SOURCE}/Components/DockerSwarm/Part/DockerSwarmNodeOverview.tsx`,
    ],
  },
  {
    // The Leader beside them is a noun: it agrees with nothing.
    thing: "a Docker Swarm manager's standing, in the Nodes list and on a node",
    app: "Dashboard",
    keys: ["Reachable", "Unreachable", "Unknown"],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Pages/DockerSwarm/View/Nodes.tsx`,
      `${DASHBOARD_SOURCE}/Components/DockerSwarm/Part/DockerSwarmNodeOverview.tsx`,
    ],
  },
  {
    thing: "an IoT device's credential, in the Device Registry's Status column",
    app: "Dashboard",
    keys: ["Enabled", "Revoked"],
    drawnIn: [`${DASHBOARD_SOURCE}/Pages/IoT/View/DeviceRegistry.tsx`],
  },
  {
    thing: "whether a certificate's issuer revoked it, on an SSL monitor",
    app: "Dashboard",
    keys: ["Not Revoked", "Revoked"],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Components/Monitor/SummaryView/SSLCertificateMonitorView.tsx`,
    ],
  },
  {
    thing: "a Kubernetes CronJob's schedule",
    app: "Dashboard",
    keys: ["Active", "Suspended"],
    drawnIn: [`${DASHBOARD_SOURCE}/Pages/Kubernetes/View/CronJobDetail.tsx`],
  },
  {
    thing: "a threat intel indicator, in the Indicators list's Status column",
    app: "Dashboard",
    keys: ["Active", "Expired (threat indicator)", "Revoked"],
    drawnIn: [`${DASHBOARD_SOURCE}/Pages/SecurityEvents/ThreatIntel.tsx`],
  },
  {
    thing:
      "a detection rule exception, in the Rule Exceptions list's Status column",
    app: "Dashboard",
    keys: [
      "Active",
      "Expired (rule exception)",
      "Upcoming (rule exception)",
      "Ended",
    ],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy.ts`,
    ],
  },
  {
    thing: "a workflow variable's OAuth token, in its Access Token card",
    app: "Dashboard",
    keys: ["Not fetched yet (OAuth token)", "Valid (OAuth token)", "Expired"],
    phrases: ["No expiry reported", "Refresh failed"],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Components/Workflow/WorkflowVariableTokenStatusLabels.ts`,
    ],
  },
  {
    thing: "an on-call calendar link, in its Status panel",
    app: "Dashboard",
    keys: ["Active", "Not fetched yet (calendar feed)", "Disabled"],
    phrases: ["Waiting for first sync", "Needs regeneration"],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil.ts`,
    ],
  },
  {
    /*
     * One pill per row of Inventory > Managed Devices, and on a device's
     * Esper card (ManagedDeviceStatusPill), each worded from
     * MANAGED_DEVICE_STATUS_LABELS (#9838).
     */
    thing:
      "a managed device's status, on the Managed Devices list and its Esper card",
    app: "Dashboard",
    keys: [
      "Online",
      "Offline",
      "Provisioning",
      "Onboarding Failed",
      "Disabled",
      "Factory Reset",
      "Removed",
    ],
    drawnIn: ["packages/Common/Types/DeviceManagement/ManagedDeviceStatus.ts"],
  },
  {
    /*
     * One pill per row of Inventory > Managed Devices' Device Managers list,
     * its Status column (getDeviceManagementHealthWords), for every service
     * a connection reads: Esper, Microsoft Intune, Workspace ONE UEM and
     * SOTI MobiControl, which draw the same six (#10009). Russian's bare
     * Waiting, Catching up and Failing are a noun, a verb and a masculine
     * noun beside the neuter Off, Stale and Healthy, so the connection's
     * have keys of their own.
     */
    thing:
      "a device manager connection's status, on the Managed Devices list's Device Managers",
    app: "Dashboard",
    keys: [
      "Off",
      "Waiting (device manager connection)",
      "Catching up (device manager connection)",
      "Failing (device manager connection)",
      "Stale",
      "Healthy",
    ],
    drawnIn: [
      `${DASHBOARD_SOURCE}/Components/DeviceManagement/DeviceManagementWords.ts`,
    ],
  },
];

export const GENDERED_LANGUAGES: Array<string> = [
  "ru",
  "ar",
  "fr",
  "es",
  "it",
  "pt",
  "hi",
];

/*
 * Words before the state that take no gender of their own: a negation, and
 * "yet" or "still" ("Ещё не запрашивался", "Pas encore récupéré", "لم يُجلب
 * بعد"). The state's gender is the next word's.
 */
const NEGATION: Record<string, Array<string>> = {
  ru: ["не", "ещё", "еще", "пока", "уже"],
  ar: ["غير", "لم", "لا"],
  fr: ["non", "pas", "encore", "déjà", "plus"],
  es: ["no", "sin", "aún", "todavía", "ya"],
  it: ["non", "ancora", "già"],
  pt: ["não", "ainda", "já"],
};

/*
 * A phrase that opens with a preposition ("En pause", "In pausa") shows no
 * gender. Russian's too: a managed device's "В сети" and "Не в сети" (online,
 * offline: "in the network") describe no gender, where the bare "в" read as
 * a masculine word ending in a consonant (#9838).
 */
const PREPOSITION: Record<string, Array<string>> = {
  ru: ["в", "во", "на", "без", "из", "с", "со", "под", "по", "до", "при"],
  fr: ["en", "hors", "à", "au"],
  es: ["en", "con"],
  it: ["in", "fuori", "da"],
  pt: ["em", "sem"],
};

// Arabic's short vowels and the like, which a word may or may not carry.
const VOWEL_MARKS: RegExp = /[ً-ِْٰ]/g;

/*
 * Words that read the same in every gender, whatever their ending: French's
 * "Obsolète" ends as the feminine "Complète" does, and is a masculine
 * device manager's state as much as a feminine connection's (#10009).
 */
const SAME_IN_EVERY_GENDER: Record<string, Array<string>> = {
  fr: ["obsolète", "obsolètes"],
};

type Gender = "masculine" | "feminine" | "neuter" | "plural";

function headWord(language: string, text: string): string | undefined {
  const words: Array<string> = text
    .replace(VOWEL_MARKS, "")
    .trim()
    .toLocaleLowerCase(language)
    .split(/\s+/);
  const negations: Array<string> = NEGATION[language] || [];
  let index: number = 0;

  while (index < words.length - 1 && negations.includes(words[index]!)) {
    index += 1;
  }

  if ((PREPOSITION[language] || []).includes(words[index] || "")) {
    return undefined;
  }

  return words[index];
}

interface Ending {
  pattern: RegExp;
  // Undefined: a word that ends so shows no gender.
  gender: Gender | undefined;
}

// Spanish's and Portuguese's: a plural ("Próximos") is told apart too.
const ROMANCE_ENDINGS: Array<Ending> = [
  { pattern: /(?:os|as)$/, gender: "plural" },
  { pattern: /a$/, gender: "feminine" },
  { pattern: /o$/, gender: "masculine" },
];

// Italian's: its plurals end in i ("Revocati").
const ITALIAN_ENDINGS: Array<Ending> = [
  { pattern: /i$/, gender: "plural" },
  { pattern: /a$/, gender: "feminine" },
  { pattern: /o$/, gender: "masculine" },
];

/*
 * Each language's endings, the first that matches the state's head word
 * deciding. Hindi reads its whole phrase, whose participle comes last.
 */
const ENDINGS: Record<string, Array<Ending>> = {
  ru: [
    // A verb's past says its gender: запрашивался, запрашивалась, запрашивалось.
    { pattern: /лся$/, gender: "masculine" },
    { pattern: /лась$/, gender: "feminine" },
    { pattern: /лось$/, gender: "neuter" },
    { pattern: /лись$/, gender: "plural" },
    // A verb's present (Выполняется) agrees with nothing.
    { pattern: /(?:ся|сь)$/, gender: undefined },
    { pattern: /(?:ое|ее|о)$/, gender: "neuter" },
    { pattern: /(?:ая|яя|а|я)$/, gender: "feminine" },
    { pattern: /(?:ые|ие|ы|и)$/, gender: "plural" },
    { pattern: /[бвгджзйклмнпрстфхцчшщ]$/, gender: "masculine" },
  ],
  ar: [
    { pattern: /ة$/, gender: "feminine" },
    { pattern: /[ء-ي]$/, gender: "masculine" },
  ],
  fr: [
    { pattern: /(?:ée|ive|ue|te)s?$/, gender: "feminine" },
    { pattern: /(?:é|if|u|t)s?$/, gender: "masculine" },
  ],
  es: ROMANCE_ENDINGS,
  it: ITALIAN_ENDINGS,
  pt: ROMANCE_ENDINGS,
  // A participle says its gender: किया गया, की गई.
  hi: [
    { pattern: /(?:गया|गए)$/, gender: "masculine" },
    { pattern: /(?:गई|गयी)$/, gender: "feminine" },
  ],
};

/*
 * The gender a state's word shows, or undefined where it shows none (a
 * verb, a phrase that opens with a preposition, a word that takes no
 * ending). Read from the word's ending, as a reader tells it.
 */
export function getStateGender(
  language: string,
  text: string,
): Gender | undefined {
  const word: string | undefined =
    language === "hi" ? text.trim() : headWord(language, text);

  if (!word || (SAME_IN_EVERY_GENDER[language] || []).includes(word)) {
    return undefined;
  }

  const ending: Ending | undefined = (ENDINGS[language] || []).find(
    (candidate: Ending): boolean => {
      return candidate.pattern.test(word);
    },
  );

  return ending?.gender;
}

// The genders a set's words show, word by word, where they show one.
export function getSetGenders(
  language: string,
  words: Array<string>,
): Record<string, Gender> {
  const genders: Record<string, Gender> = {};

  for (const word of words) {
    const gender: Gender | undefined = getStateGender(language, word);

    if (gender) {
      genders[word] = gender;
    }
  }

  return genders;
}

export function agrees(language: string, words: Array<string>): boolean {
  return new Set(Object.values(getSetGenders(language, words))).size <= 1;
}

const localeCache: Map<string, Record<string, unknown>> = new Map();

function readLocale(app: string, language: string): Record<string, unknown> {
  const file: string = path.join(
    REPOSITORY_ROOT,
    LOCALE_DIRS[app] as string,
    `${language}.json`,
  );

  if (!localeCache.has(file)) {
    localeCache.set(
      file,
      JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>,
    );
  }

  return localeCache.get(file)!;
}

describe.each(
  STATE_SETS.map((set: StateSet): [string, StateSet] => {
    return [set.thing, set];
  }),
)("the states of %s", (_thing: string, set: StateSet) => {
  test("are drawn there, every one, and are keys of the app's English", () => {
    const english: Record<string, unknown> = readLocale(set.app, "en");

    for (const file of filesDrawingHere(set)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      for (const key of [...set.keys, ...(set.phrases || [])]) {
        expect({ file, key, drawn: source.includes(`"${key}"`) }).toEqual({
          file,
          key,
          drawn: true,
        });
      }
    }

    for (const key of [...set.keys, ...(set.phrases || [])]) {
      expect([key, english[key]]).toEqual([key, key]);
    }
  });

  /*
   * A state worded with a key of its own is one the translator knows, so
   * English reads it as the bare word ("Expired"), and the files that draw
   * the set no longer look the bare word up for it.
   */
  test("a state with a key of its own reads in English as its word, and its page draws no other", () => {
    for (const key of set.keys) {
      const word: string | undefined = getWordOfMeaningKey(key);

      if (!key.endsWith(")")) {
        expect([key, word]).toEqual([key, undefined]);
        continue;
      }

      expect([key, MEANING_KEYS.includes(key)]).toEqual([key, true]);
      expect([key, Boolean(word && key.startsWith(`${word} (`))]).toEqual([
        key,
        true,
      ]);

      for (const file of filesDrawingHere(set)) {
        const source: string = fs.readFileSync(
          path.join(REPOSITORY_ROOT, file),
          "utf8",
        );

        expect({
          file,
          bare: word,
          drawn: source.includes(`"${word}"`),
        }).toEqual({ file, bare: word, drawn: false });
      }
    }
  });

  test.each(GENDERED_LANGUAGES)("agree in gender in %s", (language: string) => {
    const locale: Record<string, unknown> = readLocale(set.app, language);
    const words: Array<string> = set.keys.map((key: string): string => {
      return String(locale[key]);
    });

    expect({
      language,
      words,
      genders: getSetGenders(language, words),
      agree: agrees(language, words),
    }).toEqual({
      language,
      words,
      genders: getSetGenders(language, words),
      agree: true,
    });
  });
});

describe("a resource's two states, in Russian", () => {
  /*
   * Neuter, as the locale words a state on its own, in the Dashboard and in
   * the Admin Dashboard, and the infrastructure map's line says the same
   * state with no word that takes a gender after it.
   */
  test("are Активно and Неактивно wherever they are drawn", () => {
    for (const app of Object.keys(LOCALE_DIRS)) {
      const russian: Record<string, unknown> = readLocale(app, "ru");

      expect([app, russian["Active"], russian["Inactive"]]).toEqual([
        app,
        "Активно",
        "Неактивно",
      ]);
    }

    const dashboard: Record<string, unknown> = readLocale("Dashboard", "ru");

    expect(dashboard["Active · seen {{time}}"]).toBe(
      "Активно · последние данные {{time}}",
    );
    expect(dashboard["Inactive · seen {{time}}"]).toBe(
      "Неактивно · последние данные {{time}}",
    );
  });

  test("Russian's docs quote a threat indicator's revoked state as the page draws it", () => {
    const doc: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Docs/Content/ru/telemetry/threat-intelligence.md",
      ),
      "utf8",
    );
    const dashboard: Record<string, unknown> = readLocale("Dashboard", "ru");

    expect(doc).toContain(`**${String(dashboard["Revoked"])}**`);
    expect(doc).toContain(`**${String(dashboard["Active"])}**`);
  });
});

/*
 * The words the sets' states had, which texts quoted as the page drew
 * them: a description of a host's systemd units, of a Swarm node's state
 * and availability, of a manager's standing. A text that quotes a state
 * quotes it as the page draws it now.
 */
const FORMER_WORDS: Record<string, Array<string>> = {
  ru: ["Неактивен", "Выведен из работы", "Отозван", "Не отозван"],
  ar: ["مُفرَّغة", "قابلة للوصول", "غير قابلة للوصول"],
};

const DOCS_CONTENT: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);

// Every docs page in a language: none for a language the docs are not in.
function docsPages(language: string): Array<string> {
  const pages: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const at: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(at);
      } else if (entry.name.endsWith(".md")) {
        pages.push(at);
      }
    }
  };

  if (fs.existsSync(path.join(DOCS_CONTENT, language))) {
    walk(path.join(DOCS_CONTENT, language));
  }

  return pages;
}

describe("a text that quotes a state", () => {
  test("the Russian docs are read", () => {
    expect(docsPages("ru").length).toBeGreaterThan(100);
  });

  test.each(Object.keys(FORMER_WORDS))(
    "in %s, quotes it as the page draws it, never as it was worded before",
    (language: string) => {
      const quoting: Array<string> = [];

      for (const app of Object.keys(LOCALE_DIRS)) {
        for (const [key, text] of Object.entries(readLocale(app, language))) {
          for (const word of FORMER_WORDS[language]!) {
            if (
              typeof text === "string" &&
              (text.includes(`«${word}»`) || text.includes(`**${word}**`))
            ) {
              quoting.push(`${app} ${key}: ${word}`);
            }
          }
        }
      }

      // And the docs in the language, which name a label in bold as the page draws it.
      for (const file of docsPages(language)) {
        const text: string = fs.readFileSync(file, "utf8");

        for (const word of FORMER_WORDS[language]!) {
          if (text.includes(`**${word}**`) || text.includes(`«${word}»`)) {
            quoting.push(`${path.relative(REPOSITORY_ROOT, file)}: ${word}`);
          }
        }
      }

      expect(quoting).toEqual([]);
    },
  );

  test("a Swarm node's availability and a manager's standing are quoted in Arabic as the page draws them", () => {
    const arabic: Record<string, unknown> = readLocale("Dashboard", "ar");
    const availability: string = String(
      arabic[
        "Whether Swarm places tasks on the node: Active, Paused (it keeps its tasks and takes no new ones) or Drained (its tasks are moved to other nodes, as before maintenance)."
      ],
    );
    const standing: string = String(
      arabic[
        "A manager's standing in the swarm, as docker node ls shows it: the Leader, Reachable, or Unreachable when the other managers cannot reach it. The swarm keeps working while more than half of its managers are reachable."
      ],
    );

    for (const key of ["Active", "Paused", "Drained"]) {
      expect(availability).toContain(`«${String(arabic[key])}»`);
    }

    for (const key of ["Reachable", "Unreachable"]) {
      expect(standing).toContain(`«${String(arabic[key])}»`);
    }
  });
});

/*
 * #8659: the states a shared word could not word for every page, each
 * worded by a key of its own, and what each set reads beside it.
 */
describe("the states with keys of their own", () => {
  test("read in Russian beside their set's other states", () => {
    const russian: Record<string, unknown> = readLocale("Dashboard", "ru");

    expect({
      indicator: russian["Expired (threat indicator)"],
      exception: russian["Expired (rule exception)"],
      token: russian["Not fetched yet (OAuth token)"],
      link: russian["Not fetched yet (calendar feed)"],
    }).toEqual({
      indicator: "Истекло",
      exception: "Истекло",
      token: "Ещё не запрашивался",
      link: "Ещё не запрашивалось",
    });

    // The bare words stay the pages' that share them: a token's Expired, Session Replay's Not fetched yet.
    expect(russian["Expired"]).toBe("Истёк");
    expect(russian["Not fetched yet"]).toBe("Ещё не запрашивалась");
  });

  /*
   * As the pages draw them, from the locales as they ship: English reads
   * each as its bare word (the shipped en.json holds no key that maps to
   * itself), every other language as its locale words it.
   */
  test("are drawn in English as the bare word, and in each language as its own", () => {
    const english: Translator = dashboardTranslator("en");
    const russian: Translator = dashboardTranslator("ru");
    const arabic: Translator = dashboardTranslator("ar");
    const spanish: Translator = dashboardTranslator("es");

    expect(
      [
        "Expired (threat indicator)",
        "Expired (rule exception)",
        "Upcoming (rule exception)",
        "Not fetched yet (OAuth token)",
        "Valid (OAuth token)",
        "Not fetched yet (calendar feed)",
      ].map((key: string): string | undefined => {
        return english.translateText(key);
      }),
    ).toEqual([
      "Expired",
      "Expired",
      "Upcoming",
      "Not fetched yet",
      "Valid",
      "Not fetched yet",
    ]);
    expect(russian.translateText("Expired (threat indicator)")).toBe("Истекло");
    expect(russian.translateText("Expired")).toBe("Истёк");
    expect(russian.translateText("Not fetched yet (OAuth token)")).toBe(
      "Ещё не запрашивался",
    );
    expect(russian.translateText("Not fetched yet (calendar feed)")).toBe(
      "Ещё не запрашивалось",
    );
    expect(arabic.translateText("Valid (OAuth token)")).toBe("صالح");
    expect(spanish.translateText("Upcoming (rule exception)")).toBe(
      "Programado",
    );
  });

  /*
   * #10009: a device manager connection's six states, one above the other
   * on the Device Managers list, read in Russian as one part of speech, the
   * neuter short form, as Russian words a state on its own and as its
   * tooltips speak of the connection ("Сохранено", "Включите его"). The
   * three with keys of their own read so beside Off, Stale and Healthy,
   * which needed none; the bare words stay the other pages'.
   */
  test("a device manager connection's states read in Russian as one part of speech, the neuter", () => {
    const russian: Translator = dashboardTranslator("ru");
    const english: Translator = dashboardTranslator("en");
    const keys: Array<string> = [
      "Off",
      "Waiting (device manager connection)",
      "Catching up (device manager connection)",
      "Failing (device manager connection)",
      "Stale",
      "Healthy",
    ];
    const words: Array<string> = keys.map((key: string): string => {
      return russian.translateText(key);
    });

    expect(words).toEqual([
      "Выключено",
      "Ещё не прочитано",
      "Прочитано частично",
      "Неисправно",
      "Устарело",
      "Исправно",
    ]);
    expect(
      words.map((word: string): string | undefined => {
        return getStateGender("ru", word);
      }),
    ).toEqual(["neuter", "neuter", "neuter", "neuter", "neuter", "neuter"]);

    // English draws each as its word, as the page always did.
    expect(
      keys.map((key: string): string => {
        return english.translateText(key);
      }),
    ).toEqual(["Off", "Waiting", "Catching up", "Failing", "Stale", "Healthy"]);

    // The bare words stay the other pages': an on-call log's Waiting, a security connection's Catching up.
    expect(russian.translateText("Waiting")).toBe("Ожидание");
    expect(russian.translateText("Catching up")).toBe("Догоняет");
    expect(russian.translateText("Failing")).toBe("Сбой");
  });

  test("read in Arabic and Spanish beside theirs", () => {
    const arabic: Record<string, unknown> = readLocale("Dashboard", "ar");
    const spanish: Record<string, unknown> = readLocale("Dashboard", "es");

    // A token is masculine; the bare Valid is a certificate's (الشهادة), feminine.
    expect(arabic["Valid (OAuth token)"]).toBe("صالح");
    expect(arabic["Valid"]).toBe("صالحة");
    // One exception, beside Activo and Finalizado; the bare Próximos is a list's.
    expect(spanish["Upcoming (rule exception)"]).toBe("Programado");
    expect(spanish["Upcoming"]).toBe("Próximos");
  });

  /*
   * Each language words a page's own key as it words the bare word, unless
   * the bare word disagrees with the page's other states there: the key
   * changes nothing it did not need to.
   */
  test("are worded as the bare word wherever it already agreed", () => {
    const changed: Record<string, Array<string>> = {
      "Expired (threat indicator)": ["ru"],
      "Expired (rule exception)": ["ru"],
      "Upcoming (rule exception)": ["es", "ar"],
      "Not fetched yet (OAuth token)": ["ru"],
      "Valid (OAuth token)": ["ar"],
      "Not fetched yet (calendar feed)": ["ru"],
      // A device manager connection's states (#10009).
      "Waiting (device manager connection)": ["ru"],
      "Catching up (device manager connection)": ["ru"],
      "Failing (device manager connection)": ["ru"],
    };

    for (const language of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ]) {
      const locale: Record<string, unknown> = readLocale("Dashboard", language);

      for (const [key, languages] of Object.entries(changed)) {
        const bare: string = getWordOfMeaningKey(key) as string;

        expect({
          language,
          key,
          asTheBareWord: locale[key] === locale[bare],
        }).toEqual({
          language,
          key,
          asTheBareWord: !languages.includes(language),
        });
      }
    }
  });

  /*
   * The docs name each state in bold as the page draws it: the token's card
   * and the calendar link's panel in Russian, the indicators' and the rule
   * exceptions' Status in Russian and Spanish.
   */
  test("are quoted by the docs as the page draws them, never as the bare word", () => {
    const quoted: Array<{
      language: string;
      page: string;
      key: string;
      former: string;
    }> = [
      {
        language: "ru",
        page: "workflows/variables.md",
        key: "Not fetched yet (OAuth token)",
        former: "Ещё не запрашивалась",
      },
      {
        language: "ru",
        page: "on-call/calendar-feeds.md",
        key: "Not fetched yet (calendar feed)",
        former: "Ещё не запрашивалась",
      },
      {
        language: "ru",
        page: "telemetry/threat-intelligence.md",
        key: "Expired (threat indicator)",
        former: "Истёк",
      },
      {
        language: "ru",
        page: "telemetry/security-events.md",
        key: "Expired (rule exception)",
        former: "Истёк",
      },
      {
        language: "es",
        page: "telemetry/security-events.md",
        key: "Upcoming (rule exception)",
        former: "Próximos",
      },
    ];

    for (const { language, page, key, former } of quoted) {
      const doc: string = fs.readFileSync(
        path.join(DOCS_CONTENT, language, page),
        "utf8",
      );
      const word: string = String(readLocale("Dashboard", language)[key]);

      expect({
        language,
        page,
        quotes: doc.includes(`**${word}**`),
        quotesFormer: doc.includes(`**${former}**`),
      }).toEqual({ language, page, quotes: true, quotesFormer: false });
    }
  });
});

describe("the checks above (negative control)", () => {
  test("Russian's old pair, and a Spanish or French pair of two genders, disagree", () => {
    expect(agrees("ru", ["Активно", "Неактивен"])).toBe(false);
    expect(getSetGenders("ru", ["Активно", "Неактивен"])).toEqual({
      Активно: "neuter",
      Неактивен: "masculine",
    });
    expect(
      agrees("ru", ["Активно", "Выведен из работы", "Приостановлено"]),
    ).toBe(false);
    expect(agrees("es", ["Activo", "Inactiva"])).toBe(false);
    expect(agrees("fr", ["Actif", "Inactive"])).toBe(false);
    expect(agrees("ar", ["نشط", "مُفرَّغة", "متوقف مؤقتًا"])).toBe(false);
    expect(agrees("hi", ["रद्द किया गया", "रोकी गई"])).toBe(false);
  });

  test("a negation, a preposition and a verb are read as a reader reads them", () => {
    expect(getStateGender("ru", "Не готов")).toBe("masculine");
    expect(getStateGender("ru", "Выполняется")).toBeUndefined();
    expect(getStateGender("ar", "غير نشط")).toBe("masculine");
    expect(getStateGender("ar", "قابلة للوصول")).toBe("feminine");
    expect(getStateGender("fr", "En pause")).toBeUndefined();
    expect(getStateGender("fr", "Non révoqué")).toBe("masculine");
    expect(getStateGender("it", "In pausa")).toBeUndefined();
    expect(getStateGender("hi", "सक्रिय")).toBeUndefined();
    expect(agrees("ru", ["Активно", "Неактивно"])).toBe(true);
    expect(agrees("it", ["Attivo", "Svuotato", "In pausa"])).toBe(true);
  });

  /*
   * #10009: French's "Obsolète" is either gender, so a masculine
   * "Désactivé" and "Sain" agree with it; a feminine ending like it still
   * shows its gender, and a set of two genders is still caught.
   */
  test("a French word that is either gender shows none, and one that only ends like it still does", () => {
    expect(getStateGender("fr", "Obsolète")).toBeUndefined();
    expect(getStateGender("fr", "Non obsolète")).toBeUndefined();
    expect(agrees("fr", ["Désactivé", "En attente", "Obsolète", "Sain"])).toBe(
      true,
    );

    expect(getStateGender("fr", "Complète")).toBe("feminine");
    expect(getStateGender("fr", "Incomplète")).toBe("feminine");
    expect(agrees("fr", ["Désactivé", "Obsolète", "Incomplète"])).toBe(false);
  });

  // #10009: the connection's states as Russian worded them before, each caught.
  test("a device manager connection's former Russian states disagree", () => {
    expect(
      getSetGenders("ru", [
        "Выключено",
        "Ожидание",
        "Догоняет",
        "Сбой",
        "Устарело",
        "Исправно",
      ]),
    ).toEqual({
      Выключено: "neuter",
      Ожидание: "plural",
      Догоняет: "masculine",
      Сбой: "masculine",
      Устарело: "neuter",
      Исправно: "neuter",
    });
    expect(
      agrees("ru", [
        "Выключено",
        "Ожидание",
        "Догоняет",
        "Сбой",
        "Устарело",
        "Исправно",
      ]),
    ).toBe(false);
  });

  /*
   * #9838: Russian's online and offline are "in the network" and "not in the
   * network". The preposition read as a masculine word ending in a
   * consonant, so the managed device's neuter "Отключено" and "Удалено"
   * seemed to disagree with them.
   */
  test("a Russian state that opens with a preposition shows no gender, and a word after it still does", () => {
    expect(getStateGender("ru", "В сети")).toBeUndefined();
    expect(getStateGender("ru", "Не в сети")).toBeUndefined();
    expect(getStateGender("ru", "На паузе")).toBeUndefined();
    expect(getStateGender("ru", "Без изменений")).toBeUndefined();
    expect(agrees("ru", ["В сети", "Не в сети", "Отключено", "Удалено"])).toBe(
      true,
    );

    // A word that only begins like one is still read.
    expect(getStateGender("ru", "Включено")).toBe("neuter");
    expect(getStateGender("ru", "Выведен из работы")).toBe("masculine");
    expect(getStateGender("ru", "Не удалось зарегистрировать")).toBe("neuter");

    // And a set that disagrees beside them is still caught.
    expect(agrees("ru", ["В сети", "Отключено", "Удалён"])).toBe(false);
  });

  test("the managed device's states read as Russian words them today", () => {
    const russian: Record<string, unknown> = readLocale("Dashboard", "ru");

    expect({
      online: russian["Online"],
      offline: russian["Offline"],
      disabled: russian["Disabled"],
      removed: russian["Removed"],
    }).toEqual({
      online: "В сети",
      offline: "Не в сети",
      disabled: "Отключено",
      removed: "Удалено",
    });
  });

  test("a verb's past and a 'yet' before it are read as a reader reads them (#8659)", () => {
    expect(getStateGender("ru", "Ещё не запрашивался")).toBe("masculine");
    expect(getStateGender("ru", "Ещё не запрашивалась")).toBe("feminine");
    expect(getStateGender("ru", "Ещё не запрашивалось")).toBe("neuter");
    expect(getStateGender("ru", "Истёк")).toBe("masculine");
    expect(getStateGender("ru", "Истекло")).toBe("neuter");
    expect(getStateGender("fr", "Pas encore récupéré")).toBe("masculine");
    expect(getStateGender("es", "Aún no obtenido")).toBe("masculine");
    expect(getStateGender("it", "Non ancora recuperato")).toBe("masculine");
    expect(getStateGender("pt", "Ainda não obtido")).toBe("masculine");
    expect(getStateGender("ar", "لم يُجلب بعد")).toBe("masculine");

    // The sets as they were: each caught.
    expect(agrees("ru", ["Активно", "Истёк", "Отозвано"])).toBe(false);
    expect(
      agrees("ru", ["Ещё не запрашивалась", "Действителен", "Истёк"]),
    ).toBe(false);
    expect(agrees("ru", ["Активно", "Ещё не запрашивалась", "Отключено"])).toBe(
      false,
    );
    expect(agrees("ar", ["لم يُجلب بعد", "صالحة", "منتهي الصلاحية"])).toBe(
      false,
    );
    expect(agrees("es", ["Activo", "Caducado", "Próximos", "Finalizado"])).toBe(
      false,
    );
  });
});
