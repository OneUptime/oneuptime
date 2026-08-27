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
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
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
import {
  InitialSavedViewResolution,
  resolveInitialSavedView,
} from "../../Utils/InitialSavedView";

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
  /*
   * A saved view the URL named — set on the way back from the Insights tab,
   * which carries the view's id alongside the scope it produced. Applied in
   * preference to the project default, and in preference to the
   * hasInitialUrlState skip: a link that names a view is the user asking for
   * that view, not a deep link to protect.
   */
  initialSavedViewId?: string | null | undefined;
  /*
   * Fired whenever the selection changes, so the host can mirror it into the
   * URL. Without it the Insights tab can inherit the right scope but not the
   * name of the view it came from, and the trip back leaves the user on a
   * view's filters with nothing selected.
   */
  onSelectionChange?: ((savedViewId: string | null) => void) | undefined;
  // Read the explorer's current state for Save / Update.
  captureCurrentState: () => TelemetrySavedViewState;
  // Apply a saved view's state back into the explorer.
  applyState: (state: TelemetrySavedViewState) => void;
  // Surface non-critical errors to the host viewer (optional).
  onError?: ((error: string) => void) | undefined;
  /*
   * Extra query conditions merged into the saved-views fetch, so two
   * controls sharing one table can each list only their own views —
   * e.g. { viewType: new EqualToOrNull(TelemetrySavedViewType.List) }
   * for the list page (NULL rows predate the column and mean "list"),
   * or { viewType: TelemetrySavedViewType.Explorer } for the explorer.
   * When absent, every saved view of the project is listed, as before.
   */
  additionalQuery?: Query<T> | undefined;
  /*
   * Extra model fields stamped onto records this control creates or
   * updates (e.g. { viewType: TelemetrySavedViewType.Explorer }).
   * When absent, records are saved exactly as before.
   */
  additionalSaveFields?: Partial<T> | undefined;
  triggerClassName?: string | undefined;
  showTriggerIcon?: boolean | undefined;
  dropdownAlignment?: "left" | "right" | undefined;
}

function TelemetrySavedViewsControl<T extends TelemetrySavedViewModel>(
  props: ComponentProps<T>,
): ReactElement {
  const {
    modelType,
    captureCurrentState,
    applyState,
    hasInitialUrlState,
    initialSavedViewId,
  } = props;

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
  /*
   * Held in a ref for the same reason: hosts pass a fresh closure on every
   * render, and listing it in the effects below would re-fire them.
   */
  const onSelectionChangeRef: React.MutableRefObject<
    ((savedViewId: string | null) => void) | undefined
  > = useRef<((savedViewId: string | null) => void) | undefined>(
    props.onSelectionChange,
  );
  onSelectionChangeRef.current = props.onSelectionChange;

  /*
   * Latest additionalQuery/additionalSaveFields without re-creating the
   * callbacks below on every render — hosts typically pass fresh object
   * literals. Semantic changes to the query are detected through the
   * serialized key (query operator classes like EqualToOrNull implement
   * toJSON, so JSON.stringify canonicalizes them).
   */
  const additionalQueryRef: React.MutableRefObject<Query<T> | undefined> =
    useRef<Query<T> | undefined>(props.additionalQuery);
  additionalQueryRef.current = props.additionalQuery;
  const additionalQueryKey: string = JSON.stringify(
    props.additionalQuery || null,
  );

  const additionalSaveFieldsRef: React.MutableRefObject<
    Partial<T> | undefined
  > = useRef<Partial<T> | undefined>(props.additionalSaveFields);
  additionalSaveFieldsRef.current = props.additionalSaveFields;

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
          query: {
            ...(additionalQueryRef.current || {}),
            projectId: projectId,
          } as Query<T>,
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
      // additionalQueryKey stands in for additionalQueryRef's semantic value.
    }, [modelType, reportError, additionalQueryKey]);

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
   * Deselect the active view and put the explorer back where it starts. An
   * empty state is exactly what every host means by "no saved view": each
   * applyState implementation substitutes its own defaults for the fields it
   * finds missing, which is the same path a brand-new explorer takes.
   *
   * The initial-default guard is deliberately left set — re-applying the
   * project default view the moment the user cleared it is what they were
   * trying to get away from.
   */
  const clearSavedView: () => void = useCallback((): void => {
    setSelectedSavedViewId(null);
    applyState({});
  }, [applyState]);

  /*
   * Apply the initial view once, after the first fetch resolves (so savedViews
   * is populated). Precedence — a view the URL named, then the project
   * default when the URL carried no scope of its own — lives in
   * resolveInitialSavedView so it can be pinned in tests and so the Logs
   * explorer, which has its own saved-view UI, answers it the same way.
   */
  useEffect(() => {
    if (hasAppliedInitialDefault.current || !hasFetchedOnce) {
      return;
    }

    hasAppliedInitialDefault.current = true;

    const resolution: InitialSavedViewResolution<T> =
      resolveInitialSavedView<T>({
        savedViews,
        getId: (view: T): string => {
          return getViewId(view);
        },
        isDefault: (view: T): boolean => {
          return Boolean(view.isDefault);
        },
        urlSavedViewId: initialSavedViewId,
        hasUrlScope: hasInitialUrlState,
        /*
         * The host-owned case is already folded into hasInitialUrlState by
         * both explorers (they include a controlled window in it), so there
         * is nothing extra to report here.
         */
        hostOwnsView: false,
      });

    if (resolution.savedView) {
      applySavedView(resolution.savedView);
      return;
    }

    if (resolution.isUrlSavedViewMissing) {
      /*
       * The link named a view that is gone. Tell the host so the stale id
       * stops travelling in the URL, promising a view nothing can produce.
       */
      onSelectionChangeRef.current?.(null);
    }
  }, [
    hasFetchedOnce,
    savedViews,
    hasInitialUrlState,
    initialSavedViewId,
    applySavedView,
  ]);

  /*
   * Mirror the selection out to the host. An effect rather than a call inside
   * each setter, so every path that changes the selection — apply, clear,
   * delete, the not-found sweep below — is reported exactly once.
   *
   * The FIRST fire is skipped: it would report "nothing selected" before the
   * saved views have even been fetched, which would knock a view named by
   * the URL straight back out of the host's state (and out of the URL) in
   * the gap before the fetch resolves. The host seeded itself from that same
   * URL, so the initial value is never news to it. A view the link named
   * that turns out not to exist is reported explicitly, above.
   */
  const hasMirroredSelection: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (!hasMirroredSelection.current) {
      hasMirroredSelection.current = true;
      return;
    }

    onSelectionChangeRef.current?.(selectedSavedViewId);
  }, [selectedSavedViewId]);

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
            ...((additionalSaveFieldsRef.current || {}) as unknown as Record<
              string,
              unknown
            >),
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
            if (additionalSaveFieldsRef.current) {
              Object.assign(item, additionalSaveFieldsRef.current);
            }
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
        onClear={clearSavedView}
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
        triggerClassName={props.triggerClassName}
        showTriggerIcon={props.showTriggerIcon}
        dropdownAlignment={props.dropdownAlignment}
      />
    </>
  );
}

export default TelemetrySavedViewsControl;
