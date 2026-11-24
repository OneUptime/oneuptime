import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import DetectionRuleLibraryUpgradeCopies from "../../../../Server/Utils/SecurityEvent/DetectionRuleLibraryUpgradeCopies";
import logger from "../../../../Server/Utils/Logger";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DETECTION_RULE_LIBRARY_UPGRADES,
  DetectionRuleLibraryUpgrade,
  isSameRuleYaml,
} from "../../../../Types/SecurityEvent/DetectionRuleLibraryUpgrades";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";

/*
 * A PROJECT'S COPY OF A FIXED LIBRARY RULE (#10427). A rule added from the
 * Rule Library is a copy of its YAML, so the fix of Burst of access-denied
 * API calls - OneUptime's own reads left out - reaches a project's rule
 * only by an upgrade: every copy still word for word the rule as it was
 * added gets the library's YAML, and its description while that is the
 * library's too. A rule anyone edited is theirs, and is left as it is.
 */

const BURST: string = "2917bec0-2331-4e59-bdd4-a81211529156";

function upgradeOf(id: string): DetectionRuleLibraryUpgrade {
  return DETECTION_RULE_LIBRARY_UPGRADES.find(
    (upgrade: DetectionRuleLibraryUpgrade): boolean => {
      return upgrade.id === id;
    },
  )!;
}

function libraryEntry(id: string): DetectionRuleLibraryEntry {
  return getDetectionRuleLibraryEntry(id)!;
}

