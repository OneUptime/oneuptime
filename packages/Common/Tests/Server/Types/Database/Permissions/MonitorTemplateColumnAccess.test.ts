import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../../../Models/DatabaseModels/MonitorTemplate";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../../../Types/BaseDatabase/NotNull";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * The server half of the monitor list's Template column and Template chip
 * (issue #3491).
 *
 * Both of them are one line of UI and one permission rule, and the permission
 * rule is the half that fails loudly for everybody at once:
 *
 *  - the column selects `monitorTemplate: { _id, templateName }`, and
 *    QueryPermission.checkRelationQueryPermission THROWS on the first inner key
 *    that is not marked `canReadOnRelationQuery` rather than dropping it — so a
 *    missing flag does not hide the column, it fails the whole monitors list
 *    request, for every caller up to ProjectOwner.
 *
 *  - the chip filters `monitorTemplateId`, and a WHERE clause is held to the
 *    same standard as a SELECT: the column has to be one the caller may read,
 *    or the list 403s the moment the chip is set.
 *
 * The selects and queries below are written out as literals rather than
 * imported from the dashboard, so that changing the UI without changing the
 * model surfaces here.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const templateId: ObjectID = ObjectID.generate();

/*
 * Fresh props per assertion: DatabaseCommonInteractionPropsUtil MUTATES what it
 * is handed, pushing the auto-granted Public and CurrentUser onto the list, so
 * a shared object carries state between tests.
 */
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

/**
 * Everyone the monitor list is readable by. The failures this file guards
 * against are in the permission layer and are not role-specific, so every
 * assertion that matters is made across the whole read list rather than for one
 * role — the on-call schedule regression this mirrors hit ProjectOwner too.
 */
const MONITOR_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.MonitorAdmin,
  Permission.MonitorMember,
  Permission.MonitorViewer,
  Permission.ReadProjectMonitor,
];

/*
 * The select the Template column declares in
 * App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable.tsx, alongside
 * the fields the rest of that table asks for.
 */
const MONITOR_TABLE_SELECT: Select<Monitor> = {
  _id: true,
  name: true,
  monitorType: true,
  monitorTemplate: {
    _id: true,
    templateName: true,
  },
} as Select<Monitor>;

function checkRelationSelect(
  select: Select<Monitor>,
  props: DatabaseCommonInteractionProps,
): void {
  QueryPermission.checkRelationQueryPermission(
    Monitor,
    {} as Query<Monitor>,
    select,
    props,
  );
}

function checkQuery(
  query: Query<Monitor>,
  props: DatabaseCommonInteractionProps,
): void {
  QueryPermission.checkQueryPermission(Monitor, query, props);
}

