import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertIncidentRuleService, {
  Service,
} from "../../../Server/Services/AlertIncidentRuleService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * AN ALERT INCIDENT RULE'S WAIT IS HELD THE SAME FOR EVERY CALLER.
 *
 * The Dashboard's number box, the API, Terraform, MCP and workflows all
 * save a rule through its service, which refuses a wait that is not a
 * whole number of minutes from 0 to a week - before anything the rule
 * names is looked up - and writes one that is as the number it is.
 */

interface ServiceHooks {
  checkCreateBeforeReferences: (
    createBy: CreateBy<AlertIncidentRule>,
  ) => Promise<void>;
  checkUpdateBeforeReferences: (
    updateBy: UpdateBy<AlertIncidentRule>,
  ) => Promise<void>;
}

const hooks: ServiceHooks = AlertIncidentRuleService as unknown as ServiceHooks;

function createWith(wait: unknown): CreateBy<AlertIncidentRule> {
  const rule: AlertIncidentRule = new AlertIncidentRule();
  rule.name = "Declare incidents";
  rule.projectId = ObjectID.generate();

  if (wait !== "__absent__") {
    rule.setColumnValue("declareAfterInMinutes", wait as never);
  }

  return { data: rule, props: { isRoot: true } };
}

function updateWith(
  data: Record<string, unknown>,
): UpdateBy<AlertIncidentRule> {
  return {
    query: { _id: ObjectID.generate() },
    data: data as never,
    props: { isRoot: true },
  } as unknown as UpdateBy<AlertIncidentRule>;
}

describe("AlertIncidentRuleService", () => {
  test("checks every reference a rule names against its project", () => {
    expect(AlertIncidentRuleService).toBeInstanceOf(ProjectReferencesService);
    expect(AlertIncidentRuleService).toBeInstanceOf(Service);
  });

  describe("on create", () => {
    test.each([
      ["0", 0, 0],
      ["15", 15, 15],
      ["a number sent as text", "30", 30],
      ["nothing, written as the default", null, 0],
      ["an emptied number box", "", 0],
    ] as Array<[string, unknown, number]>)(
      "saves %s",
      async (_name: string, wait: unknown, stored: number) => {
        const createBy: CreateBy<AlertIncidentRule> = createWith(wait);

        await hooks.checkCreateBeforeReferences(createBy);

        expect(createBy.data.declareAfterInMinutes).toBe(stored);
      },
    );

    test("leaves a wait that was not sent to the column's default", async () => {
      const createBy: CreateBy<AlertIncidentRule> = createWith("__absent__");

      await hooks.checkCreateBeforeReferences(createBy);

      expect(createBy.data.declareAfterInMinutes).toBeUndefined();
    });

    test.each([
      ["a negative wait", -10],
      ["a fraction of a minute", 2.5],
      ["text", "an hour"],
      ["more than a week", 7 * 24 * 60 + 1],
    ] as Array<[string, unknown]>)(
      "refuses %s with a 400",
      async (_name: string, wait: unknown) => {
        await expect(
          hooks.checkCreateBeforeReferences(createWith(wait)),
        ).rejects.toBeInstanceOf(BadDataException);
      },
    );
  });

  describe("on update", () => {
    test("an edit that leaves the wait alone is not judged on it", async () => {
      const updateBy: UpdateBy<AlertIncidentRule> = updateWith({
        name: "Renamed",
      });

      await hooks.checkUpdateBeforeReferences(updateBy);

      expect(
        (updateBy.data as Record<string, unknown>)["declareAfterInMinutes"],
      ).toBeUndefined();
    });

    test("writes a wait sent as text as its number", async () => {
      const updateBy: UpdateBy<AlertIncidentRule> = updateWith({
        declareAfterInMinutes: "45",
      });

      await hooks.checkUpdateBeforeReferences(updateBy);

      expect(
        (updateBy.data as Record<string, unknown>)["declareAfterInMinutes"],
      ).toBe(45);
    });

    test("refuses a wait that is not a whole number of minutes", async () => {
      await expect(
        hooks.checkUpdateBeforeReferences(
          updateWith({ declareAfterInMinutes: -1 }),
        ),
      ).rejects.toThrow(
        "Declare After (Minutes) must be a whole number of minutes",
      );
    });

    test("refuses a wait of more than a week", async () => {
      await expect(
        hooks.checkUpdateBeforeReferences(
          updateWith({ declareAfterInMinutes: 20000 }),
        ),
      ).rejects.toThrow("can be at most 10080 minutes (a week)");
    });
  });
});
