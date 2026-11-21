import DataStoreOwnerTeam from "../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../Models/DatabaseModels/DataStoreOwnerUser";
import Team from "../../../../Models/DatabaseModels/Team";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataStoreOwnerKind,
  DataStoreOwnerRef,
} from "../../../../Types/DataSecurity/DataStoreOwnerProposal";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataStoreOwnerTeamService from "../../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Services/DataStoreOwnerUserService";
import TeamMemberService from "../../../Services/TeamMemberService";
import TeamService from "../../../Services/TeamService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";

/*
 * OWNERS A PERSON APPROVED, ADDED AND TAKEN BACK (#10374).
 *
 * An owner OneUptime AI proposed is added as the person who approved it -
 * their own permission to add a store's owners, so a refusal is theirs -
 * and told as any owner is (isOwnerNotified false: the owner-added job
 * tells them). What one approval adds is made whole or not at all: a
 * person who has left the project, or a team that is not one of its teams,
 * refuses the approval in words, rather than being skipped quietly, and a
 * refusal part way takes back what was added before it. An owner the store
 * has already is no change, and is never taken back by Undo.
 *
 * Every row added is recorded (DataStoreOwnerRow), so Undo removes exactly
 * those - never an owner someone added by hand.
 */

export interface DataStoreOwnerRow extends JSONObject {
  dataStoreId: string;
  kind: DataStoreOwnerKind;
  ownerId: string;
  rowId: string;
}

export function readDataStoreOwnerRows(value: unknown): Array<DataStoreOwnerRow> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): DataStoreOwnerRow | null => {
      const raw: JSONObject =
        item && typeof item === "object" ? (item as JSONObject) : {};
      const kind: unknown = raw["kind"];
      const dataStoreId: unknown = raw["dataStoreId"];
      const ownerId: unknown = raw["ownerId"];
      const rowId: unknown = raw["rowId"];

      if (
        (kind !== DataStoreOwnerKind.User && kind !== DataStoreOwnerKind.Team) ||
        typeof dataStoreId !== "string" ||
        typeof ownerId !== "string" ||
        typeof rowId !== "string" ||
        !ObjectID.isValidUUID(rowId) ||
        !ObjectID.isValidUUID(dataStoreId)
      ) {
        return null;
      }

      return { dataStoreId, kind, ownerId, rowId };
    })
    .filter((row: DataStoreOwnerRow | null): row is DataStoreOwnerRow => {
      return row !== null;
    });
}

