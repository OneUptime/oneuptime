import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * SAVING THE CHANGES TO WHO IS ON CALL IN A SCHEDULE'S LAYERS, ALL AT ONCE.
 *
 * On a schedule's Layers page, changes to who takes turns - a person added
 * to a layer or taken out of it, a new turn order, a layer moved up or down
 * in priority, a layer deleted - are made on the page first, shown in its
 * previews, and saved together with Save, or thrown away with Discard
 * (issue #7575). Each of them used to be saved the moment it was made: every
 * drop of a drag, and every person added on the way to the rotation someone
 * wanted, changed who was on call and sent what goes with that - "you are on
 * call now" to whoever it reached, a post to the schedule's Slack and
 * Microsoft Teams channels.
 *
 * Save sends what the layers are to be:
 *
 *   POST /on-call-duty-policy-schedule/:id/save-layers
 *   {
 *     "basedOnVersion": "<the version the changes were made to>",
 *     "layers": [
 *       {
 *         "layerId": "<id>",
 *         "users": [
 *           { "layerUserId": "<id>", "userId": "<id>" },
 *           { "userId": "<id>" }
 *         ]
 *       }
 *     ],
 *     "deletedLayerIds": ["<id>"]
 *   }
 *   -> { "version": "<the version the layers are at now>", ... }
 *
 * `layers` is every layer the schedule keeps, the highest priority first,
 * each with the people who take turns in it, in turn order: someone already
 * in the layer by the row they are in it by (layerUserId), someone added by
 * their user id alone. A person left out of their layer is taken out of it.
 * `deletedLayerIds` are the layers the schedule no longer has; the people in
 * them go with them.
 *
 * The server writes it in one transaction, and then works out who is on call
 * once and sends one round of messages, for the change from what was saved
 * to what is saved now (Server/Utils/OnCall/ScheduleLayersSave). The same
 * permissions and checks hold as for each change made on its own.
 *
 * The version is of the layers and the people in them - which layers there
 * are and in what order, who is in each and in what order
 * (ScheduleLayersSaveUtil.getVersion) - read from the rows themselves, so a change
 * made any way at all moves it: on another page, through the API, by
 * Terraform, or when someone leaves the project. A save made to a version
 * the layers are no longer at is refused (409): someone else changed them
 * after the page read them, and saving would undo their change without
 * anyone knowing. A layer's own settings - its name, rotation, hand-off,
 * restrictions - are no part of it: Save writes none of them, and each is
 * saved by its own Save Layer.
 *
 * Read by the server and the Dashboard, so it imports nothing that needs a
 * server or React.
 */

// The route, under the schedule API's own path, for the schedule `:id`.
export const SCHEDULE_LAYERS_SAVE_ROUTE: string = "/:id/save-layers";

// The route for one schedule, as the Dashboard calls it.
export const getScheduleLayersSaveRoute: (scheduleId: string) => string = (
  scheduleId: string,
): string => {
  return `/${scheduleId}/save-layers`;
};

// The most layers one save names: far more than any schedule has.
export const SCHEDULE_LAYERS_SAVE_MAX_LAYERS: number = 100;

// The most people one layer of a save names.
export const SCHEDULE_LAYERS_SAVE_MAX_USERS_PER_LAYER: number = 500;

// The most people one save names, in all its layers.
export const SCHEDULE_LAYERS_SAVE_MAX_USERS: number = 2000;

// The longest version a save names: getVersion's are far shorter.
const MAX_VERSION_LENGTH: number = 200;

// A person in a layer, as a save names them.
export interface ScheduleLayersSaveUser {
  // The row they are already in the layer by; left out for someone added.
  layerUserId?: string | undefined;
  userId: string;
}

// A layer the schedule keeps, as a save names it.
export interface ScheduleLayersSaveLayer {
  layerId: string;
  // Who takes turns in it, in turn order.
  users: Array<ScheduleLayersSaveUser>;
}

export interface ScheduleLayersSaveRequest {
  // The version of the layers the changes were made to.
  basedOnVersion: string;
  // Every layer the schedule keeps, the highest priority first.
  layers: Array<ScheduleLayersSaveLayer>;
  // The layers it no longer has.
  deletedLayerIds: Array<string>;
}

// A layer as it is saved: its id and its place (1 is the highest priority).
export interface ScheduleLayersStateLayer {
  id: string;
  order: number;
}

// A person in a layer as they are saved: the row, its layer, who, and their turn.
export interface ScheduleLayersStateLayerUser {
  id: string;
  layerId: string;
  userId: string;
  order: number;
}

// A schedule's layers and the people in them, as they are saved.
export interface ScheduleLayersState {
  layers: Array<ScheduleLayersStateLayer>;
  layerUsers: Array<ScheduleLayersStateLayerUser>;
}

// What a save changes in one layer it keeps, as the page says it.
export interface ScheduleLayerChanges {
  layerId: string;
  // People added to it.
  addedCount: number;
  // People taken out of it.
  removedCount: number;
  // Whether the people it had, and still has, take turns in another order.
  isTurnOrderChanged: boolean;
}

// What a save changes, as the page says it.
export interface ScheduleLayersChanges {
  hasChanges: boolean;
  // Whether the layers it keeps are in another order of priority.
  isLayerOrderChanged: boolean;
  // The layers it deletes, as the schedule had them, highest priority first.
  deletedLayerIds: Array<string>;
  // The layers it keeps that change, highest priority first.
  layers: Array<ScheduleLayerChanges>;
}

export interface ScheduleLayerOrderWrite {
  layer: ScheduleLayersStateLayer;
  order: number;
}

export interface ScheduleLayerUserOrderWrite {
  layerUser: ScheduleLayersStateLayerUser;
  order: number;
}

export interface ScheduleLayerUserCreate {
  layerId: string;
  userId: string;
  order: number;
}

/*
 * What a save writes, and what the person changed. The orders it writes are
 * 1 to n in each list it changes: the layers in their new priority order
 * once a layer moves or is deleted, and the people of a layer in their turn
 * order once anyone is added to it, taken out or moved. A list nothing
 * changes in is left as it is stored, whatever its orders are.
 */
export interface ScheduleLayersSavePlan {
  layerDeletes: Array<ScheduleLayersStateLayer>;
  layerOrderUpdates: Array<ScheduleLayerOrderWrite>;
  layerUserDeletes: Array<ScheduleLayersStateLayerUser>;
  layerUserOrderUpdates: Array<ScheduleLayerUserOrderWrite>;
  layerUserCreates: Array<ScheduleLayerUserCreate>;
  // The people in the layers it deletes: they go with their layer.
  layerUsersOfDeletedLayers: Array<ScheduleLayersStateLayerUser>;
  /*
   * Whether an order it writes is one the person chose rather than one a
   * deletion or an addition moves along: a layer moved up or down
   * (isLayerOrderChanged), and the people of a layer put in another turn
   * order. Those take the permission to edit what they move, as a move made
   * on its own does; the rest are kept in step by the save itself, as a
   * removal or an addition made on its own keeps them.
   */
  layerOrderUpdatesAreMoves: boolean;
  // The rows of layerUserOrderUpdates in a layer whose turn order changed.
  layerUserMoves: Array<ScheduleLayerUserOrderWrite>;
  changes: ScheduleLayersChanges;
}

// What a save did.
export interface ScheduleLayersSaveResult {
  // The version the layers are at now, for the next save.
  version: string;
  deletedLayers: number;
  movedLayers: number;
  addedLayerUsers: number;
  removedLayerUsers: number;
  movedLayerUsers: number;
}

// Postgres writes a uuid lower-cased, whatever case it was sent in.
const normalizeId: (id: string) => string = (id: string): string => {
  return id.trim().toLowerCase();
};

const compareText: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
};

