import type DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import UpdateBy from "../../Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  ARCHIVED_COLUMN,
  ArchivableValueDefinition,
  getArchivableValueProtectionColumns,
  getArchiveProtectionReason,
  getArchiveRefusal,
  isArchivedValue,
} from "../../../Utils/ArchivableValues";

/*
 * The server half of archiving a value (Common/Utils/ArchivableValues), run
 * by each value's service around a create and an update made in a project -
 * a person's, an API key's, Terraform's, a workflow's:
 *
 *   - a value OneUptime moves records into (the created, acknowledged and
 *     resolved states, the operational and offline statuses, the primary
 *     incident role) is never archived, and an archived value never becomes
 *     one: refused, with why;
 *   - a project keeps at least one severity that is not archived, because
 *     every new incident and alert needs one;
 *   - a new value named like an archived one is refused with where to
 *     unarchive it, instead of a bare "already exists".
 *
 * OneUptime's own writes (root) - project seeding, data migrations - are
 * trusted, as StateOrderGuard trusts them. Unarchiving is never refused.
 */

type ServiceOf<TBaseModel extends BaseModel> = DatabaseService<TBaseModel>;

const readValue: (row: unknown, column: string) => unknown = (
  row: unknown,
  column: string,
): unknown => {
  if (!row || typeof row !== "object") {
    return undefined;
  }

  const model: { getColumnValue?: (column: string) => unknown } = row as {
    getColumnValue?: (column: string) => unknown;
  };

  if (typeof model.getColumnValue === "function") {
    return model.getColumnValue(column);
  }

  return (row as Record<string, unknown>)[column];
};

const toObjectId: (value: unknown) => ObjectID | undefined = (
  value: unknown,
): ObjectID | undefined => {
  if (value instanceof ObjectID) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new ObjectID(value);
  }

  return undefined;
};

const getRowId: (row: unknown) => string = (row: unknown): string => {
  const id: unknown = readValue(row, "_id") ?? readValue(row, "id");

  return id ? id.toString() : "";
};

