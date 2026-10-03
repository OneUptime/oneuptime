import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  NUMBER_PREFIX_COLUMNS,
  NumberPrefixColumnInfo,
} from "../../../Utils/Project/NumberPrefix";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * What ProjectService stores for a number prefix - the text in front of
 * incident, alert, episode and scheduled maintenance numbers (INC-42).
 *
 * The dashboard's Number Prefix pages check a prefix before they save it,
 * but the API takes one from anyone allowed to update the project, so the
 * server holds the same rules (NumberPrefixUtil): a prefix is stored
 * trimmed, a blank one as null (numbers then start with #), and one that is
 * too long, holds a space or a character Markdown, Slack or HTML would read,
 * or ends with a digit that would run into the number, is refused - naming
 * the prefix. A write that does not carry a prefix leaves it alone.
 *
 * Nothing below the service boundary runs: no database.
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
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

type Data = Record<string, unknown>;

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;
}

async function runOnBeforeUpdate(data: Data): Promise<Data> {
  const result: OnUpdate<Project> = await (
    ProjectService as unknown as {
      onBeforeUpdate: (
        updateBy: UpdateBy<Project>,
      ) => Promise<OnUpdate<Project>>;
    }
  ).onBeforeUpdate({
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<Project>);

  return result.updateBy.data as unknown as Data;
}

async function runOnBeforeCreate(project: Project): Promise<Project> {
  const result: OnCreate<Project> = await (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props: userProps(),
  } as CreateBy<Project>);

  return result.createBy.data;
}

function valueOf(project: Project, column: string): unknown {
  return (project as unknown as Data)[column];
}

const DIGIT_MESSAGE: string =
  "End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.";
const CHARACTER_MESSAGE: string =
  "Use only letters, numbers and - _ . / : # (no spaces).";
const LENGTH_MESSAGE: string = "Use 20 characters or fewer.";

