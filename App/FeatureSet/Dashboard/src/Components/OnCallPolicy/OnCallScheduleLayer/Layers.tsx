import LayerCard from "./LayerCard";
import LayersPreview from "./LayersPreview";
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
import React, { FunctionComponent, ReactElement, useEffect } from "react";

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
