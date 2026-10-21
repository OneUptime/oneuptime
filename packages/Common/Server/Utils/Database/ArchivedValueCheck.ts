import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  ArchivableValueDefinition,
  getArchivableValueByTableName,
  getArchivedValueRefusalSentence,
} from "../../../Utils/ArchivableValues";
import {
  normalizeReferenceId,
  resolveReferenceId,
  resolveReferenceIds,
} from "./ProjectScopedReferenceRefusal";
import RelationNames from "./RelationNames";

/*
 * NOBODY PICKS AN ARCHIVED VALUE (Common/Utils/ArchivableValues).
 *
 * A write a person makes - in the dashboard, through the API with an API
 * key, with Terraform, through MCP - that sets an archived state, severity,
 * monitor status, label or incident role on a record is refused, with which
 * value and where to unarchive it. Every model's references to those values
 * are read from its own column metadata, so a relation or a list added to a
 * model later is covered without anyone remembering to.
 *
 * What it leaves alone:
 *
 *   - What a record already has. An update that sends back the value a
 *     record holds - an edit form re-sends every field, Terraform the whole
 *     resource - picks nothing new: an incident whose severity was archived
 *     keeps it through every later edit, and a monitor keeps an archived
 *     label in the list it saves back.
 *   - What OneUptime sets by itself (a root write): the monitor engine
 *     opening an incident with the severity its criteria name, a rule adding
 *     its labels, a recurring maintenance event created from its template.
 *     Automations keep using the values they were set up with, so archiving
 *     never stops one opening incidents or paging the way it did; the archive
 *     dialog says what still uses a value.
 *   - A workflow's steps, for the same reason: a workflow is an automation
 *     its author set up, and keeps running as it was built.
 *   - What a service's own hooks derive (an episode's severity from its
 *     incidents): only what the caller sent is read, before the hooks run.
 *
 * Values are looked up pinned to the record's project: an id of another
 * project's value is the project reference check's to refuse, and never
 * named here.
 *
 * No service is imported here (DatabaseService imports this): the reads are
 * handed in.
 */

// A reference of a model to an archivable value: a relation or a list.
export interface ArchivableValueColumn {
  // The property written: a relation ("incidentSeverity") or a list ("labels").
  column: string;
  // A relation's ID column ("incidentSeverityId"), written instead of or beside it.
  idColumn?: string | undefined;
  isList: boolean;
  definition: ArchivableValueDefinition;
  modelType: { new (): DatabaseBaseModel };
}

// One value a write picks, through one of those references.
export interface ArchivableValuePick {
  column: ArchivableValueColumn;
  // As the caller wrote it.
  id: string;
}

// An archived value as read back: its id (normalized), name and project.
export interface ArchivedValueRow {
  id: string;
  name: string;
  projectId: string;
}

// The archived rows among `ids` of one value table.
export type FindArchivedValues = (data: {
  modelType: { new (): DatabaseBaseModel };
  ids: Array<string>;
}) => Promise<Array<ArchivedValueRow>>;

// An archived value a write names, and what kind of value it is.
export interface ArchivedValueNamed {
  definition: ArchivableValueDefinition;
  name: string;
}

// A pick, and the archived value it names.
export interface ArchivedPick {
  pick: ArchivableValuePick;
  row: ArchivedValueRow;
}

// Keyed by the model's class.
const columnsByModel: Map<unknown, Array<ArchivableValueColumn>> = new Map();

export default class ArchivedValueCheck {
  /*
   * Whether a write's picks are checked: a person's, an API key's, a master
   * admin's. OneUptime's own writes (root) and a workflow's steps keep the
   * values they were set up with.
   */
  public static isCheckedWrite(props: DatabaseCommonInteractionProps): boolean {
    return !props.isRoot && props.userType !== UserType.Workflow;
  }