describe("ProjectService number prefixes", () => {
  let findUserSpy: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    findUserSpy = getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      new User() as never,
    );
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("applyNumberPrefixRules", () => {
    it("stores a prefix as typed", () => {
      const data: Data = { incidentNumberPrefix: "OPS-" };

      ProjectService.applyNumberPrefixRules(data);

      expect(data["incidentNumberPrefix"]).toBe("OPS-");
    });

    it("trims surrounding whitespace", () => {
      const data: Data = { alertNumberPrefix: "  ALRT-\n" };

      ProjectService.applyNumberPrefixRules(data);

      expect(data["alertNumberPrefix"]).toBe("ALRT-");
    });

    // The dashboard's text field submits "" when the prefix is cleared.
    it("stores an empty or blank prefix as null, so numbers start with #", () => {
      const data: Data = {
        incidentNumberPrefix: "",
        incidentEpisodeNumberPrefix: "   ",
        alertNumberPrefix: null,
      };

      ProjectService.applyNumberPrefixRules(data);

      expect(data).toEqual({
        incidentNumberPrefix: null,
        incidentEpisodeNumberPrefix: null,
        alertNumberPrefix: null,
      });
    });

    it("applies to all five prefixes", () => {
      const data: Data = {};

      for (const info of NUMBER_PREFIX_COLUMNS) {
        data[info.column] = `  ${info.defaultForNewProjects}  `;
      }

      ProjectService.applyNumberPrefixRules(data);

      for (const info of NUMBER_PREFIX_COLUMNS) {
        expect(data[info.column]).toBe(info.defaultForNewProjects);
      }
    });

    /*
     * An update that does not mention a prefix must not start writing it:
     * adding the key - even as null - would wipe the prefix every time the
     * project was renamed.
     */
    it("does not add a prefix to data that did not carry it", () => {
      const data: Data = { name: "Renamed" };

      ProjectService.applyNumberPrefixRules(data);

      expect(data).toEqual({ name: "Renamed" });
      for (const info of NUMBER_PREFIX_COLUMNS) {
        expect(Object.prototype.hasOwnProperty.call(data, info.column)).toBe(
          false,
        );
      }
    });

    it.each(
      NUMBER_PREFIX_COLUMNS.map(
        (info: NumberPrefixColumnInfo): [string, string] => {
          return [info.column, info.title];
        },
      ),
    )(
      "refuses %s when it ends with a digit, naming it by its title",
      (column: string, title: string) => {
        expect(() => {
          ProjectService.applyNumberPrefixRules({ [column]: "SEV1" });
        }).toThrow(new BadDataException(`${title}: ${DIGIT_MESSAGE}`));
      },
    );

    it("refuses a prefix with a space or a character that is not allowed", () => {
      expect(() => {
        ProjectService.applyNumberPrefixRules({
          incidentNumberPrefix: "IN C-",
        });
      }).toThrow(`Incident Number Prefix: ${CHARACTER_MESSAGE}`);
      expect(() => {
        ProjectService.applyNumberPrefixRules({
          alertEpisodeNumberPrefix: "<b>",
        });
      }).toThrow(`Alert Episode Number Prefix: ${CHARACTER_MESSAGE}`);
    });

    it("refuses a prefix longer than 20 characters", () => {
      expect(() => {
        ProjectService.applyNumberPrefixRules({
          scheduledMaintenanceNumberPrefix: "M".repeat(21),
        });
      }).toThrow(`Scheduled Maintenance Number Prefix: ${LENGTH_MESSAGE}`);
    });

    it("refuses a prefix that is not text", () => {
      expect(() => {
        ProjectService.applyNumberPrefixRules({ incidentNumberPrefix: 42 });
      }).toThrow("Incident Number Prefix must be text.");
    });

    it("works on a Project model instance, as onBeforeCreate hands it one", () => {
      const project: Project = new Project();
      project.name = "Acme";
      project.incidentNumberPrefix = "  OPS-  ";

      ProjectService.applyNumberPrefixRules(project);

      expect(project.incidentNumberPrefix).toBe("OPS-");
      expect(project.alertNumberPrefix).toBeUndefined();
      expect(project.name).toBe("Acme");
    });
  });

  describe("onBeforeUpdate", () => {
    it("stores the prefix the Number Prefix page saves, trimmed", async () => {
      const data: Data = await runOnBeforeUpdate({
        incidentNumberPrefix: "  OPS-  ",
        incidentEpisodeNumberPrefix: "IE-",
      });

      expect(data["incidentNumberPrefix"]).toBe("OPS-");
      expect(data["incidentEpisodeNumberPrefix"]).toBe("IE-");
    });

    it("stores a cleared prefix as null", async () => {
      const data: Data = await runOnBeforeUpdate({ alertNumberPrefix: "" });

      expect(data["alertNumberPrefix"]).toBeNull();
    });

    it("refuses a prefix that breaks a rule, before anything is written", async () => {
      await expect(
        runOnBeforeUpdate({ incidentNumberPrefix: "SEV1" }),
      ).rejects.toThrow(`Incident Number Prefix: ${DIGIT_MESSAGE}`);
      await expect(
        runOnBeforeUpdate({ alertNumberPrefix: "ALT -" }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    it("leaves an update that carries no prefix alone", async () => {
      const data: Data = await runOnBeforeUpdate({ name: "Renamed" });

      expect(data).toEqual({ name: "Renamed" });
    });
  });

  describe("onBeforeCreate", () => {
    it("gives a new project the five default prefixes", async () => {
      const project: Project = new Project();
      project.name = "Acme";

      const created: Project = await runOnBeforeCreate(project);

      expect(
        NUMBER_PREFIX_COLUMNS.map(
          (info: NumberPrefixColumnInfo): [string, unknown] => {
            return [info.column, valueOf(created, info.column)];
          },
        ),
      ).toEqual([
        ["incidentNumberPrefix", "INC-"],
        ["incidentEpisodeNumberPrefix", "IE-"],
        ["alertNumberPrefix", "ALT-"],
        ["alertEpisodeNumberPrefix", "AE-"],
        ["scheduledMaintenanceNumberPrefix", "SM-"],
      ]);
    });

    it("keeps a prefix the create request sets, trimmed", async () => {
      const project: Project = new Project();
      project.name = "Acme";
      project.incidentNumberPrefix = "  OPS-  ";

      const created: Project = await runOnBeforeCreate(project);

      expect(created.incidentNumberPrefix).toBe("OPS-");
      // The others still get their defaults.
      expect(created.alertNumberPrefix).toBe("ALT-");
    });

    it("gives a blank prefix the default, as before", async () => {
      const project: Project = new Project();
      project.name = "Acme";
      project.incidentEpisodeNumberPrefix = "   ";

      const created: Project = await runOnBeforeCreate(project);

      expect(created.incidentEpisodeNumberPrefix).toBe("IE-");
    });

    it("refuses a prefix that breaks a rule, before the project is set up", async () => {
      const project: Project = new Project();
      project.name = "Acme";
      project.scheduledMaintenanceNumberPrefix = "SM 1";

      await expect(runOnBeforeCreate(project)).rejects.toThrow(
        `Scheduled Maintenance Number Prefix: ${CHARACTER_MESSAGE}`,
      );
      expect(findUserSpy).not.toHaveBeenCalled();
    });
  });
});
