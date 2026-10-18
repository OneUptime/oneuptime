import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnedScopePermission from "Common/Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "Common/Server/Types/Database/Permissions/OwnerTableRegistry";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE OWNED SCOPE NARROWS EVERY RESOURCE WITH OWNERS, AND THE DOCS SAY SO.
 *
 * Users, Teams & Permissions says, where it explains the Owned scope, that
 * it narrows every resource that can have owners and what belongs to them,
 * and which kinds - the ones other resources are set up with - a permission
 * scoped to Owned still reads in full, changing and deleting only its own;
 * its on-call recipe makes the team the owner of its on-call policies and
 * schedules too. The upgrade guide says what changes, right after the note
 * on adding and removing owners. Every docs language says it, in its own
 * words. What the pages claim is held to the product here too: the kinds
 * they name are the kinds the owner registry holds, the ones read in full
 * are exactly the ones the registry lets every reader read, a Runner's key
 * shows only where owned, the monitors in a group go with the group, and
 * an incident or an alert goes into an episode only as its own owners'.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// Line breaks and runs of spaces, read as one space.
const WHITESPACE: RegExp = /\s+/g;

// An owner table, by its name, and the kind it owns: MonitorOwnerUser.
const OWNER_TABLE_NAME: RegExp = /^(.+)Owner(User|Team)$/;

// The Scope section's paragraph on Owned opens with the scope's own name.
const OWNED_PARAGRAPH_LEAD: Record<string, string> = {
  en: "**Owned** is the simplest way",
  da: "**Ejede** er den enkleste måde",
  de: "**Eigene** ist der einfachste Weg",
  es: "**Propios** es la forma más sencilla",
  fa: "**تحت مالکیت** ساده‌ترین راه",
  fr: "**Possédées** est le moyen le plus simple",
  hi: "**स्वामित्व**",
  it: "**Possedute** è il modo più semplice",
  ja: "**所有**は",
  ko: "**소유**는",
  nl: "**Eigen** is de eenvoudigste manier",
  no: "**Eide** er den enkleste måten",
  pt: "**Próprios** é a forma mais simples",
  ru: "**Свои** — самый простой способ",
  sv: "**Ägda** är det enklaste sättet",
  "zh-CN": "**拥有**是搭建",
  "zh-TW": "**擁有**是打造",
};

// What it says now: every resource with owners, and what is still read in full.
const OWNED_PARAGRAPH_SAYS: Record<string, Array<string>> = {
  en: [
    "It narrows every resource that can have owners — monitors, incidents, dashboards, services, monitor groups, on-call schedules and the like — and what belongs to them, such as a schedule's layers.",
    "Probes, Runners, AI agents, on-call schedules and incident and maintenance templates are what other resources are set up with, so a permission scoped to Owned still reads all of them, and you can pick any of them; it changes and deletes only the ones you or your teams own.",
    "A Runner's key, which lets whoever holds it act as the Runner, shows only on the Runners you or your teams own.",
  ],
  da: [
    "Det indsnævrer alle ressourcer, der kan have ejere",
    "så en tilladelse med omfanget Ejede læser stadig dem alle",
    "En Runners nøgle",
  ],
  de: [
    "Eingegrenzt wird jede Ressource, die Eigentümer haben kann",
    "liest sie deshalb weiterhin alle",
    "Den Schlüssel eines Runners",
  ],
  es: [
    "Acota todos los recursos que pueden tener propietarios",
    "sigue leyéndolos todos",
    "La clave de un Runner",
  ],
  fa: [
    "هر منبعی را که می‌تواند مالک داشته باشد تنگ می‌کند",
    "همچنان همهٔ آن‌ها را می‌خواند",
    "کلید یک Runner",
  ],
  fr: [
    "Cela restreint toutes les ressources pouvant avoir des propriétaires",
    "les lit donc toujours tous",
    "La clé d'un Runner",
  ],
  hi: [
    "यह हर उस संसाधन को संकुचित करता है जिसके स्वामी हो सकते हैं",
    "अब भी उन सभी को पढ़ती है",
    "किसी Runner की कुंजी",
  ],
  it: [
    "Restringe ogni risorsa che può avere proprietari",
    "continua a leggerli tutti",
    "La chiave di un Runner",
  ],
  ja: [
    "オーナーを持てるすべてのリソース",
    "引き続きすべて読み取れ",
    "Runner のキー",
  ],
  ko: [
    "소유자를 가질 수 있는 모든 리소스",
    "여전히 모두 읽으며",
    "Runner의 키",
  ],
  nl: [
    "Het beperkt elke resource die eigenaren kan hebben",
    "leest ze nog steeds allemaal",
    "De sleutel van een Runner",
  ],
  no: [
    "Det snevrer inn alle ressurser som kan ha eiere",
    "leser fortsatt alle sammen",
    "En Runners nøkkel",
  ],
  pt: [
    "Isso restringe todo recurso que pode ter proprietários",
    "continua lendo todos eles",
    "A chave de um Runner",
  ],
  ru: [
    "Сужается каждый ресурс, у которого могут быть владельцы",
    "по-прежнему читает их все",
    "Ключ Runner",
  ],
  sv: [
    "Det smalnar av varje resurs som kan ha ägare",
    "läser fortfarande alla",
    "En Runners nyckel",
  ],
  "zh-CN": [
    "它会收窄每一种能有所有者的资源",
    "仍能读取它们全部",
    "Runner 的密钥",
  ],
  "zh-TW": [
    "它會收窄每一種能有擁有者的資源",
    "仍能讀取它們全部",
    "Runner 的金鑰",
  ],
};

