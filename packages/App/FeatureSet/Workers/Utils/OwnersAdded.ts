import User from "Common/Models/DatabaseModels/User";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE "YOU WERE ADDED AS AN OWNER" JOBS (issues #8199, #8509).
 *
 * Each owner-added job - of an episode, a monitor, a scheduled maintenance
 * event, a status page, an SLO, a network device - reads the owner rows not
 * notified yet, a team row standing for each member of the team, and tells
 * the people they added. Whom each row tells is written down before the
 * rows are marked notified (OwnerNotificationDeliveries.plan), so a worker
 * stopped part way leaves the people it had not told to a later run.
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
