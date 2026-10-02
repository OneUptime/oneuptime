import { describe, expect, test } from "@jest/globals";
import {
  AI_ACCESS_FIXES_ROW_TITLE,
  AI_ACCESS_INVESTIGATION_ROW_TITLE,
  AI_ACCESS_PROTECTIONS_TITLE,
  AI_FIXES_MODE_ICONS,
  AI_FIXES_MODE_TONES,
  AiAccessBadge,
  AiFixesMode,
  formatAiAccessProtections,
  getAiAccessCardDescription,
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

  test("each has its own tone, and the tones rise with how much runs unasked", () => {
    expect(
      MODES_BY_AUTONOMY.map((mode: AiFixesMode): string => {
        return AI_FIXES_MODE_TONES[mode];
      }),
    ).toEqual(["off", "on", "automatic", "bypass"]);
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
  });
});
