import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  ScheduleLayersSaveLayer,
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveUser,
  ScheduleLayersState,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";

/*
 * THE CHANGES MADE ON THE LAYERS PAGE, BEFORE THEY ARE SAVED.
 *
 * The page keeps the layers and their people as they are saved, and beside
 * them what the reader has made of them: the layers in the order they are to
 * have - the ones to be deleted still in their place, so each says so where
 * it was - and the people of each layer in their turn order, someone added
 * as a row with no id yet. Save sends that (ScheduleLayersSave); Discard
 * puts the saved state back. These are the steps in between, with nothing
 * of React or the network in them.
 */

// The person added to a layer on the page has no row yet: a key of their own.
const addedRowKeys: WeakMap<OnCallDutyPolicyScheduleLayerUser, string> =
  new WeakMap<OnCallDutyPolicyScheduleLayerUser, string>();

let addedRowCount: number = 0;

const sameId: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

export const getLayerId: (layer: OnCallDutyPolicyScheduleLayer) => string = (
  layer: OnCallDutyPolicyScheduleLayer,
): string => {
  return layer.id?.toString() || "";
};

// The person a row is for: the user it names, or the user it holds.
export const getLayerUserUserId: (
  layerUser: OnCallDutyPolicyScheduleLayerUser,
) => string = (layerUser: OnCallDutyPolicyScheduleLayerUser): string => {
  return (
    layerUser.userId?.toString() ||
    layerUser.user?.id?.toString() ||
    layerUser.user?._id?.toString() ||
    ""
  );
};

// Whether the row is someone added on the page and not saved yet.
export const isAddedLayerUser: (
  layerUser: OnCallDutyPolicyScheduleLayerUser,
) => boolean = (layerUser: OnCallDutyPolicyScheduleLayerUser): boolean => {
  return !layerUser.id;
};

// A key that stays the row's while it is on the page, saved or not.
export const getLayerUserRowKey: (
  layerUser: OnCallDutyPolicyScheduleLayerUser,
  index: number,
) => string = (
  layerUser: OnCallDutyPolicyScheduleLayerUser,
  index: number,
): string => {
  return (
    layerUser.id?.toString() ||
    addedRowKeys.get(layerUser) ||
    `${getLayerUserUserId(layerUser)}-${index}`
  );
};

/*
 * Someone added to a layer on the page: a row with no id, holding the person
 * so their name and colour show at once, and a key of its own.
 */
export const createAddedLayerUser: (data: {
  layer: OnCallDutyPolicyScheduleLayer;
  userId: string;
  name: string;
  email: string;
}) => OnCallDutyPolicyScheduleLayerUser = (data: {
  layer: OnCallDutyPolicyScheduleLayer;
  userId: string;
  name: string;
  email: string;
}): OnCallDutyPolicyScheduleLayerUser => {
  const user: User = new User(new ObjectID(data.userId));

  if (data.name) {
    user.name = new Name(data.name);
  }

  if (data.email && Email.isValid(data.email)) {
    user.email = new Email(data.email);
  }

  const layerUser: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  layerUser.userId = new ObjectID(data.userId);
  layerUser.user = user;

  if (data.layer.id) {
    layerUser.onCallDutyPolicyScheduleLayerId = data.layer.id;
  }

  if (data.layer.onCallDutyPolicyScheduleId) {
    layerUser.onCallDutyPolicyScheduleId = data.layer.onCallDutyPolicyScheduleId;
  }

  if (data.layer.projectId) {
    layerUser.projectId = data.layer.projectId;
  }

  addedRowCount++;
  addedRowKeys.set(layerUser, `added-${addedRowCount}`);

  return layerUser;
};

/*
 * A layer's people in their turn order, as the server reads them: by order,
 * and by id where two share one (ScheduleLayersSaveUtil
 * .getLayerUsersInTurnOrder), so twins are shown the way they are saved.
 */
