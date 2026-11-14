// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { toLabelTerm } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A NOUN THE SENTENCES SHARE STARTS A LABEL WITH A CAPITAL (#7628).
 *
 * Many short noun keys are worded for the middle of a sentence - "this
 * {{noun}}", "alerts on {{resources}}" - so the languages that write a noun
 * lower-case there word them that way: "clúster de Kubernetes", "recurso en
 * la nube", "кластер Proxmox". Where the same key starts a label - a row, a
 * chip, a card's line, a name standing in for a missing one - it is drawn
 * through toLabelTerm (#7607), which starts it with a capital in the
 * reader's language. A key that is only ever a label is worded with a
 * capital in every language instead (LABEL_ONLY_KEYS).
 *
 * The keys are read from the locales: every short key - a capital first, at
 * most four words, no sentence punctuation - that toLabelTerm would change
 * in a language that writes capitals, but the few that are no such noun
 * (NOT_NOUN_KEYS). Every file of the Dashboard, and of the Common code it
 * draws, that names one of them is listed in SITES with how it draws it: in
 * a sentence, where the locale's wording is right; in English, never
 * translated; or as a label, through toLabelTerm in the calls named. A file
 * that names one and is not listed fails here: drawn as a label, it goes
 * through toLabelTerm; drawn in a sentence, it says so here.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

// The Dashboard, and the Common code that draws words for it.
const SCANNED_FOLDERS: ReadonlyArray<string> = [
  DASHBOARD,
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/Common/Models",
];

const SKIPPED_FOLDER_NAMES: ReadonlyArray<string> = ["node_modules", "Locales"];

const SOURCE_FILE: RegExp = /\.tsx?$/;

// The languages the Dashboard speaks that write capitals.
const CASED_LANGUAGES: ReadonlyArray<string> = [
  "da",
  "de",
  "es",
  "fr",
  "it",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
];

// What a sentence has and a noun does not.
const SENTENCE_PUNCTUATION: RegExp = /[.!?:;,{}()[\]"'/|<>=+*%#@&]/;

// "_one", "_few": a plural form's key.
const PLURAL_FORM: RegExp = /_(zero|one|two|few|many|other)$/;

const CAPITAL_FIRST: RegExp = /^\p{Lu}/u;

const MOST_WORDS: number = 4;

/*
 * Short keys whose wording starts lower-case for a reason of its own, so
 * toLabelTerm is not for them.
 */
const DAY_NAME: string =
  "A day's name, not a noun the sentences share: whether it takes a capital standing alone is its language's own rule - CLDR's contextTransforms capitalise one in es, fr, it, pt, ru and nl and never in da, no and sv - which toLabelTerm's capital in every language is not.";
const STARTS_WITH_A_CODE: string =
  "Starts with a code that is written lower-case in every language (https, pprof, kubectl), which toLabelTerm would capitalise.";

const NOT_NOUN_KEYS: Readonly<Record<string, string>> = {
  Mon: DAY_NAME,
  Tue: DAY_NAME,
  Wed: DAY_NAME,
  Thu: DAY_NAME,
  Fri: DAY_NAME,
  Sat: DAY_NAME,
  Sun: DAY_NAME,
  Monday: DAY_NAME,
  Tuesday: DAY_NAME,
  Wednesday: DAY_NAME,
  Thursday: DAY_NAME,
  Friday: DAY_NAME,
  Saturday: DAY_NAME,
  Sunday: DAY_NAME,
  "Copy https link": STARTS_WITH_A_CODE,
  "Download pprof": STARTS_WITH_A_CODE,
  "Edit the kubectl allowlist": STARTS_WITH_A_CODE,
};

/*
 * Keys only ever drawn as a label, or as the first word of a line: worded
 * with a capital in every language, so no call has to remember toLabelTerm.
 */
const LABEL_ONLY_KEYS: Readonly<Record<string, string>> = {
  "Galera cluster size":
    "A metric's title, on a database's and an OpenStack cloud's pages, and before the words a chart adds to it (\"{{metric}} (per second)\").",
  "Container App":
    "The first words of every sentence that says what a cloud change does to one, in every language that words those sentences (\"{{kind}} {{name}}: reiniciar\"). The catalog's label of the same words is a product's name, drawn as written (CloudResourceTypeNamesGuard).",
};

// A call that draws a key as a label: the file it is in, and what it reads.
interface LabelCall {
  file: string;
  call: RegExp;
}

type NounSite =
  | { inSentence: string }
  | { inEnglish: string }
  | { asLabel: string; drawnBy: ReadonlyArray<LabelCall> };

const OWNERS_CARD: NounSite = {
  inSentence:
    'OwnersCard\'s resourceDisplayName: "People and teams responsible for this {{resourceName}}."',
};

const MORE_SETTINGS: NounSite = {
  inSentence:
    'The settings cards\' resourceName: "Keep telemetry collected from this {{resource}} for longer or shorter ..."',
};

const LINK_IN_A_SENTENCE: NounSite = {
  inSentence:
    "A link's words, drawn inside a sentence (TranslatedSentence's slot).",
};

const ALERT_TEMPLATE: NounSite = {
  inEnglish:
    "An alert template's resourceNoun, in the English words a monitor's criteria are created with.",
};

// "Clúster de Kubernetes" as a label: translated, then started with a capital.
const TRANSLATED_LABEL_CALL: RegExp =
  /toLabelTerm\(\s*translator\.translateText\(label\) \|\| label,\s*translator\.language,?\s*\)/;

const SITES: Readonly<Record<string, NounSite>> = {
  // Labels.
  [`${DASHBOARD}/Components/NetworkTraffic/NetworkTrafficAddressNames.ts`]: {
    asLabel:
      'Where an address\'s name comes from, on the address card: "Cloud resource" beside "Host" and "DNS name".',
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/NetworkTraffic/NetworkTrafficAddressNames.ts`,
        call: /toLabelTerm\(\s*translator\.translateText\(key\) \|\| key,\s*translator\.language,?\s*\)/,
      },
      {
        file: `${DASHBOARD}/Components/NetworkTraffic/TrafficAddressCard.tsx`,
        call: /getTrafficAddressSourceText\(label\.source, translator\)/,
      },
    ],
  },
  [`${DASHBOARD}/Components/OpenStack/Part/OpenStackInstanceLinksCard.tsx`]: {
    asLabel:
      "What an OpenStack instance also is elsewhere in OneUptime, a row each.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/OpenStack/Part/OpenStackInstanceLinksCard.tsx`,
        call: /toLabelTerm\(\s*translator\.translateText\(data\.label\) \|\| data\.label,\s*translator\.language,?\s*\)/,
      },
    ],
  },
  [`${DASHBOARD}/Components/OpenStack/Part/OpenStackPlacementCard.tsx`]: {
    asLabel: "The line naming the OpenStack cloud an instance runs in.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/OpenStack/Part/OpenStackPlacementCard.tsx`,
        call: TRANSLATED_LABEL_CALL,
      },
    ],
  },
  [`${DASHBOARD}/Pages/OpenStack/Utils/OpenStackHealth.ts`]: {
    asLabel: "The kind of part on a Needs attention chip.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/ResourcePart/NeedsAttentionCard.tsx`,
        call: /toLabelTerm\(tx\(item\.kind\), translator\.language\)/,
      },
    ],
  },
  [`${DASHBOARD}/Pages/Proxmox/View/Index.tsx`]: {
    asLabel:
      "The name of a linked Ceph cluster that has none, on the Proxmox cluster's Ceph Storage card.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Pages/Proxmox/View/Index.tsx`,
        call: /toLabelTerm\(\s*translator\.translateText\("Ceph cluster"\) \|\| "Ceph cluster",\s*translator\.language,?\s*\)/,
      },
    ],
  },
  "packages/Common/Types/Monitor/MonitorTemplateSyncField.ts": {
    asLabel:
      "The name of what an infrastructure monitor watches, a row of the Template sync card.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/Form/Monitor/MonitorTemplateSyncFields.tsx`,
        call: TRANSLATED_LABEL_CALL,
      },
    ],
  },

  // Sentences.
  [`${DASHBOARD}/Components/AIChat/ChatActivityFeed.tsx`]: {
    inSentence:
      'A linked resource, "{{kind}} {{name}}", in "No open or recent alerts on {{resources}}" and the follow-up check\'s sentences.',
  },
  [`${DASHBOARD}/Components/AIChat/PageContext.ts`]: {
    inSentence:
      "The page's noun, put into Ask AI's sentences as a term (\"this {{noun}}\").",
  },
  [`${DASHBOARD}/Components/AIChat/ResourcePageContext.ts`]: {
    inSentence:
      "The page's noun, after \"This\" on Ask AI's chip and in its suggested questions.",
  },
  [`${DASHBOARD}/Components/Ceph/Part/CephPoolOverview.tsx`]: {
    inSentence:
      'A tile\'s sublabel, the words under its figure: lower-case in English too, as "monitor daemons" and "of one CPU core" are.',
  },
  [`${DASHBOARD}/Components/Code/GitHubConnect.tsx`]: LINK_IN_A_SENTENCE,
  [`${DASHBOARD}/Components/LlmConversations/LlmConversationsView.tsx`]:
    LINK_IN_A_SENTENCE,
  [`${DASHBOARD}/Components/NetworkDevice/DeviceDiagnosticsCard.tsx`]:
    LINK_IN_A_SENTENCE,
  [`${DASHBOARD}/Components/NetworkTraffic/Meraki/MerakiWords.ts`]: {
    inSentence:
      'The table\'s name for a connection, in its sentences: "You do not have permission to update this Meraki connection."',
  },
  [`${DASHBOARD}/Components/OpenStack/OpenStackLists.tsx`]: {
    inSentence:
      "A list's singularName and pluralName, which its sentences take as terms.",
  },
  [`${DASHBOARD}/Components/ResourceAiAgent/ResourceAiAgentDescriptors.ts`]: {
    inSentence:
      'How the AI agent pages\' sentences name the resource, after "this" or "a".',
  },
  [`${DASHBOARD}/Components/ResourceAiAgent/ResourceAiAgentInstall.ts`]: {
    inSentence:
      "The collector's name in the install steps' sentences (\"Add this service to the {{collectorName}}'s docker-compose.yml\").",
  },
  [`${DASHBOARD}/Components/ResourceConnection/ResourceConnectionGuides.ts`]: {
    inSentence:
      "The agent's name in the connection guide's sentences (\"Set up the {{agentName}}\").",
  },
  [`${DASHBOARD}/Pages/Ceph/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/Ceph/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Docker/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/Docker/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/DockerSwarm/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/DockerSwarm/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/IoT/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/IoT/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Kubernetes/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/Kubernetes/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Monitor/View/Documentation.tsx`]: LINK_IN_A_SENTENCE,
  [`${DASHBOARD}/Pages/NetworkDevice/View/Logs.tsx`]: {
    inSentence:
      'Words in bold inside a sentence: "It listens for {{snmpTraps}} on UDP port 162".',
  },
  [`${DASHBOARD}/Pages/OpenStack/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/OpenStack/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Podman/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/Podman/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Proxmox/View/Owners.tsx`]: OWNERS_CARD,
  [`${DASHBOARD}/Pages/Proxmox/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Rum/View/Settings.tsx`]: MORE_SETTINGS,
  [`${DASHBOARD}/Pages/Settings/McpServer.tsx`]: LINK_IN_A_SENTENCE,
  [`${DASHBOARD}/Pages/StatusPages/View/Mcp.tsx`]: LINK_IN_A_SENTENCE,
  [`${DASHBOARD}/Utils/InvestigationEvidenceFormat.ts`]: {
    inSentence: 'The page an evidence row opens, in "Open in {{page}}".',
  },
  [`${DASHBOARD}/Utils/LogsCrossSignalPivot.ts`]: {
    inSentence: "Resources named mid-sentence in the Logs pivot's hint.",
  },
  [`${DASHBOARD}/Utils/TelemetryTabScope.ts`]: {
    inSentence:
      'The filters a tab carries but cannot apply, mid-sentence: "not applied here: severity, Proxmox cluster".',
  },
  "packages/Common/Types/AI/AiAffectedResources.ts": {
    inSentence: "How the AI's affected resources are named in its sentences.",
  },
  "packages/Common/Types/AI/ResourceAiAccessPermissions.ts": {
    inEnglish: "The server's sentences about a resource's AI access.",
  },
  "packages/Common/Types/AutoRemediation/RemediationRoundName.ts": {
    inSentence: 'A round\'s name: "AI remediation for {{kind}} "{{name}}"".',
  },
  "packages/Common/Types/InstallScripts/InstallScripts.ts": {
    inEnglish:
      "The titles of the install scripts' index, which is served in English.",
  },
  "packages/Common/Types/MessageQueue/MessageQueueMetricCatalog.ts": {
    inSentence:
      'The words in brackets after a metric\'s title, which tell two copies apart: "<title> (<words>)".',
  },
  "packages/Common/Types/Monitor/CephAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/Monitor/DockerAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/Monitor/DockerSwarmAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/Monitor/KubernetesAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/Monitor/OpenStackAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/Monitor/PodmanAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/Monitor/ProxmoxAlertTemplates.ts": ALERT_TEMPLATE,
  "packages/Common/Types/OpenStack/OpenStackBlastRadius.ts": {
    inSentence: 'A count\'s noun, after its number: "3 DNS zones".',
  },
  "packages/Common/Types/ResourceAiAgent/AiResourceType.ts": {
    inSentence:
      "How a resource is named in the remediation lines' sentences, and the server's.",
  },
  "packages/Common/Types/Rules/RuleRun.ts": {
    inSentence:
      "A rule's resourceSingular and resourcePlural, in Run Rule Now's sentences.",
  },
  "packages/Common/Utils/SecurityCase/SecurityCaseMarkdown.ts": {
    inEnglish: "A security case feed's English markdown.",
  },
};

