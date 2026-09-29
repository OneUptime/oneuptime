import { getCoverageWindowEnd } from "./CoverageWindow";
import LayerCard from "./LayerCard";
import { formatWindowSpan } from "./LayerSummary";
import LayersPreview from "./LayersPreview";
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
import Recurring from "Common/Types/Events/Recurring";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import ScheduleShiftUtil, {
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "Common/Types/OnCallDutyPolicy/ScheduleShiftUtil";
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
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
} from "react";

export interface ComponentProps {
  onCallDutyPolicyScheduleId: ObjectID;
  projectId: ObjectID;
}

const Layers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [layers, setLayers] = React.useState<
    Array<OnCallDutyPolicyScheduleLayer>
  >([]);

  const [layerUsers, setLayerUsers] = React.useState<
    Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>
  >({});

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

  const [error, setError] = React.useState<string>("");

  const [deletingLayerIds, setDeletingLayerIds] = React.useState<Set<string>>(
    new Set<string>(),
  );

  const [reorderingLayerId, setReorderingLayerId] = React.useState<
    string | null
  >(null);

  const [expandedLayerIds, setExpandedLayerIds] = React.useState<Set<string>>(
    new Set<string>(),
  );

  const [layerToDelete, setLayerToDelete] =
    React.useState<OnCallDutyPolicyScheduleLayer | null>(null);

  const [showCannotDeleteOnlyLayerError, setShowCannotDeleteOnlyLayerError] =
    React.useState<boolean>(false);

  const hasInitialized: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  useEffect(() => {
    fetchLayers().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  type FetchLayersFunction = (silent?: boolean) => Promise<void>;

  /*
   * `silent` refetches (after add / delete / reorder) keep the editor on screen
   * instead of replacing the whole page with a loading spinner. Per-action
   * spinners on the buttons communicate progress instead.
   */
  const fetchLayers: FetchLayersFunction = async (
    silent: boolean = false,
  ): Promise<void> => {
    if (!silent) {
      setIsLoading(true);
    }

    try {
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

      setScheduleTimezone(schedule?.timezone?.toString() || undefined);

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

      setLayers(layersResult.data);
      setLayerUsers(groupedUsers);

      /*
       * On the very first successful load, expand the top layer so the editor
       * is immediately visible without hiding the at-a-glance list of others.
       */
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        const firstLayerId: string | undefined =
          layersResult.data[0]?.id?.toString();
        if (firstLayerId) {
          setExpandedLayerIds(new Set<string>([firstLayerId]));
        }
      }
    } catch (err) {
      /*
       * Only the initial (non-silent) load promotes to the full-page error
       * state. A failed background refetch after a mutation must not tear down
       * the editor (and any unsaved form edits) — the mutation itself already
       * surfaced its own error, and the stale data self-heals on the next load.
       */
      if (!silent) {
        setError(API.getFriendlyMessage(err));
      }
    }

    if (!silent) {
      setIsLoading(false);
    }
  };

  const addLayer: PromiseVoidFunction = async (): Promise<void> => {
    setIsAddButtonLoading(true);
    setError("");

    try {
      /*
       * Base the new order on the current maximum order (not the array length)
       * so adding after a deletion appends at the end without colliding with an
       * existing order.
       */
      const maxOrder: number = layers.reduce(
        (max: number, layer: OnCallDutyPolicyScheduleLayer) => {
          return Math.max(max, layer.order || 0);
        },
        0,
      );
      const newOrder: number = maxOrder + 1;

      /*
       * Pick a "Layer N" name that is not already taken. maxOrder+1 alone is not
       * enough: after deleting a middle layer the server re-sequences orders but
       * leaves names untouched, so "Layer 3" can still exist while maxOrder is 2.
       */
      const existingNames: Set<string> = new Set<string>(
        layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
          return layer.name?.toString() || "";
        }),
      );
      let nameIndex: number = newOrder;
      while (existingNames.has(`Layer ${nameIndex}`)) {
        nameIndex++;
      }

      const newLayer: OnCallDutyPolicyScheduleLayer =
        new OnCallDutyPolicyScheduleLayer();
      newLayer.onCallDutyPolicyScheduleId = props.onCallDutyPolicyScheduleId;
      newLayer.projectId = props.projectId;
      newLayer.name = `Layer ${nameIndex}`;
      newLayer.order = newOrder;
      newLayer.startsAt = OneUptimeDate.getCurrentDate();
      newLayer.handOffTime = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        1,
      );
      newLayer.rotation = Recurring.getDefault();
      newLayer.restrictionTimes = RestrictionTimes.getDefault();

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

      /*
       * Refetch so client order matches the server's re-sequenced values, then
       * expand the freshly added layer so the user can configure it right away.
       */
      await fetchLayers(true);

      if (createdLayer.id) {
        setExpandedLayerIds((prev: Set<string>) => {
          const next: Set<string> = new Set<string>(prev);
          next.add(createdLayer.id!.toString());
          return next;
        });
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsAddButtonLoading(false);
  };

  const requestDeleteLayer: (layer: OnCallDutyPolicyScheduleLayer) => void = (
    layer: OnCallDutyPolicyScheduleLayer,
  ): void => {
    if (layers.length === 1) {
      setShowCannotDeleteOnlyLayerError(true);
      return;
    }
    setLayerToDelete(layer);
  };

  const confirmDeleteLayer: PromiseVoidFunction = async (): Promise<void> => {
    const layer: OnCallDutyPolicyScheduleLayer | null = layerToDelete;
    if (!layer || !layer.id) {
      throw new BadDataException("layer.id cannot be null");
    }

    const layerId: string = layer.id.toString();
    setLayerToDelete(null);
    setDeletingLayerIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      next.add(layerId);
      return next;
    });

    try {
      await ModelAPI.deleteItem<OnCallDutyPolicyScheduleLayer>({
        modelType: OnCallDutyPolicyScheduleLayer,
        id: layer.id,
      });

      // Refetch: the server re-sequences the remaining layers' order on delete.
      await fetchLayers(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setDeletingLayerIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      next.delete(layerId);
      return next;
    });
  };

  type MoveLayerFunction = (index: number, direction: "up" | "down") => void;

  const moveLayer: MoveLayerFunction = async (
    index: number,
    direction: "up" | "down",
  ): Promise<void> => {
    const targetIndex: number = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= layers.length) {
      return;
    }

    const currentLayer: OnCallDutyPolicyScheduleLayer | undefined =
      layers[index];

    if (!currentLayer?.id) {
      return;
    }

    setReorderingLayerId(currentLayer.id.toString());
    setError("");

    /*
     * Reorder the array locally, then re-number every layer to a contiguous
     * 1..N sequence based on its new position and persist only the ones whose
     * order actually changed.
     *
     * This is deliberately NOT a two-value swap. A swap of two orders is not
     * atomic across two requests: if the second write fails the two layers are
     * left sharing one order value, and because the server never re-sequences
     * on update, a subsequent swap would read equal orders and write the same
     * value to both (a no-op) — permanently freezing the tie. Re-numbering by
     * position always yields distinct, contiguous orders, so a partial failure
     * self-heals on the next reorder instead of getting stuck. The order column
     * has no unique constraint, so transient duplicates mid-sequence are fine.
     */
    const reordered: Array<OnCallDutyPolicyScheduleLayer> = [...layers];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved!);

    try {
      for (let i: number = 0; i < reordered.length; i++) {
        const layer: OnCallDutyPolicyScheduleLayer = reordered[i]!;
        const desiredOrder: number = i + 1;
        if (layer.id && layer.order !== desiredOrder) {
          await ModelAPI.updateById({
            modelType: OnCallDutyPolicyScheduleLayer,
            id: layer.id,
            data: { order: desiredOrder },
          });
        }
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    /*
     * Always resync from the server — even if one of the writes failed, this
     * pulls the authoritative order so the UI never shows a stale sequence.
     */
    await fetchLayers(true);
    setReorderingLayerId(null);
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
    setLayers((prev: Array<OnCallDutyPolicyScheduleLayer>) => {
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

  const updateLayerUsers: (
    layerId: string,
    users: Array<OnCallDutyPolicyScheduleLayerUser>,
  ) => void = (
    layerId: string,
    users: Array<OnCallDutyPolicyScheduleLayerUser>,
  ): void => {
    setLayerUsers(
      (prev: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>) => {
        return {
          ...prev,
          [layerId]: [...users],
        };
      },
    );
  };

  /*
   * A single in-flight flag that serializes every mutation. Add / delete /
   * reorder each re-sequence the server-side `order`; letting two run at once
   * (e.g. deleting one layer while another is mid-reorder) would interleave
   * those re-sequences and corrupt the order values. While any mutation is in
   * flight, all add / delete / reorder controls are disabled.
   */
  const isMutating: boolean =
    isAddButtonLoading ||
    reorderingLayerId !== null ||
    deletingLayerIds.size > 0;

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
   * The schedule's coverage over the shared window, computed with exactly the
   * same LayerUtil + ScheduleShiftUtil pipeline the preview at the bottom of the
   * page uses, so the two can never disagree.
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

    const layerProps: Array<LayerProps> = layers.map(
      (layer: OnCallDutyPolicyScheduleLayer): LayerProps => {
        const layerId: string = layer.id?.toString() || "";
        return {
          users: (layerUsers[layerId] || [])
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
        layerCount: layers.length,
        assignedUserCount,
        shifts: ScheduleShiftUtil.groupEventsIntoShifts(
          new LayerUtil().getMultiLayerEvents({
            calendarStartDate: now,
            calendarEndDate: windowEnd,
            layers: layerProps,
          }),
        ),
        now,
        windowEnd,
      }),
      windowLabel: formatWindowSpan(now, windowEnd),
    };
  }, [layers, layerUsers, scheduleTimezone]);

  /*
   * Every user on any layer of this schedule. Overrides for anyone else cannot
   * affect what this page shows.
   */
  const scheduleUserIds: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set<string>();
    for (const layerId in layerUsers) {
      for (const layerUser of layerUsers[layerId] || []) {
        const userId: string = layerUser.user?.id?.toString() || "";
        if (userId) {
          ids.add(userId);
        }
      }
    }
    return ids;
  }, [layerUsers]);

  /*
   * The window the layer cards actually reason over: a little history so an
   * in-progress turn keeps its true start, and the shared forward coverage
   * window so an upcoming substitution reaches the shift table. Anchored once
   * per layer/user change rather than to a ticking clock, so the override list
   * is not refetched on every re-render.
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
     * re-anchor signal: the window should move when the schedule's layers or
     * users change (the cards are recomputed anyway), and NOT on every render,
     * which is what keying it to the clock would do.
     */
  }, [layers, layerUsers]);

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
    });

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
          {coverage.gaps.length === 1
            ? "1 coverage gap"
            : `${coverage.gaps.length} coverage gaps`}{" "}
          in the next {windowLabel}.
        </span>{" "}
        Someone is on call for {percent >= 100 ? 99 : percent}% of that window.
        During the rest, alerts routed to this schedule will notify no one. See
        the final schedule below for exactly when.
      </span>
    );

    if (coverage.status === ScheduleCoverageStatus.NoUsers) {
      message = (
        <span>
          <span className="font-semibold">
            No users are assigned to any layer.
          </span>{" "}
          Nobody is ever on call in this schedule, so every alert routed here
          will go unanswered. Expand a layer below and add at least one user.
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
    setError("");

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
      setError(API.getFriendlyMessage(err));
    }

    setIsSavingTimezone(false);
  };

  const timezoneCard: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="mb-5">
        <Card
          title="Schedule timezone"
          description={
            "Every layer in this schedule — rotation start, hand-off and active-hour restrictions — is entered and enforced in this timezone."
          }
        >
          <div className="flex items-center gap-3">
            <TimezoneSelectButton
              value={scheduleTimezone}
              saving={isSavingTimezone}
              icon={IconProp.Globe}
              placeholder="Not set — using server local time"
              modalTitle="Set schedule timezone"
              modalDescription="All rotation start, hand-off and active-hour times in this schedule are interpreted in this timezone. Changing it re-interprets the existing times in the new zone."
              submitButtonText="Save timezone"
              dataTestId="schedule-timezone-button"
              onChange={(timezone: string | undefined) => {
                saveScheduleTimezone(timezone).catch((err: Error) => {
                  setError(API.getFriendlyMessage(err));
                });
              }}
            />
            {scheduleTimezone ? (
              <span className="text-xs text-gray-500">
                Click to change. Everything below is in this zone.
              </span>
            ) : (
              <span className="text-xs text-amber-600">
                No timezone set yet — click to choose one.
              </span>
            )}
          </div>
        </Card>
      </div>
    );
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (layers.length === 0) {
    return (
      <div>
        {timezoneCard()}
        <EmptyState
          footer={addLayerButton()}
          showSolidBackground={false}
          id="no-layers"
          title={"Build your on-call rotation"}
          description={
            "Add a layer to define who is on call and when. Stack multiple layers to build coverage — higher layers take priority."
          }
          icon={IconProp.SquareStack}
        />
      </div>
    );
  }

  return (
    <div>
      {timezoneCard()}

      {/* Section header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold leading-6 text-gray-900">
            Rotation layers
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Layers are evaluated from the top down. The highest-priority layer
            with someone on call is used, so put your primary rotation on top
            and fall-back coverage below.
          </p>
        </div>
        <div className="flex-shrink-0">{addLayerButton()}</div>
      </div>

      {/*
       * Coverage gaps, stated at the point of EDITING rather than only in the
       * preview at the bottom of the page. Someone configuring a Mon-Fri layer
       * gets told immediately that nights and weekends are uncovered, instead of
       * having to scroll past every layer card to find out. Renders nothing when
       * the schedule is fully covered.
       */}
      {coverageBanner()}

      {/* Layer list */}
      <div className="space-y-4">
        {layers.map((layer: OnCallDutyPolicyScheduleLayer, i: number) => {
          const layerId: string = layer.id?.toString() || `index-${i}`;
          return (
            <LayerCard
              key={layerId}
              layer={layer}
              users={layerUsers[layerId] || []}
              timezone={scheduleTimezone}
              overrides={overrideResolution.records}
              overridePolicyContextId={overrideResolution.policyContextId}
              overrideUserInfo={overrideResolution.userInfoById}
              index={i}
              total={layers.length}
              isExpanded={expandedLayerIds.has(layerId)}
              actionsDisabled={isMutating}
              isDeleteButtonLoading={deletingLayerIds.has(layerId)}
              onToggleExpand={() => {
                toggleExpand(layerId);
              }}
              onMoveUp={() => {
                moveLayer(i, "up");
              }}
              onMoveDown={() => {
                moveLayer(i, "down");
              }}
              onDeleteLayer={() => {
                requestDeleteLayer(layer);
              }}
              onLayerChange={applySavedLayer}
              onUsersChange={(
                users: Array<OnCallDutyPolicyScheduleLayerUser>,
              ) => {
                updateLayerUsers(layerId, users);
              }}
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
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white py-4 text-sm font-medium text-gray-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon
          icon={isAddButtonLoading ? IconProp.Spinner : IconProp.Add}
          className="h-4 w-4"
        />
        Add another layer
      </button>

      {/* Final schedule preview */}
      <div className="mt-8">
        <Card
          title={"Final schedule"}
          description={
            "A combined preview of who is on call and when, after all layers and priorities are applied. " +
            (scheduleTimezone
              ? "Restriction windows are resolved in this schedule's timezone — " +
                scheduleTimezone +
                "."
              : "Shown in your local timezone — " +
                OneUptimeDate.getCurrentTimezoneString() +
                ".")
          }
        >
          <LayersPreview
            layers={layers}
            allLayerUsers={layerUsers}
            timezone={scheduleTimezone}
            onCallDutyPolicyScheduleId={props.onCallDutyPolicyScheduleId}
          />
        </Card>
      </div>

      {layerToDelete && (
        <ConfirmModal
          title={`Delete ${layerToDelete.name?.toString() || "layer"}?`}
          description={
            "This permanently removes the layer, its users and its rotation from this schedule. This action cannot be undone."
          }
          isLoading={false}
          submitButtonText={"Delete Layer"}
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText={"Cancel"}
          onClose={() => {
            setLayerToDelete(null);
          }}
          onSubmit={async () => {
            await confirmDeleteLayer();
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
    </div>
  );
};

export default Layers;
