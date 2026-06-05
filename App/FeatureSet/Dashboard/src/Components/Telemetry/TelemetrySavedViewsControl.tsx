import React, {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SavedViewsDropdown from "Common/UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { SavedViewOption } from "Common/UI/Components/TelemetryViewer/types";
import TelemetrySavedViewState, {
  TelemetrySavedViewTimeRange,
} from "Common/Types/Telemetry/TelemetrySavedViewState";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import Query from "Common/Types/BaseDatabase/Query";
import Sort from "Common/Types/BaseDatabase/Sort";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";

const SAVED_VIEWS_LIMIT: number = 100;

/*
 * Structural shape that both MetricSavedView and TraceSavedView satisfy. The
 * control is generic over the concrete model so a single implementation drives
 * both the Metrics and Traces explorers.
 */
export type TelemetrySavedViewModel = BaseModel & {
  projectId?: ObjectID | undefined;
  name?: string | undefined;
  isDefault?: boolean | undefined;
  query?: TelemetrySavedViewState | undefined;
};

/*
 * Serialize a time range into a JSON-friendly shape (ISO strings for custom
 * ranges). Shared by both viewers' captureCurrentState.
 */
export function serializeTimeRange(
  timeRange: RangeStartAndEndDateTime,
): TelemetrySavedViewTimeRange {
  const serialized: TelemetrySavedViewTimeRange = { range: timeRange.range };
  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    serialized.startValue = timeRange.startAndEndDate.startValue.toISOString();
    serialized.endValue = timeRange.startAndEndDate.endValue.toISOString();
  }
  return serialized;
}

/*
 * Rebuild a RangeStartAndEndDateTime from saved state. Defensive: unknown or
 * malformed ranges fall back to the default (past one hour). Shared by both
 * viewers' applyState.
 */
export function deserializeTimeRange(
  saved: TelemetrySavedViewTimeRange | undefined,
): RangeStartAndEndDateTime {
  if (!saved || !saved.range) {
    return { range: TimeRange.PAST_ONE_HOUR };
  }

  const knownRanges: Array<string> = Object.values(TimeRange);
  if (!knownRanges.includes(saved.range)) {
    return { range: TimeRange.PAST_ONE_HOUR };
  }

  const range: TimeRange = saved.range as TimeRange;

  if (range === TimeRange.CUSTOM && saved.startValue && saved.endValue) {
    const start: Date = new Date(saved.startValue);
    const end: Date = new Date(saved.endValue);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return {
        range: range,
        startAndEndDate: new InBetween<Date>(start, end),
      };
    }
    return { range: TimeRange.PAST_ONE_HOUR };
  }

  return { range: range };
}

export interface ComponentProps<T extends TelemetrySavedViewModel> {
  // Concrete saved-view model class (MetricSavedView | TraceSavedView).
  modelType: { new (): T };
  // Noun used in modal titles, e.g. "Trace" -> "Save Trace View".
  savedViewNoun: string;
  // Lowercase explorer label used in descriptions, e.g. "traces".
  explorerLabel: string;
  /*
   * True when the explorer already restored filter state from the URL (e.g. a
   * deep link from the detail page "filter by" action). When true, the default
   * saved view is NOT auto-applied so the deep link is not clobbered.
   */
  hasInitialUrlState: boolean;
  // Read the explorer's current state for Save / Update.
  captureCurrentState: () => TelemetrySavedViewState;
  // Apply a saved view's state back into the explorer.
  applyState: (state: TelemetrySavedViewState) => void;
  // Surface non-critical errors to the host viewer (optional).
  onError?: ((error: string) => void) | undefined;
}

