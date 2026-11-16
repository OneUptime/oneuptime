import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import DatabaseService from "Common/Server/Services/DatabaseService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import OwnerNotificationBacklog, {
  OwnerNotificationGroup,
  OwnerNotificationGroupTable,
  OwnerNotificationPage,
} from "./OwnerNotificationBacklog";

/*
 * THE "YOU WERE ADDED AS AN OWNER" JOBS (issues #8199, #8509, #8862).
 *
 * Each owner-added job - of an incident, an alert, an episode, a monitor, a
 * scheduled maintenance event, a status page, an SLO, a network device, a
 * probe, an AI agent - goes through the owner rows not notified yet, a team
 * row standing for each member of the team, and tells the people they
 * added. Whom each row tells is written down before the rows are marked
 * notified (OwnerNotificationDeliveries.plan), so a worker stopped part way
 * leaves the people it had not told to a later run.
 *
 * The rows are read a page at a time, oldest first - team rows, then user
 * rows - and each record's new owner rows of both tables are told of
 * together (OwnerNotificationBacklog.forEachGroupToNotify): a person a team
 * row and a user row both added is told once, by the first row that names
 * them, and a run stopped at its deadline never splits a record's rows
 * between two runs. Each row is marked by one hook-free compare-and-set,
 * after its people are planned and before they are told; the records the
 * rows name are read once for a page, and each team's members once.
 */

// One owner row not notified yet, and the people it added.
export interface OwnerRowAdded {
  ownerRowId: ObjectID;
  isTeam: boolean;
  users: Array<User>;
}

/*
 * Whom each owner row of one record is to tell, written down before the
 * rows are taken: each person once, even when a team row and a user row
 * added them in the same run, and only the accepted members of the
 * project - a team row expands to every member row, pending invitations
 * included, and a pending invitee has no notification settings yet (the
 * defaults are added on accept): the same people the record's findOwners
 * reports. A failure to read the members tells nobody, as it did when it
 * came after the take.
 */
export async function planOwnersAdded(data: {
  kind: OwnerNotificationKind;
  projectId: ObjectID;
  resourceId: ObjectID;
  ownerRows: Array<OwnerRowAdded>;
}): Promise<Array<OwnerNotificationDelivery>> {
  let members: Set<string> = new Set<string>();

  try {
    const users: Array<User> =
      await TeamMemberService.filterUsersToProjectMembers({
        projectId: data.projectId,
        users: data.ownerRows.flatMap((ownerRow: OwnerRowAdded) => {
          return ownerRow.users;
        }),
      });

    members = new Set<string>(
      users.map((user: User): string => {
        return user.id?.toString() || "";
      }),
    );
  } catch (e) {
    logger.error(`Error in reading the owners added (${data.kind})`, {
      projectId: data.projectId.toString(),
      resourceId: data.resourceId.toString(),
    });
    logger.error(e);
  }

  const deliveries: Array<OwnerNotificationDelivery> = [];
  const planned: Set<string> = new Set<string>();

  for (const ownerRow of data.ownerRows) {
    const owners: Array<User> = ownerRow.users.filter((user: User): boolean => {
      const userId: string = user?.id?.toString() || "";

      if (!userId || !members.has(userId) || planned.has(userId)) {
        return false;
      }

      planned.add(userId);
      return true;
    });

    if (owners.length === 0) {
      continue;
    }

    deliveries.push(
      await OwnerNotificationDeliveries.plan({
        notification: {
          kind: data.kind,
          projectId: data.projectId,
          resourceId: data.resourceId,
          eventId: ownerRow.ownerRowId,
        },
        owners: owners,
        isProjectOwners: false,
        writesFeedItem: false,
      }),
    );
  }

  return deliveries;
}

// Whom the deliveries of one record are to tell, all together.
export function ownersToTell(
  deliveries: Array<OwnerNotificationDelivery>,
): Array<User> {
  return deliveries.flatMap((delivery: OwnerNotificationDelivery) => {
    return delivery.owners;
  });
}

// The deliveries of the owner rows given: those whose rows this run took.
export function deliveriesOfRows(
  deliveries: Array<OwnerNotificationDelivery>,
  ownerRows: Array<OwnerRowAdded>,
): Array<OwnerNotificationDelivery> {
  const rowIds: Set<string> = new Set<string>(
    ownerRows.map((ownerRow: OwnerRowAdded): string => {
      return ownerRow.ownerRowId.toString().toLowerCase();
    }),
  );

  return deliveries.filter((delivery: OwnerNotificationDelivery): boolean => {
    return rowIds.has(delivery.notification.eventId.toString().toLowerCase());
  });
}

/*
 * Tells the people every record's new owner rows added, for one owner-added
 * job (see the top of this file). Per record: read it (with every record of
 * the page, in one query), plan whom its rows tell (planOwnersAdded), take
 * the rows, and - of the rows this run took - tell them (`tell`, the job's
 * own message). The rows of a record that is gone are taken, and tell
 * nobody. Never throws for one record: its failure is logged, and the rows
 * it did not take are left for a later run.
 */
