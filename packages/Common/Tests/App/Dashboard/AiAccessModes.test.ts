import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import {
  AGENT_AI_SETTINGS_COMMANDS_TITLE,
  AGENT_AI_SETTINGS_DIALOG_INTRO,
  AGENT_AI_SETTINGS_DONE_TEXT,
  AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS,
  AI_ACCESS_FIXES_ROW_TITLE,
  AI_ACCESS_INVESTIGATION_ROW_TITLE,
  AI_ACCESS_PROTECTIONS_TITLE,
  AI_FIXES_MODE_ICONS,
  AI_FIXES_MODE_TONES,
  AI_FIXES_OFF_AGENT_SET_HINT,
  AiAccessBadge,
  AiFixesMode,
  readAiSettingsSource,
  capitalizeFirst,
  formatAiAccessProtections,
  formatNameList,
  getAiAccessCardDescription,
  getAiAccessLooseningRefusal,
  getAiAccessTestPermissionMessage,
  getAiAccessTestPermissionRequirement,
  getAiFixesBadge,
  getAiFixesFieldDescription,
  getAiFixesModeCardTitle,
  getAiFixesOffHint,
  getAiInvestigationBadge,
  getAiInvestigationOffSentence,
  joinAiAccessProtections,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { RESOURCE_REMEDIATION_MODE_SHORT_NAMES } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessSettingsUtil";
import { REMEDIATION_MODE_SHORT_NAMES } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import IconProp from "../../../Types/Icon/IconProp";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

/*
 * The words and looks "What AI may do" shares between a Kubernetes
 * cluster's AI agent page and every other resource's: the two rows, the
 * badge each shows, the hint under Fixes while fixes are Off, the mode
 * cards in the Change modal and the every-mode protections.
 */

const MODES_BY_AUTONOMY: Array<AiFixesMode> = [
  "Disabled",
  "RequireApproval",
  "Automatic",
  "BypassApproval",
];

describe("the fixes modes", () => {
  /*
   * Both pages hand their own enum to the shared helpers. They must stay
   * the same four values, or a mode would read with no tone or icon.
   */
  test("are the same four values on a resource and on a Kubernetes cluster", () => {
    expect([...Object.values(ResourceAiRemediationMode)].sort()).toEqual(
      [...MODES_BY_AUTONOMY].sort(),
    );
    expect([...Object.values(KubernetesAiRemediationMode)].sort()).toEqual(
      [...MODES_BY_AUTONOMY].sort(),
    );
  });

  /*
   * "When fixes are enabled, why does it show in yellow? That makes me
   * think that fixes are not enabled." A badge says whether a setting is
   * on: every on mode reads on, and what each does is in its words and its
   * icon — never a warning colour.
   */
  test("Off reads off, and every mode that applies fixes reads on", () => {
    expect(
      MODES_BY_AUTONOMY.map((mode: AiFixesMode): string => {
        return AI_FIXES_MODE_TONES[mode];
      }),
    ).toEqual(["off", "on", "on", "on"]);
  });

  test("Bypass approval reads on, like Ask for approval: its words say the rest", () => {
    expect(
      getAiFixesBadge({
        mode: "BypassApproval",
        shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
      }),
    ).toEqual({ text: "Bypass approval", tone: "on" });
    expect(
      getAiFixesBadge({
        mode: "Automatic",
        shortNames: REMEDIATION_MODE_SHORT_NAMES,
      }).tone,
    ).toBe(getAiInvestigationBadge(true).tone);
  });

  test("each has its own icon, and every icon is a real one", () => {
    const icons: Array<IconProp> = MODES_BY_AUTONOMY.map(
      (mode: AiFixesMode): IconProp => {
        return AI_FIXES_MODE_ICONS[mode];
      },
    );

    expect(new Set(icons).size).toBe(icons.length);
    for (const icon of icons) {
      expect(Object.values(IconProp)).toContain(icon);
    }
  });
});

describe("the badges", () => {
  test("investigation reads On or Off", () => {
    expect(getAiInvestigationBadge(true)).toEqual({ text: "On", tone: "on" });
    expect(getAiInvestigationBadge(false)).toEqual({
      text: "Off",
      tone: "off",
    });
  });

  test.each(MODES_BY_AUTONOMY)(
    "fixes in %s reads the mode's short name, in the mode's tone",
    (mode: AiFixesMode) => {
      const badge: AiAccessBadge = getAiFixesBadge({
        mode,
        shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
      });

      expect(badge.text).toBe(
        RESOURCE_REMEDIATION_MODE_SHORT_NAMES[
          mode as ResourceAiRemediationMode
        ],
      );
      expect(badge.tone).toBe(AI_FIXES_MODE_TONES[mode]);
    },
  );

  test("a Kubernetes cluster's badge reads the same as a resource's", () => {
    for (const mode of MODES_BY_AUTONOMY) {
      expect(
        getAiFixesBadge({ mode, shortNames: REMEDIATION_MODE_SHORT_NAMES }),
      ).toEqual(
        getAiFixesBadge({
          mode,
          shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
        }),
      );
    }
  });

  test("Off reads Off on both rows, so the two never disagree", () => {
    expect(getAiInvestigationBadge(false).text).toBe(
      getAiFixesBadge({
        mode: "Disabled",
        shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
      }).text,
    );
  });
});

describe("the card's words", () => {
  test("the rows are Investigation and Fixes, the words the docs use", () => {
    expect(AI_ACCESS_INVESTIGATION_ROW_TITLE).toBe("Investigation");
    expect(AI_ACCESS_FIXES_ROW_TITLE).toBe("Fixes");
  });

  test("the description names the place and when a change takes effect", () => {
    expect(getAiAccessCardDescription("database server")).toBe(
      "For incidents and alerts on this database server. Changes apply from the next one.",
    );
    expect(getAiAccessCardDescription("cluster")).toBe(
      "For incidents and alerts on this cluster. Changes apply from the next one.",
    );
  });

  /*
   * Off is not "AI does nothing", and it is not "No — AI investigates":
   * it runs nothing on the place, and still investigates with what
   * OneUptime has.
   */
  test("investigation off says what AI does not do, and what it still does", () => {
    const sentence: string = getAiInvestigationOffSentence("database server");

    expect(sentence).toBe(
      "AI does not run commands on this database server. It still investigates with the data OneUptime already has.",
    );
    expect(sentence).not.toMatch(/^No\b/);
    expect(sentence).not.toContain("—");
  });
});

describe("the hint under Fixes while fixes are Off", () => {
  test("someone who may turn fixes on is told where", () => {
    expect(getAiFixesOffHint(true)).toBe(
      "Want AI to propose fixes? Click Change and choose Ask for approval.",
    );
  });

  test("everyone else is told who to ask, and not to click a button they cannot use", () => {
    const hint: string = getAiFixesOffHint(false);

    expect(hint).toBe(
      "Want AI to propose fixes? Ask a project owner or admin to choose Ask for approval.",
    );
    expect(hint).not.toContain("Click Change");
  });

  test("both name the mode to choose by its short name", () => {
    for (const canTurnOn of [true, false]) {
      expect(getAiFixesOffHint(canTurnOn)).toContain(
        RESOURCE_REMEDIATION_MODE_SHORT_NAMES[
          ResourceAiRemediationMode.RequireApproval
        ],
      );
    }
  });
});

describe("the Change modal's mode cards", () => {
  test("the field says what the choice is about", () => {
    expect(getAiFixesFieldDescription("Docker host")).toBe(
      "What AI does when it finds a fix for a problem on this Docker host.",
    );
  });

  test("only the saved mode's card is marked current", () => {
    const titles: Array<string> = MODES_BY_AUTONOMY.map(
      (mode: AiFixesMode): string => {
        return getAiFixesModeCardTitle({
          mode,
          savedMode: "Automatic",
          shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
        });
      },
    );

    expect(titles).toEqual([
      "Off",
      "Ask for approval",
      "Automatic (current)",
      "Bypass approval",
    ]);
  });

  test("Off is marked current too, when it is what is saved", () => {
    expect(
      getAiFixesModeCardTitle({
        mode: "Disabled",
        savedMode: "Disabled",
        shortNames: REMEDIATION_MODE_SHORT_NAMES,
      }),
    ).toBe("Off (current)");
  });
});

describe("where the settings are set", () => {
  test.each([
    ["agent_configuration", "agent_configuration"],
    ["agent_defaults", "agent_defaults"],
    ["oneuptime", "oneuptime"],
    // An older server sends nothing; an unknown value is no agent's.
    [undefined, "oneuptime"],
    [null, "oneuptime"],
    ["agent", "oneuptime"],
    [42, "oneuptime"],
  ])("%j reads as %s", (value: unknown, expected: string) => {
    expect(readAiSettingsSource(value)).toBe(expected);
  });

  test("the change dialog's intro names the agent for every source", () => {
    for (const intro of Object.values(AGENT_AI_SETTINGS_DIALOG_INTRO)) {
      expect(intro).toContain("{{agent}}");
      expect(intro).toContain("run the command below");
    }
    // Set by the agent: changed there, not here.
    expect(AGENT_AI_SETTINGS_DIALOG_INTRO.agent_configuration).toContain(
      "not on this page",
    );
    // Its defaults: its configuration names neither.
    expect(AGENT_AI_SETTINGS_DIALOG_INTRO.agent_defaults).toContain(
      "sets neither setting",
    );
    // Chosen here: they can move to the agent, and the page then follows.
    expect(AGENT_AI_SETTINGS_DIALOG_INTRO.oneuptime).toContain("read-only");
  });

  test("the investigation choices say what each does", () => {
    expect(AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.on.title).toBe("On");
    expect(AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.on.description).toContain(
      "read-only commands",
    );
    expect(AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.off.title).toBe("Off");
    expect(AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.off.description).toContain(
      "runs no commands",
    );
  });

  test("the fixes-off hint for settings the agent sets sends the reader to Change, for the command", () => {
    expect(AI_FIXES_OFF_AGENT_SET_HINT).toContain("Click Change");
    expect(AI_FIXES_OFF_AGENT_SET_HINT).toContain("command");
    // Never "choose Ask for approval": the page cannot save it.
    expect(AI_FIXES_OFF_AGENT_SET_HINT).not.toContain("choose");
  });
});

describe("the every-mode protections", () => {
  test("are folded under a title that says what they are", () => {
    expect(AI_ACCESS_PROTECTIONS_TITLE).toBe(
      "What stays protected in every mode",
    );
  });

  test("read as list lines: trimmed, capitalized, ending with a full stop", () => {
    expect(
      formatAiAccessProtections([
        " destructive commands never run ",
        "a write in kube-system always needs a human",
      ]),
    ).toEqual([
      "Destructive commands never run.",
      "A write in kube-system always needs a human.",
    ]);
  });

  test("keep their own closing punctuation, and drop blank clauses", () => {
    expect(
      formatAiAccessProtections(["already a sentence.", "", "   ", "why?"]),
    ).toEqual(["Already a sentence.", "Why?"]);
  });

  test("keep a clause's own semicolons: the list is built, never split", () => {
    expect(
      formatAiAccessProtections([
        "destructive commands (deleting namespaces; exec; apply) never run",
      ]),
    ).toEqual([
      "Destructive commands (deleting namespaces; exec; apply) never run.",
    ]);
  });

  test("read as one sentence: a; b; and c", () => {
    expect(joinAiAccessProtections([])).toBe("");
    expect(joinAiAccessProtections(["a"])).toBe("a");
    expect(joinAiAccessProtections(["a", "b"])).toBe("a; and b");
    expect(joinAiAccessProtections(["a", "b", "c"])).toBe("a; b; and c");
    expect(joinAiAccessProtections(["a", "b", "c", "d"])).toBe(
      "a; b; c; and d",
    );
  });

  // Never more than four today: any more are said together as the first.
  test("more than four still read as one sentence", () => {
    expect(joinAiAccessProtections(["a", "b", "c", "d", "e", "f"])).toBe(
      "a; b; c; d; e; and f",
    );
  });

  /*
   * A translated clause ends with its own language's full stop: Chinese
   * and Japanese write 。, Hindi ।. An English clause left in such a
   * locale keeps its full stop.
   */
  test("end with the full stop of the language they are in", () => {
    expect(
      formatAiAccessProtections([
        "破壊的なコマンドは決して実行されません",
        "破坏性命令永远不会运行",
        "विनाशकारी कमांड कभी नहीं चलते",
        "파괴적인 명령은 실행되지 않습니다",
        "destructive commands never run",
      ]),
    ).toEqual([
      "破壊的なコマンドは決して実行されません。",
      "破坏性命令永远不会运行。",
      "विनाशकारी कमांड कभी नहीं चलते।",
      "파괴적인 명령은 실행되지 않습니다.",
      "Destructive commands never run.",
    ]);
  });

  /*
   * Chinese, Japanese, Korean, Hindi and Persian have no capitals: a clause
   * in one that starts with a code name keeps it as it is ("kubectl", not
   * "Kubectl").
   */
  test("a clause in a script without capitals keeps its first letter", () => {
    expect(
      formatAiAccessProtections([
        "kube-system への書き込みには常に人の確認が必要です",
        "kubectl 허용 목록의 패턴은 승인 없이 실행됩니다",
        "kube-system میں لکھنا",
      ]),
    ).toEqual([
      "kube-system への書き込みには常に人の確認が必要です。",
      "kubectl 허용 목록의 패턴은 승인 없이 실행됩니다.",
      "kube-system میں لکھنا.",
    ]);
  });

  test("a clause that already ends with 。, । or ؟ keeps it", () => {
    expect(
      formatAiAccessProtections(["もう文です。", "पहले से वाक्य।", "چرا؟"]),
    ).toEqual(["もう文です。", "पहले से वाक्य।", "چرا؟"]);
  });
});

describe("names in a list", () => {
  test("read the way the copy reads them", () => {
    expect(formatNameList([], "or")).toBe("");
    expect(formatNameList(["kube-system"], "or")).toBe("kube-system");
    expect(formatNameList(["a", "b"], "and")).toBe("a and b");
    expect(formatNameList(["a", "b", "c"], "or")).toBe("a, b or c");
  });

  test("more than three are said together as the first", () => {
    expect(formatNameList(["a", "b", "c", "d"], "or")).toBe("a, b, c or d");
    expect(formatNameList(["a", "b", "c", "d", "e"], "and")).toBe(
      "a, b, c, d and e",
    );
  });

  test("capitalizeFirst capitalizes the first letter only", () => {
    expect(capitalizeFirst("switching fixes to Automatic")).toBe(
      "Switching fixes to Automatic",
    );
    expect(capitalizeFirst("das Umstellen der Korrekturen")).toBe(
      "Das Umstellen der Korrekturen",
    );
    expect(capitalizeFirst("")).toBe("");
  });

  test("capitalizeFirst leaves text in a script without capitals as it is", () => {
    expect(capitalizeFirst("kubectl 允许列表")).toBe("kubectl 允许列表");
    expect(capitalizeFirst("पैटर्न जोड़ना")).toBe("पैटर्न जोड़ना");
  });
});

describe("the sentences both pages share", () => {
  const TITLES: Array<string> = ["Project Owner", "Project Admin"];

  test("why the connection test is locked, and what a refused test says", () => {
    expect(
      getAiAccessTestPermissionRequirement({
        noun: "cluster",
        permissionTitles: TITLES,
      }),
    ).toBe(
      "Testing the connection needs permission to edit this cluster (one of: Project Owner, Project Admin).",
    );
    expect(
      getAiAccessTestPermissionMessage({
        noun: "Docker host",
        permissionTitles: TITLES,
      }),
    ).toBe(
      "Testing the connection needs permission to edit this Docker host (one of: Project Owner, Project Admin). Nothing on the Docker host or in its AI settings was changed.",
    );
  });

  test("a loosening refused names each change, then the permissions", () => {
    expect(
      getAiAccessLooseningRefusal({
        getChanges: (): Array<string> => {
          return ["switching fixes to Automatic", "binding a different Runner"];
        },
        permissionTitles: TITLES,
      }),
    ).toBe(
      "Switching fixes to Automatic, binding a different Runner needs one of these permissions: Project Owner, Project Admin.",
    );
  });

  // Chinese and Japanese list clauses with 、, Persian with ،.
  test("the changes are listed the way their script lists them", () => {
    const refusal: (changes: Array<string>) => string = (
      changes: Array<string>,
    ): string => {
      return getAiAccessLooseningRefusal({
        getChanges: (): Array<string> => {
          return changes;
        },
        permissionTitles: TITLES,
      });
    };

    expect(
      refusal(["修正を「自動」に切り替えること", "別の Runner を紐付けること"]),
    ).toBe(
      "修正を「自動」に切り替えること、別の Runner を紐付けること needs one of these permissions: Project Owner, Project Admin.",
    );
    expect(refusal(["تغییر اصلاح‌ها", "اتصال یک Runner دیگر"])).toBe(
      "تغییر اصلاح‌ها، اتصال یک Runner دیگر needs one of these permissions: Project Owner, Project Admin.",
    );
  });
});

/*
 * Everything here is looked up in the Dashboard's locale files
 * (src/Locales/README.md): a constant or a badge's text is a key, and a
 * function answers with whole keyed sentences. The two rows' words, the
 * card's description, the hint and the mode cards used to be plain strings
 * and template literals that read English in every language.
 *
 * A pseudo-locale wraps every en.json entry in ‹ ›, so what was looked up
 * comes back wrapped, and so does a word or a list put into it. A second
 * one has every entry but a few sentences: a list built from translated
 * pieces then goes into the English sentence in English. These run last:
 * they set up the global i18next instance the functions read.
 */
describe("in the reader's language", () => {
  const ENGLISH: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const LOOKED_UP: RegExp = /^‹[^]*›$/;

  const REFUSAL: string =
    "{{changes}} needs one of these permissions: {{permissions}}.";
  const REFUSED_TEST: string =
    "{{requirement}} Nothing on the {{noun}} or in its AI settings was changed.";

  beforeAll(async () => {
    const pseudo: Record<string, string> = {};

    for (const [key, value] of Object.entries(ENGLISH)) {
      if (typeof value === "string") {
        pseudo[key] = `‹${value}›`;
      }
    }

    const withoutSentences: Record<string, string> = { ...pseudo };
    delete withoutSentences[REFUSAL];
    delete withoutSentences[REFUSED_TEST];

    await i18next.init({
      lng: "xx",
      fallbackLng: "en",
      resources: {
        xx: { translation: pseudo },
        yy: { translation: withoutSentences },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("the constants and the badges' words are keys in en.json", async () => {
    await i18next.changeLanguage("xx");

    for (const key of [
      AI_ACCESS_INVESTIGATION_ROW_TITLE,
      AI_ACCESS_FIXES_ROW_TITLE,
      AI_ACCESS_PROTECTIONS_TITLE,
      AI_FIXES_OFF_AGENT_SET_HINT,
      AGENT_AI_SETTINGS_COMMANDS_TITLE,
      AGENT_AI_SETTINGS_DONE_TEXT,
      ...Object.values(AGENT_AI_SETTINGS_DIALOG_INTRO),
      AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.on.title,
      AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.off.title,
      getAiInvestigationBadge(true).text,
      getAiInvestigationBadge(false).text,
      ...MODES_BY_AUTONOMY.map((mode: AiFixesMode): string => {
        return getAiFixesBadge({
          mode,
          shortNames: REMEDIATION_MODE_SHORT_NAMES,
        }).text;
      }),
    ]) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("the card's description, the off sentence, the hints and the field's help", async () => {
    await i18next.changeLanguage("xx");

    expect(getAiAccessCardDescription("cluster")).toBe(
      "‹For incidents and alerts on this ‹cluster›. Changes apply from the next one.›",
    );
    expect(getAiInvestigationOffSentence("database server")).toMatch(LOOKED_UP);
    expect(getAiFixesOffHint(true)).toBe(
      "‹Want AI to propose fixes? Click Change and choose Ask for approval.›",
    );
    expect(getAiFixesOffHint(false)).toBe(
      "‹Want AI to propose fixes? Ask a project owner or admin to choose Ask for approval.›",
    );
    expect(getAiFixesFieldDescription("Docker host")).toBe(
      "‹What AI does when it finds a fix for a problem on this ‹Docker host›.›",
    );
  });

  test("a mode card's title: the mode's name, and the current one marked", async () => {
    await i18next.changeLanguage("xx");

    expect(
      MODES_BY_AUTONOMY.map((mode: AiFixesMode): string => {
        return getAiFixesModeCardTitle({
          mode,
          savedMode: "Automatic",
          shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
        });
      }),
    ).toEqual([
      "‹Off›",
      "‹Ask for approval›",
      "‹‹Automatic› (current)›",
      "‹Bypass approval›",
    ]);
  });

  test("the protections as one sentence, and names in a list", async () => {
    await i18next.changeLanguage("xx");

    expect(joinAiAccessProtections(["a", "b"])).toBe("‹a; and b›");
    expect(joinAiAccessProtections(["a", "b", "c"])).toBe("‹a; b; and c›");
    expect(joinAiAccessProtections(["a", "b", "c", "d"])).toBe(
      "‹a; b; c; and d›",
    );
    expect(formatNameList(["a", "b"], "or")).toBe("‹a or b›");
    expect(formatNameList(["a", "b", "c"], "and")).toBe("‹a, b and c›");
  });

  test("the shared permission sentences", async () => {
    await i18next.changeLanguage("xx");

    expect(
      getAiAccessTestPermissionMessage({
        noun: "cluster",
        permissionTitles: ["Project Owner"],
      }),
    ).toBe(
      "‹‹Testing the connection needs permission to edit this ‹cluster› (one of: Project Owner).› Nothing on the ‹cluster› or in its AI settings was changed.›",
    );
    expect(
      getAiAccessLooseningRefusal({
        getChanges: (translator: Translator): Array<string> => {
          return [translator.translateTemplate("binding a different Runner")];
        },
        permissionTitles: ["Project Owner"],
      }),
    ).toBe(
      "‹‹binding a different Runner› needs one of these permissions: Project Owner.›",
    );
  });

  /*
   * A language that words the clauses but not the sentence they go into
   * reads one English sentence, never English around translated pieces.
   */
  test("a sentence the reader's language lacks is English, the pieces in it too", async () => {
    await i18next.changeLanguage("yy");

    expect(
      getAiAccessLooseningRefusal({
        getChanges: (translator: Translator): Array<string> => {
          return [translator.translateTemplate("binding a different Runner")];
        },
        permissionTitles: ["Project Owner"],
      }),
    ).toBe(
      "Binding a different Runner needs one of these permissions: Project Owner.",
    );
    expect(
      getAiAccessTestPermissionMessage({
        noun: "cluster",
        permissionTitles: ["Project Owner"],
      }),
    ).toBe(
      "Testing the connection needs permission to edit this cluster (one of: Project Owner). Nothing on the cluster or in its AI settings was changed.",
    );
    // The requirement on its own is still the reader's.
    expect(
      getAiAccessTestPermissionRequirement({
        noun: "cluster",
        permissionTitles: ["Project Owner"],
      }),
    ).toMatch(LOOKED_UP);
  });
});