function TelemetrySavedViewsControl<T extends TelemetrySavedViewModel>(
  props: ComponentProps<T>,
): ReactElement {
  const { modelType, captureCurrentState, applyState, hasInitialUrlState } =
    props;

  const [savedViews, setSavedViews] = useState<Array<T>>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(
    null,
  );
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [viewToEdit, setViewToEdit] = useState<T | undefined>(undefined);
  const [viewToDelete, setViewToDelete] = useState<T | undefined>(undefined);

  // Ensures the default view is applied at most once, after the first fetch.
  const hasAppliedInitialDefault: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  // Latest onError without forcing fetchSavedViews to re-create.
  const onErrorRef: React.MutableRefObject<
    ((error: string) => void) | undefined
  > = useRef<((error: string) => void) | undefined>(props.onError);
  onErrorRef.current = props.onError;

  const reportError: (error: string) => void = useCallback(
    (error: string): void => {
      if (onErrorRef.current) {
        onErrorRef.current(error);
      }
    },
    [],
  );

  const getViewId: (view: T) => string = (view: T): string => {
    return view.id?.toString() || "";
  };

  const fetchSavedViews: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        setSavedViews([]);
        setHasFetchedOnce(true);
        return;
      }

      setIsLoading(true);

      try {
        const result: ModelListResult<T> = await ModelAPI.getList<T>({
          modelType: modelType,
          query: { projectId: projectId } as Query<T>,
          limit: SAVED_VIEWS_LIMIT,
          skip: 0,
          select: {
            name: true,
            query: true,
            isDefault: true,
          } as Select<T>,
          sort: { name: SortOrder.Ascending } as Sort<T>,
        });

        setSavedViews(result.data);
      } catch (err) {
        reportError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
        setHasFetchedOnce(true);
      }
    }, [modelType, reportError]);

  useEffect(() => {
    void fetchSavedViews();
  }, [fetchSavedViews]);

  const applySavedView: (view: T) => void = useCallback(
    (view: T): void => {
      applyState((view.query as TelemetrySavedViewState) || {});
      setSelectedSavedViewId(getViewId(view) || null);
    },
    [applyState],
  );

  /*
   * Apply the default view once, after the first fetch resolves (so savedViews
   * is populated). Skipped when the URL already carried filter state.
   */
  useEffect(() => {
    if (hasAppliedInitialDefault.current || !hasFetchedOnce) {
      return;
    }

    hasAppliedInitialDefault.current = true;

    if (hasInitialUrlState) {
      return;
    }

    const defaultView: T | undefined = savedViews.find((view: T): boolean => {
      return Boolean(view.isDefault);
    });

    if (defaultView) {
      applySavedView(defaultView);
    }
  }, [hasFetchedOnce, savedViews, hasInitialUrlState, applySavedView]);

  // Clear the selection if the selected view no longer exists (e.g. deleted).
  useEffect(() => {
    if (!selectedSavedViewId) {
      return;
    }

    const exists: boolean = savedViews.some((view: T): boolean => {
      return getViewId(view) === selectedSavedViewId;
    });

    if (!exists) {
      setSelectedSavedViewId(null);
    }
  }, [savedViews, selectedSavedViewId]);

  const savedViewOptions: Array<SavedViewOption> = useMemo(() => {
    return [...savedViews]
      .sort((left: T, right: T): number => {
        if (Boolean(left.isDefault) !== Boolean(right.isDefault)) {
          return left.isDefault ? -1 : 1;
        }
        return (left.name || "").localeCompare(right.name || "");
      })
      .map((view: T): SavedViewOption => {
        return {
          id: getViewId(view),
          name: view.name || "Untitled View",
          isDefault: Boolean(view.isDefault),
        };
      });
  }, [savedViews]);

  const findById: (viewId: string) => T | undefined = useCallback(
    (viewId: string): T | undefined => {
      return savedViews.find((view: T): boolean => {
        return getViewId(view) === viewId;
      });
    },
    [savedViews],
  );

  const selectedView: T | undefined = useMemo(() => {
    return selectedSavedViewId ? findById(selectedSavedViewId) : undefined;
  }, [selectedSavedViewId, findById]);

  const handleUpdateCurrent: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!selectedView?.id) {
        return;
      }

      setIsLoading(true);

      try {
        await ModelAPI.updateById<T>({
          modelType: modelType,
          id: selectedView.id,
          data: JSONFunctions.serialize({
            query: captureCurrentState(),
          } as unknown as JSONObject),
        });

        await fetchSavedViews();
      } catch (err) {
        reportError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, [
      selectedView,
      modelType,
      captureCurrentState,
      fetchSavedViews,
      reportError,
    ]);

  const formFields: Fields<T> = [
    {
      field: {
        name: true,
      },
      fieldType: FormFieldSchemaType.Text,
      title: "Name",
      description: `Choose a name for this saved ${props.explorerLabel} view.`,
      placeholder: "Errors in checkout",
      required: true,
    },
    {
      field: {
        isDefault: true,
      },
      fieldType: FormFieldSchemaType.Checkbox,
      title: "Set as default",
      description: `Automatically apply this view when opening ${props.explorerLabel}.`,
      required: false,
    },
  ] as Fields<T>;

  return (
    <>
      {showCreateModal && (
        <ModelFormModal<T>
          modelType={modelType}
          name={`Save ${props.savedViewNoun} View`}
          title={`Save ${props.savedViewNoun} View`}
          description={`Save the current ${props.explorerLabel} explorer state as a reusable view.`}
          onClose={() => {
            setShowCreateModal(false);
          }}
          submitButtonText="Save View"
          onBeforeCreate={async (item: T) => {
            item.query = captureCurrentState();
            return item;
          }}
          onSuccess={async (item: T) => {
            setShowCreateModal(false);
            await fetchSavedViews();
            applySavedView(item);
          }}
          formProps={{
            name: `Save ${props.savedViewNoun} View`,
            modelType: modelType,
            id: `save-${props.explorerLabel}-view`,
            fields: formFields,
            formType: FormType.Create,
          }}
        />
      )}

      {viewToEdit && (
        <ModelFormModal<T>
          modelType={modelType}
          modelIdToEdit={viewToEdit.id!}
          name={`Edit ${props.savedViewNoun} View`}
          title={`Edit ${props.savedViewNoun} View`}
          description="Rename this saved view or change whether it loads by default."
          onClose={() => {
            setViewToEdit(undefined);
          }}
          submitButtonText="Save Changes"
          onSuccess={async () => {
            setViewToEdit(undefined);
            await fetchSavedViews();
          }}
          formProps={{
            name: `Edit ${props.savedViewNoun} View`,
            modelType: modelType,
            id: `edit-${props.explorerLabel}-view`,
            fields: formFields,
            formType: FormType.Update,
          }}
        />
      )}

      {viewToDelete && (
        <ConfirmModal
          title={`Delete ${viewToDelete.name || "saved view"}`}
          description={`Are you sure you want to delete ${
            viewToDelete.name || "this saved view"
          }?`}
          isLoading={isLoading}
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={async () => {
            if (!viewToDelete.id) {
              setViewToDelete(undefined);
              return;
            }

            setIsLoading(true);

            try {
              await ModelAPI.deleteItem<T>({
                modelType: modelType,
                id: viewToDelete.id,
              });

              if (viewToDelete.id.toString() === selectedSavedViewId) {
                setSelectedSavedViewId(null);
              }

              await fetchSavedViews();
              setViewToDelete(undefined);
            } catch (err) {
              reportError(API.getFriendlyMessage(err));
            } finally {
              setIsLoading(false);
            }
          }}
          onClose={() => {
            setViewToDelete(undefined);
          }}
        />
      )}

      <SavedViewsDropdown
        savedViews={savedViewOptions}
        selectedSavedViewId={selectedSavedViewId}
        onSelect={(viewId: string) => {
          const view: T | undefined = findById(viewId);
          if (view) {
            applySavedView(view);
          }
        }}
        onCreate={() => {
          setShowCreateModal(true);
        }}
        onEdit={(viewId: string) => {
          setViewToEdit(findById(viewId));
        }}
        onDelete={(viewId: string) => {
          setViewToDelete(findById(viewId));
        }}
        onUpdateCurrent={selectedView ? handleUpdateCurrent : undefined}
      />
    </>
  );
}

export default TelemetrySavedViewsControl;
