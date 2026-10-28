import { describe, expect, test } from "@jest/globals";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SigmaWatchlist,
  SigmaWatchlists,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import {
  DetectionRuleDefinition,
  SigmaCorrelationStep,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  SigmaWatchlistReference,
  bindSigmaWatchlists,
  getDetectionRuleWatchlistReferences,
  getMissingSigmaWatchlists,
  getRulesReadingWatchlists,
  getSigmaRuleWatchlistReferences,
  getSigmaWatchlistKey,
  isSigmaWatchlistRequirement,
  readDetectionRuleWatchlistReferences,
} from "../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";

/*
 * WHICH WATCHLISTS A RULE READS, AND THE RULE WITH THEM BOUND.
 *
 * A rule names a list; the project holds it. The server binds the lists a
 * rule names before it compiles the rule, the Dashboard says which rules
 * read a list, and the API keeps a list a rule reads from being renamed or
 * deleted - all from the names read here.
 */

const VIP_RULE: string = `title: VIP sign-in
detection:
  vip:
    principalUser|expand: '%vip_users%'
  admins:
    targetUser|expand:
      - '%VIP_Users%'
      - '%admins%'
  condition: vip or admins
`;

const CORRELATION: string = `title: VIP fails, then succeeds
correlation:
  type: temporal_ordered
  rules:
    - vip_fails
    - known_host_success
  group-by:
    - principalUser
  timespan: 10m
---
title: VIP fails five times
name: vip_fails
correlation:
  type: event_count
  rules:
    - vip_failure
  group-by:
    - principalUser
  timespan: 10m
  condition:
    gte: 5
---
title: VIP failure
name: vip_failure
detection:
  selection:
    principalUser|expand: '%vip_users%'
    statusName: Failure
  condition: selection
---
title: Success from a critical host
name: known_host_success
detection:
  selection:
    principalHost|expand: '%critical_hosts%'
    statusName: Success
  condition: selection
`;

function list(name: string, values: Array<string> = []): SigmaWatchlist {
  return {
    name,
    entityType: SecurityEntityType.User,
    exactValues: values,
    patterns: [],
    ranges: [],
  };
}

function names(references: Array<SigmaWatchlistReference>): Array<string> {
  return references.map((reference: SigmaWatchlistReference): string => {
    return reference.name;
  });
}

describe("the lists a rule names", () => {
  test("each once, whatever the case, in the order the rule names them", () => {
    const references: Array<SigmaWatchlistReference> =
      getSigmaRuleWatchlistReferences(SigmaRuleParser.parse(VIP_RULE));

    expect(references).toEqual([
      { name: "vip_users", key: "vip_users" },
      { name: "admins", key: "admins" },
    ]);
  });

  test("a rule without expand names none", () => {
    expect(
      getSigmaRuleWatchlistReferences(
        SigmaRuleParser.parse(`title: Plain
detection:
  selection:
    principalUser: '%vip_users%'
  condition: selection
`),
      ),
    ).toEqual([]);
  });

  test("a correlation names the lists of every rule its file holds, its count steps' too", () => {
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(CORRELATION);

    expect(names(getDetectionRuleWatchlistReferences(definition))).toEqual([
      "vip_users",
      "critical_hosts",
    ]);
  });

  test("read from YAML: a rule that does not parse, or never writes the modifier, names none", () => {
    expect(names(readDetectionRuleWatchlistReferences(VIP_RULE))).toEqual([
      "vip_users",
      "admins",
    ]);
    expect(readDetectionRuleWatchlistReferences("title: [broken")).toEqual([]);
    expect(
      readDetectionRuleWatchlistReferences(`title: x
detection:
  selection:
    principalUser|expand: 'vip_users'
  condition: selection
`),
    ).toEqual([]);
    expect(readDetectionRuleWatchlistReferences("")).toEqual([]);
    expect(readDetectionRuleWatchlistReferences(undefined)).toEqual([]);
    expect(readDetectionRuleWatchlistReferences(42)).toEqual([]);
  });

  test("a requirement reads lists when it carries expand; a value names one between % signs", () => {
    expect(
      isSigmaWatchlistRequirement({
        field: "principalUser",
        modifiers: ["expand"],
        values: ["%a%"],
      }),
    ).toBe(true);
    expect(
      isSigmaWatchlistRequirement({
        field: "principalUser",
        modifiers: ["contains"],
        values: ["%a%"],
      }),
    ).toBe(false);
    expect(getSigmaWatchlistKey("%VIP_Users%")).toBe("vip_users");
    expect(getSigmaWatchlistKey("vip_users")).toBeNull();
    expect(getSigmaWatchlistKey(null)).toBeNull();
  });
});