// The upgrade note's bold lead.
const NOTE_LEAD: Record<string, string> = {
  en: "The `Owned` scope narrows every resource with owners.",
  da: "Omfanget `Owned` indsnævrer alle ressourcer med ejere.",
  de: "Der Geltungsbereich `Owned` grenzt jede Ressource mit Eigentümern ein.",
  es: "El alcance `Owned` acota todos los recursos con propietarios.",
  fa: "دامنه `Owned` هر منبعی را که مالک دارد محدود می‌کند.",
  fr: "La portée `Owned` restreint toute ressource qui a des propriétaires.",
  hi: "स्वामियों वाले हर संसाधन को `Owned` दायरा संकुचित करता है।",
  it: "L'ambito `Owned` restringe ogni risorsa che ha proprietari.",
  ja: "オーナーを持つすべてのリソースを `Owned` スコープが絞り込みます。",
  ko: "소유자가 있는 모든 리소스를 `Owned` 범위가 좁힙니다.",
  nl: "Het bereik `Owned` beperkt elke resource met eigenaren.",
  no: "Omfanget `Owned` snevrer inn alle ressurser med eiere.",
  pt: "O escopo `Owned` restringe todo recurso que tem proprietários.",
  ru: "Область `Owned` сужает каждый ресурс, у которого есть владельцы.",
  sv: "Omfattningen `Owned` begränsar varje resurs som har ägare.",
  "zh-CN": "每个有所有者的资源都受 `Owned` 范围收窄。",
  "zh-TW": "每個有擁有者的資源都受 `Owned` 範圍收窄。",
};

// The note it follows: adding and removing owners keeps to the Owned scope.
const PREVIOUS_NOTE_LEAD: string =
  "Adding and removing owners keeps to the `Owned` scope.";

// The inline code the note names, in every language.
const NOTE_CODE: Array<string> = [
  "`Owned`",
  "`MonitorAdmin`",
  "`OnCallMember`",
  "`ProjectMember`",
];

/*
 * The kinds the English pages name, by the registry's key: the ones the
 * upgrade note says have owners too, and the ones read in full.
 */
const NAMED_KINDS: Record<string, string> = {
  MonitorGroup: "Monitor groups",
  OnCallDutyPolicySchedule: "on-call schedules",
  AlertEpisode: "alert and incident episodes",
  IncidentEpisode: "alert and incident episodes",
  IncomingCallPolicy: "incoming call policies",
  IncidentTemplate: "incident and maintenance templates",
  ScheduledMaintenanceTemplate: "incident and maintenance templates",
  Probe: "probes",
  Runner: "Runners",
  AIAgent: "AI agents",
};

