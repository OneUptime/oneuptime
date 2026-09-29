import { describe, expect, it } from "@jest/globals";
import ServiceLevelObjectiveLabelRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveOwnerRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import ServiceLevelObjectiveLabelRuleService from "../../../Server/Services/ServiceLevelObjectiveLabelRuleService";
import ServiceLevelObjectiveOwnerRuleService from "../../../Server/Services/ServiceLevelObjectiveOwnerRuleService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * The SLO label and owner rule services.
 *
 * A pattern that is neither a regex nor a '*' wildcard matches nothing, and the
 * engine can only log that long after the user left the form - so the write is
 * refused, on create AND on update, naming the field in the SLO's own words.
 *
 * And a rule is configuration: unlike the feed-style retention most rule
 * services copy, it is never hard-deleted by age.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type RuleService =
  | typeof ServiceLevelObjectiveLabelRuleService
  | typeof ServiceLevelObjectiveOwnerRuleService;

interface ServiceCase {
  name: string;
  service: RuleService;
  makeRule: () =>
    | ServiceLevelObjectiveLabelRule
    | ServiceLevelObjectiveOwnerRule;
}

const SERVICES: Array<ServiceCase> = [
  {
    name: "ServiceLevelObjectiveLabelRuleService",
    service: ServiceLevelObjectiveLabelRuleService,
    makeRule: () => {
      return new ServiceLevelObjectiveLabelRule();
    },
  },
  {
    name: "ServiceLevelObjectiveOwnerRuleService",
    service: ServiceLevelObjectiveOwnerRuleService,
    makeRule: () => {
      return new ServiceLevelObjectiveOwnerRule();
    },
  },
];

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

describe.each(SERVICES)("$name", (c: ServiceCase) => {
  function create(fields: Record<string, unknown>): Promise<unknown> {
    const rule:
      | ServiceLevelObjectiveLabelRule
      | ServiceLevelObjectiveOwnerRule = c.makeRule();
    Object.assign(rule as unknown as Record<string, unknown>, {
      projectId: PROJECT_ID,
      name: "Checkout SLOs",
      ...fields,
    });

    return callHook(c.service, "onBeforeCreate", {
      data: rule,
      props: { isRoot: true },
    });
  }

  function update(data: Record<string, unknown>): Promise<unknown> {
    return callHook(c.service, "onBeforeUpdate", {
      query: { _id: ObjectID.generate().toString() },
      data: data,
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    });
  }

  describe("on create", () => {
    it.each([
      ["a regex", "^checkout-.*"],
      ["a '*' wildcard", "*checkout*"],
      ["a plain word", "checkout"],
    ])(
      "accepts %s as the SLO name pattern",
      async (_: string, pattern: string) => {
        await expect(
          create({ serviceLevelObjectiveNamePattern: pattern }),
        ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
      },
    );

    it("accepts a rule without patterns", async () => {
      await expect(create({})).resolves.toBeDefined();
    });

    it("refuses a name pattern that can never match, naming the field", async () => {
      await expect(
        create({ serviceLevelObjectiveNamePattern: "checkout-(01" }),
      ).rejects.toThrow(
        new BadDataException(
          `SLO Name Pattern "checkout-(01" is not a valid regular expression, and contains no '*' wildcard to fall back on, so it would never match an SLO. Use a regex such as checkout-.* or a wildcard such as *checkout*.`,
        ),
      );
    });

    it("refuses a description pattern that can never match, naming the field", async () => {
      await expect(
        create({ serviceLevelObjectiveDescriptionPattern: "[unclosed" }),
      ).rejects.toThrow('SLO Description Pattern "[unclosed"');
    });

    it("hands the create through unchanged", async () => {
      const result: { createBy: { data: Record<string, unknown> } } =
        (await create({
          serviceLevelObjectiveNamePattern: "*checkout*",
        })) as { createBy: { data: Record<string, unknown> } };

      expect(result.createBy.data["serviceLevelObjectiveNamePattern"]).toBe(
        "*checkout*",
      );
    });
  });

  describe("on update", () => {
    it("accepts a valid pattern", async () => {
      await expect(
        update({ serviceLevelObjectiveNamePattern: "*checkout*" }),
      ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
    });

    // Updating another column must not trip over the patterns it leaves alone.
    it("accepts an update that does not touch the patterns", async () => {
      await expect(update({ isEnabled: false })).resolves.toBeDefined();
    });

    it("refuses a name pattern that can never match", async () => {
      await expect(
        update({ serviceLevelObjectiveNamePattern: "api-(01" }),
      ).rejects.toThrow('SLO Name Pattern "api-(01"');
    });

    it("refuses a description pattern that can never match", async () => {
      await expect(
        update({ serviceLevelObjectiveDescriptionPattern: "(" }),
      ).rejects.toThrow("SLO Description Pattern");
    });
  });

  it("never hard-deletes rules by age", () => {
    expect(c.service.hardDeleteItemByColumnName).toBe("");
    expect(c.service.hardDeleteItemsOlderThanDays).toBe(0);
  });
});
