import { jest } from "@jest/globals";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserOnCallLogTimelineService from "../../Server/Services/UserOnCallLogTimelineService";
import FindBy from "../../Server/Types/Database/FindBy";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";

/*
 * THE NOTIFICATIONS ON-CALL PAGES SENT, IN MEMORY, FOR SUITES THAT RUN THE
 * OWNERS' CREATED JOBS (#7987).
 *
 * The Created jobs of incidents, alerts and their episodes leave out of the
 * owners' notification each owner a page about the record reached already
 * (OwnersReachedByAPage): they read the person's on-call timeline
 * (UserOnCallLogTimelineService.findBy) for a notification of a page about
 * the record that went out. Suites that run those jobs without a database
 * put this in its place: each notification a test says a page sent is a
 * row held here, and the read answers with the rows its query matches - a
 * column equal to the value it names, or among the values of a
 * QueryHelper.any - as the database would.
 *
 * Call it in a beforeEach: the spy is restored with jest.restoreAllMocks.
 */

// One notification of a page: its person, its record, and where it stands.
export interface PageNotification {
  projectId: ObjectID;
  userId: ObjectID;
  // The record the page was about: one of them.
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | undefined;
  triggeredByAlertEpisodeId?: ObjectID | undefined;
  // Sent, when left out.
  status?: UserNotificationStatus | undefined;
}

export interface InMemoryOnCallPages {
  // A notification a page sent, as its row of the person's on-call timeline.
  add: (notification: PageNotification) => void;
  // The read refuses, as a database that cannot be reached does.
  failWith: (error: Error | null) => void;
  // Every read of the timeline, in order.
  reads: Array<FindBy<UserOnCallLogTimeline>>;
}

// A notification, as the read matches it: each column it has, lowercased.
type Row = Record<string, string>;

interface StoredNotification {
  row: Row;
  userId: ObjectID;
  status: UserNotificationStatus;
}

const COLUMNS: Array<keyof PageNotification> = [
  "projectId",
  "userId",
  "triggeredByIncidentId",
  "triggeredByAlertId",
  "triggeredByIncidentEpisodeId",
  "triggeredByAlertEpisodeId",
  "status",
];

function key(value: unknown): string {
  return String(value).toLowerCase();
}

// The values a QueryHelper.any names, or null for a plain value.
function valuesOf(condition: unknown): Array<string> | null {
  const parameters: JSONObject | undefined = (
    condition as { objectLiteralParameters?: JSONObject } | undefined
  )?.objectLiteralParameters;

  if (!parameters) {
    return null;
  }

  return Object.values(parameters)
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map(key);
}

function matches(row: Row, query: JSONObject): boolean {
  return Object.entries(query).every(
    ([column, condition]: [string, unknown]): boolean => {
      if (condition === undefined) {
        return true;
      }

      const value: string | undefined = row[column];

      if (value === undefined) {
        return false;
      }

      const values: Array<string> | null = valuesOf(condition);

      if (values) {
        return values.includes(value);
      }

      return value === key(condition);
    },
  );
}

export function useInMemoryOnCallPages(): InMemoryOnCallPages {
  const stored: Array<StoredNotification> = [];
  const reads: Array<FindBy<UserOnCallLogTimeline>> = [];
  let failure: Error | null = null;

  jest
    .spyOn(UserOnCallLogTimelineService, "findBy")
    .mockImplementation(
      async (
        findBy: FindBy<UserOnCallLogTimeline>,
      ): Promise<Array<UserOnCallLogTimeline>> => {
        reads.push(findBy);

        if (failure) {
          throw failure;
        }

        return stored
          .filter((each: StoredNotification): boolean => {
            return matches(each.row, findBy.query as JSONObject);
          })
          .map((each: StoredNotification): UserOnCallLogTimeline => {
            const notification: UserOnCallLogTimeline =
              new UserOnCallLogTimeline();
            notification.userId = each.userId;
            notification.status = each.status;
            return notification;
          });
      },
    );

  return {
    add: (notification: PageNotification): void => {
      const status: UserNotificationStatus =
        notification.status || UserNotificationStatus.Sent;
      const row: Row = {};

      for (const column of COLUMNS) {
        const value: unknown =
          column === "status" ? status : notification[column];

        if (value !== undefined) {
          row[column] = key(value);
        }
      }

      stored.push({
        row: row,
        userId: notification.userId,
        status: status,
      });
    },
    failWith: (error: Error | null): void => {
      failure = error;
    },
    reads: reads,
  };
}