function isShortNounKey(key: string): boolean {
  const wordCount: number = key.split(/\s+/).filter(Boolean).length;

  return (
    CAPITAL_FIRST.test(key) &&
    !SENTENCE_PUNCTUATION.test(key) &&
    !PLURAL_FORM.test(key) &&
    wordCount >= 1 &&
    wordCount <= MOST_WORDS
  );
}

// The languages whose wording of `key` toLabelTerm would start with a capital.
function languagesStartingLowerCase(key: string): Array<string> {
  return CASED_LANGUAGES.filter((language: string): boolean => {
    const value: string | undefined = readDashboardLocale(language)[key];

    return typeof value === "string" && toLabelTerm(value, language) !== value;
  });
}

const NOUN_KEYS: ReadonlyArray<string> = Object.keys(
  readDashboardLocale("en"),
).filter((key: string): boolean => {
  return (
    isShortNounKey(key) &&
    !Object.prototype.hasOwnProperty.call(NOT_NOUN_KEYS, key) &&
    languagesStartingLowerCase(key).length > 0
  );
});

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(path.join(REPOSITORY_ROOT, folder), {
    withFileTypes: true,
  })) {
    const relative: string = `${folder}/${entry.name}`;

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDER_NAMES.includes(entry.name)) {
        files.push(...sourceFiles(relative));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(relative);
    }
  }

  return files;
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// A line of a comment: what it says is not drawn.
function isCommentLine(line: string): boolean {
  const start: string = line.trim();

  return (
    start.startsWith("*") || start.startsWith("//") || start.startsWith("/*")
  );
}