export async function tellOwnersAdded<TRecord extends BaseModel>(data: {
  jobName: string;
  kind: OwnerNotificationKind;
  // The column each owner row names its record by: "incidentId".
  recordIdColumn: string;
  teamService: DatabaseService<BaseModel>;
  userService: DatabaseService<BaseModel>;
  // The records the rows name, and what each is read with.
  recordService: DatabaseService<TRecord>;
  recordSelect: Select<TRecord>;
  deadline?: JobDeadline | undefined;
  // Tells the deliveries' owners they were added (each once, through them).
  tell: (
    record: TRecord,
    deliveries: Array<OwnerNotificationDelivery>,
  ) => Promise<void>;
}): Promise<void> {
  const tables: Array<OwnerNotificationGroupTable> = [
    {
      service: data.teamService,
      notYetNotified: { isOwnerNotified: false } as never,
      notified: { isOwnerNotified: true } as never,
      select: {
        _id: true,
        teamId: true,
      } as never,
    },
    {
      service: data.userService,
      notYetNotified: { isOwnerNotified: false } as never,
      notified: { isOwnerNotified: true } as never,
      select: {
        _id: true,
        userId: true,
        user: {
          email: true,
          name: true,
        },
      } as never,
    },
  ];

  const readRecord: (recordId: ObjectID) => Promise<TRecord | null> = async (
    recordId: ObjectID,
  ): Promise<TRecord | null> => {
    return await data.recordService.findOneById({
      id: recordId,
      select: data.recordSelect,
      props: {
        isRoot: true,
      },
    });
  };

  await OwnerNotificationBacklog.forEachGroupToNotify({
    jobName: data.jobName,
    recordIdColumn: data.recordIdColumn,
    tables: tables,
    deadline: data.deadline,
    // The records of a page's rows, in one query.
    readPage: async (
      recordIds: Array<ObjectID>,
      page: OwnerNotificationPage,
    ): Promise<void> => {
      const records: Array<TRecord> = await data.recordService.findBy({
        query: {
          _id: QueryHelper.any(recordIds),
        } as never,
        select: {
          ...data.recordSelect,
          _id: true,
        },
        limit: recordIds.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      /*
       * One not found - gone since its rows were read - is read on its own
       * when its group asks, as it would be without the page.
       */
      for (const record of records) {
        if (record.id) {
          page.prime<TRecord | null>(recordKey(record.id), record);
        }
      }
    },
    notify: async (input: {
      group: OwnerNotificationGroup;
      page: OwnerNotificationPage;
      take: () => Promise<Array<Array<BaseModel>>>;
    }): Promise<void> => {
      const recordId: ObjectID = input.group.recordId;
      const ownerRows: Array<OwnerRowAdded> = await ownerRowsOf({
        group: input.group,
        page: input.page,
      });

      const record: TRecord | null = await input.page.once(
        recordKey(recordId),
        (): Promise<TRecord | null> => {
          return readRecord(recordId);
        },
      );

      const projectId: ObjectID | undefined = record
        ? (columnOf(record, "projectId") as ObjectID | undefined)
        : undefined;

      /*
       * Whom each owner row is to tell, written before the rows are taken: a
       * worker stopped from here on leaves them to be told by a later run,
       * and one stopped before the take leaves the rows to be read again.
       */
      const deliveries: Array<OwnerNotificationDelivery> =
        record && projectId
          ? await planOwnersAdded({
              kind: data.kind,
              projectId: projectId,
              resourceId: recordId,
              ownerRows: ownerRows,
            })
          : [];

      /*
       * Marked as notified before the owners are told, so an owner row whose
       * notification keeps failing is never read again on every run - one
       * whose record is gone too. Only the rows this run took are its to
       * tell of: another run that took the others tells of them.
       */
      const takenIds: Set<string> = new Set<string>(
        (await input.take()).flat().map((row: BaseModel): string => {
          return row.id!.toString().toLowerCase();
        }),
      );

      if (!record) {
        return;
      }

      const taken: Array<OwnerRowAdded> = ownerRows.filter(
        (ownerRow: OwnerRowAdded): boolean => {
          return takenIds.has(ownerRow.ownerRowId.toString().toLowerCase());
        },
      );

      try {
        await data.tell(record, deliveriesOfRows(deliveries, taken));
      } catch (e) {
        logger.error(
          `${data.jobName}: telling the owners added to ${recordId.toString()} failed.`,
          {
            projectId: projectId?.toString(),
            resourceId: recordId.toString(),
          },
        );
        logger.error(e, {
          projectId: projectId?.toString(),
          resourceId: recordId.toString(),
        });
      }
    },
  });
}

/*
 * The people each owner row of a group added: a team row's members (each
 * team read once for a page), a user row's user. Team rows first, as they
 * were read: a person both name is told by the team row.
 */
async function ownerRowsOf(data: {
  group: OwnerNotificationGroup;
  page: OwnerNotificationPage;
}): Promise<Array<OwnerRowAdded>> {
  const teamRows: Array<BaseModel> = data.group.rows[0] || [];
  const userRows: Array<BaseModel> = data.group.rows[1] || [];
  const ownerRows: Array<OwnerRowAdded> = [];

  for (const teamRow of teamRows) {
    const teamId: ObjectID | undefined = columnOf(teamRow, "teamId") as
      | ObjectID
      | undefined;

    const users: Array<User> = teamId
      ? await data.page.once(
          `teamMembers:${teamId.toString()}`,
          (): Promise<Array<User>> => {
            return TeamMemberService.getUsersInTeams([teamId]);
          },
        )
      : [];

    ownerRows.push({
      ownerRowId: teamRow.id!,
      isTeam: true,
      users: users,
    });
  }

  for (const userRow of userRows) {
    const user: User | undefined = columnOf(userRow, "user") as
      | User
      | undefined;

    ownerRows.push({
      ownerRowId: userRow.id!,
      isTeam: false,
      users: user ? [user] : [],
    });
  }

  return ownerRows;
}

function recordKey(recordId: ObjectID): string {
  return `ownersAddedRecord:${recordId.toString().toLowerCase()}`;
}

// A column of a row, as the row holds it.
function columnOf(row: BaseModel, column: string): unknown {
  return (row as unknown as Record<string, unknown>)[column];
}