/*
 * A list as it is stored: by its order, and by id where two share one (a
 * schedule saved before orders were kept in step can have such twins), so
 * the server and the page put twins the same way round.
 */
const byOrderThenId: (
  a: { id: string; order: number },
  b: { id: string; order: number },
) => number = (
  a: { id: string; order: number },
  b: { id: string; order: number },
): number => {
  if (a.order !== b.order) {
    return a.order - b.order;
  }

  return compareText(normalizeId(a.id), normalizeId(b.id));
};

/*
 * 53 bits of a text, as cyrb53 (public domain, bryc) works them out: fast,
 * the same in a browser and on the server, and well spread. Not a secret:
 * the version only tells one state of the layers from another.
 */
const hash53: (text: string, seed: number) => number = (
  text: string,
  seed: number,
): number => {
  let h1: number = 0xdeadbeef ^ seed;
  let h2: number = 0x41c6ce57 ^ seed;

  for (let i: number = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const asRecord: (value: unknown) => Record<string, unknown> | null = (
  value: unknown,
): Record<string, unknown> | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const readId: (value: unknown, problem: string) => string = (
  value: unknown,
  problem: string,
): string => {
  if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
    throw new BadDataException(problem);
  }

  return normalizeId(value);
};

export default class ScheduleLayersSaveUtil {
  /*
   * The version of a schedule's layers and the people in them: each layer
   * and its order, each row of a person in a layer, with its layer, its
   * person and its turn - and nothing else. Two states have the same
   * version only when they hold the same rows the same way, however they
   * were read or listed.
   */
  public static getVersion(state: ScheduleLayersState): string {
    const layers: Array<string> = [...state.layers]
      .sort(byOrderThenId)
      .map((layer: ScheduleLayersStateLayer): string => {
        return `${normalizeId(layer.id)}:${layer.order}`;
      });

    const layerUsers: Array<string> = state.layerUsers
      .map((layerUser: ScheduleLayersStateLayerUser): string => {
        return [
          normalizeId(layerUser.layerId),
          String(layerUser.order).padStart(10, "0"),
          normalizeId(layerUser.id),
          normalizeId(layerUser.userId),
        ].join(":");
      })
      .sort(compareText);

    const text: string = `${layers.join(",")}|${layerUsers.join(",")}`;

    return [
      "1",
      state.layers.length,
      state.layerUsers.length,
      hash53(text, 0).toString(36),
      hash53(text, 7919).toString(36),
    ].join("-");
  }

  /*
   * The people of a layer as they take turns, from the rows the schedule has:
   * by their order, twins by id - as the server reads them.
   */
  public static getLayerUsersInTurnOrder(
    state: ScheduleLayersState,
    layerId: string,
  ): Array<ScheduleLayersStateLayerUser> {
    return state.layerUsers
      .filter((layerUser: ScheduleLayersStateLayerUser): boolean => {
        return normalizeId(layerUser.layerId) === normalizeId(layerId);
      })
      .sort(byOrderThenId);
  }

  // The layers in priority order, the highest first, twins by id.
  public static getLayersInPriorityOrder(
    state: ScheduleLayersState,
  ): Array<ScheduleLayersStateLayer> {
    return [...state.layers].sort(byOrderThenId);
  }

  /*
   * A save that changes nothing: the layers as they are saved, in their
   * order, each with its people in theirs. The page starts from it.
   */
  public static getUnchangedRequest(
    state: ScheduleLayersState,
  ): ScheduleLayersSaveRequest {
    return {
      basedOnVersion: ScheduleLayersSaveUtil.getVersion(state),
      layers: ScheduleLayersSaveUtil.getLayersInPriorityOrder(state).map(
        (layer: ScheduleLayersStateLayer): ScheduleLayersSaveLayer => {
          return {
            layerId: normalizeId(layer.id),
            users: ScheduleLayersSaveUtil.getLayerUsersInTurnOrder(
              state,
              layer.id,
            ).map(
              (
                layerUser: ScheduleLayersStateLayerUser,
              ): ScheduleLayersSaveUser => {
                return {
                  layerUserId: normalizeId(layerUser.id),
                  userId: normalizeId(layerUser.userId),
                };
              },
            ),
          };
        },
      ),
      deletedLayerIds: [],
    };
  }

  public static requestToJSON(request: ScheduleLayersSaveRequest): JSONObject {
    return {
      basedOnVersion: request.basedOnVersion,
      layers: request.layers.map(
        (layer: ScheduleLayersSaveLayer): JSONObject => {
          return {
            layerId: layer.layerId,
            users: layer.users.map(
              (user: ScheduleLayersSaveUser): JSONObject => {
                return user.layerUserId
                  ? { layerUserId: user.layerUserId, userId: user.userId }
                  : { userId: user.userId };
              },
            ),
          };
        },
      ),
      deletedLayerIds: [...request.deletedLayerIds],
    };
  }

  /*
   * A save as the server reads it: every id an id, each layer and each row
   * named once, and no more than a schedule could hold. Ids come back
   * lower-cased. Whether they are the schedule's is plan's
   * to say, against the rows it has.
   */
  public static parseRequest(body: unknown): ScheduleLayersSaveRequest {
    const record: Record<string, unknown> | null = asRecord(body);

    if (!record) {
      throw new BadDataException(
        "Send the layers to save: basedOnVersion, layers and deletedLayerIds.",
      );
    }

    const basedOnVersion: unknown = record["basedOnVersion"];

    if (
      typeof basedOnVersion !== "string" ||
      basedOnVersion.trim().length === 0 ||
      basedOnVersion.length > MAX_VERSION_LENGTH
    ) {
      throw new BadDataException(
        "Send basedOnVersion: the version of the layers your changes were made to. Read the layers again and send the version they are at.",
      );
    }

    const rawLayers: unknown = record["layers"];

    if (!Array.isArray(rawLayers)) {
      throw new BadDataException(
        "Send layers as a list: every layer the schedule keeps, the highest priority first.",
      );
    }

    if (rawLayers.length > SCHEDULE_LAYERS_SAVE_MAX_LAYERS) {
      throw new BadDataException(
        `A save names at most ${SCHEDULE_LAYERS_SAVE_MAX_LAYERS} layers.`,
      );
    }

    const rawDeletedLayerIds: unknown = record["deletedLayerIds"];

    if (
      rawDeletedLayerIds !== undefined &&
      rawDeletedLayerIds !== null &&
      !Array.isArray(rawDeletedLayerIds)
    ) {
      throw new BadDataException(
        "Send deletedLayerIds as a list: the layers the schedule no longer has.",
      );
    }

    const deletedLayerValues: Array<unknown> = Array.isArray(rawDeletedLayerIds)
      ? rawDeletedLayerIds
      : [];

    if (deletedLayerValues.length > SCHEDULE_LAYERS_SAVE_MAX_LAYERS) {
      throw new BadDataException(
        `A save names at most ${SCHEDULE_LAYERS_SAVE_MAX_LAYERS} layers.`,
      );
    }

    const namedLayerIds: Set<string> = new Set<string>();
    const namedLayerUserIds: Set<string> = new Set<string>();
    let userCount: number = 0;

    const nameLayer: (layerId: string) => void = (layerId: string): void => {
      if (namedLayerIds.has(layerId)) {
        throw new BadDataException(
          `Name each layer once, in layers or in deletedLayerIds: ${layerId} is named twice.`,
        );
      }

      namedLayerIds.add(layerId);
    };

    const layers: Array<ScheduleLayersSaveLayer> = rawLayers.map(
      (rawLayer: unknown): ScheduleLayersSaveLayer => {
        const layerRecord: Record<string, unknown> | null = asRecord(rawLayer);

        if (!layerRecord) {
          throw new BadDataException(
            "Each layer in layers is { layerId, users }.",
          );
        }

        const layerId: string = readId(
          layerRecord["layerId"],
          "Each layer in layers is named by its layerId.",
        );

        nameLayer(layerId);

        const rawUsers: unknown = layerRecord["users"];

        if (!Array.isArray(rawUsers)) {
          throw new BadDataException(
            `Send the users of layer ${layerId} as a list: the people who take turns in it, in turn order.`,
          );
        }

        if (rawUsers.length > SCHEDULE_LAYERS_SAVE_MAX_USERS_PER_LAYER) {
          throw new BadDataException(
            `A layer takes at most ${SCHEDULE_LAYERS_SAVE_MAX_USERS_PER_LAYER} people.`,
          );
        }

        userCount += rawUsers.length;

        if (userCount > SCHEDULE_LAYERS_SAVE_MAX_USERS) {
          throw new BadDataException(
            `A save names at most ${SCHEDULE_LAYERS_SAVE_MAX_USERS} people.`,
          );
        }

        const users: Array<ScheduleLayersSaveUser> = rawUsers.map(
          (rawUser: unknown): ScheduleLayersSaveUser => {
            const userRecord: Record<string, unknown> | null =
              asRecord(rawUser);

            if (!userRecord) {
              throw new BadDataException(
                "Each person in a layer's users is { userId }, with the layerUserId of their row when they are in the layer already.",
              );
            }

            const userId: string = readId(
              userRecord["userId"],
              "Each person in a layer's users is named by their userId.",
            );

            const rawLayerUserId: unknown = userRecord["layerUserId"];

            if (rawLayerUserId === undefined || rawLayerUserId === null) {
              return { userId: userId };
            }

            const layerUserId: string = readId(
              rawLayerUserId,
              "A layerUserId is the row a person is already in a layer by: leave it out for someone added.",
            );

            if (namedLayerUserIds.has(layerUserId)) {
              throw new BadDataException(
                `Name each person already in a layer once: ${layerUserId} is named twice.`,
              );
            }

            namedLayerUserIds.add(layerUserId);

            return { layerUserId: layerUserId, userId: userId };
          },
        );

        return { layerId: layerId, users: users };
      },
    );

    const deletedLayerIds: Array<string> = deletedLayerValues.map(
      (value: unknown): string => {
        const layerId: string = readId(
          value,
          "Each of deletedLayerIds is the id of a layer the schedule no longer has.",
        );

        nameLayer(layerId);

        return layerId;
      },
    );

    return {
      basedOnVersion: basedOnVersion,
      layers: layers,
      deletedLayerIds: deletedLayerIds,
    };
  }

  /*
   * What a save writes to the layers as they are saved (`state`), and what
   * it changes: refused, in plain words, when it is no save of these layers
   * - a layer of the schedule it does not name, one it names that the
   * schedule does not have, a row that is not in the layer it is named
   * under or that is someone else's, every layer deleted. A save made to
   * the version these layers are at names each of them, so a page never
   * meets these; a caller of the API can.
   */
  public static plan(data: {
    state: ScheduleLayersState;
    request: ScheduleLayersSaveRequest;
  }): ScheduleLayersSavePlan {
    const storedLayers: Array<ScheduleLayersStateLayer> =
      ScheduleLayersSaveUtil.getLayersInPriorityOrder(data.state);

    const storedLayerById: Map<string, ScheduleLayersStateLayer> = new Map<
      string,
      ScheduleLayersStateLayer
    >();

    for (const layer of storedLayers) {
      storedLayerById.set(normalizeId(layer.id), layer);
    }

    const storedLayerUserById: Map<string, ScheduleLayersStateLayerUser> =
      new Map<string, ScheduleLayersStateLayerUser>();

    for (const layerUser of data.state.layerUsers) {
      storedLayerUserById.set(normalizeId(layerUser.id), layerUser);
    }

    const keptLayerIds: Array<string> = data.request.layers.map(
      (layer: ScheduleLayersSaveLayer): string => {
        return normalizeId(layer.layerId);
      },
    );
    const deletedLayerIdSet: Set<string> = new Set<string>(
      data.request.deletedLayerIds.map(normalizeId),
    );

    for (const layerId of [...keptLayerIds, ...deletedLayerIdSet]) {
      if (!storedLayerById.has(layerId)) {
        throw new BadDataException(
          `${layerId} is not a layer of this schedule. Read its layers again and save your changes to them.`,
        );
      }
    }

    for (const layer of storedLayers) {
      const layerId: string = normalizeId(layer.id);

      if (!keptLayerIds.includes(layerId) && !deletedLayerIdSet.has(layerId)) {
        throw new BadDataException(
          `Name every layer of the schedule, in layers or in deletedLayerIds: layer ${layerId} is not named.`,
        );
      }
    }

    if (storedLayers.length > 0 && keptLayerIds.length === 0) {
      throw new BadDataException(
        "A schedule must have at least one layer. Add another layer before deleting this one.",
      );
    }

    // Layers: deleted, then the ones kept in their new priority order.
    const layerDeletes: Array<ScheduleLayersStateLayer> = storedLayers.filter(
      (layer: ScheduleLayersStateLayer): boolean => {
        return deletedLayerIdSet.has(normalizeId(layer.id));
      },
    );

    const storedKeptLayerIds: Array<string> = storedLayers
      .map((layer: ScheduleLayersStateLayer): string => {
        return normalizeId(layer.id);
      })
      .filter((layerId: string): boolean => {
        return !deletedLayerIdSet.has(layerId);
      });

    const isLayerOrderChanged: boolean =
      storedKeptLayerIds.join(",") !== keptLayerIds.join(",");

    const layerOrderUpdates: Array<ScheduleLayerOrderWrite> = [];

    if (isLayerOrderChanged || layerDeletes.length > 0) {
      keptLayerIds.forEach((layerId: string, index: number): void => {
        const layer: ScheduleLayersStateLayer = storedLayerById.get(layerId)!;

        if (layer.order !== index + 1) {
          layerOrderUpdates.push({ layer: layer, order: index + 1 });
        }
      });
    }

    // People: in each layer kept, the turn order it is to have.
    const layerUserDeletes: Array<ScheduleLayersStateLayerUser> = [];
    const layerUserOrderUpdates: Array<ScheduleLayerUserOrderWrite> = [];
    const layerUserMoves: Array<ScheduleLayerUserOrderWrite> = [];
    const layerUserCreates: Array<ScheduleLayerUserCreate> = [];
    const layerChanges: Array<ScheduleLayerChanges> = [];

    for (const requestLayer of data.request.layers) {
      const layerId: string = normalizeId(requestLayer.layerId);

      const storedUsers: Array<ScheduleLayersStateLayerUser> =
        ScheduleLayersSaveUtil.getLayerUsersInTurnOrder(data.state, layerId);

      const keptRowIds: Set<string> = new Set<string>();
      let addedCount: number = 0;

      for (const user of requestLayer.users) {
        if (!user.layerUserId) {
          addedCount++;
          continue;
        }

        const layerUserId: string = normalizeId(user.layerUserId);
        const stored: ScheduleLayersStateLayerUser | undefined =
          storedLayerUserById.get(layerUserId);

        if (!stored) {
          throw new BadDataException(
            `${layerUserId} is not a person in this schedule's layers. Leave out the layerUserId of someone you add.`,
          );
        }

        if (normalizeId(stored.layerId) !== layerId) {
          throw new BadDataException(
            `${layerUserId} is a person in another layer. To move someone to another layer, add them to it and take them out of the one they are in.`,
          );
        }

        if (normalizeId(stored.userId) !== normalizeId(user.userId)) {
          throw new BadDataException(
            `${layerUserId} is the row of another person: send the userId it holds, or add the person you mean.`,
          );
        }

        keptRowIds.add(layerUserId);
      }

      const removed: Array<ScheduleLayersStateLayerUser> = storedUsers.filter(
        (layerUser: ScheduleLayersStateLayerUser): boolean => {
          return !keptRowIds.has(normalizeId(layerUser.id));
        },
      );

      const storedKeptRowIds: Array<string> = storedUsers
        .map((layerUser: ScheduleLayersStateLayerUser): string => {
          return normalizeId(layerUser.id);
        })
        .filter((rowId: string): boolean => {
          return keptRowIds.has(rowId);
        });

      const requestKeptRowIds: Array<string> = requestLayer.users
        .filter((user: ScheduleLayersSaveUser): boolean => {
          return Boolean(user.layerUserId);
        })
        .map((user: ScheduleLayersSaveUser): string => {
          return normalizeId(user.layerUserId!);
        });

      const isTurnOrderChanged: boolean =
        storedKeptRowIds.join(",") !== requestKeptRowIds.join(",");

      if (!isTurnOrderChanged && addedCount === 0 && removed.length === 0) {
        continue;
      }

      layerChanges.push({
        layerId: layerId,
        addedCount: addedCount,
        removedCount: removed.length,
        isTurnOrderChanged: isTurnOrderChanged,
      });

      layerUserDeletes.push(...removed);

      requestLayer.users.forEach(
        (user: ScheduleLayersSaveUser, index: number): void => {
          const order: number = index + 1;

          if (!user.layerUserId) {
            layerUserCreates.push({
              layerId: layerId,
              userId: normalizeId(user.userId),
              order: order,
            });
            return;
          }

          const stored: ScheduleLayersStateLayerUser = storedLayerUserById.get(
            normalizeId(user.layerUserId),
          )!;

          if (stored.order === order) {
            return;
          }

          const write: ScheduleLayerUserOrderWrite = {
            layerUser: stored,
            order: order,
          };

          layerUserOrderUpdates.push(write);

          if (isTurnOrderChanged) {
            layerUserMoves.push(write);
          }
        },
      );
    }

    const layerUsersOfDeletedLayers: Array<ScheduleLayersStateLayerUser> =
      layerDeletes.flatMap(
        (
          layer: ScheduleLayersStateLayer,
        ): Array<ScheduleLayersStateLayerUser> => {
          return ScheduleLayersSaveUtil.getLayerUsersInTurnOrder(
            data.state,
            layer.id,
          );
        },
      );

    const hasChanges: boolean =
      isLayerOrderChanged || layerDeletes.length > 0 || layerChanges.length > 0;

    return {
      layerDeletes: layerDeletes,
      layerOrderUpdates: layerOrderUpdates,
      layerUserDeletes: layerUserDeletes,
      layerUserOrderUpdates: layerUserOrderUpdates,
      layerUserCreates: layerUserCreates,
      layerUsersOfDeletedLayers: layerUsersOfDeletedLayers,
      layerOrderUpdatesAreMoves: isLayerOrderChanged,
      layerUserMoves: layerUserMoves,
      changes: {
        hasChanges: hasChanges,
        isLayerOrderChanged: isLayerOrderChanged,
        deletedLayerIds: layerDeletes.map(
          (layer: ScheduleLayersStateLayer): string => {
            return normalizeId(layer.id);
          },
        ),
        layers: layerChanges,
      },
    };
  }

  // Whether a save writes nothing at all.
  public static isEmpty(plan: ScheduleLayersSavePlan): boolean {
    return (
      plan.layerDeletes.length === 0 &&
      plan.layerOrderUpdates.length === 0 &&
      plan.layerUserDeletes.length === 0 &&
      plan.layerUserOrderUpdates.length === 0 &&
      plan.layerUserCreates.length === 0
    );
  }

  public static resultToJSON(result: ScheduleLayersSaveResult): JSONObject {
    return {
      version: result.version,
      deletedLayers: result.deletedLayers,
      movedLayers: result.movedLayers,
      addedLayerUsers: result.addedLayerUsers,
      removedLayerUsers: result.removedLayerUsers,
      movedLayerUsers: result.movedLayerUsers,
    };
  }

  // The answer as the Dashboard reads it: counts it cannot read are 0.
  public static resultFromJSON(json: unknown): ScheduleLayersSaveResult {
    const record: Record<string, unknown> = asRecord(json) || {};

    const count: (key: string) => number = (key: string): number => {
      const value: unknown = record[key];
      return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : 0;
    };

    return {
      version: typeof record["version"] === "string" ? record["version"] : "",
      deletedLayers: count("deletedLayers"),
      movedLayers: count("movedLayers"),
      addedLayerUsers: count("addedLayerUsers"),
      removedLayerUsers: count("removedLayerUsers"),
      movedLayerUsers: count("movedLayerUsers"),
    };
  }
}
