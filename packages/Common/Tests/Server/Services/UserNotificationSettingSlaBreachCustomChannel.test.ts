import UserNotificationSettingService, {
  NotificationSettingChannel,
  SLA_BREACH_CHANNELS,
} from "../../../Server/Services/UserNotificationSettingService";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Custom channels and the SLA breach setting
 * (addIncidentSlaBreachedNotificationSettings). A person's SLA breach
 * setting starts on every channel they have on for "Incident created", where
 * breaches were sent before they had an event of their own - custom channels
 * (UserNotificationSetting.alertByCustomChannel) as much as SMS or push, so
 * somebody who reads their notifications in the company's own app keeps
 * reading breaches there.
 *
 * The store below answers a read with the columns it selects and no others,
 * as the database does, so a column the read forgets to select reads as off
 * here too - the way it would silently drop out of the copy in production.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5ab1ead0-0000-4000-8000-0000000000c1",
);
const USER_ID: ObjectID = new ObjectID("5ab1ead0-0000-4000-8000-0000000000c2");

const SLA_BREACHED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION;
const INCIDENT_CREATED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

type Channel = NotificationSettingChannel;
type StoredRow = Partial<Record<Channel, boolean>>;

interface SettingRead {
  query: { userId?: unknown; projectId?: unknown; eventType?: unknown };
  select: Record<string, boolean>;
  props: { isRoot?: boolean };
}

// A setting's place in the store: whose, in which project, for which event.
function key(data: {
  userId?: unknown;
  projectId?: unknown;
  eventType?: unknown;
}): string {
  return `${String(data.userId)}|${String(data.projectId)}|${String(
    data.eventType,
  )}`;
}

// The boolean alertBy* columns the setting has, as the model declares them.
function channelColumnsOfTheModel(): Array<string> {
  const model: UserNotificationSetting = new UserNotificationSetting();

  return model
    .getTableColumns()
    .columns.filter((column: string): boolean => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      return (
        column.startsWith("alertBy") &&
        metadata.type === TableColumnType.Boolean
      );
    })
    .sort();
}

describe("the custom channel column among the setting's channels", () => {
  test("SLA_BREACH_CHANNELS names it, so an SLA breach copies it from Incident created", () => {
    expect(SLA_BREACH_CHANNELS).toContain("alertByCustomChannel");
  });

  test("SLA_BREACH_CHANNELS names every channel column of the setting, each once", () => {
    expect([...SLA_BREACH_CHANNELS].sort()).toEqual(channelColumnsOfTheModel());
    expect(new Set(SLA_BREACH_CHANNELS).size).toBe(SLA_BREACH_CHANNELS.length);
  });

  test("the column is off by default: nothing reaches a custom channel until the person turns it on", () => {
    const metadata: TableColumnMetadata =
      new UserNotificationSetting().getTableColumnMetadata(
        "alertByCustomChannel",
      );

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(false);
  });
});

