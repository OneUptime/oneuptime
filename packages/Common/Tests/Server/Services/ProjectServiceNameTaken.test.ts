import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import NameTakenException, {
  NAME_TAKEN_REFUSAL_CODE,
} from "../../../Types/Exception/NameTakenException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * A NEW PROJECT NAMED AS ONE OF THE PERSON'S OWN (#10065).
 *
 * A person's projects each have a name of their own: a new one named as
 * one they are already in is refused, in the words the create dialog says
 * under its Name field, and now with the code every refusal of a taken
 * name carries (NameTakenException), so a program tells it apart without
 * reading the sentence. Nothing below the service boundary runs.
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

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      // The person is in one project already.
      projectIds: [PROJECT_ID],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;
}

function runOnBeforeCreate(name: string): Promise<OnCreate<Project>> {
  const project: Project = new Project();
  project.name = name;

  return (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props: userProps(),
  } as CreateBy<Project>);
}

describe("a new project named as one of the person's own", () => {
  beforeEach(() => {
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(
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

  it("is refused in its words as before, with the code of a taken name", async () => {
    getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
      new PositiveNumber(1) as never,
    );

    const error: unknown = await runOnBeforeCreate("Acme").catch(
      (caught: unknown): unknown => {
        return caught;
      },
    );

    expect(error).toBeInstanceOf(NameTakenException);
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "You already have a project with the same name. Choose another name.",
    );
    expect(getErrorDetails(error)).toEqual({
      refusalCode: NAME_TAKEN_REFUSAL_CODE,
    });
  });

  it("goes on when none of the person's projects has the name", async () => {
    getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );

    await expect(runOnBeforeCreate("Acme")).resolves.toBeDefined();
  });
});
