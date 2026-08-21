import BadDataException from "../../../Types/Exception/BadDataException";
import SigmaRule, {
  SigmaConditionNode,
  SigmaLevel,
  SigmaSelection,
} from "../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { describe, expect, test } from "@jest/globals";

/*
 * The Sigma parser is the trust boundary of detections-as-code: whatever
 * it accepts, the ClickHouse compiler will faithfully evaluate, and
 * whatever it silently mis-parses becomes a detection that "runs" but
 * never fires. These tests pin the supported grammar — selections,
 * modifiers, the condition expression language — and, just as
 * deliberately, the loud rejection of everything unsupported
 * (aggregations, unknown selections, unknown modifiers).
 */

const BRUTE_FORCE_RULE: string = `
title: Possible Brute Force
id: 6a3050f0-24b8-4b78-97cd-6a1c60b6d4f4
description: Many failed logons from one source.
status: experimental
level: high
tags:
  - attack.credential_access
  - attack.t1110
  - attack.ta0006
logsource:
  product: okta
  category: authentication
detection:
  selection:
    className: Authentication
    statusName: Failure
  filter_internal:
    principalIp|startswith: '10.'
  condition: selection and not filter_internal
`;

describe("SigmaRuleParser.parse", () => {
  test("parses metadata: title, id, description, status, level", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(BRUTE_FORCE_RULE);

    expect(rule.title).toBe("Possible Brute Force");
    expect(rule.id).toBe("6a3050f0-24b8-4b78-97cd-6a1c60b6d4f4");
    expect(rule.description).toBe("Many failed logons from one source.");
    expect(rule.status).toBe("experimental");
    expect(rule.level).toBe(SigmaLevel.High);
    expect(rule.logsource["product"]).toBe("okta");
  });

  test("extracts MITRE tactics and techniques from attack tags, ignoring textual tactic tags", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(BRUTE_FORCE_RULE);

    expect(rule.mitreTechniques).toEqual(["T1110"]);
    expect(rule.mitreTactics).toEqual(["TA0006"]);
  });

  test("supports sub-technique tags like attack.t1110.001", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`
title: Sub-technique
tags:
  - attack.t1110.001
detection:
  selection:
    a: b
  condition: selection
`);

    expect(rule.mitreTechniques).toEqual(["T1110.001"]);
  });

  test("defaults level to medium when absent or unknown", () => {
    const withoutLevel: SigmaRule = SigmaRuleParser.parse(`
title: No level
detection:
  selection:
    a: b
  condition: selection
`);
    expect(withoutLevel.level).toBe(SigmaLevel.Medium);

    const withBogusLevel: SigmaRule = SigmaRuleParser.parse(`
title: Bogus level
level: apocalyptic
detection:
  selection:
    a: b
  condition: selection
`);
    expect(withBogusLevel.level).toBe(SigmaLevel.Medium);
  });

  test("parses a field map selection: fields AND, values list OR", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`
title: Field map
detection:
  selection:
    className: Authentication
    principalUser:
      - alice
      - bob
  condition: selection
`);

    const selection: SigmaSelection = rule.selections[0]!;
    expect(selection.name).toBe("selection");
    expect(selection.fieldMaps).toHaveLength(1);
    expect(selection.fieldMaps[0]).toHaveLength(2);
    expect(selection.fieldMaps[0]![1]!.values).toEqual(["alice", "bob"]);
    expect(selection.keywords).toEqual([]);
  });

  test("parses field modifiers off the key", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`
title: Modifiers
detection:
  selection:
    principalProcess|contains|all:
      - curl
      - http
  condition: selection
`);

    const requirement: SigmaSelection = rule.selections[0]!;
    expect(requirement.fieldMaps[0]![0]!.field).toBe("principalProcess");
    expect(requirement.fieldMaps[0]![0]!.modifiers).toEqual([
      "contains",
      "all",
    ]);
  });

  test("parses a list-of-maps selection: maps OR together", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`
title: Map list
detection:
  selection:
    - className: Authentication
      statusName: Failure
    - className: Detection Finding
  condition: selection
`);

    expect(rule.selections[0]!.fieldMaps).toHaveLength(2);
    expect(rule.selections[0]!.fieldMaps[0]).toHaveLength(2);
    expect(rule.selections[0]!.fieldMaps[1]).toHaveLength(1);
  });

  test("parses a keyword-list selection", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`
title: Keywords
detection:
  keywords:
    - mimikatz
    - lsass dump
  condition: keywords
`);

    expect(rule.selections[0]!.keywords).toEqual(["mimikatz", "lsass dump"]);
    expect(rule.selections[0]!.fieldMaps).toEqual([]);
  });

  test("keeps null values (field-absent matches)", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`
title: Null value
detection:
  selection:
    principalUser: null
  condition: selection
`);

    expect(rule.selections[0]!.fieldMaps[0]![0]!.values).toEqual([null]);
  });

  describe("condition grammar", () => {
    function parseCondition(condition: string): SigmaConditionNode {
      const rule: SigmaRule = SigmaRuleParser.parse(`
title: Condition
detection:
  sel_a:
    a: 1
  sel_b:
    b: 2
  filter_x:
    c: 3
  condition: ${condition}
`);
      return rule.condition;
    }

    test("a single selection reference", () => {
      expect(parseCondition("sel_a")).toEqual({
        kind: "selection",
        name: "sel_a",
      });
    });

    test("and / or with correct precedence (and binds tighter)", () => {
      const node: SigmaConditionNode = parseCondition(
        "sel_a or sel_b and filter_x",
      );

      expect(node.kind).toBe("or");
      if (node.kind === "or") {
        expect(node.children[0]).toEqual({ kind: "selection", name: "sel_a" });
        expect(node.children[1]!.kind).toBe("and");
      }
    });

    test("parentheses override precedence", () => {
      const node: SigmaConditionNode = parseCondition(
        "(sel_a or sel_b) and filter_x",
      );

      expect(node.kind).toBe("and");
      if (node.kind === "and") {
        expect(node.children[0]!.kind).toBe("or");
      }
    });

    test("not binds tighter than and", () => {
      const node: SigmaConditionNode = parseCondition("sel_a and not filter_x");

      expect(node.kind).toBe("and");
      if (node.kind === "and") {
        expect(node.children[1]).toEqual({
          kind: "not",
          child: { kind: "selection", name: "filter_x" },
        });
      }
    });

    test("`1 of sel_*` quantifier", () => {
      expect(parseCondition("1 of sel_*")).toEqual({
        kind: "of",
        quantifier: 1,
        pattern: "sel_*",
      });
    });

    test("`all of sel_*` quantifier", () => {
      expect(parseCondition("all of sel_*")).toEqual({
        kind: "of",
        quantifier: "all",
        pattern: "sel_*",
      });
    });

    test("`any of them` quantifier", () => {
      expect(parseCondition("any of them")).toEqual({
        kind: "of",
        quantifier: "any",
        pattern: "them",
      });
    });

    test("case-insensitive keywords: AND/OR/NOT parse the same", () => {
      const node: SigmaConditionNode = parseCondition("sel_a AND NOT sel_b");

      expect(node.kind).toBe("and");
    });

    test("`and` inside a selection name is not treated as an operator", () => {
      const rule: SigmaRule = SigmaRuleParser.parse(`
title: Name with keyword substring
detection:
  candy:
    a: 1
  condition: candy
`);
      expect(rule.condition).toEqual({ kind: "selection", name: "candy" });
    });
  });

  describe("rejections", () => {
    function expectParseError(ruleYaml: string, messagePart: string): void {
      try {
        SigmaRuleParser.parse(ruleYaml);
        throw new Error("expected parse to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toContain(messagePart);
      }
    }

    test("empty YAML", () => {
      expectParseError("", "YAML is empty");
    });

    test("invalid YAML", () => {
      expectParseError("title: [unclosed", "invalid YAML");
    });

    test("missing detection", () => {
      expectParseError(
        "title: No detection",
        "`detection` mapping is required",
      );
    });

    test("missing condition", () => {
      expectParseError(
        `
title: No condition
detection:
  selection:
    a: b
`,
        "condition",
      );
    });

    test("aggregation conditions are rejected loudly", () => {
      expectParseError(
        `
title: Aggregation
detection:
  selection:
    a: b
  condition: selection | count() > 5
`,
        "aggregation",
      );
    });

    test("condition referencing an unknown selection", () => {
      expectParseError(
        `
title: Unknown selection
detection:
  selection:
    a: b
  condition: selection and missing_one
`,
        'unknown selection "missing_one"',
      );
    });

    test("`of` pattern matching no selection", () => {
      expectParseError(
        `
title: No pattern match
detection:
  selection:
    a: b
  condition: all of filter_*
`,
        "matches no selection",
      );
    });

    test("unsupported field modifier", () => {
      expectParseError(
        `
title: Bad modifier
detection:
  selection:
    a|base64offset: b
  condition: selection
`,
        'unsupported field modifier "base64offset"',
      );
    });

    test("selection mixing maps and scalars", () => {
      expectParseError(
        `
title: Mixed selection
detection:
  selection:
    - a: b
    - plain-keyword
  condition: selection
`,
        "mixes maps and scalars",
      );
    });

    test("nested object values inside a field", () => {
      expectParseError(
        `
title: Nested value
detection:
  selection:
    a:
      nested: value
  condition: selection
`,
        "nested object value",
      );
    });

    test("empty selection", () => {
      expectParseError(
        `
title: Empty selection
detection:
  selection: {}
  condition: selection
`,
        "empty",
      );
    });

    test("dangling operator at the end of the condition", () => {
      expectParseError(
        `
title: Dangling operator
detection:
  selection:
    a: b
  condition: selection and
`,
        "unexpected end of expression",
      );
    });

    test("unbalanced parenthesis", () => {
      expectParseError(
        `
title: Unbalanced
detection:
  selection:
    a: b
  condition: (selection
`,
        "missing closing parenthesis",
      );
    });

    test("bare number without `of`", () => {
      expectParseError(
        `
title: Bare number
detection:
  selection:
    a: b
  condition: selection and 1
`,
        "expected",
      );
    });
  });

  describe("matchSelectionNames", () => {
    test("them matches everything", () => {
      expect(SigmaRuleParser.matchSelectionNames("them", ["a", "b"])).toEqual([
        "a",
        "b",
      ]);
    });

    test("prefix wildcard", () => {
      expect(
        SigmaRuleParser.matchSelectionNames("sel_*", [
          "sel_a",
          "sel_b",
          "filter",
        ]),
      ).toEqual(["sel_a", "sel_b"]);
    });

    test("exact name", () => {
      expect(
        SigmaRuleParser.matchSelectionNames("sel_a", ["sel_a", "sel_ab"]),
      ).toEqual(["sel_a"]);
    });
  });
});
