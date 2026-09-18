import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * Data residency is a OneUptime Cloud concept. A self-hosted install is
 * wherever its operator put it, so on IsBillingEnabled=false the server
 * refuses to store a residency at all - even from a master admin, even
 * through the API rather than the Admin Dashboard (which does not offer the
 * card there).
 *
 * Clearing is the exception: an install that turned billing off after a
 * residency was set can still remove it.
 *
 * The flag is read at module scope, so this is a separate file from the
 * billing-on suite rather than a case inside it.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const REFUSAL: string =
  "Data residency can only be set when billing is enabled.";

type UpdateData = Record<string, unknown>;

function makeUpdateBy(
  data: UpdateData,
  props: Record<string, unknown> = { isMasterAdmin: true },
): UpdateBy<Project> {
  return {
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: props,
  } as unknown as UpdateBy<Project>;
}

describe("ProjectService data residency on a self-hosted install", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("applyDataResidencyRules", () => {
    it("refuses to set a residency", () => {
      expect(() => {
        ProjectService.applyDataResidencyRules({ dataResidency: "EU" });
      }).toThrow(BadDataException);
    });

    it("says why it refused", () => {
      expect(() => {
        ProjectService.applyDataResidencyRules({ dataResidency: "EU" });
      }).toThrow(REFUSAL);
    });

    it("refuses a residency that is only padded with whitespace", () => {
      expect(() => {
        ProjectService.applyDataResidencyRules({ dataResidency: "  EU  " });
      }).toThrow(REFUSAL);
    });

    it("allows clearing it with null", () => {
      const data: UpdateData = { dataResidency: null };

      expect(() => {
        ProjectService.applyDataResidencyRules(data);
      }).not.toThrow();

      expect(data["dataResidency"]).toBeNull();
    });

    it("allows clearing it with an empty string, and stores null", () => {
      const data: UpdateData = { dataResidency: "" };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBeNull();
    });

    it("allows clearing it with whitespace, and stores null", () => {
      const data: UpdateData = { dataResidency: "   " };

      ProjectService.applyDataResidencyRules(data);

      expect(data["dataResidency"]).toBeNull();
    });

    it("ignores data that does not carry the column", () => {
      const data: UpdateData = { name: "Renamed" };

      expect(() => {
        ProjectService.applyDataResidencyRules(data);
      }).not.toThrow();

      expect(data).toEqual({ name: "Renamed" });
    });

    /*
     * The shape check still comes first: a number is not "a residency the
     * server will not store", it is not a residency at all.
     */
    it("reports a non-text value as not text, not as a billing refusal", () => {
      expect(() => {
        ProjectService.applyDataResidencyRules({ dataResidency: 7 });
      }).toThrow("Data residency must be text.");
    });
  });

  describe("onBeforeUpdate", () => {
    it("refuses a master admin setting a residency", async () => {
      await expect(
        (ProjectService as any).onBeforeUpdate(
          makeUpdateBy({ dataResidency: "EU (Frankfurt)" }),
        ),
      ).rejects.toThrow(REFUSAL);
    });

    it("refuses a root caller setting one too", async () => {
      await expect(
        (ProjectService as any).onBeforeUpdate(
          makeUpdateBy({ dataResidency: "EU" }, { isRoot: true }),
        ),
      ).rejects.toThrow(REFUSAL);
    });

    it("lets a master admin clear it", async () => {
      const result: OnUpdate<Project> = await (
        ProjectService as any
      ).onBeforeUpdate(makeUpdateBy({ dataResidency: "" }));

      expect((result.updateBy.data as UpdateData)["dataResidency"]).toBeNull();
    });

    it("leaves every other project update working as before", async () => {
      const result: OnUpdate<Project> = await (
        ProjectService as any
      ).onBeforeUpdate(makeUpdateBy({ name: "Renamed" }));

      expect(result.updateBy.data).toEqual({ name: "Renamed" });
    });
  });

  describe("onBeforeCreate", () => {
    it("refuses a new project that carries a residency, before looking up the user", async () => {
      getJestSpyOn(UserService, "findOneById").mockResolvedValue(null as never);

      const project: Project = new Project();
      project.name = "Acme";
      project.dataResidency = "EU";

      await expect(
        (ProjectService as any).onBeforeCreate({
          data: project,
          props: { userId: ObjectID.generate(), isMasterAdmin: true },
        } as unknown as CreateBy<Project>),
      ).rejects.toThrow(REFUSAL);

      expect(UserService.findOneById).not.toHaveBeenCalled();
    });
  });
});