function rule(
  index: number,
  sigmaRuleYaml: string,
  description: string = upgradeOf(BURST).previousDescription,
): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  model.id = new ObjectID(
    `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
  );
  model.sigmaRuleYaml = sigmaRuleYaml;
  model.description = description;
  return model;
}

interface Installed {
  updates: Array<{ id: string; data: JSONObject }>;
  reads: Array<JSONObject>;
}

// The project's rules, read a page at a time as the service reads them.
function install(
  rules: Array<DetectionRule>,
  failing: Set<string> = new Set(),
): Installed {
  const installed: Installed = { updates: [], reads: [] };

  jest
    .spyOn(DetectionRuleService, "findBy")
    .mockImplementation(
      async (data: unknown): Promise<Array<DetectionRule>> => {
        const read: JSONObject = data as JSONObject;
        installed.reads.push(read);

        const skip: number = Number(read["skip"]);
        const limit: number = Number(read["limit"]);

        return rules.slice(skip, skip + limit);
      },
    );

  jest
    .spyOn(DetectionRuleService, "updateOneById")
    .mockImplementation(async (data: unknown): Promise<number> => {
      const update: { id: ObjectID; data: JSONObject } = data as {
        id: ObjectID;
        data: JSONObject;
      };

      if (failing.has(update.id.toString())) {
        throw new Error("A rule that cannot be saved");
      }

      installed.updates.push({ id: update.id.toString(), data: update.data });

      // The rows it saved, as the service returns them.
      return 1;
    });

  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  return installed;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the library's upgrades", () => {
  test("each names a library rule, and was its wording or its grouping before: it is not that now", () => {
    expect(DETECTION_RULE_LIBRARY_UPGRADES.length).toBeGreaterThan(0);

    for (const upgrade of DETECTION_RULE_LIBRARY_UPGRADES) {
      const entry: DetectionRuleLibraryEntry = libraryEntry(upgrade.id);

      expect(entry).toBeDefined();

      const isYamlFixed: boolean = !isSameRuleYaml(
        entry.sigmaRuleYaml,
        upgrade.previousSigmaRuleYaml,
      );
      // A fix that moved the field it groups by (#10773) may leave its YAML as it was.
      const isGroupByFixed: boolean =
        upgrade.previousGroupByField !== undefined &&
        upgrade.previousGroupByField !== (entry.groupByField || "");

      expect({ id: upgrade.id, fixed: isYamlFixed || isGroupByFixed }).toEqual({
        id: upgrade.id,
        fixed: true,
      });
      expect(upgrade.previousSigmaRuleYaml).toContain(`id: ${upgrade.id}\n`);
      expect(upgrade.why.length).toBeGreaterThan(0);
    }
  });

  test("Burst of access-denied API calls was the same selection, without OneUptime's own left out", () => {
    const before: SigmaRule = SigmaRuleParser.parse(
      upgradeOf(BURST).previousSigmaRuleYaml,
    );
    const now: SigmaRule = SigmaRuleParser.parse(
      libraryEntry(BURST).sigmaRuleYaml,
    );

    expect(before.title).toBe(now.title);
    expect(before.level).toBe(now.level);
    expect(
      now.selections.find((selection: { name: string }): boolean => {
        return selection.name === "selection";
      }),
    ).toEqual(
      before.selections.find((selection: { name: string }): boolean => {
        return selection.name === "selection";
      }),
    );
    expect(
      before.selections.map((selection: { name: string }): string => {
        return selection.name;
      }),
    ).toEqual(["selection"]);
    expect(upgradeOf(BURST).previousDescription).toBe(
      "Twenty or more AWS API calls denied for one identity within ten minutes: someone probing what a stolen key can do.",
    );
  });
});

describe("isSameRuleYaml", () => {
  const yaml: string = "title: A\nid: 1\ndetection:\n  selection:\n    a: b\n";

  test("the same lines, whatever the line endings, the spaces that end them and the blank lines around", () => {
    expect(isSameRuleYaml(yaml, yaml)).toBe(true);
    expect(isSameRuleYaml(yaml, yaml.split("\n").join("\r\n"))).toBe(true);
    expect(
      isSameRuleYaml(yaml, `\n\n${yaml.replace("a: b", "a: b   ")}\n`),
    ).toBe(true);
  });

  test("anything else changed is another rule", () => {
    expect(isSameRuleYaml(yaml, yaml.replace("a: b", "a: c"))).toBe(false);
    expect(isSameRuleYaml(yaml, yaml.replace("    a: b", "  a: b"))).toBe(
      false,
    );
    expect(isSameRuleYaml(yaml, `${yaml}  condition: selection\n`)).toBe(false);

    // A blank line inside the rule, after its title.
    const lines: Array<string> = yaml.split("\n");
    lines.splice(1, 0, "");

    expect(isSameRuleYaml(yaml, lines.join("\n"))).toBe(false);
  });
});

describe("DetectionRuleLibraryUpgradeCopies", () => {
  const previous: string = upgradeOf(BURST).previousSigmaRuleYaml;

  test("a copy as it was added gets the library's YAML and description", async () => {
    const installed: Installed = install([rule(1, previous)]);

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(1);
    expect(installed.updates).toEqual([
      {
        id: "0192f1a0-0000-7000-8000-000000000001",
        data: {
          sigmaRuleYaml: libraryEntry(BURST).sigmaRuleYaml,
          description: libraryEntry(BURST).description,
        },
      },
    ]);
  });

  test("a copy saved with other line endings or trailing spaces is still the rule as added", async () => {
    const installed: Installed = install([
      rule(1, previous.split("\n").join("\r\n")),
      rule(2, `${previous.replace("level: medium", "level: medium  ")}\n`),
    ]);

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(2);
    expect(installed.updates).toHaveLength(2);
  });

  test("a copy anyone edited is theirs, and is left as it is", async () => {
    const installed: Installed = install([
      rule(1, previous.replace("      - AccessDenied\n", "")),
      rule(2, previous.replace("level: medium", "level: high")),
      rule(
        3,
        previous.replace(
          "  condition: selection\n",
          "  filter_ci:\n    userIdentity.arn|contains: ci-deployer\n  condition: selection and not filter_ci\n",
        ),
      ),
    ]);

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(0);
    expect(installed.updates).toEqual([]);
  });

  test("a description someone wrote is kept, while the YAML gets the fix", async () => {
    const installed: Installed = install([
      rule(1, previous, "Our own words for the rule."),
    ]);

    await DetectionRuleLibraryUpgradeCopies.upgradeAll();

    expect(installed.updates).toEqual([
      {
        id: "0192f1a0-0000-7000-8000-000000000001",
        data: { sigmaRuleYaml: libraryEntry(BURST).sigmaRuleYaml },
      },
    ]);
  });

  test("a copy already upgraded is not touched again: run twice, the second changes nothing", async () => {
    const installed: Installed = install([
      rule(
        1,
        libraryEntry(BURST).sigmaRuleYaml,
        libraryEntry(BURST).description,
      ),
    ]);

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(0);
    expect(installed.updates).toEqual([]);
  });

  test("reads only the rules whose YAML names the library rule's id, as OneUptime, oldest first", async () => {
    const installed: Installed = install([]);

    await DetectionRuleLibraryUpgradeCopies.upgradeAll();

    const read: JSONObject = installed.reads[0]!;
    const query: JSONObject = read["query"] as JSONObject;

    expect(query["sigmaRuleYaml"]).toBeInstanceOf(Search);
    expect((query["sigmaRuleYaml"] as Search<string>).toString()).toBe(
      `id: ${BURST}`,
    );
    expect(read["select"]).toEqual({
      _id: true,
      sigmaRuleYaml: true,
      description: true,
      groupByField: true,
    });
    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["sort"]).toEqual({ createdAt: SortOrder.Ascending });
  });

  test("reads every page, however many projects have the rule", async () => {
    const rules: Array<DetectionRule> = Array.from(
      { length: 450 },
      (_value: unknown, index: number): DetectionRule => {
        return rule(index + 1, previous);
      },
    );
    const installed: Installed = install(rules);

    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf(upgradeOf(BURST)),
    ).toBe(450);
    expect(
      installed.reads.map((read: JSONObject): number => {
        return Number(read["skip"]);
      }),
    ).toEqual([0, 200, 400]);
  });

  test("every fixed rule's copies are read, each by its own id", async () => {
    const installed: Installed = install([]);

    await DetectionRuleLibraryUpgradeCopies.upgradeAll();

    expect(
      installed.reads.map((read: JSONObject): string => {
        return (
          (read["query"] as JSONObject)["sigmaRuleYaml"] as Search<string>
        ).toString();
      }),
    ).toEqual(
      DETECTION_RULE_LIBRARY_UPGRADES.map(
        (upgrade: DetectionRuleLibraryUpgrade): string => {
          return `id: ${upgrade.id}`;
        },
      ),
    );
  });

  test("one rule that cannot be saved does not keep the rest from the fix", async () => {
    const error: SpyInstance<typeof logger.error> = jest.spyOn(logger, "error");
    const installed: Installed = install(
      [rule(1, previous), rule(2, previous), rule(3, previous)],
      new Set(["0192f1a0-0000-7000-8000-000000000002"]),
    );

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(2);
    expect(
      installed.updates.map((update: { id: string }): string => {
        return update.id;
      }),
    ).toEqual([
      "0192f1a0-0000-7000-8000-000000000001",
      "0192f1a0-0000-7000-8000-000000000003",
    ]);
    expect(error).toHaveBeenCalled();
  });

  test("an upgrade of a rule the library no longer has, or whose wording and grouping are the library's now, does nothing", async () => {
    const installed: Installed = install([rule(1, previous)]);

    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf({
        id: "00000000-0000-4000-8000-000000000000",
        why: "gone",
        previousSigmaRuleYaml: previous,
        previousDescription: "",
      }),
    ).toBe(0);
    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf({
        ...upgradeOf(BURST),
        previousSigmaRuleYaml: libraryEntry(BURST).sigmaRuleYaml,
      }),
    ).toBe(0);
    expect(installed.reads).toEqual([]);
  });
});

/*
 * #10773: the two OpenStack rules that count per address count per
 * principalIp - which names the address behind a Hash rule's token - not
 * the parser's own openstack.audit.initiator_address, which holds real
 * addresses only. A project's copy still the library's gets the same: the
 * burst, its YAML unchanged, is grouped by principalIp when it is still
 * grouped by the old field; the admin rule, its first-seen field in its
 * YAML, gets the library's YAML. A copy anyone changed is theirs.
 */
describe("the OpenStack rules that count per address (#10773)", () => {
  const OPENSTACK_BURST: string = "6e7a4f92-2d3b-4b31-9a55-1f0c8e7d4a10";
  const ADMIN_FROM_NEW_ADDRESS: string = "c94e1b77-8a26-4d57-b2f1-0ea3f6d81c22";
  const OLD_FIELD: string = "openstack.audit.initiator_address";

  function copy(
    index: number,
    data: { yaml: string; groupByField?: string; description?: string },
  ): DetectionRule {
    const model: DetectionRule = rule(
      index,
      data.yaml,
      data.description ?? libraryEntry(OPENSTACK_BURST).description,
    );

    if (data.groupByField !== undefined) {
      model.groupByField = data.groupByField;
    }

    return model;
  }

  test("the burst was grouped by the parser's attribute, and is by principalIp now, its YAML as it was", () => {
    const upgrade: DetectionRuleLibraryUpgrade = upgradeOf(OPENSTACK_BURST);
    const entry: DetectionRuleLibraryEntry = libraryEntry(OPENSTACK_BURST);

    expect(upgrade.previousGroupByField).toBe(OLD_FIELD);
    expect(entry.groupByField).toBe("principalIp");
    expect(
      isSameRuleYaml(entry.sigmaRuleYaml, upgrade.previousSigmaRuleYaml),
    ).toBe(true);
    expect(upgrade.previousDescription).toBe(entry.description);
  });

  test("the admin rule read the parser's attribute as its new value, and principalIp now - nothing else changed", () => {
    const upgrade: DetectionRuleLibraryUpgrade = upgradeOf(
      ADMIN_FROM_NEW_ADDRESS,
    );
    const entry: DetectionRuleLibraryEntry = libraryEntry(
      ADMIN_FROM_NEW_ADDRESS,
    );

    expect(upgrade.previousGroupByField).toBeUndefined();
    expect(upgrade.previousSigmaRuleYaml).toContain(`    field: ${OLD_FIELD}\n`);
    expect(entry.sigmaRuleYaml).toContain("    field: principalIp\n");
    expect(
      isSameRuleYaml(
        upgrade.previousSigmaRuleYaml.replace(
          `    field: ${OLD_FIELD}\n`,
          "    field: principalIp\n",
        ),
        entry.sigmaRuleYaml,
      ),
    ).toBe(true);
    expect(upgrade.previousDescription).toBe(entry.description);
  });

  test("a burst copy still grouped by the parser's attribute is grouped by principalIp, and nothing else of it changes", async () => {
    const installed: Installed = install([
      copy(1, {
        yaml: upgradeOf(OPENSTACK_BURST).previousSigmaRuleYaml,
        groupByField: OLD_FIELD,
      }),
    ]);

    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf(
        upgradeOf(OPENSTACK_BURST),
      ),
    ).toBe(1);
    expect(installed.updates).toEqual([
      {
        id: "0192f1a0-0000-7000-8000-000000000001",
        data: { groupByField: "principalIp" },
      },
    ]);
  });

  test("a burst copy grouped by a field someone chose, or by none, is theirs", async () => {
    const installed: Installed = install([
      copy(1, {
        yaml: upgradeOf(OPENSTACK_BURST).previousSigmaRuleYaml,
        groupByField: "principalUser",
      }),
      copy(2, {
        yaml: upgradeOf(OPENSTACK_BURST).previousSigmaRuleYaml,
        groupByField: "",
      }),
    ]);

    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf(
        upgradeOf(OPENSTACK_BURST),
      ),
    ).toBe(0);
    expect(installed.updates).toEqual([]);
  });

  test("a burst copy whose YAML someone edited is theirs, whatever it is grouped by", async () => {
    const installed: Installed = install([
      copy(1, {
        yaml: upgradeOf(OPENSTACK_BURST).previousSigmaRuleYaml.replace(
          "level: medium",
          "level: high",
        ),
        groupByField: OLD_FIELD,
      }),
    ]);

    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf(
        upgradeOf(OPENSTACK_BURST),
      ),
    ).toBe(0);
    expect(installed.updates).toEqual([]);
  });

  test("an admin rule copy as it was added gets the library's YAML; one someone edited is theirs", async () => {
    const previous: string = upgradeOf(
      ADMIN_FROM_NEW_ADDRESS,
    ).previousSigmaRuleYaml;
    const installed: Installed = install([
      copy(1, {
        yaml: previous,
        description: libraryEntry(ADMIN_FROM_NEW_ADDRESS).description,
      }),
      copy(2, {
        yaml: previous.replace(
          "      - admin\n",
          "      - admin\n      - ops-admin\n",
        ),
      }),
    ]);

    expect(
      await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf(
        upgradeOf(ADMIN_FROM_NEW_ADDRESS),
      ),
    ).toBe(1);
    expect(installed.updates).toEqual([
      {
        id: "0192f1a0-0000-7000-8000-000000000001",
        data: {
          sigmaRuleYaml: libraryEntry(ADMIN_FROM_NEW_ADDRESS).sigmaRuleYaml,
          description: libraryEntry(ADMIN_FROM_NEW_ADDRESS).description,
        },
      },
    ]);
  });

  test("run twice, the second changes nothing", async () => {
    const rules: Array<DetectionRule> = [
      copy(1, {
        yaml: upgradeOf(OPENSTACK_BURST).previousSigmaRuleYaml,
        groupByField: OLD_FIELD,
      }),
      copy(2, {
        yaml: upgradeOf(ADMIN_FROM_NEW_ADDRESS).previousSigmaRuleYaml,
      }),
    ];
    const installed: Installed = install(rules);

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(2);

    // The store, as the first run left it.
    for (const update of installed.updates) {
      const saved: DetectionRule = rules.find(
        (model: DetectionRule): boolean => {
          return model.id!.toString() === update.id;
        },
      )!;

      if (update.data["groupByField"] !== undefined) {
        saved.groupByField = update.data["groupByField"] as string;
      }

      if (update.data["sigmaRuleYaml"] !== undefined) {
        saved.sigmaRuleYaml = update.data["sigmaRuleYaml"] as string;
      }
    }

    installed.updates.length = 0;

    expect(await DetectionRuleLibraryUpgradeCopies.upgradeAll()).toBe(0);
    expect(installed.updates).toEqual([]);
  });

  test("a project's copy of the burst is found by the YAML's id, its group field read beside it", async () => {
    const installed: Installed = install([]);

    await DetectionRuleLibraryUpgradeCopies.upgradeCopiesOf(
      upgradeOf(OPENSTACK_BURST),
    );

    expect(installed.reads).toHaveLength(1);
    expect(
      (
        (installed.reads[0]!["query"] as JSONObject)[
          "sigmaRuleYaml"
        ] as Search<string>
      ).toString(),
    ).toBe(`id: ${OPENSTACK_BURST}`);
    expect((installed.reads[0]!["select"] as JSONObject)["groupByField"]).toBe(
      true,
    );
  });
});
