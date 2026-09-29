import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";

/*
 * AccessTokenService.refreshUserTenantAccessPermission emits one row per
 * TeamPermission across every team the user belongs to, without merging or
 * ordering them. The same permission can therefore be blocked twice: once by
 * a team that scopes the block to some labels and once by a team that blocks
 * it outright. The table-wide block must win no matter which row comes first.
 */
describe("TablePermission.checkTableLevelBlockPermissions", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const labelA: ObjectID = ObjectID.generate();
  const labelB: ObjectID = ObjectID.generate();

  function makeProps(
    permissions: Array<UserPermission>,
  ): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions,
    };

    return {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  function blockPermission(
    permission: Permission,
    labelIds: Array<ObjectID> | undefined,
  ): UserPermission {
    return {
      _type: "UserPermission",
      permission,
      labelIds: labelIds as Array<ObjectID>,
      isBlockPermission: true,
    };
  }

  function allowPermission(
    permission: Permission,
    labelIds: Array<ObjectID>,
  ): UserPermission {
    return {
      _type: "UserPermission",
      permission,
      labelIds,
      isBlockPermission: false,
    };
  }

  function incidentWithLabels(labelIds: Array<ObjectID>): Incident {
    const incident: Incident = new Incident();
    incident.labels = labelIds.map((id: ObjectID) => {
      const label: Label = new Label();
      label.id = id;
      return label;
    });
    return incident;
  }

  const requestTypes: Array<DatabaseRequestType> = [
    DatabaseRequestType.Create,
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("with a single block row", () => {
    it.each(requestTypes)(
      "refuses %s when the block row carries no labels",
      (type: DatabaseRequestType) => {
        expect(() => {
          TablePermission.checkTableLevelBlockPermissions(
            Incident,
            makeProps([blockPermission(Permission.ProjectMember, [])]),
            type,
          );
        }).toThrow(NotAuthorizedException);
      },
    );

    it.each(requestTypes)(
      "does not refuse %s outright when the block row carries labels",
      (type: DatabaseRequestType) => {
        expect(() => {
          TablePermission.checkTableLevelBlockPermissions(
            Incident,
            makeProps([blockPermission(Permission.ProjectMember, [labelA])]),
            type,
          );
        }).not.toThrow();
      },
    );

    it("treats a block row whose labelIds is missing as table-wide", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([blockPermission(Permission.ProjectMember, undefined)]),
          DatabaseRequestType.Read,
        );
      }).toThrow(NotAuthorizedException);
    });
  });

  describe("with several block rows for the same permission", () => {
    it.each(requestTypes)(
      "refuses %s when a labelled block row comes before an unlabelled one",
      (type: DatabaseRequestType) => {
        expect(() => {
          TablePermission.checkTableLevelBlockPermissions(
            Incident,
            makeProps([
              blockPermission(Permission.ProjectMember, [labelA]),
              blockPermission(Permission.ProjectMember, []),
            ]),
            type,
          );
        }).toThrow(NotAuthorizedException);
      },
    );

    it.each(requestTypes)(
      "refuses %s when the unlabelled block row comes first",
      (type: DatabaseRequestType) => {
        expect(() => {
          TablePermission.checkTableLevelBlockPermissions(
            Incident,
            makeProps([
              blockPermission(Permission.ProjectMember, []),
              blockPermission(Permission.ProjectMember, [labelA]),
            ]),
            type,
          );
        }).toThrow(NotAuthorizedException);
      },
    );

    it("refuses when the unlabelled row is buried behind several labelled ones", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([
            blockPermission(Permission.ProjectMember, [labelA]),
            blockPermission(Permission.ProjectMember, [labelB]),
            blockPermission(Permission.ProjectMember, [labelA, labelB]),
            blockPermission(Permission.ProjectMember, undefined),
          ]),
          DatabaseRequestType.Update,
        );
      }).toThrow(NotAuthorizedException);
    });

    it("leaves the request to the label check when every block row carries labels", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([
            blockPermission(Permission.ProjectMember, [labelA]),
            blockPermission(Permission.ProjectMember, [labelB]),
          ]),
          DatabaseRequestType.Read,
        );
      }).not.toThrow();
    });

    it("names the blocked permission in the refusal", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([
            blockPermission(Permission.ProjectMember, [labelA]),
            blockPermission(Permission.ProjectMember, []),
          ]),
          DatabaseRequestType.Delete,
        );
      }).toThrow(
        `${Permission.ProjectMember} is in your team's permission block list.`,
      );
    });
  });

  describe("with block rows for different permissions of the model", () => {
    it("refuses when another permission of the model is blocked table-wide", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([
            blockPermission(Permission.ProjectMember, [labelA]),
            blockPermission(Permission.IncidentMember, []),
          ]),
          DatabaseRequestType.Update,
        );
      }).toThrow(
        `${Permission.IncidentMember} is in your team's permission block list.`,
      );
    });

    /*
     * IncidentViewer is only in Incident's read list, so a table-wide block on
     * it takes reading away and leaves the other operations alone.
     */
    it.each([
      { type: DatabaseRequestType.Read, refused: true },
      { type: DatabaseRequestType.Create, refused: false },
      { type: DatabaseRequestType.Update, refused: false },
      { type: DatabaseRequestType.Delete, refused: false },
    ])(
      "matches block rows against the $type permission list only",
      ({ type, refused }: { type: DatabaseRequestType; refused: boolean }) => {
        const check: () => void = (): void => {
          TablePermission.checkTableLevelBlockPermissions(
            Incident,
            makeProps([
              blockPermission(Permission.ProjectMember, [labelA]),
              blockPermission(Permission.IncidentViewer, []),
            ]),
            type,
          );
        };

        if (refused) {
          expect(check).toThrow(NotAuthorizedException);
        } else {
          expect(check).not.toThrow();
        }
      },
    );
  });

  describe("rows that must not trigger a table-wide block", () => {
    it("ignores an unlabelled block row for a permission the model does not use", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([
            blockPermission(Permission.ProjectMember, [labelA]),
            blockPermission(Permission.MonitorViewer, []),
          ]),
          DatabaseRequestType.Read,
        );
      }).not.toThrow();
    });

    it("ignores an unlabelled allow row for the blocked permission", () => {
      expect(() => {
        TablePermission.checkTableLevelBlockPermissions(
          Incident,
          makeProps([
            blockPermission(Permission.ProjectMember, [labelA]),
            allowPermission(Permission.ProjectMember, []),
          ]),
          DatabaseRequestType.Read,
        );
      }).not.toThrow();
    });
  });

  /*
   * Every CRUD entry point relies on this helper for the table-wide case: the
   * read query rewrite and the update/delete label check only look at block
   * rows that carry labels, so a missed unlabelled row is never enforced
   * anywhere else.
   */
  describe("through the CRUD entry points", () => {
    /*
     * The user is granted the permission table-wide, so any refusal below can
     * only come from the block rows.
     */
    const grant: UserPermission = allowPermission(Permission.ProjectMember, []);
    const mixedBlockRows: Array<UserPermission> = [
      grant,
      blockPermission(Permission.ProjectMember, [labelA]),
      blockPermission(Permission.ProjectMember, []),
    ];

    it("allows update and delete when only the grant is present", async () => {
      await expect(
        UpdatePermission.checkUpdatePermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: async () => {
            return incidentWithLabels([labelB]);
          },
          props: makeProps([grant]),
        }),
      ).resolves.toBeUndefined();

      await expect(
        DeletePermission.checkDeletePermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: async () => {
            return incidentWithLabels([labelB]);
          },
          props: makeProps([grant]),
        }),
      ).resolves.toBeUndefined();
    });

    it("refuses create", () => {
      expect(() => {
        CreatePermission.checkCreateBlockPermissions(
          Incident,
          makeProps(mixedBlockRows),
        );
      }).toThrow(NotAuthorizedException);
    });

    it("refuses read instead of only filtering the labelled rows out", async () => {
      jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue({
        joinTableName: "IncidentLabel",
        ownerColumnName: "incidentId",
        relationColumnName: "labelId",
      });

      await expect(
        ReadPermission.checkReadBlockPermission(
          Incident,
          { projectId } as any,
          makeProps(mixedBlockRows),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("refuses update of a record that carries none of the blocked labels", async () => {
      const fetchModel: jest.Mock = jest.fn(async () => {
        return incidentWithLabels([labelB]);
      });

      await expect(
        UpdatePermission.checkUpdatePermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: fetchModel,
          props: makeProps(mixedBlockRows),
        }),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("refuses delete of a record that carries none of the blocked labels", async () => {
      const fetchModel: jest.Mock = jest.fn(async () => {
        return incidentWithLabels([labelB]);
      });

      await expect(
        DeletePermission.checkDeletePermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: fetchModel,
          props: makeProps(mixedBlockRows),
        }),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("refuses before loading the record for a label comparison", async () => {
      const fetchModel: jest.Mock = jest.fn(async () => {
        return incidentWithLabels([]);
      });

      await expect(
        AccessControlPermission.checkAccessControlBlockPermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: fetchModel,
          type: DatabaseRequestType.Update,
          props: makeProps(mixedBlockRows),
        }),
      ).rejects.toThrow(NotAuthorizedException);
      expect(fetchModel).not.toHaveBeenCalled();
    });

    it.each([{ isRoot: true }, { isMasterAdmin: true }])(
      "still lets %o requests through",
      async (bypass: DatabaseCommonInteractionProps) => {
        const props: DatabaseCommonInteractionProps = {
          ...makeProps(mixedBlockRows),
          ...bypass,
        };

        expect(() => {
          CreatePermission.checkCreateBlockPermissions(Incident, props);
        }).not.toThrow();

        await expect(
          ReadPermission.checkReadBlockPermission(
            Incident,
            { projectId } as any,
            props,
          ),
        ).resolves.toBeDefined();

        await expect(
          AccessControlPermission.checkAccessControlBlockPermissionByModel({
            modelType: Incident,
            fetchModelWithAccessControlIds: jest.fn(),
            type: DatabaseRequestType.Delete,
            props,
          }),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe("label-scoped blocks keep working after the table-level check", () => {
    const labelledBlockRows: Array<UserPermission> = [
      blockPermission(Permission.ProjectMember, [labelA]),
      blockPermission(Permission.IncidentMember, [labelB]),
    ];

    it("refuses update of a record that carries a blocked label", async () => {
      await expect(
        AccessControlPermission.checkAccessControlBlockPermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: async () => {
            return incidentWithLabels([labelB]);
          },
          type: DatabaseRequestType.Update,
          props: makeProps(labelledBlockRows),
        }),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("allows update of a record that carries none of the blocked labels", async () => {
      await expect(
        AccessControlPermission.checkAccessControlBlockPermissionByModel({
          modelType: Incident,
          fetchModelWithAccessControlIds: async () => {
            return incidentWithLabels([ObjectID.generate()]);
          },
          type: DatabaseRequestType.Update,
          props: makeProps(labelledBlockRows),
        }),
      ).resolves.toBeUndefined();
    });
  });
});