describe("selecting a monitor's template through the relation", () => {
  it("accepts the monitor table's select", () => {
    expect(() => {
      return checkRelationSelect(
        MONITOR_TABLE_SELECT,
        makeProps([Permission.ProjectOwner]),
      );
    }).not.toThrow();
  });

  it("accepts it for every reader of the monitor list", () => {
    for (const permission of MONITOR_READERS) {
      expect(() => {
        return checkRelationSelect(
          MONITOR_TABLE_SELECT,
          makeProps([permission]),
        );
      }).not.toThrow();
    }
  });

  it("accepts the template name selected on its own", () => {
    // Without `_id` alongside it, in case the cell stops linking to the template.
    expect(() => {
      return checkRelationSelect(
        {
          monitorTemplate: {
            templateName: true,
          },
        } as Select<Monitor>,
        makeProps([Permission.ProjectMember]),
      );
    }).not.toThrow();
  });

  /*
   * The flag is what makes the select legal, and it is on the related model
   * rather than on Monitor — so nothing in the dashboard or in Monitor.ts
   * mentions it, and dropping it is an easy, silent edit.
   */
  it("is legal because templateName is readable through a relation", () => {
    const template: BaseModel = new MonitorTemplate();
    const metadata: TableColumnMetadata =
      template.getTableColumnMetadata("templateName");

    expect(metadata.canReadOnRelationQuery).toBe(true);
    expect(metadata.type).toBe(TableColumnType.ShortText);
  });

  /*
   * The relation traversal only recurses into Entity columns. If Monitor's
   * `monitorTemplate` stopped being one, `monitorTemplate: { ... }` would no
   * longer be a relation select at all and this whole gate would go vacuous.
   */
  it("travels a real Entity relation on Monitor", () => {
    const monitor: BaseModel = new Monitor();
    const metadata: TableColumnMetadata =
      monitor.getTableColumnMetadata("monitorTemplate");

    expect(metadata.type).toBe(TableColumnType.Entity);
    expect(metadata.modelType).toBe(MonitorTemplate);
    expect(metadata.manyToOneRelationColumn).toBe("monitorTemplateId");
  });

  /*
   * The flag is not a blanket opening of the template table. A column that
   * does not carry it still refuses, which is what keeps the surface to the
   * one label the column renders.
   */
  it("still refuses a template column that is not marked for relation reads", () => {
    expect(() => {
      return checkRelationSelect(
        {
          monitorTemplate: {
            monitorSteps: true,
          },
        } as Select<Monitor>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow();
  });

  it("still refuses a column that does not exist on the template", () => {
    expect(() => {
      return checkRelationSelect(
        {
          monitorTemplate: {
            noSuchColumn: true,
          },
        } as unknown as Select<Monitor>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow();
  });

  it("still refuses a deep relation through the template", () => {
    expect(() => {
      return checkRelationSelect(
        {
          monitorTemplate: {
            project: {
              name: true,
            },
          },
        } as unknown as Select<Monitor>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow("You cannot query deep relations");
  });
});

describe("filtering monitors by their template", () => {
  /*
   * The chip writes the foreign key. A WHERE clause reads a value as surely as
   * a SELECT does, so this has to be a column the caller may read — otherwise
   * setting the chip 403s a list that rendered fine a moment earlier.
   */
  it("accepts the chip's monitorTemplateId filter for every reader", () => {
    for (const permission of MONITOR_READERS) {
      expect(() => {
        return checkQuery(
          {
            projectId: projectId,
            monitorTemplateId: templateId,
          } as Query<Monitor>,
          makeProps([permission]),
        );
      }).not.toThrow();
    }
  });

  it("accepts the multi-select form the chip actually sends", () => {
    expect(() => {
      return checkQuery(
        {
          projectId: projectId,
          monitorTemplateId: new Includes([templateId, ObjectID.generate()]),
        } as unknown as Query<Monitor>,
        makeProps([Permission.ReadProjectMonitor]),
      );
    }).not.toThrow();
  });

  /*
   * "Which monitors came from no template" — the rows the Template column
   * renders as "—", and the ones a template rollout has not reached. Only the
   * foreign key can be asked this: there is no template row to join against.
   */
  it("accepts the 'is empty' and 'is not empty' forms", () => {
    expect(() => {
      return checkQuery(
        {
          projectId: projectId,
          monitorTemplateId: new IsNull(),
        } as unknown as Query<Monitor>,
        makeProps([Permission.ReadProjectMonitor]),
      );
    }).not.toThrow();

    expect(() => {
      return checkQuery(
        {
          projectId: projectId,
          monitorTemplateId: new NotNull(),
        } as unknown as Query<Monitor>,
        makeProps([Permission.ReadProjectMonitor]),
      );
    }).not.toThrow();
  });

  it("filters a real, indexed column rather than a computed one", () => {
    const monitor: BaseModel = new Monitor();
    const metadata: TableColumnMetadata =
      monitor.getTableColumnMetadata("monitorTemplateId");

    expect(metadata.type).toBe(TableColumnType.ObjectID);
    expect(monitor.getTableColumns().columns).toContain("monitorTemplateId");
  });

  /*
   * The counterpart to the accept cases: the gate is really running, so the
   * tests above pass because the column is readable rather than because
   * nothing was checked.
   */
  it("still refuses a column that does not exist on Monitor", () => {
    expect(() => {
      return checkQuery(
        {
          projectId: projectId,
          monitorTemplateName: "Production API Health",
        } as unknown as Query<Monitor>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow("Column does not exist");
  });

  it("refuses the filter for a caller with no read on monitors at all", () => {
    expect(() => {
      return checkQuery(
        {
          monitorTemplateId: templateId,
        } as Query<Monitor>,
        makeProps([Permission.ReadProjectIncident]),
      );
    }).toThrow();
  });
});
