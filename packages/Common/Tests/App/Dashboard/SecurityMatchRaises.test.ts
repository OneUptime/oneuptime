import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_MATCH_RAISES_ANSWERS,
  SECURITY_MATCH_RAISES_COLUMNS,
  SecurityMatchRaises,
  TaxiiSignIn,
  getDetectionRuleNameAfterYamlChange,
  getSecurityMatchRaises,
  getSigmaRuleTitle,
  getTaxiiSignIn,
  getValuesForSecurityMatchRaises,
  isSecurityMatchRaises,
  raisesAlert,
  raisesIncident,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityMatchRaises";
import { DETECTION_RULE_LIBRARY } from "../../../Types/SecurityEvent/DetectionRuleLibrary";

/*
 * What a security match raises (SecurityMatchRaises): one choice of four
 * over a detection rule's or threat intel feed's two columns, read the way
 * the evaluators read them; a detection rule's name from its Sigma rule's
 * title; and how a TAXII feed signs in.
 */

describe("what a match raises", () => {
  test("every answer writes both columns, and reads back as itself", () => {
    for (const raises of SECURITY_MATCH_RAISES_ANSWERS) {
      const values: Record<string, unknown> = getValuesForSecurityMatchRaises({
        values: { name: "Rule" },
        raises: raises,
      });

      expect(values).toEqual({
        name: "Rule",
        ...SECURITY_MATCH_RAISES_COLUMNS[raises],
      });
      expect(getSecurityMatchRaises(values)).toBe(raises);
    }
  });

  test("columns left out read as the evaluators read them: an alert, no incident", () => {
    expect(getSecurityMatchRaises({})).toBe(SecurityMatchRaises.Alert);
    expect(getSecurityMatchRaises({ shouldCreateAlert: null })).toBe(
      SecurityMatchRaises.Alert,
    );
    expect(getSecurityMatchRaises({ shouldCreateIncident: null })).toBe(
      SecurityMatchRaises.Alert,
    );
    expect(raisesAlert({})).toBe(true);
    expect(raisesIncident({})).toBe(false);
  });

  test("the default comes first, and Neither is an answer: a library rule starts there", () => {
    expect(SECURITY_MATCH_RAISES_ANSWERS[0]).toBe(SecurityMatchRaises.Alert);
    expect(
      getSecurityMatchRaises({
        shouldCreateAlert: false,
        shouldCreateIncident: false,
      }),
    ).toBe(SecurityMatchRaises.Neither);
  });

  test("only the four answers are answers", () => {
    expect(isSecurityMatchRaises("both")).toBe(true);
    expect(isSecurityMatchRaises("page")).toBe(false);
    expect(isSecurityMatchRaises(undefined)).toBe(false);
  });
});

describe("a detection rule's name, from its Sigma rule's title", () => {
  test("reads the top-level title, unquoted, without a trailing comment", () => {
    expect(getSigmaRuleTitle("title: Failed logon burst\nid: 1")).toBe(
      "Failed logon burst",
    );
    expect(getSigmaRuleTitle("title: 'Password spraying'")).toBe(
      "Password spraying",
    );
    expect(getSigmaRuleTitle('title: "MFA push fatigue"  # noisy')).toBe(
      "MFA push fatigue",
    );
    expect(getSigmaRuleTitle("title: Windows line\r\nid: 2")).toBe(
      "Windows line",
    );
  });

  test("an indented title belongs to something else, and no title is no name", () => {
    expect(
      getSigmaRuleTitle("detection:\n  title: not the rule's\ncondition: x"),
    ).toBe("");
    expect(getSigmaRuleTitle("logsource:\n  category: auth")).toBe("");
    expect(getSigmaRuleTitle(undefined)).toBe("");
  });

  test("every Rule Library rule is named after its YAML's title", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      expect({
        entry: entry.title,
        title: getSigmaRuleTitle(entry.sigmaRuleYaml),
      }).toEqual({ entry: entry.title, title: entry.title });
    }
  });

  test("the name follows the title until a name of one's own is typed", () => {
    expect(
      getDetectionRuleNameAfterYamlChange({
        name: "",
        previousYaml: "",
        nextYaml: "title: A",
      }),
    ).toBe("A");
    expect(
      getDetectionRuleNameAfterYamlChange({
        name: "A",
        previousYaml: "title: A",
        nextYaml: "title: B",
      }),
    ).toBe("B");
    expect(
      getDetectionRuleNameAfterYamlChange({
        name: "Mine",
        previousYaml: "title: A",
        nextYaml: "title: B",
      }),
    ).toBeNull();
    // Unchanged, or no title yet: nothing to do.
    expect(
      getDetectionRuleNameAfterYamlChange({
        name: "A",
        previousYaml: "title: A",
        nextYaml: "title: A\nid: 1",
      }),
    ).toBeNull();
    expect(
      getDetectionRuleNameAfterYamlChange({
        name: "",
        previousYaml: "",
        nextYaml: "logsource:",
      }),
    ).toBeNull();
  });

  test("reads a long rule line by line", () => {
    const long: string = `${"x: y\n".repeat(20000)}title: Last`;

    expect(getSigmaRuleTitle(long)).toBe("Last");
  });
});

describe("how a TAXII feed signs in", () => {
  test("the answer a form picked, or none where no form asks", () => {
    expect(getTaxiiSignIn({ taxiiSignIn: "api-token" })).toBe(
      TaxiiSignIn.ApiToken,
    );
    expect(getTaxiiSignIn({ taxiiSignIn: "basic-auth" })).toBe(
      TaxiiSignIn.BasicAuth,
    );
    expect(getTaxiiSignIn({})).toBeNull();
    expect(getTaxiiSignIn({ taxiiSignIn: "oauth" })).toBeNull();
  });
});
