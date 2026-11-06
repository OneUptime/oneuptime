import AlertGroupingRuleService from "../../../../Server/Services/AlertGroupingRuleService";
import IncidentGroupingRuleService from "../../../../Server/Services/IncidentGroupingRuleService";
import GroupingRuleCountCheck from "../../../../Server/Utils/Rules/GroupingRuleCountCheck";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A GROUPING RULE MAY BE SAVED WITH AS THE NUMBER OF MATCHING RECORDS IT
 * WAITS FOR (issue #5374): a whole number from 1 to 100, the engines' own
 * limits. A write that leaves it out is not checked; anything else is
 * refused, naming the column and the range, on every write - the API,
 * Terraform, a workflow, OneUptime's own - before anything is looked up.
 */

describe("GroupingRuleCountCheck", () => {
  test.each([1, 2, 3, 42, 100])("takes %d", (count: number) => {
    expect(() => {
      GroupingRuleCountCheck.check({
        count: count,
        columnTitle: "Minimum Incident Count",
      });
    }).not.toThrow();
  });

  test("does not check a write that leaves the count out", () => {
    expect(() => {
      GroupingRuleCountCheck.check({
        count: undefined,
        columnTitle: "Minimum Incident Count",
      });
    }).not.toThrow();
  });

  test.each([
    ["0", 0],
    ["101", 101],
    ["a negative count", -3],
    ["a fraction", 2.5],
    ["text", "3"],
    ["null", null],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["true", true],
    ["an object", { count: 3 }],
  ] as Array<[string, unknown]>)(
    "refuses %s, naming the column and the range",
    (_name: string, count: unknown) => {
      expect(() => {
        GroupingRuleCountCheck.check({
          count: count,
          columnTitle: "Minimum Alert Count",
        });
      }).toThrow(
        new BadDataException(
          "Minimum Alert Count must be a whole number from 1 to 100.",
        ),
      );
    },
  );
});

type CheckFunction = (write: { data: Record<string, unknown> }) => Promise<void>;

interface ServiceCase {
  name: string;
  service: unknown;
  column: string;
  title: string;
  otherKindsColumn: string;
}

const SERVICES: Array<ServiceCase> = [
  {
    name: "IncidentGroupingRuleService",
    service: IncidentGroupingRuleService,
    column: "minimumIncidentCount",
    title: "Minimum Incident Count",
    otherKindsColumn: "minimumAlertCount",
  },
  {
    name: "AlertGroupingRuleService",
    service: AlertGroupingRuleService,
    column: "minimumAlertCount",
    title: "Minimum Alert Count",
    otherKindsColumn: "minimumIncidentCount",
  },
];

describe.each(SERVICES)("$name", (serviceCase: ServiceCase) => {
  function hook(name: string): CheckFunction {
    const service: Record<string, CheckFunction> =
      serviceCase.service as Record<string, CheckFunction>;
    const found: CheckFunction | undefined = service[name];

    expect(found).toBeDefined();
    return found!.bind(service) as CheckFunction;
  }

  test.each(["checkCreateBeforeReferences", "checkUpdateBeforeReferences"])(
    "%s takes a count the engines act on, and a write without one",
    async (name: string) => {
      await expect(
        hook(name)({ data: { [serviceCase.column]: 5 } }),
      ).resolves.toBeUndefined();
      await expect(
        hook(name)({ data: { name: "Renamed" } }),
      ).resolves.toBeUndefined();
    },
  );

  test.each(["checkCreateBeforeReferences", "checkUpdateBeforeReferences"])(
    "%s refuses one it does not",
    async (name: string) => {
      for (const count of [0, 101, 2.5, "5", null]) {
        await expect(
          hook(name)({ data: { [serviceCase.column]: count } }),
        ).rejects.toThrow(
          `${serviceCase.title} must be a whole number from 1 to 100.`,
        );
      }
    },
  );

  test("reads only its own kind's column", async () => {
    await expect(
      hook("checkCreateBeforeReferences")({
        data: { [serviceCase.otherKindsColumn]: 500 },
      }),
    ).resolves.toBeUndefined();
  });
});
