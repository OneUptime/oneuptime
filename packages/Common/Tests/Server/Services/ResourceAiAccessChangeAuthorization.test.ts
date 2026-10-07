import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { withLabelJoinTables } from "../TestingUtils/LabelJoinTables";

/*
 * Contract under test — ResourceAiAccessService.assertCallerMayChangeResource,
 * the gate the approve route puts in front of every resource an AI plan
 * changes. The plan runs on the resource as root, so the approver must be
 * someone who may EDIT that resource, exactly as a CRUD update would decide
 * it:
 *
 * - the resource's update ACL (a grant of an update permission);
 * - label-scoped block rows, decided from the row's own labels (a block of
 *   EditDatabaseServer for label "prod" refuses the prod server, not the
 *   staging one);
 * - label-scoped allow rows (an edit grant limited to "staging" does not
 *   reach the prod server);
 * - a row the caller cannot read at all is refused;
 * - root and master admins are not gated.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SERVER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROD_LABEL_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STAGING_LABEL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function label(id: ObjectID, name: string): Label {
  const model: Label = new Label();
  model.id = id;
  model.name = name;
  return model;
}

function server(labels: Array<Label>): DatabaseServer {
  const model: DatabaseServer = new DatabaseServer();
  model.id = SERVER_ID;
  // Read with its project, as the service selects it.
  model.projectId = PROJECT_ID;
  model.labels = labels;
  return model;
}

function userProps(
  permissions: Array<Partial<UserPermission>>,
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(
      (permission: Partial<UserPermission>): UserPermission => {
        return {
          _type: "UserPermission",
          labelIds: [],
          isBlockPermission: false,
          ...permission,
        } as UserPermission;
      },
    ),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

/*
 * The server's reads: as root it returns the row (with its labels); under
 * the caller's props it returns the row unless `readableByCaller` is false.
 */
function mockDatabaseServer(data: {
  row: DatabaseServer | null;
  readableByCaller?: boolean | undefined;
}): jest.SpyInstance {
  return jest
    .spyOn(DatabaseServerService, "findOneBy")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const props: DatabaseCommonInteractionProps = (
        args as { props: DatabaseCommonInteractionProps }
      ).props;

      if (!props.isRoot && data.readableByCaller === false) {
        return null as never;
      }

      return data.row as never;
    });
}

function assertMayChange(
  props: DatabaseCommonInteractionProps,
  resourceType: AiResourceType = AiResourceType.DatabaseServer,
): Promise<void> {
  return ResourceAiAccessService.assertCallerMayChangeResource({
    props,
    projectId: PROJECT_ID,
    resourceType,
    resourceId: SERVER_ID,
  });
}

describe("ResourceAiAccessService.assertCallerMayChangeResource", () => {
  /*
   * A team's block with labels narrows the editable lookup itself, against
   * the resource's label join table.
   */
  beforeEach(() => {
    withLabelJoinTables();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lets a project member who may edit the resource through", async () => {
    mockDatabaseServer({ row: server([label(PROD_LABEL_ID, "prod")]) });

    await expect(
      assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
    ).resolves.toBeUndefined();
  });

  it("refuses a caller whose edit permission on the resource is blocked for one of its labels", async () => {
    mockDatabaseServer({ row: server([label(PROD_LABEL_ID, "prod")]) });

    const props: DatabaseCommonInteractionProps = userProps([
      { permission: Permission.ProjectMember },
      {
        permission: Permission.EditDatabaseServer,
        isBlockPermission: true,
        labelIds: [PROD_LABEL_ID],
      },
    ]);

    await expect(assertMayChange(props)).rejects.toThrow(
      NotAuthorizedException,
    );
    await expect(assertMayChange(props)).rejects.toThrow(
      "You do not have permission to edit this database server, so you cannot approve an AI plan that changes it.",
    );
  });

  it("negative control: the same block does not touch a resource without that label", async () => {
    mockDatabaseServer({
      row: server([label(STAGING_LABEL_ID, "staging")]),
    });

    await expect(
      assertMayChange(
        userProps([
          { permission: Permission.ProjectMember },
          {
            permission: Permission.EditDatabaseServer,
            isBlockPermission: true,
            labelIds: [PROD_LABEL_ID],
          },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a caller whose edit grant is limited to other labels", async () => {
    mockDatabaseServer({ row: server([label(PROD_LABEL_ID, "prod")]) });

    await expect(
      assertMayChange(
        userProps([
          {
            permission: Permission.EditDatabaseServer,
            labelIds: [STAGING_LABEL_ID],
          },
          {
            permission: Permission.ReadDatabaseServer,
          },
        ]),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("refuses a caller who may start runbooks but holds no edit permission on the resource", async () => {
    mockDatabaseServer({ row: server([]) });

    await expect(
      assertMayChange(
        userProps([
          { permission: Permission.RunbookMember },
          { permission: Permission.ReadDatabaseServer },
        ]),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("refuses a caller who cannot read the resource at all", async () => {
    mockDatabaseServer({
      row: server([label(PROD_LABEL_ID, "prod")]),
      readableByCaller: false,
    });

    await expect(
      assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("refuses a resource that is not in the project", async () => {
    mockDatabaseServer({ row: null });

    await expect(
      assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("reads the resource through its own type's service", async () => {
    const dockerHosts: jest.SpyInstance = jest
      .spyOn(DockerHostService, "findOneBy")
      .mockResolvedValue(null as never);
    const databaseServers: jest.SpyInstance = mockDatabaseServer({
      row: server([]),
    });

    await expect(
      assertMayChange(
        userProps([{ permission: Permission.ProjectMember }]),
        AiResourceType.DockerHost,
      ),
    ).rejects.toThrow("to edit this Docker host");

    expect(dockerHosts).toHaveBeenCalled();
    expect(databaseServers).not.toHaveBeenCalled();
  });

  it("does not gate root or master admins", async () => {
    const reads: jest.SpyInstance = mockDatabaseServer({ row: null });

    await expect(assertMayChange({ isRoot: true })).resolves.toBeUndefined();
    await expect(
      assertMayChange({ isMasterAdmin: true, userId: USER_ID }),
    ).resolves.toBeUndefined();
    expect(reads).not.toHaveBeenCalled();
  });
});
