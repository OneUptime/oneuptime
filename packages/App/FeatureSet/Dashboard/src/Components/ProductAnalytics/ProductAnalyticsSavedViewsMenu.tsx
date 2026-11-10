import RumProductAnalyticsSavedView from "Common/Models/DatabaseModels/RumProductAnalyticsSavedView";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH,
  ProductAnalyticsSavedViewDefinitions,
  ProductAnalyticsSavedViewType,
  isSameProductAnalyticsDefinition,
} from "Common/Types/Rum/ProductAnalyticsSavedViews";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DeleteConfirmationMessage from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import SavedViewsDropdown from "Common/UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { SavedViewOption } from "Common/UI/Components/TelemetryViewer/types";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import usePermissionSnapshot from "Common/UI/Utils/UsePermissionSnapshot";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  PRODUCT_ANALYTICS_SAVED_VIEW_WORDS,
  ProductAnalyticsSavedView,
  ProductAnalyticsSavedViewAddress,
  ProductAnalyticsSavedViewWords,
  SAVED_VIEW_CHANGED_TEMPLATE,
  SAVED_VIEW_DELETE_WIDGETS_NOTE,
  SAVED_VIEW_NAME_DESCRIPTION,
  SAVED_VIEW_NAME_PLACEHOLDER,
  SAVED_VIEW_UNREADABLE,
  SAVED_VIEW_UNREADABLE_NOTICE,
  deleteProductAnalyticsSavedView,
  listProductAnalyticsSavedViews,
  readProductAnalyticsSavedViewAddress,
  updateProductAnalyticsSavedViewDefinition,
} from "./ProductAnalyticsSavedViews";

/*
 * Saved funnels or saved retention tables (issue #6630), on the Funnels and
 * User Retention pages' toolbar where the explorers keep their saved views
 * (the same dropdown): the application's saved ones by name, each opening
 * what it keeps; "+ Save funnel" under them, which keeps what is on screen
 * under a name; and on each one Edit (its name), Delete and - on the open
 * one, once what is on screen is no longer what it keeps - Update. The
 * open one is named in the trigger, "(changed)" once it differs.
 *
 * The list is read as the page opens and again as the dropdown opens, so
 * one saved in another tab is in it. A role that may not read saved views
 * has none to list: the toolbar leaves the dropdown out.
 *
 * The page keeps the open one in its address (`?view=<id>`). A link that
 * names one and says nothing else - a dashboard widget's - opens what it
 * keeps once the list is read, and the page reads nothing until then
 * (onSettled), so it does not first read and show its default. A link
 * that says what to read itself keeps saying it, the saved view it names
 * shown as changed when the two differ. One that names a saved view this
 * person cannot open says so over the page (onNotice), and the page shows
 * its default.
 */

export interface ComponentProps<T extends ProductAnalyticsSavedViewType> {
  rumApplicationId: ObjectID;
  viewType: T;
  // What is on screen, as a definition: null while there is nothing to save.
  definition: ProductAnalyticsSavedViewDefinitions[T] | null;
  // The saved view open now: the address's.
  savedViewId: string | null;
  /*
   * Whether the address the page opened on said what to read itself: then
   * the saved view it names is not put over it.
   */
  isDefinitionInAddress: boolean;
  // Show a saved view: what it keeps, and it as the open one.
  onOpen: (view: ProductAnalyticsSavedView<T>) => void;
  // The open one, without changing what is on screen (null: none).
  onSelect: (savedViewId: string | null) => void;
  // A sentence for the page to say over what it shows; null takes it away.
  onNotice: (notice: string | null) => void;
  /*
   * Called once the saved view the address named is open or let go (as
   * soon as the list is read when it names none): the page reads from then.
   */
  onSettled: () => void;
  /*
   * Whether the page has had its onSettled: a menu drawn again (a toolbar
   * that moves) lists, and leaves what the page shows as it is.
   */
  isSettled: boolean;
  dataTestId: string;
}

enum ListState {
  Loading = "Loading",
  Loaded = "Loaded",
  NotLoaded = "NotLoaded",
}

