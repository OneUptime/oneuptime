/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY - an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseService from "../../../Server/Services/BaseService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Services from "../../../Server/Services/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import BaseModelComponents from "../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, { Argument } from "../../../Types/Workflow/Component";
import {
  getCreateFromTemplateArgument,
  getCreateFromTemplateColumn,
  getCreateFromTemplateTableNames,
} from "../../../Types/Workflow/CreateFromTemplate";
import Text from "../../../Types/Text";
import { describe, expect, test } from "@jest/globals";

/*
 * A WORKFLOW'S TEMPLATE SETTING AND THE SERVICE THAT APPLIES IT, TOGETHER.
 *
 * A Create One step gets a template setting for the tables
 * Types/Workflow/CreateFromTemplate names, and hands the picked template to
 * its record's service (DatabaseService.createFromTemplate), which refuses
 * it unless the service applies templates itself. So:
 *
 *  - every table with the setting has a service that overrides
 *    createFromTemplate - a step whose setting reached the refusal would be
 *    a setting that never works;
 *  - every service that overrides it has the setting, so no service applies
 *    templates that no step can reach;
 *  - the column a record remembers its template in exists and is
 *    OneUptime's to write: no caller may send it, and the service writes it.
 */

const DATABASE_SERVICES: Array<DatabaseService<BaseModel>> = (
  Services as Array<BaseService>
).filter((service: BaseService): boolean => {
  return service instanceof DatabaseService;
}) as Array<DatabaseService<BaseModel>>;

// Whether the service, or a class between it and DatabaseService, applies templates.
function appliesTemplates(service: DatabaseService<BaseModel>): boolean {
  let prototype: Record<string, unknown> | null =
    Object.getPrototypeOf(service);

  while (prototype && prototype !== (DatabaseService.prototype as unknown)) {
    if (Object.prototype.hasOwnProperty.call(prototype, "createFromTemplate")) {
      return true;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return false;
}

function servicesOf(tableName: string): Array<DatabaseService<BaseModel>> {
  return DATABASE_SERVICES.filter(
    (service: DatabaseService<BaseModel>): boolean => {
      return service.getModel().tableName === tableName;
    },
  );
}

describe("a template setting has a service that applies it", () => {
  test("the tables whose Create One step has a template setting", () => {
    expect(getCreateFromTemplateTableNames()).toEqual(["Incident"]);
  });

  test.each(getCreateFromTemplateTableNames())(
    "%s: its service applies templates",
    (tableName: string) => {
      const services: Array<DatabaseService<BaseModel>> = servicesOf(tableName);

      expect(services.length).toBeGreaterThan(0);

      for (const service of services) {
        expect({ tableName, applies: appliesTemplates(service) }).toEqual({
          tableName,
          applies: true,
        });
      }
    },
  );

  test("every service that applies templates has a step setting that reaches it", () => {
    const tables: Array<string> = DATABASE_SERVICES.filter(appliesTemplates)
      .map((service: DatabaseService<BaseModel>): string => {
        return service.getModel().tableName || "";
      })
      .sort();

    expect(Array.from(new Set(tables))).toEqual(
      getCreateFromTemplateTableNames(),
    );
  });

  test.each(getCreateFromTemplateTableNames())(
    "%s: the column the template is recorded in is OneUptime's to write",
    (tableName: string) => {
      const model: BaseModel = servicesOf(tableName)[0]!.getModel();
      const column: string | null = getCreateFromTemplateColumn(tableName);

      expect(column).not.toBeNull();
      expect(model.getTableColumnMetadata(column!)).toBeTruthy();

      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column!);

      expect(access?.create).toEqual([]);
      expect(access?.update).toEqual([]);
    },
  );

  test.each(getCreateFromTemplateTableNames())(
    "%s: the Create One step offers the setting first, and makes JSON Object optional with it",
    (tableName: string) => {
      const model: BaseModel = servicesOf(tableName)[0]!.getModel();
      const createOne: ComponentMetadata | undefined =
        BaseModelComponents.getComponents(model).find(
          (component: ComponentMetadata): boolean => {
            return (
              component.id ===
              `${Text.pascalCaseToDashes(tableName)}-create-one`
            );
          },
        );
      const setting: Argument = getCreateFromTemplateArgument(tableName)!;

      expect(
        (createOne?.arguments || []).map((argument: Argument): string => {
          return argument.id;
        }),
      ).toEqual([setting.id, "json"]);
      expect(createOne?.arguments?.[0]).toEqual(setting);
      expect(createOne?.arguments?.[1]?.notRequiredWhen).toEqual({
        argumentId: setting.id,
      });
    },
  );
});
