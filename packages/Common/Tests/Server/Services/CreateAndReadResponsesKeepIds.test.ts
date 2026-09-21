import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import User from "../../../Models/DatabaseModels/User";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectSSOService from "../../../Server/Services/ProjectSsoService";
import UserService from "../../../Server/Services/UserService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * WHY THIS FILE EXISTS.
 *
 * A project owner's POST /api/project-scim answered 200 with every column of
 * the new row EXCEPT "_id", and the get-list that followed - selecting
 * {_id:true, name:true} - came back as [{name}]. Nothing was wrong with the
 * data or the query: the row carried its real `_id` in memory and `_id`
 * reached TypeORM in the projection. The id was dropped while serializing the
 * response, because DatabaseBaseModel.toJSONObject iterates a column list that
 * is cached per model class, and that cache had been built from the create
 * path's own mutilated model instance - BaseAPI.createItem deleted `_id` off
 * it, and DatabaseService.create asks that instance for its columns
 * (generateDefaultValues) on the way through. One create poisoned the class
 * for the life of the process, for every later caller.
 *
 * These tests drive the real services with a mocked repository - no database -
 * and deliberately delete `_id` off the model handed to create(), which is
 * what the API used to do. They assert the whole round trip keeps its ids
 * anyway. Each test uses a different model because the caches are per class
 * and per process: reusing one would leave a warm cache and pass vacuously.
 *
 * Three callers, because the accidental mitigation on the create path
 * (enforceTenantRelationMatchesScalar, which warms the cache from the
 * service's own healthy model) skipped exactly these:
 *   a) a project owner on a tenant-scoped model - the reported case
 *   b) an isRoot caller, which returns before that guard runs
 *   c) a REFUSED create on a model with no tenant column - proof that a
 *      request nobody was allowed to make cannot poison anything, since the
 *      columns are read ~20 lines before the create permission check
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const ROW_ID: string = "22222222-2222-4222-8222-222222222222";

function ownerProps(): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
  ].map((permission: Permission) => {
    return {
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission" as const,
    };
  });

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions,
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function loggedInUserProps(): DatabaseCommonInteractionProps {
  return {
    ...ownerProps(),
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.CurrentUser],
      _type: "UserGlobalAccessPermission",
    },
  };
}

/*
 * Stands in for Postgres: `save` stamps the generated uuid onto the entity the
 * way the driver writes it back, and `find` returns a row that has one.
 */
function mockRepository(
  service: unknown,
  modelType: { new (): BaseModel },
  rowFields: JSONObject,
): void {
  const repository: Record<string, unknown> = {
    save: async (entity: BaseModel): Promise<BaseModel> => {
      entity._id = ROW_ID;
      return entity;
    },
    find: async (): Promise<Array<BaseModel>> => {
      const row: BaseModel = new modelType();
      row._id = ROW_ID;
      Object.assign(row, rowFields);
      return [row];
    },
    findOneBy: async (): Promise<null> => {
      return null;
    },
    count: async (): Promise<number> => {
      return 0;
    },
  };

  jest
    .spyOn(service as never, "getRepository" as never)
    .mockReturnValue(repository as never);
}

/* What BaseAPI.createItem used to hand the service: `_id` deleted outright. */
function payloadWithIdDeleted<T extends BaseModel>(
  json: JSONObject,
  modelType: { new (): T },
): T {
  const item: T = BaseModel.fromJSON<T>(json, modelType) as T;
  delete (item as unknown as Record<string, unknown>)["_id"];

  return item;
}

describe("create and read responses keep their _id", () => {
  test("a project owner creating and then listing a tenant-scoped model (the reported case)", async () => {
    mockRepository(ProjectSCIMService, ProjectSCIM, { name: "listed scim" });

    const savedItem: ProjectSCIM = await ProjectSCIMService.create({
      data: payloadWithIdDeleted<ProjectSCIM>(
        {
          name: "created scim",
          projectId: PROJECT_ID.toString(),
          bearerToken: "scim-token",
        },
        ProjectSCIM,
      ),
      props: ownerProps(),
    });

    const createResponse: JSONObject = BaseModel.toJSON(savedItem, ProjectSCIM);

    expect(savedItem._id).toBe(ROW_ID);
    expect(createResponse["_id"]).toBe(ROW_ID);

    const rows: Array<ProjectSCIM> = await ProjectSCIMService.findBy({
      query: { projectId: PROJECT_ID },
      select: { _id: true, name: true } as never,
      limit: 50,
      skip: 0,
      props: ownerProps(),
    });

    const listResponse: JSONArray = BaseModel.toJSONObjectArray(
      rows,
      ProjectSCIM,
    );

    expect(rows[0]?._id).toBe(ROW_ID);
    expect((listResponse[0] as JSONObject)["_id"]).toBe(ROW_ID);
    expect((listResponse[0] as JSONObject)["name"]).toBe("listed scim");
  });

  test("an isRoot caller creating, then a project owner listing", async () => {
    /*
     * isRoot returns from enforceTenantRelationMatchesScalar before it can
     * warm the column cache, so on master this create was the first thing to
     * describe the class - and it described it without an id.
     */
    mockRepository(ProjectSSOService, ProjectSso, { name: "listed sso" });

    const savedItem: ProjectSso = await ProjectSSOService.create({
      data: payloadWithIdDeleted<ProjectSso>(
        {
          name: "created sso",
          description: "created by the root caller",
          projectId: PROJECT_ID.toString(),
          signatureMethod: "RSA-SHA256",
          digestMethod: "SHA256",
          signOnURL: "https://example.com/sso",
          issuerURL: "https://example.com",
          publicCertificate: "a-certificate",
        },
        ProjectSso,
      ),
      props: { isRoot: true },
    });

    expect(BaseModel.toJSON(savedItem, ProjectSso)["_id"]).toBe(ROW_ID);

    const rows: Array<ProjectSso> = await ProjectSSOService.findBy({
      query: { projectId: PROJECT_ID },
      select: { _id: true, name: true } as never,
      limit: 50,
      skip: 0,
      props: ownerProps(),
    });

    const listResponse: JSONArray = BaseModel.toJSONObjectArray(
      rows,
      ProjectSso,
    );

    expect((listResponse[0] as JSONObject)["_id"]).toBe(ROW_ID);
  });

  test("a REFUSED create on a model with no tenant column cannot strip ids from later reads", async () => {
    /*
     * User.create is `[]` - nobody may POST /api/user - and User has no
     * @TenantColumn, so neither the permission check nor the tenant guard
     * stood between the request and the column cache. One authenticated POST
     * that always 4xxs was enough to strip `_id` from every User response the
     * process served afterwards.
     */
    mockRepository(UserService, User, {
      email: { _type: "Email", value: "someone@example.com" },
    });

    await expect(
      UserService.create({
        data: payloadWithIdDeleted<User>(
          { email: "attacker@example.com" },
          User,
        ),
        props: loggedInUserProps(),
      }),
    ).rejects.toThrow(/not allowed/i);

    const rows: Array<User> = await UserService.findBy({
      query: { _id: USER_ID.toString() } as never,
      select: { _id: true, email: true } as never,
      limit: 10,
      skip: 0,
      props: loggedInUserProps(),
    });

    const listResponse: JSONArray = BaseModel.toJSONObjectArray(rows, User);

    expect(rows[0]?._id).toBe(ROW_ID);
    expect((listResponse[0] as JSONObject)["_id"]).toBe(ROW_ID);
  });
});