// The kinds the pages say are read in full, by the registry's key.
const READ_IN_FULL: Array<string> = [
  "Probe",
  "Runner",
  "AIAgent",
  "OnCallDutyPolicySchedule",
  "IncidentTemplate",
  "ScheduledMaintenanceTemplate",
];

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// The line of a page that opens with `lead`; exactly one.
function lineOpening(page: string, lead: string): string {
  const lines: Array<string> = page.split("\n").filter((line: string) => {
    return line.startsWith(lead);
  });

  expect([lead, lines.length]).toEqual([lead, 1]);

  return lines[0]!;
}

describe("Docs: the Owned scope narrows every resource with owners", () => {
  test("every docs language is checked, each in its own words", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const words of [
      OWNED_PARAGRAPH_LEAD,
      OWNED_PARAGRAPH_SAYS,
      NOTE_LEAD,
    ]) {
      expect(Object.keys(words).sort()).toEqual([...LANGUAGES].sort());
    }
  });

  test.each(LANGUAGES)(
    "%s: Users, Teams & Permissions says the Owned scope narrows every resource with owners, and what it still reads in full",
    (language: string) => {
      const page: string = read(language, "permissions/index.md");
      const paragraph: string = lineOpening(
        page,
        OWNED_PARAGRAPH_LEAD[language]!,
      );

      for (const words of OWNED_PARAGRAPH_SAYS[language]!) {
        expect([language, words, paragraph.includes(words)]).toEqual([
          language,
          words,
          true,
        ]);
      }

      // On the English page's line, so the two lie side by side.
      expect([language, page.split("\n").indexOf(paragraph)]).toEqual([
        language,
        read("en", "permissions/index.md")
          .split("\n")
          .findIndex((line: string): boolean => {
            return line.startsWith(OWNED_PARAGRAPH_LEAD["en"]!);
          }),
      ]);

      // Translated: none of the English sentences is left in English.
      if (language !== "en") {
        for (const english of OWNED_PARAGRAPH_SAYS["en"]!) {
          expect([language, page.includes(english)]).toEqual([language, false]);
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the on-call recipe makes the team the owner of its on-call policies and schedules too",
    (language: string) => {
      const english: string = lineOpening(
        read("en", "permissions/index.md"),
        "**On-call engineers who manage their own services.**",
      );

      expect(english).toContain(
        "then add the team as owner of the monitors, on-call policies and schedules it runs. Whatever its people create with these permissions, they own already.",
      );

      const englishLine: number = read("en", "permissions/index.md")
        .split("\n")
        .indexOf(english);
      const translated: string = read(language, "permissions/index.md").split(
        "\n",
      )[englishLine]!;

      // The same roles, and two sentences after its lead, as in English.
      for (const code of [
        "`MonitorAdmin`",
        "`IncidentMember`",
        "`OnCallMember`",
      ]) {
        expect([language, code, countOf(translated, code)]).toEqual([
          language,
          code,
          1,
        ]);
      }

      expect([language, translated.length > english.length * 0.4]).toEqual([
        language,
        true,
      ]);
    },
  );

  test("in English the upgrade note says what changes, right after the note on adding and removing owners", () => {
    const items: Array<string> = otherChangesItems("en");
    const note: string = otherChangesItemAtEnglishPlace("en", NOTE_LEAD["en"]!);
    const previous: string = otherChangesItemAtEnglishPlace(
      "en",
      PREVIOUS_NOTE_LEAD,
    );

    expect(items.indexOf(note)).toBe(items.indexOf(previous) + 1);

    const flat: string = note.replace(WHITESPACE, " ");

    for (const sentence of [
      "Monitor groups, on-call schedules, alert and incident episodes, incoming call policies, incident and maintenance templates, probes, Runners and AI agents have owners too, and a permission scoped to `Owned` - such as `MonitorAdmin`, `OnCallMember` or `ProjectMember` - now changes and deletes only the ones its people or their teams own, and adds and removes owners only on those.",
      "What belongs to one goes with it: a schedule's layers, the people in them and its shared calendar link, an incoming call policy's escalation rules, an episode's notes, state changes and role members, and the monitors in a monitor group.",
      "Incidents and alerts are added to an episode, one or many at a time, only where the person or their team owns them.",
      "Monitor groups, episodes and incoming call policies are also read only where owned; probes, Runners, AI agents, on-call schedules and templates are still read in full, so they can be picked - all but a Runner's key, which shows only where owned.",
      "Someone who creates one of them with a permission scoped to `Owned` is made its owner; one that nobody owns is changed only by a permission over the whole project, so make your teams the owners of the ones they look after - an episode a grouping rule opens takes the rule's episode owners.",
      "See [Users, Teams & Permissions](/docs/permissions/index).",
    ]) {
      expect([sentence, flat.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the note in the English note's place, under its own lead",
    (language: string) => {
      const items: Array<string> = otherChangesItems(language);
      const note: string = otherChangesItemAtEnglishPlace(
        language,
        NOTE_LEAD["en"]!,
      );
      const previous: string = otherChangesItemAtEnglishPlace(
        language,
        PREVIOUS_NOTE_LEAD,
      );

      expect([language, items.indexOf(note)]).toEqual([
        language,
        items.indexOf(previous) + 1,
      ]);
      expect([
        language,
        note.startsWith(`- **${NOTE_LEAD[language]!}** `),
      ]).toEqual([language, true]);
      expect([language, note.includes(NOTE_LEAD["en"]!)]).toEqual([
        language,
        false,
      ]);

      // The same code, as often as the English note names it.
      const english: string = otherChangesItemAtEnglishPlace(
        "en",
        NOTE_LEAD["en"]!,
      );

      for (const code of NOTE_CODE) {
        expect([language, code, countOf(note, code)]).toEqual([
          language,
          code,
          countOf(english, code),
        ]);
      }

      expect([language, note.includes("](/docs/permissions/index)")]).toEqual([
        language,
        true,
      ]);
    },
  );
});

/*
 * What the pages claim, held to the product: every kind they name has owners
 * the Owned scope reads (the owner registry), every kind with owner tables
 * is one of the registry's, and the kinds read in full are exactly the ones
 * the registry lets every reader read - and so are a schedule's layers.
 */
describe("what the docs say holds in the product", () => {
  type ModelType = { new (): BaseModel };

  const modelNamed: (name: string) => ModelType = (name: string): ModelType => {
    const modelType: ModelType | undefined = (
      AllModelTypes as Array<ModelType>
    ).find((each: ModelType): boolean => {
      return each.name === name;
    });

    expect([name, Boolean(modelType)]).toEqual([name, true]);

    return modelType!;
  };

  test("every kind the upgrade note names is one the Owned scope narrows, named as the note names it", () => {
    const note: string = otherChangesItemAtEnglishPlace(
      "en",
      NOTE_LEAD["en"]!,
    ).replace(WHITESPACE, " ");

    for (const [kind, words] of Object.entries(NAMED_KINDS)) {
      expect([kind, OwnerTableRegistry.has(kind)]).toEqual([kind, true]);
      expect([kind, note.includes(words)]).toEqual([kind, true]);
    }
  });

  test("every kind with owner tables is in the registry the Owned scope reads", () => {
    const kinds: Set<string> = new Set<string>();

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const tableName: string = new modelType().tableName || "";
      const match: RegExpExecArray | null = OWNER_TABLE_NAME.exec(tableName);

      if (match) {
        kinds.add(match[1]!);
      }
    }

    expect(kinds.size).toBeGreaterThanOrEqual(37);

    for (const kind of kinds) {
      expect([kind, OwnerTableRegistry.has(kind)]).toEqual([kind, true]);
    }
  });

  test("the kinds read in full are exactly the ones the registry lets every reader read, and so are a schedule's layers", () => {
    const flagged: Array<string> = Array.from(OwnerTableRegistry.entries())
      .filter(([, pair]: [string, OwnerTablePair]): boolean => {
        return Boolean(pair.ownedScopeLeavesReads);
      })
      .map(([kind]: [string, OwnerTablePair]): string => {
        return kind;
      });

    expect(flagged.sort()).toEqual([...READ_IN_FULL].sort());

    for (const kind of READ_IN_FULL) {
      expect([
        kind,
        OwnedScopePermission.leavesReadsAlone(modelNamed(kind)),
      ]).toEqual([kind, true]);
    }

    // The ones the note says are read only where owned.
    for (const kind of [
      "MonitorGroup",
      "AlertEpisode",
      "IncidentEpisode",
      "IncomingCallPolicy",
    ]) {
      expect([
        kind,
        OwnedScopePermission.leavesReadsAlone(modelNamed(kind)),
      ]).toEqual([kind, false]);
    }

    // What belongs to one goes with it: a schedule's layers and shared link.
    for (const part of [
      "OnCallDutyPolicyScheduleLayer",
      "OnCallDutyPolicyScheduleLayerUser",
      "OnCallDutyPolicyScheduleCalendarFeed",
    ]) {
      expect([
        part,
        OwnedScopePermission.getOwnedThrough(modelNamed(part))?.parentModels,
        OwnedScopePermission.leavesReadsAlone(modelNamed(part)),
      ]).toEqual([part, [modelNamed("OnCallDutyPolicySchedule")], true]);
    }

    for (const [part, kind] of [
      ["IncomingCallPolicyEscalationRule", "IncomingCallPolicy"],
      // The monitors in a monitor group go with the group.
      ["MonitorGroupResource", "MonitorGroup"],
      // An incident or an alert goes into an episode as its own owners'.
      ["IncidentEpisodeMember", "Incident"],
      ["AlertEpisodeMember", "Alert"],
      ["IncidentEpisodeRoleMember", "IncidentEpisode"],
      ["IncidentEpisodeInternalNote", "IncidentEpisode"],
      ["IncidentEpisodePublicNote", "IncidentEpisode"],
      ["IncidentEpisodeStateTimeline", "IncidentEpisode"],
      ["AlertEpisodeInternalNote", "AlertEpisode"],
      ["AlertEpisodeStateTimeline", "AlertEpisode"],
    ] as Array<[string, string]>) {
      expect([
        part,
        OwnedScopePermission.getOwnedThrough(modelNamed(part))?.parentModels,
      ]).toEqual([part, [modelNamed(kind)]]);
    }
  });

  test("a Runner's key shows only where owned: it is the one column of a kind read in full that follows the owners", () => {
    const runner: ModelType = modelNamed("Runner");
    const projectId: ObjectID = ObjectID.generate();

    const ownedRunbookAdmin: DatabaseCommonInteractionProps = {
      userId: ObjectID.generate(),
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.RunbookAdmin,
              labelIds: [],
              isBlockPermission: false,
              scope: PermissionScope.Owned,
            },
          ],
        },
      },
    };

    expect(OwnedScopePermission.leavesReadsAlone(runner)).toBe(true);
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(runner, ownedRunbookAdmin),
    ).toEqual(["key"]);

    for (const kind of READ_IN_FULL.filter((name: string): boolean => {
      return name !== "Runner";
    })) {
      expect([
        kind,
        OwnedScopePermission.getColumnsKeptToOwners(
          modelNamed(kind),
          ownedRunbookAdmin,
        ),
      ]).toEqual([kind, []]);
    }
  });

  test("an episode a grouping rule opens takes the rule's episode owners: both grouping rules name them", () => {
    for (const rule of ["IncidentGroupingRule", "AlertGroupingRule"]) {
      const model: BaseModel = new (modelNamed(rule))();

      for (const column of ["episodeOwnerUsers", "episodeOwnerTeams"]) {
        expect([
          rule,
          column,
          Boolean(model.getTableColumnMetadata(column)),
        ]).toEqual([rule, column, true]);
      }
    }
  });
});
