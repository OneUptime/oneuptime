import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import PublicPermission from "../../../../../Server/Types/Database/Permissions/PublicPermission";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import UserPermissions from "../../../../../Server/Types/Database/Permissions/UserPermission";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";

/*
 * Exercises the @CanAccessIfCanReadOn handling in
 * BasePermission.checkPermissions: the access-control relation query it
 * builds (e.g. `incident: { labels: [...] }`) must merge with — not
 * overwrite — a caller-supplied filter on the same relation key.
 */
describe("BasePermission canAccessIfCanReadOn relation query", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const permittedLabel: ObjectID = ObjectID.generate();

  /*
   * A caller who may read incidents (the note is read through its incident)
   * with these permission rows.
   */
  function makeProps(
    permissions: Array<UserPermission> = [
      {
        _type: "UserPermission",
        permission: Permission.IncidentViewer,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  ): DatabaseCommonInteractionProps {
    return {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: permissions,
        },
      },
    };
  }

  beforeEach(() => {
    jest
      .spyOn(PublicPermission, "checkIfUserIsLoggedIn")
      .mockImplementation(() => {});
    jest
      .spyOn(TenantPermission, "addTenantScopeToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    jest
      .spyOn(UserPermissions, "addUserScopeToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {});
    jest
      .spyOn(QueryPermission, "checkQueryPermission")
      .mockImplementation(() => {});
    jest
      .spyOn(AccessControlPermission, "addAccessControlIdsToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    jest
      .spyOn(OwnedScopePermission, "addOwnedScopeToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    // Permitted labels resolved for the related model (Incident).
    jest
      .spyOn(AccessControlPermission, "getAccessControlIdsForQuery")
      .mockReturnValue([permittedLabel]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function checkPermissions(query: any): Promise<any> {
    const result: { query: any } = await BasePermission.checkPermissions(
      IncidentInternalNote,
      query,
      null,
      makeProps(),
      DatabaseRequestType.Read,
    );
    return result.query;
  }

  it("merges the access-control query with an existing relation object filter", async () => {
    const query: any = await checkPermissions({
      incident: { projectId: projectId },
    });

    /*
     * Regression: the access-control relation query used to overwrite the
     * caller's relation filter entirely.
     */
    expect(query.incident).toEqual({
      projectId: projectId,
      labels: [permittedLabel],
    });
  });

  it("folds a scalar relation filter into the relation _id", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const query: any = await checkPermissions({
      incident: incidentId,
    });

    expect(query.incident).toEqual({
      _id: incidentId.toString(),
      labels: [permittedLabel],
    });
  });

  it("applies only the access-control query when there is no relation filter", async () => {
    const query: any = await checkPermissions({ projectId });

    expect(query.incident).toEqual({
      labels: [permittedLabel],
    });
  });

  /*
   * A note is read through its incident: a caller who holds a note
   * permission but none of the incident's read permissions reaches no note,
   * where it used to reach the notes of every incident.
   */
  it("refuses a caller who may read no incident, whatever they hold on notes", async () => {
    for (const type of [
      DatabaseRequestType.Read,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      await expect(
        BasePermission.checkPermissions(
          IncidentInternalNote,
          { projectId },
          null,
          makeProps(
            [
              Permission.ReadIncidentInternalNote,
              Permission.EditIncidentInternalNote,
              Permission.DeleteIncidentInternalNote,
            ].map((permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
              };
            }),
          ),
          type,
        ),
      ).rejects.toThrow(
        new NotAuthorizedException(
          `You do not have permissions to ${type} Incident Internal Note. It is read through its Incident, and you need one of these permissions to read Incidents: Project Owner, Project Admin, Project Member, Viewer, Incident Admin, Incident Member, Incident Viewer, Read Incident`,
        ),
      );
    }
  });
});