  /*
   * The references of `model` to archivable values, read once per model
   * from its column metadata: every relation with an ID column of its own
   * and every many-to-many list whose model is one.
   */
  public static getColumns(
    model: DatabaseBaseModel,
  ): Array<ArchivableValueColumn> {
    const cached: Array<ArchivableValueColumn> | undefined = columnsByModel.get(
      model.constructor,
    );

    if (cached) {
      return cached;
    }

    const columns: Array<ArchivableValueColumn> = [];

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (!metadata || !metadata.modelType) {
        continue;
      }

      const isList: boolean = metadata.type === TableColumnType.EntityArray;
      const isRelation: boolean = metadata.type === TableColumnType.Entity;

      if (!isList && !isRelation) {
        continue;
      }

      const definition: ArchivableValueDefinition | null =
        getArchivableValueByTableName(new metadata.modelType().tableName);

      if (!definition) {
        continue;
      }

      const idColumn: string | undefined = isRelation
        ? RelationNames.getIdColumn(model, column, metadata)
        : undefined;

      if (isRelation && !idColumn) {
        continue;
      }

      columns.push({
        column: column,
        idColumn: idColumn,
        isList: isList,
        definition: definition,
        modelType: metadata.modelType,
      });
    }

    columnsByModel.set(model.constructor, columns);

