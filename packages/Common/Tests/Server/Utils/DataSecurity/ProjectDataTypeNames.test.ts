import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityCustomDataTypeService from "../../../../Server/Services/DataSecurityCustomDataTypeService";
import ProjectDataTypeNames from "../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A PROJECT'S DATA TYPES, NAMED FOR ONE REQUEST (#10363).
 *
 * The project's own types are read once - their ids and names, nothing
 * else - as OneUptime, or as the reader when the reader's own permissions
 * decide what they see (Ask AI). A reader who may not read them gets each
 * named "Custom data type", never an id; one that is gone reads as deleted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10363000-0000-4000-8000-000000000001",
);
const EMPLOYEE_ROW: string = "10363000-0000-4000-8000-0000000000e1";
const GONE_ROW: string = "10363000-0000-4000-8000-0000000000e2";

function customType(id: string, name: string): DataSecurityCustomDataType {
  const row: DataSecurityCustomDataType = new DataSecurityCustomDataType(
    new ObjectID(id),
  );
  row.name = name;
  return row;
}

function read(
  answer: Array<DataSecurityCustomDataType> | Error,
): SpyInstance<typeof DataSecurityCustomDataTypeService.findBy> {
  return jest
    .spyOn(DataSecurityCustomDataTypeService, "findBy")
    .mockImplementation((async () => {
      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    }) as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectDataTypeNames.read", () => {
  test("reads the project's custom types once, their ids and names only, as OneUptime", async () => {
    const spy: SpyInstance<typeof DataSecurityCustomDataTypeService.findBy> =
      read([customType(EMPLOYEE_ROW, "Employee ID")]);

    const namer: DataTypeNamer = await ProjectDataTypeNames.read({
      projectId: PROJECT_ID,
    });

    expect(spy).toHaveBeenCalledTimes(1);

    const call: JSONObject = spy.mock.calls[0]![0] as unknown as JSONObject;

    expect(call["query"]).toEqual({ projectId: PROJECT_ID });
    expect(call["select"]).toEqual({ _id: true, name: true });
    expect(call["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(call["props"]).toEqual({ isRoot: true });
    expect(namer.nameOf(`custom:${EMPLOYEE_ROW}`)).toBe("Employee ID");
    expect(namer.nameOf(`custom:${GONE_ROW}`)).toBe("A deleted data type");
    expect(namer.nameOf("email-address")).toBe("Email address");
  });

  test("reads them with the reader's own permissions when it is handed them", async () => {
    const spy: SpyInstance<typeof DataSecurityCustomDataTypeService.findBy> =
      read([customType(EMPLOYEE_ROW, "Employee ID")]);
    const props: DatabaseCommonInteractionProps = {
      userId: ObjectID.generate(),
      tenantId: PROJECT_ID,
    };

    await ProjectDataTypeNames.read({ projectId: PROJECT_ID, props });

    expect((spy.mock.calls[0]![0] as unknown as JSONObject)["props"]).toBe(
      props,
    );
  });

  test.each([
    ["a role that may not read them", new NotAuthorizedException("No.")],
    ["a plan without them", new PaymentRequiredException("Upgrade.")],
  ])(
    "%s gets each named as a custom data type, never by an id",
    async (_who: string, refusal: Error) => {
      read(refusal);

      const namer: DataTypeNamer = await ProjectDataTypeNames.read({
        projectId: PROJECT_ID,
        props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
      });

      expect(namer.hasCustomTypes()).toBe(false);
      expect(namer.nameOf(`custom:${EMPLOYEE_ROW}`)).toBe("Custom data type");
      expect(namer.nameOf("credit-card-number")).toBe("Card number");
    },
  );

  test("a read that fails for another reason fails the request", async () => {
    read(new BadDataException("The database is down."));

    await expect(
      ProjectDataTypeNames.read({ projectId: PROJECT_ID }),
    ).rejects.toThrow("The database is down.");
  });

  test("a project with no custom types names every custom id as deleted", async () => {
    read([]);

    const namer: DataTypeNamer = await ProjectDataTypeNames.read({
      projectId: PROJECT_ID,
    });

    expect(namer.hasCustomTypes()).toBe(true);
    expect(namer.nameOf(`custom:${EMPLOYEE_ROW}`)).toBe("A deleted data type");
  });
});