/*
 * The dropdown's rows: each saved view by its name; the open one marked
 * changed when what is on screen differs from what it keeps; one whose
 * definition this version cannot read, said so under its name.
 */
export function toProductAnalyticsSavedViewOptions<
  T extends ProductAnalyticsSavedViewType,
>(data: {
  views: Array<ProductAnalyticsSavedView<T>>;
  savedViewId: string | null;
  definition: ProductAnalyticsSavedViewDefinitions[T] | null;
  translator: Translator;
}): Array<SavedViewOption> {
  return data.views.map(
    (view: ProductAnalyticsSavedView<T>): SavedViewOption => {
      const isChanged: boolean =
        view.id === data.savedViewId &&
        data.definition !== null &&
        view.definition !== null &&
        !isSameProductAnalyticsDefinition(view.definition, data.definition);

      return {
        id: view.id,
        name: isChanged
          ? data.translator.translateTemplate(SAVED_VIEW_CHANGED_TEMPLATE, {
              name: view.name,
            })
          : view.name,
        detail: view.definition
          ? undefined
          : data.translator.translateText(SAVED_VIEW_UNREADABLE) ||
            SAVED_VIEW_UNREADABLE,
      };
    },
  );
}

/*
 * What becomes of the saved view the address named, once the list is read
 * (null: it could not be): opened, kept as named over the address's own
 * definition, or let go with a sentence saying why.
 */
export type ProductAnalyticsAddressViewOutcome<
  T extends ProductAnalyticsSavedViewType,
> =
  | { kind: "none" }
  | { kind: "open"; view: ProductAnalyticsSavedView<T> }
  | { kind: "keep" }
  | { kind: "drop"; notice: string };

export function settleProductAnalyticsAddressView<
  T extends ProductAnalyticsSavedViewType,
>(data: {
  savedViewId: string | null;
  isDefinitionInAddress: boolean;
  views: Array<ProductAnalyticsSavedView<T>> | null;
  words: ProductAnalyticsSavedViewWords;
}): ProductAnalyticsAddressViewOutcome<T> {
  if (!data.savedViewId) {
    return { kind: "none" };
  }

  if (data.views === null) {
    return { kind: "drop", notice: data.words.notLoaded };
  }

  const named: ProductAnalyticsSavedView<T> | undefined = data.views.find(
    (view: ProductAnalyticsSavedView<T>): boolean => {
      return view.id === data.savedViewId;
    },
  );

  if (!named || !named.definition) {
    return { kind: "drop", notice: data.words.missing };
  }

  return data.isDefinitionInAddress
    ? { kind: "keep" }
    : { kind: "open", view: named };
}

/*
 * What a Funnels or User Retention page keeps of its saved views: what its
 * address said as it opened, the open one (kept in the address), whether
 * the one the address named is still being opened - the page reads
 * nothing until it is - and a sentence to say over the page.
 */
export interface ProductAnalyticsSavedViewState {
  address: ProductAnalyticsSavedViewAddress;
  savedViewId: string | null;
  setSavedViewId: (savedViewId: string | null) => void;
  isOpening: boolean;
  isSettled: boolean;
  settle: () => void;
  notice: string | null;
  setNotice: (notice: string | null) => void;
}

export function useProductAnalyticsSavedViewState(
  viewType: ProductAnalyticsSavedViewType,
): ProductAnalyticsSavedViewState {
  const [address] = useState<ProductAnalyticsSavedViewAddress>(
    (): ProductAnalyticsSavedViewAddress => {
      return readProductAnalyticsSavedViewAddress(
        window.location.search,
        viewType,
      );
    },
  );
  const [savedViewId, setSavedViewId] = useState<string | null>(
    address.savedViewId,
  );
  const [isSettled, setIsSettled] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const settle: () => void = useCallback((): void => {
    setIsSettled(true);
  }, []);

  return {
    address: address,
    savedViewId: savedViewId,
    setSavedViewId: setSavedViewId,
    isOpening: address.isOpening && !isSettled,
    isSettled: isSettled,
    settle: settle,
    notice: notice,
    setNotice: setNotice,
  };
}