export const sortInTurnOrder: (
  layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>,
) => Array<OnCallDutyPolicyScheduleLayerUser> = (
  layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>,
): Array<OnCallDutyPolicyScheduleLayerUser> => {
  return [...layerUsers].sort(
    (
      a: OnCallDutyPolicyScheduleLayerUser,
      b: OnCallDutyPolicyScheduleLayerUser,
    ): number => {
      const byOrder: number = (a.order || 0) - (b.order || 0);

      if (byOrder !== 0) {
        return byOrder;
      }

      const aId: string = a.id?.toString().toLowerCase() || "";
      const bId: string = b.id?.toString().toLowerCase() || "";

      return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
  );
};

// The layers in priority order, as the server reads them.
export const sortInPriorityOrder: (
  layers: Array<OnCallDutyPolicyScheduleLayer>,
) => Array<OnCallDutyPolicyScheduleLayer> = (
  layers: Array<OnCallDutyPolicyScheduleLayer>,
): Array<OnCallDutyPolicyScheduleLayer> => {
  return [...layers].sort(
    (a: OnCallDutyPolicyScheduleLayer, b: OnCallDutyPolicyScheduleLayer) => {
      const byOrder: number = (a.order || 0) - (b.order || 0);

      if (byOrder !== 0) {
        return byOrder;
      }

      const aId: string = getLayerId(a).toLowerCase();
      const bId: string = getLayerId(b).toLowerCase();

      return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
  );
};

// The layers and their people as saved, as the version and the save read them.
export const getScheduleLayersState: (data: {
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
}) => ScheduleLayersState = (data: {
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
}): ScheduleLayersState => {
  const state: ScheduleLayersState = {
    layers: data.layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
      return { id: getLayerId(layer), order: layer.order || 0 };
    }),
    layerUsers: [],
  };

  for (const layerId in data.layerUsers) {
    for (const layerUser of data.layerUsers[layerId] || []) {
      if (!layerUser.id) {
        continue;
      }

      state.layerUsers.push({
        id: layerUser.id.toString(),
        layerId: layerUser.onCallDutyPolicyScheduleLayerId?.toString() || layerId,
        userId: getLayerUserUserId(layerUser),
        order: layerUser.order || 0,
      });
    }
  }

  return state;
};

// What Save sends: the layers kept, in their order, each with its people in theirs.
export const buildScheduleLayersSaveRequest: (data: {
  basedOnVersion: string;
  layerOrder: Array<string>;
  deletedLayerIds: Set<string>;
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
}) => ScheduleLayersSaveRequest = (data: {
  basedOnVersion: string;
  layerOrder: Array<string>;
  deletedLayerIds: Set<string>;
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
}): ScheduleLayersSaveRequest => {
  return {
    basedOnVersion: data.basedOnVersion,
    layers: data.layerOrder
      .filter((layerId: string): boolean => {
        return !data.deletedLayerIds.has(layerId);
      })
      .map((layerId: string): ScheduleLayersSaveLayer => {
        return {
          layerId: layerId,
          users: (data.layerUsers[layerId] || []).map(
            (
              layerUser: OnCallDutyPolicyScheduleLayerUser,
            ): ScheduleLayersSaveUser => {
              const userId: string = getLayerUserUserId(layerUser);

              return layerUser.id
                ? { layerUserId: layerUser.id.toString(), userId: userId }
                : { userId: userId };
            },
          ),
        };
      }),
    deletedLayerIds: data.layerOrder.filter((layerId: string): boolean => {
      return data.deletedLayerIds.has(layerId);
    }),
  };
};

/*
 * The layers' order once `layerId` moves a place up (higher priority) or
 * down. A layer that is to be deleted keeps its place on the page and is
 * stepped over: the layer moves past the next one that stays.
 */
export const moveLayerInOrder: (data: {
  layerOrder: Array<string>;
  deletedLayerIds: Set<string>;
  layerId: string;
  direction: "up" | "down";
}) => Array<string> = (data: {
  layerOrder: Array<string>;
  deletedLayerIds: Set<string>;
  layerId: string;
  direction: "up" | "down";
}): Array<string> => {
  const from: number = data.layerOrder.findIndex((id: string): boolean => {
    return sameId(id, data.layerId);
  });

  if (from < 0) {
    return data.layerOrder;
  }

  const step: number = data.direction === "up" ? -1 : 1;
  let to: number = from + step;

  while (
    to >= 0 &&
    to < data.layerOrder.length &&
    data.deletedLayerIds.has(data.layerOrder[to]!)
  ) {
    to += step;
  }

  if (to < 0 || to >= data.layerOrder.length) {
    return data.layerOrder;
  }

  const moved: Array<string> = [...data.layerOrder];
  moved[from] = data.layerOrder[to]!;
  moved[to] = data.layerOrder[from]!;

  return moved;
};