    return columns;
  }

  /*
   * The values a payload picks, each once per reference: a list as related
   * rows, { _id } objects, ObjectIDs or plain strings; a relation as the
   * relation and/or its ID column - both are read. An id that is not a uuid
   * is left to the checks that refuse it.
   */
  public static getPicks(
    model: DatabaseBaseModel,
    payload: unknown,
  ): Array<ArchivableValuePick> {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const record: Record<string, unknown> = payload as Record<string, unknown>;
    const picks: Array<ArchivableValuePick> = [];

    for (const column of ArchivedValueCheck.getColumns(model)) {
      const values: Array<ObjectID | string> = [
        ...resolveReferenceIds(record[column.column]),
      ];

      if (column.idColumn) {
        const id: ObjectID | string | undefined = resolveReferenceId(
          record[column.idColumn],
        );

        if (id) {
          values.push(id);
        }
      }

      const seen: Set<string> = new Set<string>();

      for (const value of values) {
        const id: string = value.toString().trim();

        if (!id || !ObjectID.isValidUUID(id)) {
          continue;
        }

        const key: string = normalizeReferenceId(id);

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        picks.push({ column: column, id: id });
      }
    }

    return picks;
  }

  /*
   * The picks that name an archived value, with the value: one read per
   * value table, for all of its ids at once.
   */
  public static async findArchivedPicks(data: {
    picks: Array<ArchivableValuePick>;
    findArchived: FindArchivedValues;
  }): Promise<Array<ArchivedPick>> {
    const byTable: Map<
      string,
      {
        modelType: { new (): DatabaseBaseModel };
        ids: Set<string>;
      }
    > = new Map();

    for (const pick of data.picks) {
      const tableName: string = pick.column.definition.tableName;
      const entry: {
        modelType: { new (): DatabaseBaseModel };
        ids: Set<string>;
      } = byTable.get(tableName) || {
        modelType: pick.column.modelType,
        ids: new Set<string>(),
      };

      entry.ids.add(normalizeReferenceId(pick.id));
      byTable.set(tableName, entry);
    }

    const archivedByTable: Map<string, Map<string, ArchivedValueRow>> =
      new Map();

    for (const [tableName, entry] of byTable) {
      const rows: Array<ArchivedValueRow> = await data.findArchived({
        modelType: entry.modelType,
        ids: Array.from(entry.ids),
      });

      const archived: Map<string, ArchivedValueRow> = new Map();

      for (const row of rows) {
        archived.set(normalizeReferenceId(row.id), {
          id: normalizeReferenceId(row.id),
          name: row.name,
          projectId: normalizeReferenceId(row.projectId),
        });
      }

      archivedByTable.set(tableName, archived);
    }

    const archivedPicks: Array<ArchivedPick> = [];

    for (const pick of data.picks) {
      const row: ArchivedValueRow | undefined = archivedByTable
        .get(pick.column.definition.tableName)
        ?.get(normalizeReferenceId(pick.id));

      if (row) {
        archivedPicks.push({ pick: pick, row: row });
      }
    }

    return archivedPicks;
  }

  /*
   * The ids a stored row holds in one reference, normalized: a list's
   * related rows, or a relation's ID column (and the relation, when it was
   * read).
   */
  public static getHeldIds(
    row: unknown,
    column: ArchivableValueColumn,
  ): Set<string> {
    const held: Set<string> = new Set<string>();

    if (!row || typeof row !== "object") {
      return held;
    }

    const read: (name: string) => unknown = (name: string): unknown => {
      const model: { getColumnValue?: (column: string) => unknown } = row as {
        getColumnValue?: (column: string) => unknown;
      };

      if (typeof model.getColumnValue === "function") {
        return model.getColumnValue(name);
      }

      return (row as Record<string, unknown>)[name];
    };

    const values: Array<ObjectID | string> = [
      ...resolveReferenceIds(read(column.column)),
    ];

    if (column.idColumn) {
      const id: ObjectID | string | undefined = resolveReferenceId(
        read(column.idColumn),
      );

      if (id) {
        values.push(id);
      }
    }

    for (const value of values) {
      const id: string = value.toString().trim();

      if (id) {
        held.add(normalizeReferenceId(id));
      }
    }

    return held;
  }

  /*
   * What the rows an update writes are read with to tell what each already
   * holds: a list's related rows by id, a relation by its ID column.
   */
  public static getHeldSelect(
    columns: Array<ArchivableValueColumn>,
  ): Record<string, unknown> {
    const select: Record<string, unknown> = { _id: true };

    for (const column of columns) {
      if (column.isList) {
        select[column.column] = { _id: true };
      } else if (column.idColumn) {
        select[column.idColumn] = true;
      }
    }

    return select;
  }

  /*
   * The archived picks an update makes on these rows: those of the rows'
   * own project (another project's id is the project check's) that not
   * every row already holds - an update writes the same values to every row
   * it reaches, and a value one row has does not make it pickable for the
   * others.
   */
  public static getArchivedPicksNotHeld(data: {
    archivedPicks: Array<ArchivedPick>;
    rows: Array<unknown>;
    getRowProjectId: (row: unknown) => string;
  }): Array<ArchivedPick> {
    return data.archivedPicks.filter((archivedPick: ArchivedPick): boolean => {
      return data.rows.some((row: unknown): boolean => {
        const projectId: string = normalizeReferenceId(
          data.getRowProjectId(row) || "",
        );

        if (!projectId || projectId !== archivedPick.row.projectId) {
          return false;
        }

        return !ArchivedValueCheck.getHeldIds(
          row,
          archivedPick.pick.column,
        ).has(archivedPick.row.id);
      });
    });
  }

  /*
   * The answer to a write that picks archived values: one sentence per kind
   * of value, naming each value once.
   */
  public static getRefusalMessage(archivedPicks: Array<ArchivedPick>): string {
    return ArchivedValueCheck.getRefusalMessageForValues(
      archivedPicks.map((archivedPick: ArchivedPick): ArchivedValueNamed => {
        return {
          definition: archivedPick.pick.column.definition,
          name: archivedPick.row.name,
        };
      }),
    );
  }

  // The same for values named some other way: a monitor's criteria.
  public static getRefusalMessageForValues(
    values: Array<ArchivedValueNamed>,
  ): string {
    const namesByTable: Map<string, Array<string>> = new Map();
    const definitions: Map<string, ArchivableValueDefinition> = new Map();

    for (const value of values) {
      const definition: ArchivableValueDefinition = value.definition;
      const names: Array<string> = namesByTable.get(definition.tableName) || [];

      if (!names.includes(value.name)) {
        names.push(value.name);
      }

      namesByTable.set(definition.tableName, names);
      definitions.set(definition.tableName, definition);
    }

    const sentences: Array<string> = [];

    for (const [tableName, names] of namesByTable) {
      sentences.push(
        getArchivedValueRefusalSentence({
          definition: definitions.get(tableName)!,
          names: names,
        }),
      );
    }

    return sentences.join(" ");
  }

  // Refuses a write with the archived values it picks. See getRefusalMessage.
  public static refuse(archivedPicks: Array<ArchivedPick>): void {
    if (archivedPicks.length === 0) {
      return;
    }

    throw new ArchivedValuePickedException(
      ArchivedValueCheck.getRefusalMessage(archivedPicks),
    );
  }

  // The same for values named some other way. See getRefusalMessageForValues.
  public static refuseValues(values: Array<ArchivedValueNamed>): void {
    if (values.length === 0) {
      return;
    }

    throw new ArchivedValuePickedException(
      ArchivedValueCheck.getRefusalMessageForValues(values),
    );
  }
}

/*
 * A write that picks an archived value. A BadDataException, so an API caller
 * sees a 400 with the message.
 */
export class ArchivedValuePickedException extends BadDataException {}
