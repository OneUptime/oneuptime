import { NotificationChannelKey } from "./NotificationChannelReadiness";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE PERSON'S NOTIFICATION SETTINGS, FOR THE WHOLE PAGE.
 *
 * One UserNotificationSetting row per event type: a boolean per channel
 * (alertByEmail, alertBySMS, ...) and, for New security case, the lowest
 * priority that notifies. A missing row is every channel off: the server
 * sends nothing for an event without one.
 *
 * Every card used to read its own rows. The page reads them all at once
 * now - a few dozen small rows - because a tab's summary and the "All
 * events" switches need to see every event of a tab together.
 *
 * What a switch stores is exactly what it stored before:
 *
 *   - a row that exists is updated by id, one column only;
 *   - an event with no row gets one, with the switched channel and every
 *     other channel off;
 *   - New security case's priority, chosen with no row yet, makes one as
 *     the server would have seeded it: email and push on, with the choice.
 *
 * A change shows at once and is saved at once. Writes to one event wait for
 * each other, in the order they were asked for, so a row created by the
 * first is updated by the second rather than created twice. A write the
 * server refuses puts back that one switch - not the row, which may hold
 * other changes since - and the caller hears why.
 */

export const NOTIFICATION_SETTING_CHANNEL_COLUMNS: ReadonlyArray<NotificationChannelKey> =
  [
    "alertByEmail",
    "alertBySMS",
    "alertByCall",
    "alertByPush",
    "alertByWhatsApp",
    "alertByTelegram",
    "alertBySlack",
    "alertByMicrosoftTeams",
    "alertByMattermost",
    "alertByWebhook",
    "alertByCustomChannel",
  ];

export type RowsByEvent = ReadonlyMap<
  NotificationSettingEventType,
  UserNotificationSetting
>;

export interface SetChannelRequest {
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  channel: NotificationChannelKey;
  value: boolean;
}

export interface NotificationSettingRows {
  rowsByEvent: RowsByEvent;
  isLoading: boolean;
  // Why the rows could not be read, or "".
  loadError: string;
  reload: () => Promise<void>;
  /*
   * Switches one channel on or off for the events given - one, or every
   * event of a card. Rejects, with the reason, when a write is refused.
   */
  setChannel: (request: SetChannelRequest) => Promise<void>;
  // New security case's lowest priority that notifies.
  setPriority: (
    eventType: NotificationSettingEventType,
    priorityId: string,
  ) => Promise<void>;
}

export const isChannelOn: (
  row: UserNotificationSetting | undefined,
  channel: NotificationChannelKey,
) => boolean = (
  row: UserNotificationSetting | undefined,
  channel: NotificationChannelKey,
): boolean => {
  return Boolean(row && (row as unknown as Record<string, unknown>)[channel]);
};

// A copy of a row to change, with every channel, its id and its priority.
const copyRow: (data: {
  row: UserNotificationSetting | undefined;
  eventType: NotificationSettingEventType;
  projectId: ObjectID;
  userId: ObjectID;
}) => UserNotificationSetting = (data: {
  row: UserNotificationSetting | undefined;
  eventType: NotificationSettingEventType;
  projectId: ObjectID;
  userId: ObjectID;
}): UserNotificationSetting => {
  const copy: UserNotificationSetting = new UserNotificationSetting();

  for (const channel of NOTIFICATION_SETTING_CHANNEL_COLUMNS) {
    (copy as unknown as Record<string, boolean>)[channel] = isChannelOn(
      data.row,
      channel,
    );
  }

  if (data.row?._id) {
    copy._id = data.row._id;
  }

  if (data.row?.minimumSecurityCasePriorityId) {
    copy.minimumSecurityCasePriorityId = data.row.minimumSecurityCasePriorityId;
  }

  copy.projectId = data.projectId;
  copy.userId = data.userId;
  copy.eventType = data.eventType;

  return copy;
};

// The id the server gave a row it created, when its answer says.
const readCreatedId: (response: unknown) => string | null = (
  response: unknown,
): string | null => {
  const data: JSONObject | JSONArray | undefined = (
    response as HTTPResponse<JSONObject> | undefined
  )?.data as JSONObject | JSONArray | undefined;

  if (!data || Array.isArray(data)) {
    return null;
  }

  const id: unknown = data["_id"];

  if (typeof id === "string" && id) {
    return id;
  }

  if (id && typeof id === "object" && "value" in (id as JSONObject)) {
    const value: unknown = (id as JSONObject)["value"];
    return typeof value === "string" && value ? value : null;
  }

  return null;
};

