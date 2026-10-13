import * as Notifications from "expo-notifications";

/*
 * Android's notification channels, kept the way Android keeps them.
 *
 * Mocking getNotificationChannelAsync to flip from bypassDnd false to true is
 * how the critical alert tests used to simulate "the responder granted Do Not
 * Disturb access" - and it let a real bug through: the stored channel does NOT
 * change when access is granted. These rules, from Android's own
 * PreferencesHelper.createNotificationChannel, are what decide it:
 *
 *   - A NEW channel written by the app keeps bypassDnd only if the app holds
 *     Do Not Disturb (notification policy) access at that moment; otherwise
 *     it is stored false, without an error.
 *   - Writing an EXISTING channel updates its name and description. Its
 *     bypassDnd follows the write only if the app holds the access AND the
 *     user has not changed any of that channel's settings; every other setting
 *     stays as stored.
 *   - A user changing a channel in system settings (its sound, its bypass, its
 *     importance) locks it: from then on the app cannot change those settings.
 *   - The app can read a channel at any time, and gets what is stored.
 *
 * install() routes expo-notifications' channel calls here, so the code under
 * test talks to this "Android" exactly as it talks to the real one.
 */

export interface StoredAndroidChannel {
  id: string;
  name: string;
  description?: string | undefined;
  importance: number;
  bypassDnd: boolean;
  sound: string | null;
  vibrationPattern: Array<number> | null;
  audioAttributes?: unknown;
  // Settings the user changed in system settings, which the app can no longer change.
  userLockedFields: Array<string>;
}

export class FakeAndroidNotificationChannels {
  private readonly channels: Map<string, StoredAndroidChannel> = new Map();

  private hasDndAccess: boolean = false;

  // Every write the app made, in order: what it asked for, by channel id.
  public readonly writes: Array<{
    id: string;
    requestedBypassDnd: boolean;
  }> = [];

  public install(): void {
    jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockImplementation(
        async (
          id: string,
          channel: Notifications.NotificationChannelInput,
        ): Promise<Notifications.NotificationChannel | null> => {
          return this.write(id, channel);
        },
      );

    jest
      .spyOn(Notifications, "getNotificationChannelAsync")
      .mockImplementation(
        async (
          id: string,
        ): Promise<Notifications.NotificationChannel | null> => {
          return this.read(id);
        },
      );
  }

  public grantDoNotDisturbAccess(): void {
    this.hasDndAccess = true;
  }

  public revokeDoNotDisturbAccess(): void {
    this.hasDndAccess = false;
  }

  /*
   * The user changing a channel in system settings: the values change, and
   * the settings they touched are locked against the app.
   */
  public userChangesChannel(
    id: string,
    changes: Partial<Pick<StoredAndroidChannel, "bypassDnd" | "sound">>,
  ): void {
    const stored: StoredAndroidChannel | undefined = this.channels.get(id);

    if (!stored) {
      throw new Error(`No channel ${id} to change`);
    }

    for (const [field, value] of Object.entries(changes)) {
      (stored as unknown as Record<string, unknown>)[field] = value;

      if (!stored.userLockedFields.includes(field)) {
        stored.userLockedFields.push(field);
      }
    }
  }

  public stored(id: string): StoredAndroidChannel | undefined {
    const channel: StoredAndroidChannel | undefined = this.channels.get(id);

    return channel
      ? { ...channel, userLockedFields: [...channel.userLockedFields] }
      : undefined;
  }

  private write(
    id: string,
    input: Notifications.NotificationChannelInput,
  ): Notifications.NotificationChannel {
    const requestedBypassDnd: boolean = Boolean(input.bypassDnd);

    this.writes.push({ id, requestedBypassDnd });

    const existing: StoredAndroidChannel | undefined = this.channels.get(id);

    if (!existing) {
      this.channels.set(id, {
        id: id,
        name: input.name || id,
        description: input.description || undefined,
        importance: input.importance,
        // Kept only while the app holds the access; stored false otherwise.
        bypassDnd: requestedBypassDnd && this.hasDndAccess,
        sound: input.sound ?? null,
        vibrationPattern: input.vibrationPattern ?? null,
        audioAttributes: input.audioAttributes,
        userLockedFields: [],
      });

      return this.read(id)!;
    }

    existing.name = input.name || existing.name;
    existing.description = input.description || existing.description;

    if (existing.userLockedFields.length === 0 && this.hasDndAccess) {
      existing.bypassDnd = requestedBypassDnd;
    }

    return this.read(id)!;
  }

  private read(id: string): Notifications.NotificationChannel | null {
    const stored: StoredAndroidChannel | undefined = this.channels.get(id);

    if (!stored) {
      return null;
    }

    return {
      id: stored.id,
      name: stored.name,
      description: stored.description,
      importance: stored.importance,
      bypassDnd: stored.bypassDnd,
      sound: stored.sound,
      vibrationPattern: stored.vibrationPattern,
      audioAttributes: stored.audioAttributes,
    } as unknown as Notifications.NotificationChannel;
  }
}
