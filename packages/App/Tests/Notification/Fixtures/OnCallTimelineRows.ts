import { jest } from "@jest/globals";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";

/*
 * ON-CALL NOTIFICATIONS (UserOnCallLogTimeline) HELD IN MEMORY, as the
 * senders and the providers' delivery reports reach them through
 * OnCallNotificationStatus:
 *
 *   - findOneById reads a row as it is now, with its version;
 *   - updateOneBy names a row by id, at a status and a version, and lands
 *     only while the row still holds both - moving the version on, as
 *     Postgres does under DatabaseService's compare-and-set on the version.
 *
 * What landed is kept, in order (writes). A test can make something land
 * between a read and the write that follows it (whenRead): the person
 * acknowledging the page meanwhile, say.
 */

export interface StoredOnCallNotification {
  status: UserNotificationStatus | null;
  statusMessage?: string | undefined;
  version: number;
}

export interface OnCallNotificationWrite {
  id: string;
  data: {
    status?: UserNotificationStatus | undefined;
    statusMessage?: string | undefined;
  };
}

interface UpdateOneByInput {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
}

// The two reads and writes OnCallNotificationStatus makes, on the service.
interface TimelineService {
  findOneById: unknown;
  updateOneBy: unknown;
}

export default class OnCallTimelineRows {
  public readonly rows: Map<string, StoredOnCallNotification> = new Map<
    string,
    StoredOnCallNotification
  >();

  public readonly writes: Array<OnCallNotificationWrite> = [];

  private readonly afterReads: Array<(row: StoredOnCallNotification) => void> =
    [];

  // A notification, as written when its page went out.
  public add(
    id: ObjectID,
    status: UserNotificationStatus | null,
  ): StoredOnCallNotification {
    const row: StoredOnCallNotification = { status: status, version: 1 };
    this.rows.set(id.toString(), row);
    return row;
  }

  public get(id: ObjectID): StoredOnCallNotification | undefined {
    return this.rows.get(id.toString());
  }

  /*
   * Runs `change` on the row right after the next read of it hands back
   * what it held: a write that lands between that read and the write that
   * follows it. The change moves the row's version on, as any write does.
   */
  public whenRead(change: (row: StoredOnCallNotification) => void): void {
    this.afterReads.push((row: StoredOnCallNotification): void => {
      change(row);
      row.version++;
    });
  }

  // A read: the row as it is now, as the select returns it.
  public read(input: { id: ObjectID }): UserOnCallLogTimeline | null {
    const row: StoredOnCallNotification | undefined = this.rows.get(
      input.id.toString(),
    );

    if (!row) {
      return null;
    }

    const notification: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    notification.id = new ObjectID(input.id.toString());
    notification.version = row.version;

    if (row.status !== null) {
      notification.status = row.status;
    }

    if (row.statusMessage !== undefined) {
      notification.statusMessage = row.statusMessage;
    }

    const afterRead: ((row: StoredOnCallNotification) => void) | undefined =
      this.afterReads.shift();

    if (afterRead) {
      afterRead(row);
    }

    return notification;
  }

  /*
   * An update by query: lands only while the row holds the status and the
   * version the query names, as one UPDATE ... WHERE would. How many rows
   * it wrote.
   */
  public update(input: UpdateOneByInput): number {
    const id: string = String(input.query["_id"]);
    const row: StoredOnCallNotification | undefined = this.rows.get(id);

    if (!row) {
      return 0;
    }

    if ("status" in input.query && row.status !== input.query["status"]) {
      return 0;
    }

    if ("version" in input.query && row.version !== input.query["version"]) {
      return 0;
    }

    const data: OnCallNotificationWrite["data"] = {};

    if (input.data["status"] !== undefined) {
      row.status = input.data["status"] as UserNotificationStatus;
      data.status = row.status;
    }

    if (input.data["statusMessage"] !== undefined) {
      row.statusMessage = input.data["statusMessage"] as string;
      data.statusMessage = row.statusMessage;
    }

    row.version++;
    this.writes.push({ id: id, data: data });

    return 1;
  }

  /*
   * Puts the rows behind the service's findOneById and updateOneBy: its
   * own jest.fn()s when the service is a jest.mock of it, spies on the
   * real one otherwise.
   */
  public standIn(service: TimelineService): void {
    const methods: Record<keyof TimelineService, (input: never) => unknown> = {
      findOneById: (input: { id: ObjectID }): Promise<unknown> => {
        return Promise.resolve(this.read(input));
      },
      updateOneBy: (input: UpdateOneByInput): Promise<number> => {
        return Promise.resolve(this.update(input));
      },
    };

    for (const name of Object.keys(methods) as Array<keyof TimelineService>) {
      const existing: unknown = service[name];

      if (jest.isMockFunction(existing)) {
        existing.mockImplementation(methods[name] as never);
        continue;
      }

      jest
        .spyOn(service as unknown as Record<string, never>, name)
        .mockImplementation(methods[name] as never);
    }
  }
}