describe("the rules that read each list", () => {
  test("by name key, every rule that names the list, in the order given", () => {
    const readers: Map<string, Array<{ id: string; name: string }>> =
      getRulesReadingWatchlists([
        { id: "r1", name: "VIP sign-in", sigmaRuleYaml: VIP_RULE },
        { id: "r2", name: "Plain", sigmaRuleYaml: "title: x" },
        { id: "r3", name: "Sequence", sigmaRuleYaml: CORRELATION },
        { id: "r4", name: "No YAML" },
      ]);

    expect(readers.get("vip_users")).toEqual([
      { id: "r1", name: "VIP sign-in" },
      { id: "r3", name: "Sequence" },
    ]);
    expect(readers.get("admins")).toEqual([{ id: "r1", name: "VIP sign-in" }]);
    expect(readers.get("critical_hosts")).toEqual([
      { id: "r3", name: "Sequence" },
    ]);
    expect(readers.has("plain")).toBe(false);
  });
});

describe("binding a project's lists to a rule", () => {
  test("the lists a definition names that the project does not have", () => {
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(VIP_RULE);

    expect(getMissingSigmaWatchlists(definition, {})).toEqual([
      "vip_users",
      "admins",
    ]);
    expect(
      getMissingSigmaWatchlists(definition, { vip_users: list("vip_users") }),
    ).toEqual(["admins"]);
    expect(
      getMissingSigmaWatchlists(definition, {
        vip_users: list("vip_users"),
        admins: list("admins"),
      }),
    ).toEqual([]);
  });

  test("a single rule carries only the lists it names, and the rule given is left as it was", () => {
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(VIP_RULE);
    const available: SigmaWatchlists = {
      vip_users: list("vip_users", ["alice"]),
      admins: list("admins", ["root"]),
      unrelated: list("unrelated"),
    };

    const bound: DetectionRuleDefinition = bindSigmaWatchlists(
      definition,
      available,
    );

    expect(bound.kind).toBe("single");
    expect((bound as { rule: SigmaRule }).rule.watchlists).toEqual({
      vip_users: available["vip_users"],
      admins: available["admins"],
    });
    expect((definition as { rule: SigmaRule }).rule.watchlists).toBeUndefined();
  });

  test("a rule that names none is the same rule", () => {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      "title: x\ndetection:\n  s:\n    principalUser: a\n  condition: s\n",
    );

    const bound: DetectionRuleDefinition = bindSigmaWatchlists(definition, {
      vip_users: list("vip_users"),
    });

    expect((bound as { rule: SigmaRule }).rule).toBe(
      (definition as { rule: SigmaRule }).rule,
    );
  });

  test("a correlation's steps and the rules its count steps read each carry their own lists", () => {
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(CORRELATION);
    const available: SigmaWatchlists = {
      vip_users: list("vip_users", ["alice"]),
      critical_hosts: {
        ...list("critical_hosts", ["dc-01"]),
        entityType: SecurityEntityType.Host,
      },
    };

    const bound: DetectionRuleDefinition = bindSigmaWatchlists(
      definition,
      available,
    );

    expect(bound.kind).toBe("correlation");

    const steps: Array<SigmaCorrelationStep> = (
      bound as { steps: Array<SigmaCorrelationStep> }
    ).steps;
    const countStep: SigmaCorrelationStep = steps.find(
      (step: SigmaCorrelationStep): boolean => {
        return Boolean(step.count);
      },
    )!;
    const ruleStep: SigmaCorrelationStep = steps.find(
      (step: SigmaCorrelationStep): boolean => {
        return Boolean(step.rule);
      },
    )!;

    expect(countStep.count!.rules[0]!.watchlists).toEqual({
      vip_users: available["vip_users"],
    });
    expect(ruleStep.rule!.watchlists).toEqual({
      critical_hosts: available["critical_hosts"],
    });
  });

  test("a name missing from the lists given stays unbound", () => {
    const bound: DetectionRuleDefinition = bindSigmaWatchlists(
      SigmaRuleSetParser.parse(VIP_RULE),
      { vip_users: list("vip_users") },
    );

    expect(Object.keys((bound as { rule: SigmaRule }).rule.watchlists!)).toEqual(
      ["vip_users"],
    );
  });
});