const useNotificationSettingRows: (data: {
  projectId: ObjectID | null;
  userId: ObjectID | null;
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
}) => NotificationSettingRows = (data: {
  projectId: ObjectID | null;
  userId: ObjectID | null;
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
}): NotificationSettingRows => {
  /*
   * Keyed on strings: callers build the ids from global utils on every
   * render, and an ObjectID never compares equal to the last one.
   */
  const projectKey: string = data.projectId?.toString() || "";
  const userKey: string = data.userId?.toString() || "";
  /*
   * As JSON, never joined with a comma: an event type is a sentence, and
   * "...about to miss, or misses, a response target" has two of its own.
   */
  const eventTypesKey: string = JSON.stringify(data.eventTypes);

  const [rowsByEvent, setRowsByEventState] = useState<RowsByEvent>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  // The rows as they are now, for a write that outlives the render it began in.
  const rowsRef: MutableRefObject<RowsByEvent> = useRef<RowsByEvent>(new Map());
  // Each event's last write, which its next write waits for.
  const writesRef: MutableRefObject<
    Map<NotificationSettingEventType, Promise<void>>
  > = useRef<Map<NotificationSettingEventType, Promise<void>>>(new Map());

  const setRows: (next: RowsByEvent) => void = (next: RowsByEvent): void => {
    rowsRef.current = next;
    setRowsByEventState(next);
  };

  // Changes one event's row, from the rows as they are when it runs.
  const updateRow: (
    eventType: NotificationSettingEventType,
    change: (row: UserNotificationSetting) => void,
  ) => void = (
    eventType: NotificationSettingEventType,
    change: (row: UserNotificationSetting) => void,
  ): void => {
    const next: Map<NotificationSettingEventType, UserNotificationSetting> =
      new Map(rowsRef.current);
    const row: UserNotificationSetting = copyRow({
      row: rowsRef.current.get(eventType),
      eventType: eventType,
      projectId: new ObjectID(projectKey),
      userId: new ObjectID(userKey),
    });

    change(row);
    next.set(eventType, row);
    setRows(next);
  };

  const readRows: (
    eventTypes: ReadonlyArray<NotificationSettingEventType>,
  ) => Promise<Array<UserNotificationSetting>> = async (
    eventTypes: ReadonlyArray<NotificationSettingEventType>,
  ): Promise<Array<UserNotificationSetting>> => {
    const result: ListResult<UserNotificationSetting> =
      await ModelAPI.getList<UserNotificationSetting>({
        modelType: UserNotificationSetting,
        query: {
          projectId: new ObjectID(projectKey),
          userId: new ObjectID(userKey),
          eventType: new Includes([...eventTypes]),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          eventType: true,
          alertByEmail: true,
          alertBySMS: true,
          alertByCall: true,
          alertByPush: true,
          alertByWhatsApp: true,
          alertByTelegram: true,
          alertBySlack: true,
          alertByMicrosoftTeams: true,
          alertByMattermost: true,
          alertByWebhook: true,
          alertByCustomChannel: true,
          minimumSecurityCasePriorityId: true,
        },
        sort: {},
      });

    return result.data;
  };

  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!projectKey || !userKey) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const rows: Array<UserNotificationSetting> = await readRows(
        JSON.parse(eventTypesKey) as Array<NotificationSettingEventType>,
      );
      const next: Map<NotificationSettingEventType, UserNotificationSetting> =
        new Map();

      for (const row of rows) {
        if (row.eventType) {
          next.set(row.eventType, row);
        }
      }

      setRows(next);
      setLoadError("");
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectKey, userKey, eventTypesKey]);

  useEffect(() => {
    reload().catch((err: unknown) => {
      setLoadError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [reload]);

  // Runs a write to one event after the ones asked for before it.
  const enqueue: (
    eventType: NotificationSettingEventType,
    write: () => Promise<void>,
  ) => Promise<void> = (
    eventType: NotificationSettingEventType,
    write: () => Promise<void>,
  ): Promise<void> => {
    const previous: Promise<void> =
      writesRef.current.get(eventType) || Promise.resolve();
    const next: Promise<void> = previous
      .catch((): void => {
        // The write before it reported its own failure.
      })
      .then(write);

    writesRef.current.set(eventType, next);

    next
      .finally((): void => {
        if (writesRef.current.get(eventType) === next) {
          writesRef.current.delete(eventType);
        }
      })
      .catch((): void => {
        // The caller hears about it from its own await.
      });

    return next;
  };

  /*
   * Saves a row made on the page: from the id the server answers with, or
   * else by reading the event's row back, so a later switch updates it
   * rather than making another.
   */
  const createRow: (
    eventType: NotificationSettingEventType,
    model: UserNotificationSetting,
  ) => Promise<void> = async (
    eventType: NotificationSettingEventType,
    model: UserNotificationSetting,
  ): Promise<void> => {
    const response: unknown = await ModelAPI.create<UserNotificationSetting>({
      model: model,
      modelType: UserNotificationSetting,
    });

    let id: string | null = readCreatedId(response);

    if (!id) {
      try {
        const rows: Array<UserNotificationSetting> = await readRows([
          eventType,
        ]);
        const saved: UserNotificationSetting | undefined = rows.find(
          (row: UserNotificationSetting): boolean => {
            return row.eventType === eventType;
          },
        );

        id = saved?._id ? saved._id.toString() : null;
      } catch {
        // Saved: only its id is not known yet, and the next read has it.
      }
    }

    if (id) {
      const savedId: string = id;

      updateRow(eventType, (row: UserNotificationSetting): void => {
        row._id = savedId;
      });
    }
  };

  const setChannel: (request: SetChannelRequest) => Promise<void> = async (
    request: SetChannelRequest,
  ): Promise<void> => {
    const changing: Array<NotificationSettingEventType> =
      request.eventTypes.filter(
        (eventType: NotificationSettingEventType): boolean => {
          return (
            isChannelOn(rowsRef.current.get(eventType), request.channel) !==
            request.value
          );
        },
      );

    // Shown at once.
    for (const eventType of changing) {
      updateRow(eventType, (row: UserNotificationSetting): void => {
        (row as unknown as Record<string, boolean>)[request.channel] =
          request.value;
      });
    }

    const results: Array<PromiseSettledResult<void>> = await Promise.allSettled(
      changing.map((eventType: NotificationSettingEventType): Promise<void> => {
        return enqueue(eventType, async (): Promise<void> => {
          const row: UserNotificationSetting | undefined =
            rowsRef.current.get(eventType);

          if (row?._id) {
            await ModelAPI.updateById<UserNotificationSetting>({
              modelType: UserNotificationSetting,
              id: new ObjectID(row._id.toString()),
              data: { [request.channel]: request.value } as JSONObject,
            });
            return;
          }

          const model: UserNotificationSetting = new UserNotificationSetting();
          model.projectId = new ObjectID(projectKey);
          model.userId = new ObjectID(userKey);
          model.eventType = eventType;

          for (const channel of NOTIFICATION_SETTING_CHANNEL_COLUMNS) {
            (model as unknown as Record<string, boolean>)[channel] =
              channel === request.channel ? request.value : false;
          }

          await createRow(eventType, model);
        });
      }),
    );

    let failure: unknown = null;

    results.forEach(
      (result: PromiseSettledResult<void>, index: number): void => {
        if (result.status === "fulfilled") {
          return;
        }

        failure = failure || result.reason;

        // That one switch goes back.
        updateRow(changing[index]!, (row: UserNotificationSetting): void => {
          (row as unknown as Record<string, boolean>)[request.channel] =
            !request.value;
        });
      },
    );

    if (failure) {
      throw new Error(API.getFriendlyMessage(failure));
    }
  };

  const setPriority: (
    eventType: NotificationSettingEventType,
    priorityId: string,
  ) => Promise<void> = async (
    eventType: NotificationSettingEventType,
    priorityId: string,
  ): Promise<void> => {
    const previous: ObjectID | undefined =
      rowsRef.current.get(eventType)?.minimumSecurityCasePriorityId;

    updateRow(eventType, (row: UserNotificationSetting): void => {
      row.minimumSecurityCasePriorityId = new ObjectID(priorityId);
    });

    try {
      await enqueue(eventType, async (): Promise<void> => {
        const row: UserNotificationSetting | undefined =
          rowsRef.current.get(eventType);

        if (row?._id) {
          await ModelAPI.updateById<UserNotificationSetting>({
            modelType: UserNotificationSetting,
            id: new ObjectID(row._id.toString()),
            data: { minimumSecurityCasePriorityId: priorityId } as JSONObject,
          });
          return;
        }

        // As the server seeds the row: email and push on, with the choice.
        const model: UserNotificationSetting = new UserNotificationSetting();
        model.projectId = new ObjectID(projectKey);
        model.userId = new ObjectID(userKey);
        model.eventType = eventType;

        for (const channel of NOTIFICATION_SETTING_CHANNEL_COLUMNS) {
          (model as unknown as Record<string, boolean>)[channel] =
            channel === "alertByEmail" || channel === "alertByPush";
        }

        model.minimumSecurityCasePriorityId = new ObjectID(priorityId);

        // What the page shows is what the row now says.
        updateRow(eventType, (shown: UserNotificationSetting): void => {
          shown.alertByEmail = true;
          shown.alertByPush = true;
        });

        await createRow(eventType, model);
      });
    } catch (err) {
      updateRow(eventType, (row: UserNotificationSetting): void => {
        if (previous) {
          row.minimumSecurityCasePriorityId = previous;
        } else {
          delete (row as unknown as Record<string, unknown>)[
            "minimumSecurityCasePriorityId"
          ];
        }
      });

      throw new Error(API.getFriendlyMessage(err));
    }
  };

  return {
    rowsByEvent: rowsByEvent,
    isLoading: isLoading,
    loadError: loadError,
    reload: reload,
    setChannel: setChannel,
    setPriority: setPriority,
  };
};

export default useNotificationSettingRows;