// The people of a layer who are saved in it and are not on the page any more.
export const getRemovedLayerUsers: (data: {
  saved: Array<OnCallDutyPolicyScheduleLayerUser>;
  draft: Array<OnCallDutyPolicyScheduleLayerUser>;
}) => Array<OnCallDutyPolicyScheduleLayerUser> = (data: {
  saved: Array<OnCallDutyPolicyScheduleLayerUser>;
  draft: Array<OnCallDutyPolicyScheduleLayerUser>;
}): Array<OnCallDutyPolicyScheduleLayerUser> => {
  const kept: Set<string> = new Set<string>(
    data.draft
      .map((layerUser: OnCallDutyPolicyScheduleLayerUser): string => {
        return layerUser.id?.toString().toLowerCase() || "";
      })
      .filter(Boolean),
  );

  return data.saved.filter(
    (layerUser: OnCallDutyPolicyScheduleLayerUser): boolean => {
      return (
        Boolean(layerUser.id) &&
        !kept.has(layerUser.id!.toString().toLowerCase())
      );
    },
  );
};

// Whether two rows are the one row: the same object, or saved with the same id.
export const isSameLayerUserRow: (
  a: OnCallDutyPolicyScheduleLayerUser,
  b: OnCallDutyPolicyScheduleLayerUser,
) => boolean = (
  a: OnCallDutyPolicyScheduleLayerUser,
  b: OnCallDutyPolicyScheduleLayerUser,
): boolean => {
  if (a === b) {
    return true;
  }

  const aId: string = a.id?.toString() || "";
  const bId: string = b.id?.toString() || "";

  return Boolean(aId) && Boolean(bId) && sameId(aId, bId);
};

/*
 * Someone taken out of a layer, put back where they were: before the first
 * person saved after them who is still in the layer, or at the end when
 * none is.
 */
export const restoreRemovedLayerUser: (data: {
  saved: Array<OnCallDutyPolicyScheduleLayerUser>;
  draft: Array<OnCallDutyPolicyScheduleLayerUser>;
  layerUser: OnCallDutyPolicyScheduleLayerUser;
}) => Array<OnCallDutyPolicyScheduleLayerUser> = (data: {
  saved: Array<OnCallDutyPolicyScheduleLayerUser>;
  draft: Array<OnCallDutyPolicyScheduleLayerUser>;
  layerUser: OnCallDutyPolicyScheduleLayerUser;
}): Array<OnCallDutyPolicyScheduleLayerUser> => {
  const isTheRow: (row: OnCallDutyPolicyScheduleLayerUser) => boolean = (
    row: OnCallDutyPolicyScheduleLayerUser,
  ): boolean => {
    return isSameLayerUserRow(row, data.layerUser);
  };

  if (data.draft.some(isTheRow)) {
    return data.draft;
  }

  let at: number = data.draft.length;
  const savedIndex: number = data.saved.findIndex(isTheRow);

  if (savedIndex >= 0) {
    for (const later of data.saved.slice(savedIndex + 1)) {
      const laterAt: number = data.draft.findIndex(
        (row: OnCallDutyPolicyScheduleLayerUser): boolean => {
          return isSameLayerUserRow(row, later);
        },
      );

      if (laterAt >= 0) {
        at = laterAt;
        break;
      }
    }
  }

  const restored: Array<OnCallDutyPolicyScheduleLayerUser> = [...data.draft];
  restored.splice(at, 0, data.layerUser);

  return restored;
};

// A list with the item at `from` moved to `to`, as a drop leaves it.
export const moveInList: <T>(list: Array<T>, from: number, to: number) => Array<T> =
  <T>(list: Array<T>, from: number, to: number): Array<T> => {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= list.length ||
      to >= list.length
    ) {
      return list;
    }

    const moved: Array<T> = [...list];
    const [item] = moved.splice(from, 1);
    moved.splice(to, 0, item as T);

    return moved;
  };
