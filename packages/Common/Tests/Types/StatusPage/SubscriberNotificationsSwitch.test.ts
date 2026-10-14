import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import {
  isSendingSubscriberNotifications,
  SUBSCRIBER_NOTIFICATIONS_COLUMN,
  SUBSCRIBER_NOTIFICATIONS_OFF_MESSAGE,
  SUBSCRIBER_NOTIFICATIONS_OFF_TEXT,
} from "../../../Types/StatusPage/SubscriberNotificationsSwitch";
import { describe, expect, test } from "@jest/globals";

/*
 * Send Notifications to Subscribers (StatusPage.sendSubscriberNotifications):
 * the one switch for everything a status page tells its subscribers. Every
 * sender asks isSendingSubscriberNotifications, which reads "on" for
 * anything but an explicit false, so a page read without the column keeps
 * notifying as every page did before the switch.
 */

describe("whether a status page sends its subscribers anything", () => {
  test("a page with the switch on does", () => {
    expect(
      isSendingSubscriberNotifications({ sendSubscriberNotifications: true }),
    ).toBe(true);
  });

  test("a page with the switch off does not", () => {
    expect(
      isSendingSubscriberNotifications({ sendSubscriberNotifications: false }),
    ).toBe(false);
  });

  test.each([undefined, null])(
    "a page read without the column (%p) does, as before the switch",
    (value: null | undefined) => {
      expect(
        isSendingSubscriberNotifications({
          sendSubscriberNotifications: value,
        }),
      ).toBe(true);
      expect(isSendingSubscriberNotifications({})).toBe(true);
    },
  );

  test("no page at all is read as on, for the same reason", () => {
    expect(isSendingSubscriberNotifications(null)).toBe(true);
    expect(isSendingSubscriberNotifications(undefined)).toBe(true);
  });

  test("a real status page model reads the same", () => {
    const page: StatusPage = new StatusPage();
    expect(isSendingSubscriberNotifications(page)).toBe(true);

    page.sendSubscriberNotifications = false;
    expect(isSendingSubscriberNotifications(page)).toBe(false);
  });
});

describe("the column", () => {
  const page: StatusPage = new StatusPage();

  test("is a switch on the status page, on by default", () => {
    const metadata: { type: TableColumnType; defaultValue?: unknown } =
      page.getTableColumnMetadata(SUBSCRIBER_NOTIFICATIONS_COLUMN);

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(true);
  });

  test("can be switched on and off on every plan", () => {
    expect(
      page.getColumnBillingAccessControl(SUBSCRIBER_NOTIFICATIONS_COLUMN),
    ).toBeUndefined();
  });

  test("is the team's to read and change, and never the public's", () => {
    const access: {
      read: Array<Permission>;
      update: Array<Permission>;
      create: Array<Permission>;
    } = page.getColumnAccessControlFor(SUBSCRIBER_NOTIFICATIONS_COLUMN)!;

    expect(access.read).not.toContain(Permission.Public);
    expect(access.update).not.toContain(Permission.Public);
    expect(access.update).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.StatusPageAdmin,
        Permission.EditProjectStatusPage,
      ]),
    );
  });
});

describe("what the senders say", () => {
  test("a page passed over says it sends its subscribers nothing", () => {
    expect(SUBSCRIBER_NOTIFICATIONS_OFF_TEXT).toBe(
      "not sent, this status page does not send notifications to its subscribers",
    );
  });

  test("a report or a send with nothing to send names the switch", () => {
    expect(SUBSCRIBER_NOTIFICATIONS_OFF_MESSAGE).toContain(
      "Send Notifications to Subscribers is off",
    );
  });
});