/* The page's sentence about its saved views, over what it shows: until closed. */
export function ProductAnalyticsSavedViewNotice(props: {
  notice: string | null;
  onClose: () => void;
}): ReactElement {
  if (!props.notice) {
    return <></>;
  }

  return (
    <div className="mb-5">
      <Alert
        type={AlertType.WARNING}
        title={props.notice}
        onClose={props.onClose}
        dataTestId="product-analytics-saved-view-notice"
      />
    </div>
  );
}

/*
 * A gate with no reason has not read the permission snapshot yet: its
 * action is left out until it has, rather than offered and refused.
 */
function isOffered(gate: PermissionGateResult): boolean {
  return gate.isAllowed || Boolean(gate.disabledReason);
}

function ProductAnalyticsSavedViewsMenu<
  T extends ProductAnalyticsSavedViewType,
>(props: ComponentProps<T>): ReactElement {
  const translator: Translator = useTranslator();
  // The gates below read the permission snapshot: drawn again as it lands.
  usePermissionSnapshot();
  const words: ProductAnalyticsSavedViewWords =
    PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[props.viewType];
  const [views, setViews] = useState<Array<ProductAnalyticsSavedView<T>>>([]);
  const [listState, setListState] = useState<ListState>(ListState.Loading);
  const [toSave, setToSave] = useState<
    ProductAnalyticsSavedViewDefinitions[T] | null
  >(null);
  const [toRename, setToRename] = useState<ProductAnalyticsSavedView<T> | null>(
    null,
  );
  const [toDelete, setToDelete] = useState<ProductAnalyticsSavedView<T> | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | undefined>(
    undefined,
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const model: RumProductAnalyticsSavedView =
    new RumProductAnalyticsSavedView();
  const readGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Read,
  );
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Delete,
  );

  /*
   * Held, so the first read settles the address with the page's latest
   * callbacks rather than the ones it drew with first.
   */
  const propsRef: React.MutableRefObject<ComponentProps<T>> =
    useRef<ComponentProps<T>>(props);
  propsRef.current = props;

  const rumApplicationId: string = props.rumApplicationId.toString();
  const viewType: T = props.viewType;

  const loadViews: () => Promise<Array<ProductAnalyticsSavedView<T>> | null> =
    useCallback(async (): Promise<Array<
      ProductAnalyticsSavedView<T>
    > | null> => {
      try {
        const listed: Array<ProductAnalyticsSavedView<T>> =
          await listProductAnalyticsSavedViews<T>({
            rumApplicationId: new ObjectID(rumApplicationId),
            viewType: viewType,
          });

        setViews(listed);
        setListState(ListState.Loaded);

        return listed;
      } catch {
        // Said in the list, which reads again as it next opens.
        setListState(ListState.NotLoaded);

        return null;
      }
    }, [rumApplicationId, viewType]);

  /*
   * Read as the page opens, whoever reads it: the server decides who may,
   * and the address's saved view is settled by its answer either way.
   */
  useEffect(() => {
    let isCurrent: boolean = true;

    void loadViews().then(
      (listed: Array<ProductAnalyticsSavedView<T>> | null): void => {
        const current: ComponentProps<T> = propsRef.current;

        if (!isCurrent || current.isSettled) {
          return;
        }

        const outcome: ProductAnalyticsAddressViewOutcome<T> =
          settleProductAnalyticsAddressView<T>({
            savedViewId: current.savedViewId,
            isDefinitionInAddress: current.isDefinitionInAddress,
            views: listed,
            words: PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[current.viewType],
          });

        if (outcome.kind === "open") {
          current.onOpen(outcome.view);
        } else if (outcome.kind === "drop") {
          current.onSelect(null);
          current.onNotice(outcome.notice);
        }

        current.onSettled();
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [loadViews]);

  if (!readGate.isAllowed) {
    return <></>;
  }

  const findView: (viewId: string) => ProductAnalyticsSavedView<T> | null = (
    viewId: string,
  ): ProductAnalyticsSavedView<T> | null => {
    return (
      views.find((view: ProductAnalyticsSavedView<T>): boolean => {
        return view.id === viewId;
      }) || null
    );
  };

  const selectedView: ProductAnalyticsSavedView<T> | null = props.savedViewId
    ? findView(props.savedViewId)
    : null;
  const onScreen: ProductAnalyticsSavedViewDefinitions[T] | null =
    props.definition;
  const isChanged: boolean = Boolean(
    selectedView &&
      selectedView.definition &&
      onScreen &&
      !isSameProductAnalyticsDefinition(selectedView.definition, onScreen),
  );

  let createDisabledReason: string | undefined = undefined;

  if (!createGate.isAllowed) {
    createDisabledReason = createGate.disabledReason;
  } else if (!onScreen) {
    createDisabledReason =
      translator.translateText(words.nothingToSave) || words.nothingToSave;
  }

  /*
   * While the list is read, and when it could not be: said in the panel, a
   * failed read with Try again under it. The trigger shows no count then -
   * "0" would say there are none - nor for an application that has none.
   */
  let emptyContent: ReactElement | undefined = undefined;

  if (listState === ListState.Loading) {
    emptyContent = (
      <div
        className="px-3 py-6 text-center text-xs text-gray-500"
        role="status"
      >
        {translator.translateText("Loading…")}
      </div>
    );
  } else if (listState === ListState.NotLoaded) {
    emptyContent = (
      <div
        className="flex flex-col items-center gap-1.5 px-3 py-5 text-center"
        role="alert"
        data-testid={`${props.dataTestId}-not-loaded`}
      >
        <p className="text-xs text-red-700">
          {translator.translateText(words.notLoaded) || words.notLoaded}
        </p>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            setListState(ListState.Loading);
            void loadViews();
          }}
        >
          {translator.translateText("Try again")}
        </button>
      </div>
    );
  }

  const nameFields: Fields<RumProductAnalyticsSavedView> = [
    {
      field: {
        name: true,
      },
      fieldType: FormFieldSchemaType.Text,
      title: "Name",
      description: SAVED_VIEW_NAME_DESCRIPTION,
      placeholder: SAVED_VIEW_NAME_PLACEHOLDER,
      required: true,
      validation: {
        maxLength: PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH,
      },
    },
  ];

  return (
    <>
      <SavedViewsDropdown
        dataTestId={props.dataTestId}
        savedViews={
          listState === ListState.Loaded
            ? toProductAnalyticsSavedViewOptions<T>({
                views: views,
                savedViewId: props.savedViewId,
                definition: onScreen,
                translator: translator,
              })
            : []
        }
        showCount={listState === ListState.Loaded && views.length > 0}
        emptyContent={emptyContent}
        selectedSavedViewId={props.savedViewId}
        showTriggerIcon={true}
        triggerIcon={IconProp.Bookmark}
        labels={{
          trigger: words.list,
          panel: words.list,
          empty: words.empty,
          create: words.create,
          search: words.search,
        }}
        onOpen={() => {
          if (listState === ListState.NotLoaded) {
            setListState(ListState.Loading);
          }

          void loadViews();
        }}
        onSelect={(viewId: string) => {
          const view: ProductAnalyticsSavedView<T> | null = findView(viewId);

          if (!view) {
            return;
          }

          if (!view.definition) {
            props.onNotice(
              translator.translateTemplate(SAVED_VIEW_UNREADABLE_NOTICE, {
                name: view.name,
              }),
            );
            return;
          }

          props.onNotice(null);
          props.onOpen(view);
        }}
        // What is on screen stays; it is no longer kept as the saved one.
        onClear={() => {
          props.onSelect(null);
        }}
        onCreate={
          isOffered(createGate)
            ? () => {
                if (onScreen) {
                  setToSave(onScreen);
                }
              }
            : undefined
        }
        createDisabledReason={createDisabledReason}
        onEdit={
          updateGate.isAllowed
            ? (viewId: string) => {
                setToRename(findView(viewId));
              }
            : undefined
        }
        onDelete={
          deleteGate.isAllowed
            ? (viewId: string) => {
                setDeleteError(undefined);
                setToDelete(findView(viewId));
              }
            : undefined
        }
        onUpdateCurrent={
          updateGate.isAllowed && selectedView && isChanged && onScreen
            ? () => {
                void updateProductAnalyticsSavedViewDefinition({
                  savedViewId: selectedView.id,
                  definition:
                    onScreen as ProductAnalyticsSavedViewDefinitions[ProductAnalyticsSavedViewType],
                })
                  .then(async (): Promise<void> => {
                    props.onNotice(null);
                    await loadViews();
                  })
                  .catch((error: unknown): void => {
                    props.onNotice(API.getFriendlyMessage(error));
                  });
              }
            : undefined
        }
      />
      {toSave ? (
        <ModelFormModal<RumProductAnalyticsSavedView>
          modelType={RumProductAnalyticsSavedView}
          name={`${props.dataTestId}-save`}
          title={words.save}
          description={words.saveDescription}
          submitButtonText={words.save}
          onClose={() => {
            setToSave(null);
          }}
          onBeforeCreate={async (
            item: RumProductAnalyticsSavedView,
          ): Promise<RumProductAnalyticsSavedView> => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (projectId) {
              item.projectId = projectId;
            }

            item.rumApplicationId = props.rumApplicationId;
            item.viewType = props.viewType;
            item.definition = toSave as unknown as JSONObject;

            return item;
          }}
          onSuccess={(created: RumProductAnalyticsSavedView) => {
            setToSave(null);
            props.onNotice(null);

            const createdId: string | undefined = created._id?.toString();

            void loadViews().then((): void => {
              if (createdId) {
                props.onSelect(createdId);
              }
            });
          }}
          formProps={{
            name: `${props.dataTestId}-save-form`,
            modelType: RumProductAnalyticsSavedView,
            id: `${props.dataTestId}-save-form`,
            formType: FormType.Create,
            fields: nameFields,
          }}
        />
      ) : (
        <></>
      )}
      {toRename ? (
        <ModelFormModal<RumProductAnalyticsSavedView>
          modelType={RumProductAnalyticsSavedView}
          modelIdToEdit={new ObjectID(toRename.id)}
          name={`${props.dataTestId}-rename`}
          title={words.rename}
          submitButtonText="Save Changes"
          onClose={() => {
            setToRename(null);
          }}
          onSuccess={() => {
            setToRename(null);
            void loadViews();
          }}
          formProps={{
            name: `${props.dataTestId}-rename-form`,
            modelType: RumProductAnalyticsSavedView,
            id: `${props.dataTestId}-rename-form`,
            formType: FormType.Update,
            fields: nameFields,
          }}
        />
      ) : (
        <></>
      )}
      {toDelete ? (
        <ConfirmModal
          title={words.delete}
          description={
            <DeleteConfirmationMessage
              kind="question"
              name={toDelete.name}
              typeLabel="saved view"
              // The dashboards that show it: their widgets say it is gone.
              warning={
                translator.translateText(SAVED_VIEW_DELETE_WIDGETS_NOTE) ||
                SAVED_VIEW_DELETE_WIDGETS_NOTE
              }
            />
          }
          isLoading={isDeleting}
          error={deleteError}
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            const deleting: ProductAnalyticsSavedView<T> = toDelete;

            setIsDeleting(true);
            setDeleteError(undefined);

            void deleteProductAnalyticsSavedView(deleting.id)
              .then(async (): Promise<void> => {
                if (deleting.id === props.savedViewId) {
                  props.onSelect(null);
                }

                setToDelete(null);
                await loadViews();
              })
              .catch((error: unknown): void => {
                setDeleteError(API.getFriendlyMessage(error));
              })
              .finally((): void => {
                setIsDeleting(false);
              });
          }}
          onClose={() => {
            setToDelete(null);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
}

export default ProductAnalyticsSavedViewsMenu;