export default class ArchivableValueGuard {
  /*
   * Before a create: a value created archived is held to the same rules as
   * one archived later, and a name an archived value already has is
   * answered with where to unarchive it.
   */
  public static async beforeCreate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: ArchivableValueDefinition;
    createBy: CreateBy<TBaseModel>;
  }): Promise<void> {
    if (data.createBy.props.isRoot) {
      return;
    }

    const record: TBaseModel = data.createBy.data;

    const projectId: ObjectID | undefined =
      data.createBy.props.tenantId || toObjectId(readValue(record, "projectId"));

    if (!projectId) {
      return;
    }

    const name: unknown = readValue(record, "name");

    if (typeof name === "string" && name.trim()) {
      const archivedNamesake: TBaseModel | null = await data.service.findOneBy(
        {
          query: {
            projectId: projectId,
            name: QueryHelper.findWithSameText(name.trim()),
            [ARCHIVED_COLUMN]: true,
          } as unknown as Query<TBaseModel>,
          select: {
            _id: true,
          } as Select<TBaseModel>,
          props: {
            isRoot: true,
          },
        },
      );

      if (archivedNamesake) {
        throw new BadDataException(
          `An archived ${data.definition.singular} is already called "${name.trim()}". Unarchive it in ${data.definition.settingsPath}, or choose another name.`,
        );
      }
    }

    if (!isArchivedValue(record)) {
      return;
    }

    const refusal: string | null = getArchiveRefusal({
      definition: data.definition,
      rowsToArchive: [record],
      liveIds: data.definition.keepsOneLiveReason
        ? await ArchivableValueGuard.getLiveIds({
            service: data.service,
            projectId: projectId,
          })
        : [],
      getRowId: (): string => {
        // Not a row of the project yet: it never counts as a live one.
        return "__new-value__";
      },
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  /*
   * Before an update that archives values, or makes a value one OneUptime
   * relies on: refused when it would archive a protected value, leave a
   * project without a live value of a kind it keeps one of, or protect an
   * archived one. Every other update costs nothing extra.
   */
  public static async beforeUpdate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: ArchivableValueDefinition;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<void> {
    if (data.updateBy.props.isRoot) {
      return;
    }

    const changes: Record<string, unknown> = data.updateBy.data as Record<
      string,
      unknown
    >;

    const archives: boolean = changes[ARCHIVED_COLUMN] === true;
    const unarchives: boolean = changes[ARCHIVED_COLUMN] === false;

    const protects: boolean = data.definition.protections.some(
      (protection: { column: string; value: boolean }): boolean => {
        return changes[protection.column] === protection.value;
      },
    );

    if (!archives && !(protects && !unarchives)) {
      return;
    }

    const protectionColumns: Array<string> =
      getArchivableValueProtectionColumns(data.definition);

    const select: Record<string, unknown> = {
      _id: true,
      name: true,
      projectId: true,
      [ARCHIVED_COLUMN]: true,
    };

    for (const column of protectionColumns) {
      select[column] = true;
    }

    // The rows the update writes, and the update held to them.
    const rows: Array<TBaseModel> =
      await data.service.findRowsAndHoldUpdateToThem(
        data.updateBy,
        select as Select<TBaseModel>,
      );

    // Each row as the update leaves it.
    const rowsAfter: Array<Record<string, unknown>> = rows.map(
      (row: TBaseModel): Record<string, unknown> => {
        const after: Record<string, unknown> = {
          _id: getRowId(row),
          name: readValue(row, "name"),
          projectId: readValue(row, "projectId"),
          [ARCHIVED_COLUMN]: readValue(row, ARCHIVED_COLUMN),
        };

        for (const column of protectionColumns) {
          after[column] = Object.prototype.hasOwnProperty.call(changes, column)
            ? changes[column]
            : readValue(row, column);
        }

        if (archives) {
          after[ARCHIVED_COLUMN] = true;
        }

        return after;
      },
    );

    if (!archives) {
      // A value made one OneUptime relies on must not stay archived.
      const archivedProtected: Record<string, unknown> | undefined =
        rowsAfter.find((row: Record<string, unknown>): boolean => {
          return (
            isArchivedValue(row) &&
            getArchiveProtectionReason({
              definition: data.definition,
              row: row,
            }) !== null
          );
        });

      if (archivedProtected) {
        const name: unknown = archivedProtected["name"];

        throw new BadDataException(
          `${
            typeof name === "string" && name.trim()
              ? `"${name.trim()}"`
              : `This ${data.definition.singular}`
          } is archived. Unarchive it first: OneUptime moves records into this one, so it can't stay archived.`,
        );
      }

      return;
    }

    // Archiving: only the rows the update really turns are judged.
    const turning: Array<TBaseModel> = rows.filter(
      (row: TBaseModel): boolean => {
        return !isArchivedValue(row);
      },
    );

    if (turning.length === 0) {
      return;
    }

    const turningIds: Set<string> = new Set<string>(
      turning.map((row: TBaseModel): string => {
        return getRowId(row);
      }),
    );

    const byProject: Map<string, Array<Record<string, unknown>>> = new Map();

    for (const row of rowsAfter) {
      if (!turningIds.has(row["_id"] as string)) {
        continue;
      }

      const projectKey: string = (row["projectId"] || "").toString();
      const projectRows: Array<Record<string, unknown>> =
        byProject.get(projectKey) || [];
      projectRows.push(row);
      byProject.set(projectKey, projectRows);
    }

    for (const [projectKey, projectRows] of byProject) {
      const refusal: string | null = getArchiveRefusal({
        definition: data.definition,
        rowsToArchive: projectRows,
        // Read only for a kind a project keeps one of: the rule reads nothing else.
        liveIds:
          data.definition.keepsOneLiveReason && projectKey
            ? await ArchivableValueGuard.getLiveIds({
                service: data.service,
                projectId: new ObjectID(projectKey),
              })
            : [],
        getRowId: getRowId,
      });

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }
  }

  // The ids of the project's values that are not archived.
  public static async getLiveIds<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    projectId: ObjectID;
  }): Promise<Array<string>> {
    const rows: Array<TBaseModel> = await data.service.findBy({
      query: {
        projectId: data.projectId,
        [ARCHIVED_COLUMN]: false,
      } as unknown as Query<TBaseModel>,
      select: {
        _id: true,
      } as Select<TBaseModel>,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return rows.map((row: TBaseModel): string => {
      return getRowId(row);
    });
  }
}
