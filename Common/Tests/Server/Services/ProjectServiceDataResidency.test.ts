import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * What ProjectService lets a master admin store in Project.dataResidency on a
 * server that bills (OneUptime Cloud). Who may write it at all is the column's
 * access control, tested in ProjectDataResidencyColumn.test.ts; this is what
 * the value looks like once it is written: trimmed, and NULL when blank.
 *
 * The billing-off behaviour lives in ProjectServiceDataResidencySelfHosted -
 * IsBillingEnabled is read at module scope, so it needs its own file.
 *
 * Nothing below the service boundary runs: no database, no Stripe.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type UpdateData = Record<string, unknown>;

function makeUpdateBy(data: UpdateData): UpdateBy<Project> {
  return {
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: { isMasterAdmin: true },
  } as unknown as UpdateBy<Project>;
}

async function runOnBeforeUpdate(
  data: UpdateData,
): Promise<{ result: OnUpdate<Project>; data: UpdateData }> {
  const updateBy: UpdateBy<Project> = makeUpdateBy(data);

  const result: OnUpdate<Project> = await (
    ProjectService as any
  ).onBeforeUpdate(updateBy);

  return { result, data: result.updateBy.data as UpdateData };
}

describe("ProjectService data residency with billing enabled", () => {
  beforeEach(() => {
    /*
     * Tripwires for the billing branches of onBeforeUpdate. A data residency
     * update is not a business-details update and must not reach Stripe.
     */
    getJestSpyOn(
      BillingService,
      "updateCustomerBusinessDetails",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      NotificationService,
      "rechargeIfBalanceIsLow",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      null as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("applyDataResidencyRules", () => {
    it("stores a label as typed", () => {
      const data: UpdateData = { dataResidency: "EU (Frankfurt)" };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBe("EU (Frankfurt)");
    });

    it("trims surrounding whitespace", () => {
      const data: UpdateData = { dataResidency: "  US East\n" };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBe("US East");
    });

    it("stores an empty string as null", () => {
      const data: UpdateData = { dataResidency: "" };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBeNull();
    });

    it("stores a whitespace-only string as null", () => {
      const data: UpdateData = { dataResidency: "    " };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBeNull();
    });

    it("keeps an explicit null as null", () => {
      const data: UpdateData = { dataResidency: null };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBeNull();
    });

    /*
     * An update that does not mention the column must not start writing it:
     * adding the key - even as null - would clear a residency staff set, every
     * time the customer renamed their project.
     */
    it("does not add the column to data that did not carry it", () => {
      const data: UpdateData = { name: "Renamed" };

      ProjectService.applyDataResidencyRules(data);

      expect(data).toEqual({ name: "Renamed" });
      expect(Object.prototype.hasOwnProperty.call(data, "dataResidency")).toBe(
        false,
      );
    });

    it("refuses a value that is not text", () => {
      expect(() => {
        ProjectService.applyDataResidencyRules({ dataResidency: 42 });
      }).toThrow(BadDataException);

      expect(() => {
        ProjectService.applyDataResidencyRules({
          dataResidency: { region: "EU" },
        });
      }).toThrow("Data residency must be text.");
    });

    it("refuses a label longer than the column", () => {
      expect(() => {
        ProjectService.applyDataResidencyRules({
          dataResidency: "a".repeat(101),
        });
      }).toThrow("Data residency cannot be more than 100 characters.");
    });

    it("accepts a label exactly as long as the column", () => {
      const data: UpdateData = { dataResidency: "a".repeat(100) };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBe("a".repeat(100));
    });

    it("works on a Project model instance, as onBeforeCreate hands it one", () => {
      const project: Project = new Project();
      project.name = "Acme";
      project.dataResidency = "  EU  ";

      ProjectService.applyDataResidencyRules(project);

      expect(project.dataResidency).toBe("EU");
      expect(project.name).toBe("Acme");
    });

    it("leaves a Project model instance with no residency untouched", () => {
      const project: Project = new Project();
      project.name = "Acme";

      ProjectService.applyDataResidencyRules(project);

      expect(project.dataResidency).toBeUndefined();
    });
  });

  describe("onBeforeUpdate", () => {
    it("trims the residency a master admin saves", async () => {
      const { data } = await runOnBeforeUpdate({
        dataResidency: "  EU (Frankfurt)  ",
      });

      expect(data["dataResidency"]).toBe("EU (Frankfurt)");
    });

    /*
     * The Admin Dashboard's text field submits "" when the admin clears it.
     * That has to land as NULL, so the customer's settings stop showing it.
     */
    it("turns a cleared field into null", async () => {
      const { data } = await runOnBeforeUpdate({ dataResidency: "" });

      expect(data["dataResidency"]).toBeNull();
    });

    it("keeps null as null", async () => {
      const { data } = await runOnBeforeUpdate({ dataResidency: null });

      expect(data["dataResidency"]).toBeNull();
    });

    it("hands back the same updateBy it was given, with no carry-forward", async () => {
      const updateBy: UpdateBy<Project> = makeUpdateBy({
        dataResidency: "US East",
      });

      const result: OnUpdate<Project> = await (
        ProjectService as any
      ).onBeforeUpdate(updateBy);

      expect(result.updateBy).toBe(updateBy);
      expect(result.carryForward).toEqual([]);
    });

    it("rejects an over-long value before anything is written", async () => {
      await expect(
        runOnBeforeUpdate({ dataResidency: "x".repeat(250) }),
      ).rejects.toThrow(BadDataException);
    });

    it("rejects a value that is not text", async () => {
      await expect(runOnBeforeUpdate({ dataResidency: 7 })).rejects.toThrow(
        "Data residency must be text.",
      );
    });

    it("does not touch updates that do not carry the column", async () => {
      const { data } = await runOnBeforeUpdate({ name: "Renamed" });

      expect(data).toEqual({ name: "Renamed" });
    });

    it("leaves the other columns in the same update alone", async () => {
      const { data } = await runOnBeforeUpdate({
        name: "Renamed",
        dataResidency: " EU ",
      });

      expect(data).toEqual({ name: "Renamed", dataResidency: "EU" });
    });

    it("does not sync anything to the payment provider", async () => {
      await runOnBeforeUpdate({ dataResidency: "EU" });

      expect(
        BillingService.updateCustomerBusinessDetails,
      ).not.toHaveBeenCalled();
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });

    it("still syncs business details to the payment provider when they ride along", async () => {
      /*
       * The residency rules run first in the hook. This proves they do not
       * short-circuit the rest of it.
       */
      (ProjectService.findOneById as jest.Mock).mockResolvedValue({
        paymentProviderCustomerId: "cus_123",
      } as never);

      const { data } = await runOnBeforeUpdate({
        dataResidency: " EU ",
        businessDetails: "Acme Ltd",
      });

      expect(data["dataResidency"]).toBe("EU");
      expect(
        BillingService.updateCustomerBusinessDetails,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("onBeforeCreate", () => {
    /*
     * onBeforeCreate goes on to look the creating user up. The lookup is
     * stubbed to stop the hook right there, and records what the residency
     * looked like at that moment - which proves the rules ran first, before
     * any other work the hook does.
     */
    const STOP: Error = new Error("stop after the residency rules");

    function makeCreateBy(project: Project): CreateBy<Project> {
      return {
        data: project,
        props: { userId: ObjectID.generate(), isMasterAdmin: true },
      } as unknown as CreateBy<Project>;
    }

    it("trims the residency before looking up the creating user", async () => {
      let seenDataResidency: unknown = "not called";

      getJestSpyOn(UserService, "findOneById").mockImplementation(
        ((): never => {
          seenDataResidency = project.dataResidency;
          throw STOP;
        }) as never,
      );

      const project: Project = new Project();
      project.name = "Acme";
      project.dataResidency = "  EU (Frankfurt) ";

      await expect(
        (ProjectService as any).onBeforeCreate(makeCreateBy(project)),
      ).rejects.toBe(STOP);

      expect(seenDataResidency).toBe("EU (Frankfurt)");
    });

    it("rejects an over-long residency without looking up the user", async () => {
      getJestSpyOn(UserService, "findOneById").mockImplementation(
        ((): never => {
          throw STOP;
        }) as never,
      );

      const project: Project = new Project();
      project.name = "Acme";
      project.dataResidency = "a".repeat(101);

      await expect(
        (ProjectService as any).onBeforeCreate(makeCreateBy(project)),
      ).rejects.toThrow(BadDataException);

      expect(UserService.findOneById).not.toHaveBeenCalled();
    });

    it("still requires a project name first", async () => {
      const project: Project = new Project();
      project.dataResidency = "EU";

      await expect(
        (ProjectService as any).onBeforeCreate(makeCreateBy(project)),
      ).rejects.toThrow("Project name is required");
    });

    it("creates a project without a residency exactly as before", async () => {
      let seen: boolean = false;

      getJestSpyOn(UserService, "findOneById").mockImplementation(
        ((): never => {
          seen = true;
          throw STOP;
        }) as never,
      );

      const project: Project = new Project();
      project.name = "Acme";

      await expect(
        (ProjectService as any).onBeforeCreate(makeCreateBy(project)),
      ).rejects.toBe(STOP);

      expect(seen).toBe(true);
      expect(project.dataResidency).toBeUndefined();
    });
  });
});
