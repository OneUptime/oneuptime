import RelationListPermission, {
  CheckedRelationList,
} from "../../../Server/Types/Database/Permissions/RelationListPermission";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY LIST A WRITE MAY NAME RECORDS IN IS HELD TO THE CALLER'S READ, OR
 * NAMES RECORDS EVERY MEMBER READS.
 *
 * A create or an update that lists records - the monitors an incident
 * affects, the status pages a maintenance event shows on, the on-call
 * policies an alert pages, the runbooks a rule runs - names only records its
 * caller may read (RelationListPermission, asked by DatabaseService on every
 * create and update). This sweeps every many-to-many column a create or an
 * update may write, on every model:
 *
 *   - a list of records read one by one (labelled, owned, private, read
 *     through another record, or carrying the labels of what they name) is
 *     held to the read - every one of them, by RelationListPermission's own
 *     sweep of the model, but the parent a model is read through, which the
 *     parent rule holds;
 *   - every other list names records read as a whole table, by every member
 *     of the project. Those models are pinned below with the reason the
 *     project reference check is their answer; a new one fails this test
 *     until it is weighed and added, and one that comes to be read one by
 *     one is checked from then on and fails this test until it is removed.
 *
 * Lists of records read one by one that the rule leaves out on purpose may
 * only shrink - and there are none.
 */

type ModelType = { new (): BaseModel };

// The models a list may name without the caller's read of them, and why.
const READ_AS_A_WHOLE_TABLE: Record<string, string> = {
  Label:
    "Every member reads the project's labels; the reference check refuses another project's label like a missing one.",
  Team: "Every member reads the project's teams; the reference check refuses another project's team.",
  User: "People are held to membership of the project (ProjectScopedReferenceValidator), not to a read of the user table.",
  File: "A record points only at its own project's files (FileOwnership), checked on every create and update.",
  IncidentSeverity:
    "Severities are project settings every member reads; the reference check holds them to the project.",
  AlertSeverity:
    "Severities are project settings every member reads; the reference check holds them to the project.",
  MonitorStatus:
    "Monitor statuses are project settings every member reads; the reference check holds them to the project.",
  IncidentRole:
    "Incident roles are project settings every member reads; the reference check holds them to the project.",
};

// Lists of records read one by one the rule leaves out. May only shrink - and is empty.
const LISTS_LEFT_OUT: Array<string> = [];

interface WritableList {
  name: string;
  modelType: ModelType;
  column: string;
  listedModelType: ModelType;
}

function getWritableLists(): Array<WritableList> {
  const lists: Array<WritableList> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata | undefined = columns[column];

      if (
        !metadata ||
        metadata.type !== TableColumnType.EntityArray ||
        !metadata.modelType ||
        column === model.canAccessIfCanReadOn
      ) {
        continue;
      }

      const isWritable: boolean =
        (accessControl[column]?.create || []).length > 0 ||
        (accessControl[column]?.update || []).length > 0;

      if (!isWritable) {
        continue;
      }

      lists.push({
        name: `${model.tableName}.${column}`,
        modelType: modelType,
        column: column,
        listedModelType: metadata.modelType as ModelType,
      });
    }
  }

  return lists;
}

const WRITABLE_LISTS: Array<WritableList> = getWritableLists();

const isChecked: (list: WritableList) => boolean = (
  list: WritableList,
): boolean => {
  return RelationListPermission.getCheckedLists(list.modelType).some(
    (checked: CheckedRelationList): boolean => {
      return checked.column === list.column;
    },
  );
};