export default class DataStoreOwnerWrites {
  /*
   * Why these owners cannot be added in this project, in words, or null:
   * every person a member who accepted their invitation, every team one of
   * the project's teams.
   */
  public static async getOwnersRefusal(data: {
    projectId: ObjectID;
    owners: ReadonlyArray<DataStoreOwnerRef & { name?: string | undefined }>;
  }): Promise<string | null> {
    for (const owner of data.owners) {
      if (!ObjectID.isValidUUID(owner.id)) {
        return "An owner this would add is no person or team of this project, so nothing was done.";
      }

      if (owner.kind === DataStoreOwnerKind.User) {
        const isMember: boolean = await TeamMemberService.isUserMemberOfProject(
          {
            projectId: data.projectId,
            userId: new ObjectID(owner.id),
          },
        );

        if (!isMember) {
          return `${owner.name || "A person this would add"} is no longer a member of this project, so nothing was done. Pick another owner.`;
        }

        continue;
      }

      const team: Team | null = await TeamService.findOneBy({
        query: { _id: new ObjectID(owner.id), projectId: data.projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!team) {
        return `${owner.name || "A team this would add"} is no longer a team of this project, so nothing was done. Pick another owner.`;
      }
    }

    return null;
  }

  // The owners a store has of these, by kind and id.
  public static async getExistingOwnerKeys(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Set<string>> {
    const [users, teams]: [Array<DataStoreOwnerUser>, Array<DataStoreOwnerTeam>] =
      await Promise.all([
        DataStoreOwnerUserService.findBy({
          query: { projectId: data.projectId, dataStoreId: data.dataStoreId },
          select: { userId: true },
          skip: 0,
          limit: 500,
          props: { isRoot: true },
        }),
        DataStoreOwnerTeamService.findBy({
          query: { projectId: data.projectId, dataStoreId: data.dataStoreId },
          select: { teamId: true },
          skip: 0,
          limit: 500,
          props: { isRoot: true },
        }),
      ]);

    return new Set([
      ...users.map((row: DataStoreOwnerUser): string => {
        return `${DataStoreOwnerKind.User}:${row.userId?.toString().toLowerCase() || ""}`;
      }),
      ...teams.map((row: DataStoreOwnerTeam): string => {
        return `${DataStoreOwnerKind.Team}:${row.teamId?.toString().toLowerCase() || ""}`;
      }),
    ]);
  }

  /*
   * Adds the owners the store does not have yet, as the person, each told
   * as any owner is. All or nothing: a refusal part way takes back what was
   * added before it, and throws.
   */
  public static async addOwners(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    owners: ReadonlyArray<DataStoreOwnerRef>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<DataStoreOwnerRow>> {
    const existing: Set<string> =
      await DataStoreOwnerWrites.getExistingOwnerKeys(data);
    const added: Array<DataStoreOwnerRow> = [];

    try {
      for (const owner of data.owners) {
        const key: string = `${owner.kind}:${owner.id.toLowerCase()}`;

        if (existing.has(key)) {
          continue;
        }

        existing.add(key);

        if (owner.kind === DataStoreOwnerKind.User) {
          const row: DataStoreOwnerUser = new DataStoreOwnerUser();

          row.projectId = data.projectId;
          row.dataStoreId = data.dataStoreId;
          row.userId = new ObjectID(owner.id);
          row.isOwnerNotified = false;

          const created: DataStoreOwnerUser =
            await DataStoreOwnerUserService.create({
              data: row,
              props: data.props,
            });

          added.push({
            dataStoreId: data.dataStoreId.toString(),
            kind: DataStoreOwnerKind.User,
            ownerId: owner.id,
            rowId: created.id!.toString(),
          });
          continue;
        }

        const row: DataStoreOwnerTeam = new DataStoreOwnerTeam();

        row.projectId = data.projectId;
        row.dataStoreId = data.dataStoreId;
        row.teamId = new ObjectID(owner.id);
        row.isOwnerNotified = false;

        const created: DataStoreOwnerTeam =
          await DataStoreOwnerTeamService.create({
            data: row,
            props: data.props,
          });

        added.push({
          dataStoreId: data.dataStoreId.toString(),
          kind: DataStoreOwnerKind.Team,
          ownerId: owner.id,
          rowId: created.id!.toString(),
        });
      }
    } catch (error) {
      await DataStoreOwnerWrites.removeOwnersAsOneUptime({
        projectId: data.projectId,
        rows: added,
      });

      throw error;
    }

    return added;
  }

  /*
   * Removes the rows a change added, as the person: a row someone removed
   * since is already gone, and is no failure. Returns how many it removed.
   */
  public static async removeOwners(data: {
    projectId: ObjectID;
    rows: ReadonlyArray<DataStoreOwnerRow>;
    props: DatabaseCommonInteractionProps;
  }): Promise<number> {
    let removed: number = 0;
    const userRows: Array<ObjectID> = [];
    const teamRows: Array<ObjectID> = [];

    for (const row of data.rows) {
      (row.kind === DataStoreOwnerKind.User ? userRows : teamRows).push(
        new ObjectID(row.rowId),
      );
    }

    if (userRows.length > 0) {
      removed += await DataStoreOwnerUserService.deleteBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(userRows) },
        limit: userRows.length,
        skip: 0,
        props: data.props,
      });
    }

    if (teamRows.length > 0) {
      removed += await DataStoreOwnerTeamService.deleteBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(teamRows) },
        limit: teamRows.length,
        skip: 0,
        props: data.props,
      });
    }

    return removed;
  }

  // What a change that failed part way added, taken back as OneUptime.
  public static async removeOwnersAsOneUptime(data: {
    projectId: ObjectID;
    rows: ReadonlyArray<DataStoreOwnerRow>;
  }): Promise<void> {
    try {
      await DataStoreOwnerWrites.removeOwners({
        projectId: data.projectId,
        rows: data.rows,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `DataSecurity owners: could not take back ${data.rows.length} owners after a change failed: ${error}`,
      );
    }
  }

  // The owners, refused in words where they cannot be added.
  public static async assertOwnersCanBeAdded(data: {
    projectId: ObjectID;
    owners: ReadonlyArray<DataStoreOwnerRef & { name?: string | undefined }>;
  }): Promise<void> {
    const refusal: string | null =
      await DataStoreOwnerWrites.getOwnersRefusal(data);

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }
}
