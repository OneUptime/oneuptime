import type DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type { UserModelClass } from "../../../Models/DatabaseModels/DatabaseBaseModel/UserModelType";
import type { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE USER MODEL, FOR THE RELATION EVERY RECORD HAS TO WHOEVER LAST CHANGED
 * IT (DatabaseBaseModel.lastModifiedByUser, #10290).
 *
 * User extends DatabaseBaseModel, so the relation reads it through
 * UserModelType, never through an import at the top of DatabaseBaseModel.
 * On a server that module requires User when nothing has loaded it yet. A
 * browser build takes UserModelType.browser.ts in its place (the "browser"
 * field of packages/Common/package.json), which requires nothing: the
 * bundler had wrapped User and every module it imports to run later, and
 * every public page downloaded those wrappers before it could draw
 * (UserModelFirstLoadBuild.test.ts). There, User's file says it is the User
 * model as it loads (setUserModelType).
 *
 * Each case loads the modules afresh (jest.isolateModules), so what one
 * loads is not there for the next.
 */

type UserModelTypeModule = {
  getUserModelType: () => UserModelClass;
  setUserModelType: (modelType: UserModelClass) => void;
};

const SERVER_MODULE: string =
  "../../../Models/DatabaseModels/DatabaseBaseModel/UserModelType";
const BROWSER_MODULE: string =
  "../../../Models/DatabaseModels/DatabaseBaseModel/UserModelType.browser";
const USER_MODULE: string = "../../../Models/DatabaseModels/User";

describe("on a server", () => {
  test("the relation to whoever last changed a record resolves to User, on every model", () => {
    jest.isolateModules(() => {
      const User: UserModelClass = (
        jest.requireActual(USER_MODULE) as { default: UserModelClass }
      ).default;
      const Label: { new (): DatabaseBaseModel } = (
        jest.requireActual("../../../Models/DatabaseModels/Label") as {
          default: { new (): DatabaseBaseModel };
        }
      ).default;

      for (const model of [new Label(), new User()]) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata("lastModifiedByUser");

        expect(metadata.modelType).toBe(User);
      }
    });
  });

  test("User is required when nothing has loaded it yet", () => {
    jest.isolateModules(() => {
      const userModelType: UserModelTypeModule = jest.requireActual(
        SERVER_MODULE,
      ) as UserModelTypeModule;

      const resolved: UserModelClass = userModelType.getUserModelType();
      const User: UserModelClass = (
        jest.requireActual(USER_MODULE) as { default: UserModelClass }
      ).default;

      expect(resolved).toBe(User);
    });
  });

  test("User's file says it is the User model as it loads", () => {
    jest.isolateModules(() => {
      const userModelType: UserModelTypeModule = jest.requireActual(
        SERVER_MODULE,
      ) as UserModelTypeModule;
      const setUserModelType: ReturnType<typeof jest.spyOn> = jest.spyOn(
        userModelType,
        "setUserModelType",
      );

      const User: UserModelClass = (
        jest.requireActual(USER_MODULE) as { default: UserModelClass }
      ).default;

      expect(setUserModelType).toHaveBeenCalledWith(User);
      expect(userModelType.getUserModelType()).toBe(User);
    });
  });
});

describe("in a browser build (UserModelType.browser.ts)", () => {
  test("it is the model User's file said it is", () => {
    jest.isolateModules(() => {
      const userModelType: UserModelTypeModule = jest.requireActual(
        BROWSER_MODULE,
      ) as UserModelTypeModule;

      class StandInUser {}

      userModelType.setUserModelType(StandInUser as unknown as UserModelClass);

      expect(userModelType.getUserModelType()).toBe(StandInUser);
    });
  });

  test("before User has loaded it is nothing, and the relation is resolved again when next read", () => {
    jest.isolateModules(() => {
      const userModelType: UserModelTypeModule = jest.requireActual(
        BROWSER_MODULE,
      ) as UserModelTypeModule;

      expect(userModelType.getUserModelType()).toBeFalsy();
    });
  });

  test("requires nothing, so the bundler wraps no module to run later", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, `${BROWSER_MODULE}.ts`),
      "utf8",
    );

    expect(source).not.toMatch(/\brequire\s*\(\s*["'`]/);
  });
});