describe("every list a write may name records in", () => {
  test("the sweep covers the lists a write may name records in", () => {
    expect(WRITABLE_LISTS.length).toBeGreaterThan(300);
  });

  test("a list of records read one by one is held to the caller's read", () => {
    const unchecked: Array<string> = WRITABLE_LISTS.filter(
      (list: WritableList): boolean => {
        return (
          RelationListPermission.isReadPerRecord(list.listedModelType) &&
          !isChecked(list)
        );
      },
    ).map((list: WritableList): string => {
      return list.name;
    });

    expect(unchecked.sort()).toEqual([...LISTS_LEFT_OUT].sort());
  });

  test("every other list names records every member reads, for the reason given", () => {
    const tables: Set<string> = new Set<string>();

    for (const list of WRITABLE_LISTS) {
      if (isChecked(list)) {
        continue;
      }

      tables.add(new list.listedModelType().tableName || "");
    }

    expect(Array.from(tables).sort()).toEqual(
      Object.keys(READ_AS_A_WHOLE_TABLE).sort(),
    );
  });

  test("a model read as a whole table is not one read one by one", () => {
    for (const list of WRITABLE_LISTS) {
      const table: string = new list.listedModelType().tableName || "";

      if (READ_AS_A_WHOLE_TABLE[table]) {
        expect([list.name, isChecked(list)]).toEqual([list.name, false]);
      }
    }
  });

  test.each([
    ["Incident", "monitors"],
    ["Incident", "statusPages"],
    ["Incident", "onCallDutyPolicies"],
    ["Alert", "onCallDutyPolicies"],
    ["Alert", "services"],
    ["ScheduledMaintenance", "monitors"],
    ["ScheduledMaintenance", "statusPages"],
    ["StatusPageAnnouncement", "monitors"],
    ["IncidentTemplate", "monitors"],
    ["ScheduledMaintenanceTemplate", "statusPages"],
    ["IncidentGroupingRule", "onCallDutyPolicies"],
    ["RunbookRule", "runbooks"],
    ["MonitorSecret", "monitors"],
    ["StatusPageSubscriber", "statusPageResources"],
  ])("%s.%s is held to the read of what it lists", (table: string, column: string) => {
    const list: WritableList | undefined = WRITABLE_LISTS.find(
      (each: WritableList): boolean => {
        return each.name === `${table}.${column}`;
      },
    );

    expect(list).toBeDefined();
    expect(isChecked(list!)).toBe(true);
  });

  test("the parent a model is read through, through a list, is the parent rule's", () => {
    expect(
      RelationListPermission.getCheckedLists(
        (AllModelTypes as Array<ModelType>).find((modelType: ModelType) => {
          return new modelType().tableName === "StatusPageAnnouncement";
        })!,
      ).map((list: CheckedRelationList): string => {
        return list.column;
      }),
    ).not.toContain("statusPages");
  });
});

/*
 * DatabaseService asks the rule on every create and update, before the
 * write's hooks run.
 */
describe("the shared paths ask it", () => {
  const source: string = fs.readFileSync(
    path.resolve(__dirname, "../../../Server/Services/DatabaseService.ts"),
    "utf8",
  );

  const bodyOf: (signature: string) => string = (
    signature: string,
  ): string => {
    const start: number = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 20000);
  };

  test("a create asks before its hooks", () => {
    const create: string = bodyOf(
      "public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {",
    );

    const lists: number = create.indexOf("await this.checkNamedLists({");
    const hooks: number = create.indexOf("await this._onBeforeCreate(createBy)");

    expect(lists).toBeGreaterThan(-1);
    expect(hooks).toBeGreaterThan(lists);
  });

  test("an update asks before its hooks, with what each row lists already", () => {
    const update: string = bodyOf(
      "private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {",
    );

    const named: number = update.indexOf(
      "await this.checkUpdateNamedRecords(updateBy)",
    );
    const hooks: number = update.indexOf("await this.onBeforeUpdate(updateBy)");

    expect(named).toBeGreaterThan(-1);
    expect(hooks).toBeGreaterThan(named);

    const helper: string = bodyOf(
      "private async checkUpdateNamedRecords(",
    );

    expect(helper).toContain("heldIdsByColumn");
    expect(helper).toContain("await this.checkNamedLists({");
  });
});
