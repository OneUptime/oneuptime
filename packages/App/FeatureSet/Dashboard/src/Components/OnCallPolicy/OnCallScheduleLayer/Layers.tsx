import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import { getCoverageWindowEnd } from "./CoverageWindow";
import DeletedLayerCard from "./DeletedLayerCard";
import LayerCard from "./LayerCard";
import { formatWindowSpan } from "./LayerSummary";
import LayersPreview from "./LayersPreview";
import LayersSaveBar, {
  LayersSaveStatus,
  getLayersChangeLines,
} from "./LayersSaveBar";
import {
  buildScheduleLayersSaveRequest,
  getLayerId,
  getMovedLayerUserIds,
  getRemovedLayerUsers,
  getScheduleLayersState,
  moveLayerInOrder,
  restoreRemovedLayerUser,
  sortInPriorityOrder,
  sortInTurnOrder,
} from "./LayersDraft";
import {
  isScheduleLayersSaveConflict,
  saveScheduleLayers,
} from "./SaveScheduleLayers";
import SkipLayerUserModal from "./SkipLayerUserModal";
import {
  GlobalUserOverrideShortcut,
  GlobalUserOverrideShortcutKind,
  getGlobalUserOverrideShortcut,
} from "../UserOverrides/GlobalUserOverrideLock";
import {
  UserOverridePolicy,
  fetchSchedulePolicies,
  fetchUserOverrideAddAccess,
  getPoliciesToOffer,
} from "../UserOverrides/UserOverridePolicies";
import { SCHEDULE_FINAL_SCHEDULE_DESCRIPTION } from "./ScheduleOverviewCopy";
import {
  ScheduleOverrideResolution,
  useScheduleUserOverrides,
} from "./ScheduleOverrides";
import TimezoneSelectButton from "./TimezoneSelectButton";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import DefinitionsDrawnAfter from "Common/UI/Components/Glossary/DefinitionsDrawnAfter";
import LearnMoreLink from "Common/UI/Components/Link/LearnMoreLink";
import { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import ScheduleResolution from "Common/Types/OnCallDutyPolicy/ScheduleResolution";
import {
  buildNewScheduleLayer,
  getNewLayerName,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import ScheduleLayersSaveUtil, {
  ScheduleLayersChanges,
  ScheduleLayersSaveRequest,
  ScheduleLayersState,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";
import ScheduleShiftUtil, {
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "Common/Types/OnCallDutyPolicy/ScheduleShiftUtil";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useUnsavedChanges } from "Common/UI/Utils/NewVersion/UnsavedChanges";
import useLeaveGuard, { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
} from "react";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  onCallDutyPolicyScheduleId: ObjectID;
  projectId: ObjectID;
}

/*
 * THE LAYERS PAGE HOLDS ITS CHANGES TO WHO TAKES TURNS UNTIL SAVE.
 *
 * People added to a layer, taken out of it or dragged into another turn
 * order, a layer moved up or down, a layer deleted: each is made on the page
 * first. The layer cards, the coverage banner and the final schedule show
 * the layers as they will be; a bar at the foot of the page says what has
 * changed (LayersSaveBar); Save changes saves all of it at once, so who is
 * on call changes once and the people it reaches are told once
 * (SaveScheduleLayers); Discard puts the layers back as they are saved; and
 * leaving the page asks first (useLeaveGuard). Each of them used to be
 * saved the moment it was made, so a drag past three people told each of
 * them they were on call, and then that they were not (issue #7575).
 *
 * The page keeps the layers and their people as they are saved, and its
 * changes beside them: the layers in the order they are to have, the ones
 * to be deleted still in their place, and each layer's people in their turn
 * order (LayersDraft). Save sends the version the saved layers are at, so a
 * save made after someone else changed them is refused rather than undo
 * their change unseen (a 409, and the bar asks for a reload).
 *
 * Left as they were, each saved by a button of its own in a form or a
 * dialog of its own, so none is saved by accident: a layer's settings (its
 * form's Save Layer), the schedule's timezone (Save timezone) and Skip
 * until... (its dialog's Save). And Add layer, saved at once: the new layer
 * is empty and at the bottom, so it puts nobody on call until people are
 * added to it - and that waits for Save.
 */

// The layers and their people as one read gives them.
interface LoadedLayers {
  timezone: string | undefined;
  // In priority order, the highest first.
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  // By layer id, each in turn order.
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
}

// How long "Changes saved" stays up once a save is done.
export const LAYERS_SAVED_NOTICE_MS: number = 4000;

// A copy of the people of each layer, whose lists the page may change.
const copyLayerUsers: (
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>,
) => Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> = (
  layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>,
): Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> => {
  const copy: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> = {};

  for (const layerId in layerUsers) {
    copy[layerId] = [...(layerUsers[layerId] || [])];
  }

  return copy;
};

const Layers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  // The layers as they are saved, in priority order.
  const [savedLayers, setSavedLayers] = React.useState<
    Array<OnCallDutyPolicyScheduleLayer>
  >([]);

  // The people of each layer as they are saved, in turn order.
  const [savedLayerUsers, setSavedLayerUsers] = React.useState<
    Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>
  >({});

  /*
   * The page's changes, until Save or Discard: the layers in the order they
   * are to have (the ones to be deleted too, in their place), the ones to be
   * deleted, and the people of each layer in the turn order they are to
   * have - someone added as a row with no id yet.
   */
  const [layerOrder, setLayerOrder] = React.useState<Array<string>>([]);

  const [deletedLayerIds, setDeletedLayerIds] = React.useState<Set<string>>(
    new Set<string>(),
  );

  const [draftLayerUsers, setDraftLayerUsers] = React.useState<
    Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>
  >({});

  const [saveStatus, setSaveStatus] = React.useState<LayersSaveStatus>({
    kind: "idle",
  });

  const [isReloading, setIsReloading] = React.useState<boolean>(false);

  const [showDiscardConfirm, setShowDiscardConfirm] =
    React.useState<boolean>(false);

  /*
   * The schedule's IANA timezone. The "Final schedule" preview must resolve
   * restriction wall-clock windows in this zone (as the server does and as the
   * sibling FinalPreview does), otherwise the editing preview shows on-call
   * hours in the viewer's browser zone and contradicts who actually gets paged
   * (audit F21).
   */
  const [scheduleTimezone, setScheduleTimezone] = React.useState<
    string | undefined
  >(undefined);

  const [isSavingTimezone, setIsSavingTimezone] =
    React.useState<boolean>(false);

  const [isAddButtonLoading, setIsAddButtonLoading] =
    React.useState<boolean>(false);

  // The first read of the layers failed: the page says so instead of the layers.
  const [error, setError] = React.useState<string>("");

  /*
   * Adding a layer, saving the timezone or reading the layers again failed:
   * said over the layers, which stay - with any changes the page holds.
   */
  const [actionError, setActionError] = React.useState<string>("");

  const [expandedLayerIds, setExpandedLayerIds] = React.useState<Set<string>>(
    new Set<string>(),
  );

  const [showCannotDeleteOnlyLayerError, setShowCannotDeleteOnlyLayerError] =
    React.useState<boolean>(false);

  /*
   * "Skip until..." on a person in a layer: who the dialog is for, while it
   * is open. Each override saved from it bumps the refresh key, so the cards,
   * the coverage banner and the final schedule read the overrides again.
   */
  const [personToSkip, setPersonToSkip] = React.useState<{
    userId: string;
    name: string;
  } | null>(null);

  const [overrideRefreshKey, setOverrideRefreshKey] = React.useState<number>(0);

  /*
   * What "Skip until..." adds for the reader (GlobalUserOverrideLock). The
   * skip applies to every on-call policy, so it takes a permission to add
   * overrides over the whole project. Read on every render: the snapshot
   * can land after the page first draws.
   */
  const skipShortcut: GlobalUserOverrideShortcut =
    getGlobalUserOverrideShortcut();

  const isSkipOnSomePolicies: boolean =
    skipShortcut.kind === GlobalUserOverrideShortcutKind.SomePolicies;

  /*
   * For a reader whose permission covers only some policies: the policies
   * that page through this schedule which the server says they may cover
   * (UserOverridePolicies) - the skip is added on those, one override on
   * each - or null until it has answered.
   */
  const [skipPolicies, setSkipPolicies] =
    React.useState<Array<UserOverridePolicy> | null>(null);

  useEffect(() => {
    if (!isSkipOnSomePolicies) {
      return;
    }

    let isCurrent: boolean = true;

    const askServer: () => Promise<
      Array<UserOverridePolicy>
    > = async (): Promise<Array<UserOverridePolicy>> => {
      const policies: Array<UserOverridePolicy> = await fetchSchedulePolicies(
        props.onCallDutyPolicyScheduleId,
      );

      if (policies.length === 0) {
        return [];
      }

      return getPoliciesToOffer({
        policies: policies,
        access: await fetchUserOverrideAddAccess({
          projectId: props.projectId.toString(),
          onCallDutyPolicyIds: policies.map(
            (policy: UserOverridePolicy): string => {
              return policy.id;
            },
          ),
        }),
      });
    };

    askServer()
      .then((policies: Array<UserOverridePolicy>) => {
        if (isCurrent) {
          setSkipPolicies(policies);
        }
      })
      .catch(() => {
        // Not knowing which, it offers none: the button stays locked.
        if (isCurrent) {
          setSkipPolicies([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [isSkipOnSomePolicies, props.onCallDutyPolicyScheduleId.toString()]);

  /*
   * Why "Skip until..." is locked for the reader, or null: they may add no
   * override at all, or their permission covers only some policies and
   * the server allows none of this schedule's - or has not answered yet.
   * Locked, each row's button stays where it is, says why, and the dialog
   * never opens.
   */
  let skipLockedReason: string | null = skipShortcut.reason;

  if (isSkipOnSomePolicies && skipPolicies && skipPolicies.length > 0) {
    skipLockedReason = null;
  }

  /*
   * The schedule's timezone, its layers in priority order and every
   * layer's people in turn order - the order the server reads them in, so
   * twins (two rows saved with one order) are shown as they take turns.
   */
  const loadLayers: () => Promise<LoadedLayers> =
    async (): Promise<LoadedLayers> => {
      /*
       * Load the schedule's timezone so the "Final schedule" preview resolves
       * restriction windows in the same zone the server uses to page people
       * (audit F21).
       */
      const schedule: OnCallDutyPolicySchedule | null =
        await ModelAPI.getItem<OnCallDutyPolicySchedule>({
          modelType: OnCallDutyPolicySchedule,
          id: props.onCallDutyPolicyScheduleId,
          select: {
            timezone: true,
          },
        });

      const layersResult: ListResult<OnCallDutyPolicyScheduleLayer> =
        await ModelAPI.getList<OnCallDutyPolicyScheduleLayer>({
          modelType: OnCallDutyPolicyScheduleLayer,
          query: {
            onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            order: true,
            name: true,
            description: true,
            startsAt: true,
            restrictionTimes: true,
            rotation: true,
            onCallDutyPolicyScheduleId: true,
            projectId: true,
            handOffTime: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      // Fetch every layer's users in a single request, then group by layer id.
      const usersResult: ListResult<OnCallDutyPolicyScheduleLayerUser> =
        await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
          modelType: OnCallDutyPolicyScheduleLayerUser,
          query: {
            onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            onCallDutyPolicyScheduleLayerId: true,
            userId: true,
            user: {
              name: true,
              email: true,
              _id: true,
              profilePictureId: true,
            },
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      const groupedUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> =
        {};
      for (const layerUser of usersResult.data) {
        const layerId: string =
          layerUser.onCallDutyPolicyScheduleLayerId?.toString() || "";
        if (!groupedUsers[layerId]) {
          groupedUsers[layerId] = [];
        }
        groupedUsers[layerId]!.push(layerUser);
      }

      for (const layerId in groupedUsers) {
        groupedUsers[layerId] = sortInTurnOrder(groupedUsers[layerId] || []);
      }

      return {
        timezone: schedule?.timezone?.toString() || undefined,
        layers: sortInPriorityOrder(layersResult.data),
        layerUsers: groupedUsers,
      };
    };

  // The layers as read, saved and on the page alike: no changes held.
  const applyLoadedLayers: (loaded: LoadedLayers) => void = (
    loaded: LoadedLayers,
  ): void => {
    setScheduleTimezone(loaded.timezone);
    setSavedLayers(loaded.layers);
    setSavedLayerUsers(loaded.layerUsers);
    setLayerOrder(loaded.layers.map(getLayerId));
    setDeletedLayerIds(new Set<string>());
    setDraftLayerUsers(copyLayerUsers(loaded.layerUsers));
  };

  useEffect(() => {
    let isCurrent: boolean = true;

    loadLayers()
      .then((loaded: LoadedLayers) => {
        if (!isCurrent) {
          return;
        }

        applyLoadedLayers(loaded);

        /*
         * On the first load, expand the top layer so the editor is
         * immediately visible without hiding the at-a-glance list of others.
         */
        const firstLayerId: string | undefined = loaded.layers[0]
          ? getLayerId(loaded.layers[0])
          : undefined;

        if (firstLayerId) {
          setExpandedLayerIds(new Set<string>([firstLayerId]));
        }

        setIsLoading(false);
      })
      .catch((err: Error) => {
        if (!isCurrent) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const layerById: Map<string, OnCallDutyPolicyScheduleLayer> = useMemo(() => {
    const map: Map<string, OnCallDutyPolicyScheduleLayer> = new Map<
      string,
      OnCallDutyPolicyScheduleLayer
    >();

    for (const layer of savedLayers) {
      map.set(getLayerId(layer), layer);
    }

    return map;
  }, [savedLayers]);

  /*
   * The layers in the order the page has them: every saved layer once, a
   * layer added since at the end.
   */
  const draftLayerOrder: Array<string> = useMemo(() => {
    const ordered: Array<string> = layerOrder.filter(
      (layerId: string): boolean => {
        return layerById.has(layerId);
      },
    );

    const listed: Set<string> = new Set<string>(ordered);

    for (const layer of savedLayers) {
      const layerId: string = getLayerId(layer);

      if (!listed.has(layerId)) {
        ordered.push(layerId);
        listed.add(layerId);
      }
    }

    return ordered;
  }, [layerOrder, savedLayers, layerById]);

  // The layers the schedule keeps, in the priority order they are to have.
  const keptLayerIds: Array<string> = useMemo(() => {
    return draftLayerOrder.filter((layerId: string): boolean => {
      return !deletedLayerIds.has(layerId);
    });
  }, [draftLayerOrder, deletedLayerIds]);

  const keptLayers: Array<OnCallDutyPolicyScheduleLayer> = useMemo(() => {
    return keptLayerIds
      .map((layerId: string): OnCallDutyPolicyScheduleLayer | undefined => {
        return layerById.get(layerId);
      })
      .filter(
        (
          layer: OnCallDutyPolicyScheduleLayer | undefined,
        ): layer is OnCallDutyPolicyScheduleLayer => {
          return Boolean(layer);
        },
      );
  }, [keptLayerIds, layerById]);

  // The people of each layer kept, as the page has them.
  const keptLayerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> =
    useMemo(() => {
      const users: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> = {};

      for (const layerId of keptLayerIds) {
        users[layerId] = draftLayerUsers[layerId] || [];
      }

      return users;
    }, [keptLayerIds, draftLayerUsers]);

  /*
   * What Save sends, and what it changes - worked out the way the server
   * works it out (ScheduleLayersSaveUtil.plan), from the layers as they are
   * saved and the version they are at.
   */
  const savedState: ScheduleLayersState = useMemo(() => {
    return getScheduleLayersState({
      layers: savedLayers,
      layerUsers: savedLayerUsers,
    });
  }, [savedLayers, savedLayerUsers]);

  const saveRequest: ScheduleLayersSaveRequest = useMemo(() => {
    return buildScheduleLayersSaveRequest({
      basedOnVersion: ScheduleLayersSaveUtil.getVersion(savedState),
      layerOrder: draftLayerOrder,
      deletedLayerIds: deletedLayerIds,
      layerUsers: draftLayerUsers,
    });
  }, [savedState, draftLayerOrder, deletedLayerIds, draftLayerUsers]);

  /*
   * Null only when the changes cannot be worked out, which the page's own
   * changes never lead to: the bar then says there are changes, and Save
   * says what the server makes of them.
   */
  const changes: ScheduleLayersChanges | null = useMemo(() => {
    try {
      return ScheduleLayersSaveUtil.plan({
        state: savedState,
        request: saveRequest,
      }).changes;
    } catch {
      return null;
    }
  }, [savedState, saveRequest]);

  /*
   * Whether the page holds changes Save has not saved. Not once a save is
   * done but could not be read back: those are saved.
   */
  const hasUnsavedChanges: boolean =
    (changes ? changes.hasChanges : true) && saveStatus.kind !== "reloadFailed";

  /*
   * Whether the page marks what it has changed: a person New, Moved or
   * Removed when you save, a layer to be deleted, a card's "Unsaved
   * changes". Not once a save is done but could not be read back: those
   * changes are saved, and the page waits for Reload layers.
   */
  const marksUnsavedChanges: boolean = saveStatus.kind !== "reloadFailed";

  /*
   * A page with unsaved changes holds them: nothing reloads it under them,
   * a new version of OneUptime included, and leaving it asks first.
   */
  useUnsavedChanges(hasUnsavedChanges);

  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsavedChanges);

  // The layers whose people, or whose place among the layers, the page has changed.
  const changedLayerIds: Set<string> = useMemo(() => {
    const changed: Set<string> = new Set<string>();

    for (const layer of changes?.layers || []) {
      changed.add(layer.layerId.toLowerCase());
    }

    const savedKeptLayerIds: Array<string> = savedLayers
      .map(getLayerId)
      .filter((layerId: string): boolean => {
        return !deletedLayerIds.has(layerId);
      });

    keptLayerIds.forEach((layerId: string, index: number): void => {
      if (savedKeptLayerIds[index] !== layerId) {
        changed.add(layerId.toLowerCase());
      }
    });

    return changed;
  }, [changes, savedLayers, deletedLayerIds, keptLayerIds]);

  // "Changes saved" goes after a moment.
  useEffect(() => {
    if (saveStatus.kind !== "saved") {
      return undefined;
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setSaveStatus((status: LayersSaveStatus) => {
        return status.kind === "saved" ? { kind: "idle" } : status;
      });
    }, LAYERS_SAVED_NOTICE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [saveStatus]);

  /*
   * A change made on the page: what the bar said about the last save - that
   * it failed, or that it is done - is no longer what it is about.
   */
  const noteChange: () => void = (): void => {
    setSaveStatus((status: LayersSaveStatus) => {
      return status.kind === "error" || status.kind === "saved"
        ? { kind: "idle" }
        : status;
    });
  };

  // A layer's name, as its card says it.
  const getLayerName: (layerId: string) => string = (
    layerId: string,
  ): string => {
    const key: string = layerId.toLowerCase();
    const layer: OnCallDutyPolicyScheduleLayer | undefined =
      layerById.get(layerId) ||
      savedLayers.find((candidate: OnCallDutyPolicyScheduleLayer) => {
        return getLayerId(candidate).toLowerCase() === key;
      });

    const name: string = layer?.name?.toString() || "";

    if (name) {
      return name;
    }

    const index: number = draftLayerOrder.findIndex(
      (candidate: string): boolean => {
        return candidate.toLowerCase() === key;
      },
    );

    return translator.translateTemplate("Layer {{number}}", {
      number: index + 1,
    });
  };

  const addLayer: () => Promise<void> = async (): Promise<void> => {
    setIsAddButtonLoading(true);
    setActionError("");

    /*
     * The page's changes, and the layers they were made to, as they are when
     * the new layer is asked for.
     */
    const hadUnsavedChanges: boolean = hasUnsavedChanges;
    const stateBefore: ScheduleLayersState = savedState;

    try {
      /*
       * Base the new order on the current maximum order (not the array length)
       * so adding after a deletion appends at the end without colliding with an
       * existing order.
       */
      const maxOrder: number = savedLayers.reduce(
        (max: number, layer: OnCallDutyPolicyScheduleLayer) => {
          return Math.max(max, layer.order || 0);
        },
        0,
      );
      const newOrder: number = maxOrder + 1;

      /*
       * The layer every new layer starts as (ScheduleLayerDefaults), the same
       * the server adds when a schedule is created with people to take
       * turns: on call from now, handing off once a week, around the clock.
       * Its name is "Layer N", skipping names still taken: after deleting a
       * middle layer the server re-sequences orders but leaves names
       * untouched, so "Layer 3" can still exist while maxOrder is 2.
       */
      const newLayer: OnCallDutyPolicyScheduleLayer = buildNewScheduleLayer({
        onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
        projectId: props.projectId,
        name: getNewLayerName({
          order: newOrder,
          existingNames: savedLayers.map(
            (layer: OnCallDutyPolicyScheduleLayer) => {
              return layer.name?.toString() || "";
            },
          ),
        }),
        order: newOrder,
        timezone: scheduleTimezone,
      });

      const response: HTTPResponse<
        | OnCallDutyPolicyScheduleLayer
        | OnCallDutyPolicyScheduleLayer[]
        | JSONObject
        | JSONArray
      > = await ModelAPI.create<OnCallDutyPolicyScheduleLayer>({
        model: newLayer,
        modelType: OnCallDutyPolicyScheduleLayer,
      });

      const createdLayer: OnCallDutyPolicyScheduleLayer =
        response.data as OnCallDutyPolicyScheduleLayer;

      const createdLayerId: string = createdLayer.id?.toString() || "";

      // Read again, so the page has the layer as the server saved it.
      const loaded: LoadedLayers = await loadLayers();

      if (!hadUnsavedChanges) {
        applyLoadedLayers(loaded);
      } else {
        /*
         * The page holds changes: they stay, made to the layers as they are
         * now - the same, with the new layer at the end - and the new layer
         * goes at the end of the page's order too. Unless someone else
         * changed the layers meanwhile: saving the page's changes over theirs
         * would undo theirs unseen, so the bar asks for a reload, as Save
         * would.
         */
        const expected: ScheduleLayersState = {
          layers: [
            ...stateBefore.layers,
            { id: createdLayerId, order: newOrder },
          ],
          layerUsers: stateBefore.layerUsers,
        };

        const loadedState: ScheduleLayersState = getScheduleLayersState({
          layers: loaded.layers,
          layerUsers: loaded.layerUsers,
        });

        if (
          createdLayerId &&
          ScheduleLayersSaveUtil.getVersion(loadedState) ===
            ScheduleLayersSaveUtil.getVersion(expected)
        ) {
          setScheduleTimezone(loaded.timezone);
          setSavedLayers(loaded.layers);
          setSavedLayerUsers(loaded.layerUsers);
          setLayerOrder((previous: Array<string>) => {
            return previous.includes(createdLayerId)
              ? previous
              : [...previous, createdLayerId];
          });
        } else {
          setSaveStatus({ kind: "conflict" });
        }
      }

      // Expanded, so the user can configure it right away.
      if (createdLayerId) {
        setExpandedLayerIds((prev: Set<string>) => {
          const next: Set<string> = new Set<string>(prev);
          next.add(createdLayerId);
          return next;
        });
      }
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsAddButtonLoading(false);
  };

  /*
   * Delete on a layer: it is deleted when the page is saved, and until then
   * its card says so where it was, with Undo. A schedule keeps one layer at
   * least.
   */
  const requestDeleteLayer: (layerId: string) => void = (
    layerId: string,
  ): void => {
    if (keptLayerIds.length <= 1) {
      setShowCannotDeleteOnlyLayerError(true);
      return;
    }

    setDeletedLayerIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      next.add(layerId);
      return next;
    });
    noteChange();
  };

  const undoDeleteLayer: (layerId: string) => void = (
    layerId: string,
  ): void => {
    setDeletedLayerIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      next.delete(layerId);
      return next;
    });
    noteChange();
  };

  /*
   * A layer moved a place up (higher priority) or down, past the next layer
   * the schedule keeps: one to be deleted stays where it is.
   */
  const moveLayer: (layerId: string, direction: "up" | "down") => void = (
    layerId: string,
    direction: "up" | "down",
  ): void => {
    setLayerOrder(
      moveLayerInOrder({
        layerOrder: draftLayerOrder,
        deletedLayerIds: deletedLayerIds,
        layerId: layerId,
        direction: direction,
      }),
    );
    noteChange();
  };

  const toggleExpand: (layerId: string) => void = (layerId: string): void => {
    setExpandedLayerIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const applySavedLayer: (savedLayer: OnCallDutyPolicyScheduleLayer) => void = (
    savedLayer: OnCallDutyPolicyScheduleLayer,
  ): void => {
    /*
     * Merge the saved fields into the matching layer so the collapsed summary
     * (name, rotation, restrictions) reflects the change without a full reload.
     */
    setSavedLayers((prev: Array<OnCallDutyPolicyScheduleLayer>) => {
      return prev.map((layer: OnCallDutyPolicyScheduleLayer) => {
        if (layer.id?.toString() !== savedLayer.id?.toString()) {
          return layer;
        }
        if (savedLayer.name !== undefined) {
          layer.name = savedLayer.name;
        }
        if (savedLayer.description !== undefined) {
          layer.description = savedLayer.description;
        }
        if (savedLayer.startsAt !== undefined) {
          layer.startsAt = savedLayer.startsAt;
        }
        if (savedLayer.rotation !== undefined) {
          layer.rotation = savedLayer.rotation;
        }
        if (savedLayer.handOffTime !== undefined) {
          layer.handOffTime = savedLayer.handOffTime;
        }
        if (savedLayer.restrictionTimes !== undefined) {
          layer.restrictionTimes = savedLayer.restrictionTimes;
        }
        return layer;
      });
    });
  };

  // The people of a layer as the page is to have them: held until Save.
  const updateLayerUsers: (
    layerId: string,
    users: Array<OnCallDutyPolicyScheduleLayerUser>,
  ) => void = (
    layerId: string,
    users: Array<OnCallDutyPolicyScheduleLayerUser>,
  ): void => {
    setDraftLayerUsers(
      (prev: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>) => {
        return {
          ...prev,
          [layerId]: [...users],
        };
      },
    );
    noteChange();
  };

  // Undo on someone taken out of a layer: back where they were.
  const restoreLayerUser: (
    layerId: string,
    layerUser: OnCallDutyPolicyScheduleLayerUser,
  ) => void = (
    layerId: string,
    layerUser: OnCallDutyPolicyScheduleLayerUser,
  ): void => {
    setDraftLayerUsers(
      (prev: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>) => {
        return {
          ...prev,
          [layerId]: restoreRemovedLayerUser({
            saved: savedLayerUsers[layerId] || [],
            draft: prev[layerId] || [],
            layerUser: layerUser,
          }),
        };
      },
    );
    noteChange();
  };

  // Discard: the layers as they are saved, on the page again.
  const discardChanges: () => void = (): void => {
    setLayerOrder(savedLayers.map(getLayerId));
    setDeletedLayerIds(new Set<string>());
    setDraftLayerUsers(copyLayerUsers(savedLayerUsers));
    setSaveStatus({ kind: "idle" });
    setShowDiscardConfirm(false);
  };

  /*
   * Save: every change at once (SaveScheduleLayers), then the layers read
   * again as they are now saved. A save refused because someone else
   * changed the layers first keeps the changes on the page and asks for a
   * reload; any other refusal says why and keeps them, to save again.
   */
  const saveChanges: () => Promise<void> = async (): Promise<void> => {
    if (saveStatus.kind === "saving") {
      return;
    }

    setSaveStatus({ kind: "saving" });
    setActionError("");

    try {
      await saveScheduleLayers({
        scheduleId: props.onCallDutyPolicyScheduleId,
        projectId: props.projectId,
        request: saveRequest,
      });
    } catch (err) {
      setSaveStatus(
        isScheduleLayersSaveConflict(err)
          ? { kind: "conflict" }
          : { kind: "error", message: API.getFriendlyMessage(err) },
      );
      return;
    }

    try {
      applyLoadedLayers(await loadLayers());
      setSaveStatus({ kind: "saved" });
    } catch (err) {
      setSaveStatus({
        kind: "reloadFailed",
        message: API.getFriendlyMessage(err),
      });
    }
  };

  // Reload, after a conflict or a save the page could not read back: the page's changes go.
  const reloadLayers: () => Promise<void> = async (): Promise<void> => {
    setIsReloading(true);
    setActionError("");

    try {
      applyLoadedLayers(await loadLayers());
      setSaveStatus({ kind: "idle" });
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsReloading(false);
  };

  /*
   * While the page saves, adds a layer or reads the layers again, its other
   * changes wait: Add layer, and moving, deleting or changing the people of
   * a layer. So they do after a save the page could not read back, and
   * after someone else changed the layers first, until Reload layers: a
   * change made to the layers as the page last read them would be refused,
   * since they have moved on. The page's changes stay in view meanwhile, so
   * whoever made them can see what to make again once the layers are read.
   */
  const isMutating: boolean =
    isAddButtonLoading ||
    saveStatus.kind === "saving" ||
    saveStatus.kind === "reloadFailed" ||
    saveStatus.kind === "conflict" ||
    isReloading;

  const addLayerButton: GetReactElementFunction = (): ReactElement => {
    return (
      <Button
        title="Add Layer"
        isLoading={isAddButtonLoading}
        disabled={isMutating}
        onClick={async () => {
          await addLayer();
        }}
        icon={IconProp.Add}
        buttonStyle={ButtonStyleType.PRIMARY}
      />
    );
  };

  /*
   * Every user on any layer of this schedule, as the page has them. Overrides
   * for anyone else cannot affect what this page shows.
   */
  const scheduleUserIds: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set<string>();
    for (const layerId in keptLayerUsers) {
      for (const layerUser of keptLayerUsers[layerId] || []) {
        const userId: string = layerUser.user?.id?.toString() || "";
        if (userId) {
          ids.add(userId);
        }
      }
    }
    return ids;
  }, [keptLayerUsers]);

  /*
   * The names of the people on this schedule's layers, by user id: the
   * "Skip until..." dialog names whoever its "Who is away?" is changed to.
   */
  const scheduleUserNameById: Record<string, string> = useMemo(() => {
    const names: Record<string, string> = {};
    for (const layerId in keptLayerUsers) {
      for (const layerUser of keptLayerUsers[layerId] || []) {
        const userId: string = layerUser.user?.id?.toString() || "";
        const name: string =
          layerUser.user?.name?.toString() ||
          layerUser.user?.email?.toString() ||
          "";
        if (userId && name) {
          names[userId] = name;
        }
      }
    }
    return names;
  }, [keptLayerUsers]);

  /*
   * The window the layer cards actually reason over: a little history so an
   * in-progress turn keeps its true start, and the shared forward coverage
   * window so an upcoming substitution reaches the shift table. Anchored once
   * per saved layer/user change rather than to a ticking clock, so the override
   * list is not refetched on every re-render - nor on every change the page
   * holds: someone added is read for by the overrides' own user key.
   *
   * A rotation slower than the coverage window (an annual hand-off, say) can
   * list turns beyond this window's end; a substitution that far out will not be
   * reflected in those far-future rows. It is always reflected in the one row
   * that can page somebody today — "on call now".
   */
  const overrideWindow: { start: Date; end: Date } = useMemo(() => {
    const windowNow: Date = OneUptimeDate.getCurrentDate();
    return {
      start: OneUptimeDate.addRemoveDays(windowNow, -2),
      end: getCoverageWindowEnd(windowNow),
    };
    /*
     * The body reads neither dependency on purpose. They are here as a
     * re-anchor signal: the window should move when the schedule's saved
     * layers or users change (the cards are recomputed anyway), and NOT on
     * every render, which is what keying it to the clock would do.
     */
  }, [savedLayers, savedLayerUsers]);

  /*
   * The overrides in force for this schedule, resolved the way the server does
   * for routing (see ./ScheduleOverrides). Fed to every layer card so its "on
   * call now" line and shift table name whoever is actually covering, instead of
   * contradicting the final-schedule calendar at the bottom of this same page.
   * https://github.com/OneUptime/oneuptime/issues/3411
   */
  const overrideResolution: ScheduleOverrideResolution =
    useScheduleUserOverrides({
      onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
      scheduleUserIds,
      windowStart: overrideWindow.start,
      windowEnd: overrideWindow.end,
      refreshKey: overrideRefreshKey,
    });

  /*
   * The schedule's coverage over the shared window, computed with exactly the
   * same resolution (ScheduleResolution) and ScheduleShiftUtil pipeline the
   * preview at the bottom of the page uses, so the two can never disagree -
   * time away included: everybody in a layer away at once leaves that layer
   * with nobody on call, and a gap the banner names when no layer below
   * covers it. Of the layers as the page has them: a change it holds shows
   * here before it is saved.
   *
   * Expanding every layer's rotation across the window and merging the layers by
   * priority is the most expensive thing this component does — hundreds of
   * milliseconds for a daily rotation, and it scales super-linearly with the
   * window. Memoized so it runs when the schedule actually changes rather than
   * on every render (expanding a layer card, opening a modal, a timezone save
   * rolling back), which would otherwise block the main thread each time.
   *
   * `now` is deliberately captured inside the memo: the window only needs to be
   * accurate to the current edit, and re-anchoring it on a clock tick would
   * throw away the cached result every second.
   */
  const coverageSummary: {
    coverage: ScheduleCoverageState;
    windowLabel: string;
  } = useMemo(() => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const windowEnd: Date = getCoverageWindowEnd(now);

    const layerProps: Array<LayerProps> = keptLayers.map(
      (layer: OnCallDutyPolicyScheduleLayer): LayerProps => {
        const layerId: string = layer.id?.toString() || "";
        return {
          users: (keptLayerUsers[layerId] || [])
            .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return layerUser.user!;
            })
            .filter(Boolean),
          startDateTimeOfLayer: layer.startsAt!,
          handOffTime: layer.handOffTime!,
          rotation: layer.rotation!,
          restrictionTimes: layer.restrictionTimes!,
          timezone: scheduleTimezone,
        };
      },
    );

    const assignedUserCount: number = layerProps.reduce(
      (total: number, layerProp: LayerProps) => {
        return total + layerProp.users.length;
      },
      0,
    );

    return {
      coverage: ScheduleShiftUtil.getCoverageState({
        layerCount: keptLayers.length,
        assignedUserCount,
        shifts: ScheduleShiftUtil.groupEventsIntoShifts(
          ScheduleResolution.resolve({
            calendarStartDate: now,
            calendarEndDate: windowEnd,
            layers: layerProps,
            overrides: overrideResolution.records,
            currentOnCallDutyPolicyId:
              overrideResolution.policyContextId || undefined,
          }).events,
        ),
        now,
        windowEnd,
      }),
      windowLabel: formatWindowSpan(now, windowEnd),
    };
  }, [
    keptLayers,
    keptLayerUsers,
    scheduleTimezone,
    overrideResolution.records,
    overrideResolution.policyContextId,
  ]);

  /*
   * A compact statement of the schedule's coverage, rendered above the layer
   * cards. Only rendered when there is something to act on — a fully-covered
   * schedule shows nothing, so the banner reads as an exception rather than as
   * noise present on every visit.
   *
   * Deliberately NOT a blocking form validation: a partially-covered schedule is
   * a legitimate configuration (an escalation policy may intend a business-hours
   * layer to fall through to a team). The point is that the consequence is
   * stated at the moment of editing rather than discovered during an incident.
   */
  const coverageBanner: () => ReactElement | null = (): ReactElement | null => {
    const coverage: ScheduleCoverageState = coverageSummary.coverage;
    const windowLabel: string = coverageSummary.windowLabel;

    /*
     * Nothing to say when every moment of the window has someone on call — the
     * banner exists to surface gaps, so silence here is the "all good" state.
     */
    if (
      coverage.status === ScheduleCoverageStatus.Covered &&
      coverage.gaps.length === 0
    ) {
      return null;
    }

    const percent: number = Math.round(coverage.coverageRatio * 100);

    let message: ReactElement = (
      <span>
        <span className="font-semibold">
          {translator.translatePlural(
            {
              one: "{{count}} coverage gap in the next {{window}}.",
              other: "{{count}} coverage gaps in the next {{window}}.",
            },
            coverage.gaps.length,
            { window: windowLabel },
          )}
        </span>{" "}
        {translator.translateTemplate(
          "Someone is on call for {{percent}}% of that window. During the rest, alerts routed to this schedule will notify no one. See the final schedule below for exactly when.",
          { percent: percent >= 100 ? 99 : percent },
        )}
      </span>
    );

    if (coverage.status === ScheduleCoverageStatus.NoUsers) {
      message = (
        <span>
          <span className="font-semibold">
            {translator.translateText("No users are assigned to any layer.")}
          </span>{" "}
          {translator.translateText(
            "Nobody is ever on call in this schedule, so every alert routed here will go unanswered. Expand a layer below and add at least one user.",
          )}
        </span>
      );
    }

    return (
      <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
        <Icon
          icon={IconProp.Alert}
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500"
        />
        {message}
      </div>
    );
  };

  type SaveScheduleTimezoneFunction = (
    timezone: string | undefined,
  ) => Promise<void>;

  /*
   * The schedule's timezone lives on the schedule model but is edited here, next
   * to the layers whose rotation-start / hand-off / restriction times it governs
   * — so the zone and the times it interprets are configured in one place. We
   * update local state optimistically so the layer editors and previews
   * re-anchor immediately, and roll back if the save fails.
   */
  const saveScheduleTimezone: SaveScheduleTimezoneFunction = async (
    timezone: string | undefined,
  ): Promise<void> => {
    const previous: string | undefined = scheduleTimezone;

    if (timezone === previous) {
      return;
    }

    setScheduleTimezone(timezone);
    setIsSavingTimezone(true);
    setActionError("");

    try {
      await ModelAPI.updateById({
        modelType: OnCallDutyPolicySchedule,
        id: props.onCallDutyPolicyScheduleId,
        data: {
          timezone: timezone || null,
        },
      });
    } catch (err) {
      setScheduleTimezone(previous);
      setActionError(API.getFriendlyMessage(err));
    }

    setIsSavingTimezone(false);
  };

  /*
   * "Rotation layers", said with what a layer is (DefinedTerm), and the docs
   * page that explains them: the same words over the first layer's empty
   * card and over the list of layers.
   */
  const rotationLayersTitle: ReactElement = (
    <DefinedTerm term={GlossaryTerm.Layer}>
      {translator.translateText("Rotation layers")}
    </DefinedTerm>
  );

  const layersLearnMore: ReactElement = (
    <LearnMoreLink
      docsPath="/docs/on-call/schedules#layers"
      dataTestId="schedule-layers-learn-more"
    />
  );

  const timezoneCard: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="mb-5">
        <Card
          title="Schedule timezone"
          description={"Every time on the layers below is in this timezone."}
        >
          <div className="flex items-center gap-3">
            <TimezoneSelectButton
              value={scheduleTimezone}
              saving={isSavingTimezone}
              icon={IconProp.Globe}
              placeholder="Not set: the server's own time is used"
              modalTitle={translationKey("Set schedule timezone")}
              modalDescription={translationKey(
                "Changing it keeps each time as it reads, in the new timezone: a 09:00 hand-off stays at 09:00.",
              )}
              submitButtonText="Save timezone"
              dataTestId="schedule-timezone-button"
              onChange={(timezone: string | undefined) => {
                saveScheduleTimezone(timezone).catch((err: Error) => {
                  setActionError(API.getFriendlyMessage(err));
                });
              }}
            />
            {scheduleTimezone ? (
              <span className="text-xs text-gray-500">
                {translator.translateText(
                  "Everything below is in this timezone.",
                )}
              </span>
            ) : (
              <span className="text-xs text-amber-600">
                {translator.translateText("No timezone set yet. Choose one.")}
              </span>
            )}
          </div>
        </Card>
      </div>
    );
  };

  // What went wrong adding a layer, saving the timezone or reading the layers again.
  const actionErrorAlert: GetReactElementFunction = (): ReactElement => {
    if (!actionError) {
      return <></>;
    }

    return (
      <div className="mb-5">
        <Alert
          type={AlertType.DANGER}
          title={actionError}
          dataTestId="schedule-layers-action-error"
          onClose={() => {
            setActionError("");
          }}
        />
      </div>
    );
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (savedLayers.length === 0) {
    /*
     * The first layer, asked for in the card the layers go in - under the
     * timezone card, as the layers are - rather than on the bare page 13rem
     * below it.
     */
    return (
      <div>
        {timezoneCard()}
        {actionErrorAlert()}
        <Card
          title={rotationLayersTitle}
          titleText="Rotation layers"
          rightElement={layersLearnMore}
        >
          <EmptyState
            footer={
              /*
               * Button keeps a dialog footer's left margin (md:ml-3), which
               * would push it off the centre here, so its wrapper clears it.
               */
              <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
                {addLayerButton()}
              </div>
            }
            id="no-layers"
            title={"Build your on-call rotation"}
            description={"Add a layer to say who is on call, and when."}
            icon={IconProp.SquareStack}
            paddingClassName="py-8"
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      {timezoneCard()}

      {/* Section header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {/*
           * Its definition right after the heading, not in it: the heading
           * stays named "Rotation layers" while it shows.
           */}
          <DefinitionsDrawnAfter>
            <h2 className="text-lg font-semibold leading-6 text-gray-900">
              {rotationLayersTitle}
            </h2>
          </DefinitionsDrawnAfter>
          {/* A div, not a p: the link's icon is drawn in a block of its own. */}
          <div className="mt-1.5 max-w-2xl text-sm text-gray-500">
            {translator.translateText(
              "The highest layer with someone on call is the one that pages. Put the main rotation on top, and fall-back cover below it.",
            )}{" "}
            {layersLearnMore}
          </div>
        </div>
        {/*
          Under the description on a phone, at the right edge, as a card
          header's actions always are; beside the title from sm up.
        */}
        <div className="flex-shrink-0 self-end sm:self-auto">
          {addLayerButton()}
        </div>
      </div>

      {actionErrorAlert()}

      {/*
       * Coverage gaps, stated at the point of EDITING rather than only in the
       * preview at the bottom of the page. Someone configuring a Mon-Fri layer
       * gets told immediately that nights and weekends are uncovered, instead of
       * having to scroll past every layer card to find out. Renders nothing when
       * the schedule is fully covered.
       */}
      {coverageBanner()}

      {/* Layer list: the layers the schedule keeps, and the ones to be deleted where they were. */}
      <div className="space-y-4">
        {draftLayerOrder.map((layerId: string) => {
          const layer: OnCallDutyPolicyScheduleLayer | undefined =
            layerById.get(layerId);

          if (!layer) {
            return null;
          }

          if (deletedLayerIds.has(layerId)) {
            // Saved once the page could not read the save back: deleted.
            if (!marksUnsavedChanges) {
              return null;
            }

            return (
              <DeletedLayerCard
                key={layerId}
                name={getLayerName(layerId)}
                disabled={isMutating}
                onUndo={() => {
                  undoDeleteLayer(layerId);
                }}
              />
            );
          }

          const index: number = keptLayerIds.indexOf(layerId);

          return (
            <LayerCard
              key={layerId}
              layer={layer}
              users={draftLayerUsers[layerId] || []}
              removedUsers={getRemovedLayerUsers({
                saved: savedLayerUsers[layerId] || [],
                draft: draftLayerUsers[layerId] || [],
              })}
              movedUserIds={getMovedLayerUserIds({
                saved: savedLayerUsers[layerId] || [],
                draft: draftLayerUsers[layerId] || [],
              })}
              hasUnsavedChanges={
                marksUnsavedChanges &&
                changedLayerIds.has(layerId.toLowerCase())
              }
              marksUnsavedChanges={marksUnsavedChanges}
              timezone={scheduleTimezone}
              overrides={overrideResolution.records}
              overridePolicyContextId={overrideResolution.policyContextId}
              overrideUserInfo={overrideResolution.userInfoById}
              index={index}
              total={keptLayerIds.length}
              isExpanded={expandedLayerIds.has(layerId)}
              actionsDisabled={isMutating}
              onToggleExpand={() => {
                toggleExpand(layerId);
              }}
              onMoveUp={() => {
                moveLayer(layerId, "up");
              }}
              onMoveDown={() => {
                moveLayer(layerId, "down");
              }}
              onDeleteLayer={() => {
                requestDeleteLayer(layerId);
              }}
              onLayerChange={applySavedLayer}
              onUsersChange={(
                users: Array<OnCallDutyPolicyScheduleLayerUser>,
              ) => {
                updateLayerUsers(layerId, users);
              }}
              onRestoreUser={(layerUser: OnCallDutyPolicyScheduleLayerUser) => {
                restoreLayerUser(layerId, layerUser);
              }}
              onSkipUser={(person: { userId: string; name: string }) => {
                if (skipLockedReason) {
                  return;
                }

                setPersonToSkip(person);
              }}
              skipLockedReason={skipLockedReason}
            />
          );
        })}
      </div>

      {/* Add layer affordance */}
      <button
        type="button"
        onClick={async () => {
          await addLayer();
        }}
        disabled={isMutating}
        className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white py-4 text-sm font-medium text-gray-500 transition-colors ${getHandDrawnButtonStateClassName(
          {
            isLocked: isMutating,
            isBusy: isAddButtonLoading,
            hoverClassName:
              "hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-600",
          },
        )}`}
      >
        <Icon
          icon={isAddButtonLoading ? IconProp.Spinner : IconProp.Add}
          className="h-4 w-4"
        />
        {translator.translateText("Add another layer")}
      </button>

      {/* Final schedule preview, of the layers as the page has them */}
      <div className="mt-8">
        <Card
          title={"Final schedule"}
          description={SCHEDULE_FINAL_SCHEDULE_DESCRIPTION}
          rightElement={
            hasUnsavedChanges ? (
              <span
                data-testid="final-schedule-unsaved"
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                />
                {translator.translateText("Includes unsaved changes")}
              </span>
            ) : undefined
          }
        >
          <LayersPreview
            layers={keptLayers}
            allLayerUsers={keptLayerUsers}
            timezone={scheduleTimezone}
            onCallDutyPolicyScheduleId={props.onCallDutyPolicyScheduleId}
            overridesRefreshKey={overrideRefreshKey}
          />
        </Card>
      </div>

      <LayersSaveBar
        hasUnsavedChanges={hasUnsavedChanges}
        status={saveStatus}
        changeLines={getLayersChangeLines({
          changes: changes,
          getLayerName: getLayerName,
          translator: translator,
        })}
        isReloading={isReloading}
        onSave={() => {
          saveChanges().catch((err: Error) => {
            setSaveStatus({
              kind: "error",
              message: API.getFriendlyMessage(err),
            });
          });
        }}
        onDiscard={() => {
          setShowDiscardConfirm(true);
        }}
        onReload={() => {
          reloadLayers().catch((err: Error) => {
            setActionError(API.getFriendlyMessage(err));
          });
        }}
      />

      {personToSkip && !skipLockedReason && (
        <SkipLayerUserModal
          userId={personToSkip.userId}
          name={personToSkip.name}
          nameById={scheduleUserNameById}
          policies={isSkipOnSomePolicies ? skipPolicies || [] : undefined}
          onClose={() => {
            setPersonToSkip(null);
          }}
          onSkipped={() => {
            setPersonToSkip(null);
            setOverrideRefreshKey((key: number) => {
              return key + 1;
            });
          }}
        />
      )}

      {showCannotDeleteOnlyLayerError && (
        <ConfirmModal
          title={`Cannot delete layer`}
          description={
            "A schedule must have at least one layer. Add another layer before deleting this one."
          }
          isLoading={false}
          submitButtonText={"Close"}
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setShowCannotDeleteOnlyLayerError(false);
          }}
        />
      )}

      {/*
       * Discard on the bar asks first, in the words Cancel on a dashboard
       * with unsaved changes asks in (DashboardToolbar).
       */}
      {showDiscardConfirm && (
        <ConfirmModal
          title={"Discard unsaved changes?"}
          description={
            "You have unsaved changes to this schedule's layers. If you discard them, the layers go back to how they were last saved."
          }
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText={"Discard Changes"}
          closeButtonText={"Keep Editing"}
          onSubmit={discardChanges}
          onClose={() => {
            setShowDiscardConfirm(false);
          }}
        />
      )}

      {/*
       * Leaving the page with unsaved changes asks first (LeaveGuard): Keep
       * Editing stays, Discard Changes goes where they were going. Last, so it
       * opens above any dialog that is open on the page.
       */}
      {leavePrompt.isAsking && (
        <ConfirmModal
          title={"Leave without saving?"}
          description={
            "You have unsaved changes to this schedule's layers. If you leave now, they will be lost."
          }
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText={"Discard Changes"}
          closeButtonText={"Keep Editing"}
          onSubmit={leavePrompt.leave}
          onClose={leavePrompt.stay}
        />
      )}
    </div>
  );
};

export default Layers;
