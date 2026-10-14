import {
  MITRE_ATTACK_VERSION,
  MITRE_REVOKED_TECHNIQUES,
  MITRE_TACTICS,
  MITRE_TACTIC_SHORT_NAMES,
  MITRE_TACTIC_TECHNIQUES,
  MITRE_TECHNIQUES,
  MitreTactic,
  MitreTechnique,
  describeMitreId,
  getMitreTactic,
  getMitreTechnique,
  resolveMitreTacticId,
  resolveMitreTechniqueId,
} from "../../../Types/SecurityEvent/MitreAttack";
import { describe, expect, test } from "@jest/globals";

/*
 * The ATT&CK data the coverage view and the Sigma parser read. The counts
 * are the ones attack.mitre.org states on each tactic's page for v20, so a
 * technique dropped or doubled while editing the lists fails here.
 */

const STATED_TECHNIQUE_COUNTS: Record<string, number> = {
  TA0043: 12,
  TA0042: 9,
  TA0001: 11,
  TA0002: 22,
  TA0003: 22,
  TA0004: 13,
  TA0005: 31,
  TA0112: 18,
  TA0006: 18,
  TA0007: 34,
  TA0008: 9,
  TA0009: 17,
  TA0011: 18,
  TA0010: 10,
  TA0040: 15,
};

describe("MITRE ATT&CK data", () => {
  test("is version 20, with its fifteen tactics in matrix order", () => {
    expect(MITRE_ATTACK_VERSION).toBe("20");
    expect(
      MITRE_TACTICS.map((tactic: MitreTactic): string => {
        return tactic.name;
      }),
    ).toEqual([
      "Reconnaissance",
      "Resource Development",
      "Initial Access",
      "Execution",
      "Persistence",
      "Privilege Escalation",
      "Stealth",
      "Defense Impairment",
      "Credential Access",
      "Discovery",
      "Lateral Movement",
      "Collection",
      "Command and Control",
      "Exfiltration",
      "Impact",
    ]);
  });

  test("every tactic lists exactly the techniques its page counts", () => {
    for (const tactic of MITRE_TACTICS) {
      expect({
        tactic: tactic.id,
        count: (MITRE_TACTIC_TECHNIQUES[tactic.id] || []).length,
      }).toEqual({
        tactic: tactic.id,
        count: STATED_TECHNIQUE_COUNTS[tactic.id],
      });
    }
  });

  test("has 227 distinct parent techniques, each named the same in every column", () => {
    expect(MITRE_TECHNIQUES).toHaveLength(227);

    const names: Map<string, string> = new Map();

    for (const tactic of MITRE_TACTICS) {
      for (const [id, name] of MITRE_TACTIC_TECHNIQUES[tactic.id] || []) {
        expect(id).toMatch(/^T\d{4}$/);
        const known: string | undefined = names.get(id);
        if (known) {
          expect(name).toBe(known);
        }
        names.set(id, name);
      }
    }
  });

  test("a technique that serves several tactics carries all of them, in matrix order", () => {
    const validAccounts: MitreTechnique | undefined =
      getMitreTechnique("T1078");

    expect(validAccounts?.name).toBe("Valid Accounts");
    expect(validAccounts?.tacticIds).toEqual([
      "TA0001",
      "TA0003",
      "TA0004",
      "TA0005",
    ]);
  });

  test("tactic short names cover every tactic, with defense_evasion read as Stealth", () => {
    const covered: Set<string> = new Set(
      Object.values(MITRE_TACTIC_SHORT_NAMES),
    );

    for (const tactic of MITRE_TACTICS) {
      expect(covered.has(tactic.id)).toBe(true);
    }

    expect(resolveMitreTacticId("defense_evasion")).toBe("TA0005");
    expect(getMitreTactic("TA0005")?.name).toBe("Stealth");
  });

  test("resolves tactic ids and names in the spellings rules use", () => {
    expect(resolveMitreTacticId("ta0006")).toBe("TA0006");
    expect(resolveMitreTacticId("credential_access")).toBe("TA0006");
    expect(resolveMitreTacticId("credential-access")).toBe("TA0006");
    expect(resolveMitreTacticId("Credential Access")).toBe("TA0006");
    expect(resolveMitreTacticId("command_and_control")).toBe("TA0011");
    expect(resolveMitreTacticId("defense_impairment")).toBe("TA0112");
    expect(resolveMitreTacticId("t1110")).toBeUndefined();
    expect(resolveMitreTacticId("not_a_tactic")).toBeUndefined();
    expect(resolveMitreTacticId("")).toBeUndefined();
    // Object.prototype keys are not tactics.
    expect(resolveMitreTacticId("constructor")).toBeUndefined();
  });

  test("rolls sub-techniques up to their parent and revoked ids onto their replacement", () => {
    expect(resolveMitreTechniqueId("t1110.003")).toBe("T1110");
    expect(resolveMitreTechniqueId("T1110")).toBe("T1110");
    expect(resolveMitreTechniqueId("T1562")).toBe("T1685");
    expect(resolveMitreTechniqueId("T1562.001")).toBe("T1685");
    expect(resolveMitreTechniqueId("T1562.004")).toBe("T1686");
    expect(resolveMitreTechniqueId("T1562.003")).toBe("T1690");
    // An old sub-technique the table does not list falls back to the parent's replacement.
    expect(resolveMitreTechniqueId("T1562.099")).toBe("T1685");
    expect(resolveMitreTechniqueId("T9999")).toBeUndefined();
    expect(resolveMitreTechniqueId("")).toBeUndefined();
  });

  test("every replacement in the revoked table is a technique of this version", () => {
    for (const replacement of Object.values(MITRE_REVOKED_TECHNIQUES)) {
      expect(getMitreTechnique(replacement)?.id).toBe(replacement);
    }
  });

  test("describes ids for people, keeping unknown ones as they are", () => {
    expect(describeMitreId("TA0006")).toBe("TA0006 Credential Access");
    expect(describeMitreId("T1110")).toBe("T1110 Brute Force");
    expect(describeMitreId("t1110.003")).toBe("T1110.003 Brute Force");
    expect(describeMitreId("T9999")).toBe("T9999");
    expect(describeMitreId("TA9999")).toBe("TA9999");
  });
});
