import { describe, expect, test } from "@jest/globals";
import {
  getIndefiniteArticle,
  toSentenceCaseName,
  withIndefiniteArticle,
} from "../../../Utils/DeveloperDocs/ExampleValues";

/*
 * The Developer pages build sentences around a resource's name ("Create an
 * incident", "Creates an on-call policy"). The page in the maintainer's
 * screenshot said "Create a incident": the article must follow the sound of
 * the name, not just its first letter.
 */

describe("indefinite articles", () => {
  test.each([
    ["incident", "an incident"],
    ["alert", "an alert"],
    ["announcement", "an announcement"],
    ["on-call policy", "an on-call policy"],
    ["on-call schedule", "an on-call schedule"],
    ["incoming call policy", "an incoming call policy"],
    ["inventory item", "an inventory item"],
    ["escalation rule", "an escalation rule"],
    ["uptime check", "an uptime check"],
  ])("a vowel sound takes an: %s", (noun: string, expected: string) => {
    expect(withIndefiniteArticle(noun)).toBe(expected);
  });

  test.each([
    ["monitor", "a monitor"],
    ["status page", "a status page"],
    ["scheduled maintenance event", "a scheduled maintenance event"],
    ["team", "a team"],
    ["workflow", "a workflow"],
    ["Kubernetes cluster", "a Kubernetes cluster"],
    ["Docker host", "a Docker host"],
  ])("a consonant sound takes a: %s", (noun: string, expected: string) => {
    expect(withIndefiniteArticle(noun)).toBe(expected);
  });

  test.each([
    ["user", "a user"],
    ["unique name", "a unique name"],
    ["unit", "a unit"],
    ["URL", "a URL"],
    ["one-off job", "a one-off job"],
  ])(
    "a vowel letter with a consonant sound takes a: %s",
    (noun: string, expected: string) => {
      expect(withIndefiniteArticle(noun)).toBe(expected);
    },
  );

  test.each([
    ["SLO", "an SLO"],
    ["SSL certificate", "an SSL certificate"],
    ["HTTP monitor", "an HTTP monitor"],
    ["MCP tool", "an MCP tool"],
    ["AI insight", "an AI insight"],
    ["API key", "an API key"],
    ["IoT fleet", "an IoT fleet"],
    ["DNS record", "a DNS record"],
    ["TLS certificate", "a TLS certificate"],
    ["vCenter", "a vCenter"],
  ])(
    "an acronym read letter by letter goes by the name of its first letter: %s",
    (noun: string, expected: string) => {
      expect(withIndefiniteArticle(noun)).toBe(expected);
    },
  );

  test("an acronym read as a word goes by its sound", () => {
    expect(withIndefiniteArticle("RUM application")).toBe("a RUM application");
    expect(getIndefiniteArticle("SAML provider")).toBe("a");
  });

  test("every name a Developer page uses reads right in a sentence", () => {
    const names: Array<[string, string]> = [
      ["Incident", "an incident"],
      ["Incident Episode", "an incident episode"],
      ["Alert Episode", "an alert episode"],
      ["On-Call Policy", "an on-call policy"],
      ["SLO", "an SLO"],
      ["IoT Fleet", "an IoT fleet"],
      ["RUM Application", "a RUM application"],
      ["vCenter", "a vCenter"],
      ["Inventory Item", "an inventory item"],
      ["Scheduled Maintenance Event", "a scheduled maintenance event"],
    ];

    for (const [name, expected] of names) {
      expect(withIndefiniteArticle(toSentenceCaseName(name))).toBe(expected);
    }
  });

  test("an empty phrase does not throw", () => {
    expect(getIndefiniteArticle("")).toBe("a");
    expect(getIndefiniteArticle("   ")).toBe("a");
  });
});