// Every file that names a noun key outside a comment, with the keys it names.
function findNounSites(): Map<string, Set<string>> {
  const literals: Array<[string, string]> = NOUN_KEYS.map(
    (key: string): [string, string] => {
      return [key, JSON.stringify(key)];
    },
  );
  const sites: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const folder of SCANNED_FOLDERS) {
    for (const file of sourceFiles(folder)) {
      const source: string = readSource(file);
      const named: Array<[string, string]> = literals.filter(
        (literal: [string, string]): boolean => {
          return source.includes(literal[1]);
        },
      );

      if (named.length === 0) {
        continue;
      }

      for (const line of source.split("\n")) {
        if (isCommentLine(line)) {
          continue;
        }

        for (const [key, literal] of named) {
          if (line.includes(literal)) {
            const keys: Set<string> = sites.get(file) || new Set<string>();
            keys.add(key);
            sites.set(file, keys);
          }
        }
      }
    }
  }

  return sites;
}

const NOUN_SITES: Map<string, Set<string>> = findNounSites();

describe("the noun keys the sentences share", () => {
  test("are read from the locales: the nouns of the sentences five languages word lower-case are among them", () => {
    for (const key of [
      "Kubernetes cluster",
      "Cloud resource",
      "Ceph cluster",
      "DNS zone",
      "OpenStack cloud",
    ]) {
      expect(NOUN_KEYS).toContain(key);
    }

    expect(languagesStartingLowerCase("Kubernetes cluster")).toEqual(
      expect.arrayContaining(["es", "fr", "it", "pt", "ru"]),
    );
  });

  test("a word with its own case is no such key: vCenter stays vCenter", () => {
    expect(NOUN_KEYS).not.toContain("Archived vCenters");
    expect(NOUN_KEYS).not.toContain("Hypervisor vCPUs");
  });

  test("every key set aside is still a short key some language starts lower-case, with its reason", () => {
    for (const [key, reason] of Object.entries(NOT_NOUN_KEYS)) {
      expect({ key, isShortNounKey: isShortNounKey(key) }).toEqual({
        key,
        isShortNounKey: true,
      });
      expect({
        key,
        lowerCaseIn: languagesStartingLowerCase(key).length > 0,
      }).toEqual({ key, lowerCaseIn: true });
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

describe("every file that names one says how it draws it", () => {
  test("is listed in SITES", () => {
    const unlisted: Array<string> = Array.from(NOUN_SITES.entries())
      .filter(([file]: [string, Set<string>]): boolean => {
        return !Object.prototype.hasOwnProperty.call(SITES, file);
      })
      .map(([file, keys]: [string, Set<string>]): string => {
        return `${file}: ${Array.from(keys).sort().join(", ")}`;
      });

    expect(unlisted).toEqual([]);
  });

  test("and every file listed still names one", () => {
    const stale: Array<string> = Object.keys(SITES).filter(
      (file: string): boolean => {
        return !NOUN_SITES.has(file);
      },
    );

    expect(stale).toEqual([]);
  });

  test("a label is drawn through toLabelTerm, in the calls named", () => {
    const missing: Array<string> = [];

    for (const [file, site] of Object.entries(SITES)) {
      if (!("asLabel" in site)) {
        continue;
      }

      expect(site.drawnBy.length).toBeGreaterThan(0);

      for (const drawing of site.drawnBy) {
        if (!drawing.call.test(readSource(drawing.file))) {
          missing.push(`${file}: ${drawing.file} ${String(drawing.call)}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("a key only ever drawn as a label", () => {
  test.each(Object.keys(LABEL_ONLY_KEYS))(
    "%s starts with a capital in every language that writes one",
    (key: string) => {
      expect(languagesStartingLowerCase(key)).toEqual([]);

      for (const language of CASED_LANGUAGES) {
        expect(readDashboardLocale(language)[key]).toMatch(CAPITAL_FIRST);
      }
    },
  );
});