describe("UserNotificationSettingService: an SLA breach setting and custom channels", () => {
  let store: Map<string, StoredRow>;
  let reads: Array<SettingRead>;
  let createCalls: number;

  const seed: (
    eventType: NotificationSettingEventType,
    row: StoredRow,
  ) => void = (
    eventType: NotificationSettingEventType,
    row: StoredRow,
  ): void => {
    store.set(
      key({ userId: USER_ID, projectId: PROJECT_ID, eventType: eventType }),
      { ...row },
    );
  };

  // The channels a stored setting has on, sorted, every other one off.
  const channelsOn: (
    eventType: NotificationSettingEventType,
  ) => Array<string> = (
    eventType: NotificationSettingEventType,
  ): Array<string> => {
    const row: StoredRow | undefined = store.get(
      key({ userId: USER_ID, projectId: PROJECT_ID, eventType: eventType }),
    );

    if (!row) {
      throw new Error(`No ${eventType} setting was stored.`);
    }

    return SLA_BREACH_CHANNELS.filter((channel: Channel): boolean => {
      return row[channel] === true;
    })
      .map((channel: Channel): string => {
        return channel;
      })
      .sort();
  };

  const addSlaBreachSetting: () => Promise<void> = async (): Promise<void> => {
    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
  };

  beforeEach(() => {
    store = new Map<string, StoredRow>();
    reads = [];
    createCalls = 0;

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation(((args: {
        query: { userId: ObjectID; projectId: ObjectID; eventType: string };
      }): Promise<PositiveNumber> => {
        return Promise.resolve(
          new PositiveNumber(store.has(key(args.query)) ? 1 : 0),
        );
      }) as never);

    // Answers with the selected columns only, as the database does.
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockImplementation(((
        args: SettingRead,
      ): Promise<UserNotificationSetting | null> => {
        reads.push(args);

        const found: StoredRow | undefined = store.get(key(args.query));

        if (!found) {
          return Promise.resolve(null);
        }

        const item: UserNotificationSetting = new UserNotificationSetting();
        const columns: Record<string, unknown> = item as unknown as Record<
          string,
          unknown
        >;

        for (const column of Object.keys(args.select)) {
          if (args.select[column] && column in found) {
            columns[column] = found[column as Channel];
          }
        }

        return Promise.resolve(item);
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation(((args: {
        data: UserNotificationSetting;
      }): Promise<UserNotificationSetting> => {
        createCalls++;

        const row: StoredRow = {};

        for (const channel of SLA_BREACH_CHANNELS) {
          if (args.data[channel] !== undefined) {
            row[channel] = Boolean(args.data[channel]);
          }
        }

        store.set(key(args.data), row);

        return Promise.resolve(args.data);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the Incident created setting is read with its custom channel column, as the server", async () => {
    seed(INCIDENT_CREATED, { alertByEmail: true });

    await addSlaBreachSetting();

    const read: SettingRead | undefined = reads.find(
      (candidate: SettingRead): boolean => {
        return candidate.query.eventType === INCIDENT_CREATED;
      },
    );

    expect(read).toBeDefined();
    expect(read!.select["alertByCustomChannel"]).toBe(true);
    expect(read!.props.isRoot).toBe(true);
  });

  test("the read selects every channel the copy reads, so none drops out of it", async () => {
    seed(INCIDENT_CREATED, { alertByEmail: true });

    await addSlaBreachSetting();

    const select: Record<string, boolean> = reads.find(
      (candidate: SettingRead): boolean => {
        return candidate.query.eventType === INCIDENT_CREATED;
      },
    )!.select;

    for (const channel of SLA_BREACH_CHANNELS) {
      expect({ channel, selected: select[channel] }).toEqual({
        channel,
        selected: true,
      });
    }
  });

  test("custom channels on for Incident created are on for SLA breaches, beside email", async () => {
    seed(INCIDENT_CREATED, { alertByEmail: true, alertByCustomChannel: true });

    await addSlaBreachSetting();

    expect(channelsOn(SLA_BREACHED)).toEqual(
      ["alertByCustomChannel", "alertByEmail"].sort(),
    );
  });

  test("custom channels alone on for Incident created: SLA breaches by custom channels, and by email as everyone's are", async () => {
    seed(INCIDENT_CREATED, { alertByCustomChannel: true });

    await addSlaBreachSetting();

    expect(channelsOn(SLA_BREACHED)).toEqual(
      ["alertByCustomChannel", "alertByEmail"].sort(),
    );
  });

  test("custom channels off for Incident created stay off for SLA breaches", async () => {
    seed(INCIDENT_CREATED, {
      alertByEmail: true,
      alertByPush: true,
      alertByCustomChannel: false,
    });

    await addSlaBreachSetting();

    expect(channelsOn(SLA_BREACHED)).toEqual(
      ["alertByEmail", "alertByPush"].sort(),
    );
  });

  test("custom channels left unset on Incident created (a row from before the column) stay off", async () => {
    seed(INCIDENT_CREATED, { alertByEmail: true, alertBySMS: true });

    await addSlaBreachSetting();

    expect(channelsOn(SLA_BREACHED)).toEqual(
      ["alertByEmail", "alertBySMS"].sort(),
    );
  });

  test("somebody with no Incident created setting starts by email alone, custom channels off", async () => {
    await addSlaBreachSetting();

    expect(channelsOn(SLA_BREACHED)).toEqual(["alertByEmail"]);
  });

  test("an SLA breach setting the person already has keeps its custom channel choice", async () => {
    seed(SLA_BREACHED, { alertByEmail: false, alertByCustomChannel: false });
    seed(INCIDENT_CREATED, { alertByCustomChannel: true });

    await addSlaBreachSetting();

    expect(createCalls).toBe(0);
    expect(channelsOn(SLA_BREACHED)).toEqual([]);
  });

  test("a new member starts with custom channels off for every event, SLA breaches included", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    expect(store.size).toBeGreaterThan(1);
    expect(channelsOn(SLA_BREACHED)).toEqual(["alertByEmail"]);

    for (const [stored, row] of Array.from(store.entries())) {
      expect({ stored, custom: row.alertByCustomChannel === true }).toEqual({
        stored,
        custom: false,
      });
    }
  });

  test("the custom channel choice of Incident created is read, never changed", async () => {
    seed(INCIDENT_CREATED, { alertByCustomChannel: true });

    await addSlaBreachSetting();

    expect(channelsOn(INCIDENT_CREATED)).toEqual(["alertByCustomChannel"]);
  });

  /*
   * Every combination the seed draws of channels on for "Incident created":
   * the SLA breach setting is that combination, with email.
   */
  test("64 drawn combinations of Incident created's channels: the SLA breach setting is each one, with email", async () => {
    const random: SeededRandom = seededRandom(1403);

    for (let draw: number = 0; draw < 64; draw++) {
      store = new Map<string, StoredRow>();

      const incidentCreated: StoredRow = {};

      for (const channel of SLA_BREACH_CHANNELS) {
        incidentCreated[channel] = random(2) === 1;
      }

      seed(INCIDENT_CREATED, incidentCreated);

      await addSlaBreachSetting();

      const expected: Array<string> = Array.from(
        new Set<string>([
          "alertByEmail",
          ...SLA_BREACH_CHANNELS.filter((channel: Channel): boolean => {
            return incidentCreated[channel] === true;
          }),
        ]),
      ).sort();

      expect({ draw, channels: channelsOn(SLA_BREACHED) }).toEqual({
        draw,
        channels: expected,
      });
    }
  });
});
