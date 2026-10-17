import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorsTable from "../../../Components/Monitor/MonitorTable";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import MonitorGroupMonitorsCopy, {
  ADD_MONITORS_QUERY_PARAM,
} from "../../../Components/MonitorGroup/MonitorGroupMonitorsCopy";
import {
  getMonitorsToOffer,
  getNothingToAddMessage,
  MonitorGroupAddResult,
  MonitorToOffer,
  getAddMonitorsErrorMessage,
} from "../../../Components/MonitorGroup/MonitorGroupMembership";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";

/*
 * Where Add Monitors stands with the project's monitors: still reading them,
 * could not read them (it says why and offers Try again), or read.
 */
type MonitorsToOfferState = "loading" | "failed" | "loaded";

interface AddMonitorsFormValues {
  monitors: Array<string>;
}

const MonitorGroupMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitorIds, setMonitorIds] = useState<Array<ObjectID> | null>(null);
  /*
   * Loading from the start: the table is drawn once the group's members are
   * read. Drawn before, it read "No monitors in this group yet" for a moment
   * on a group that has monitors.
   */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [selectedMonitor, setSelectedMonitor] = useState<Monitor | null>(null);
  const [isRemoveLoading, setIsRemoveLoading] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /*
   * Add Monitors: every monitor of the project that is not in the group yet,
   * picked together in one dialog. Opened by its card button, or as the page
   * opens when the group's Overview sent the reader here to add its first
   * monitors (?addMonitors=true).
   */
  const [showAddModal, setShowAddModal] = useState<boolean>(
    Navigation.getQueryStringByName(ADD_MONITORS_QUERY_PARAM) === "true" &&
      PermissionGate.check(new MonitorGroupResource(), ModelAction.Create)
        .isAllowed,
  );
  const [projectMonitors, setProjectMonitors] = useState<Array<Monitor>>([]);
  const [offerState, setOfferState] = useState<MonitorsToOfferState>("loading");
  // Why the project's monitors could not be read.
  const [offerError, setOfferError] = useState<string>("");
  const [isAddLoading, setIsAddLoading] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");

  /*
   * What the dialog's picker holds when it (re)draws: nothing when it opens,
   * and the picks that were not added after a partial failure - the form is
   * drawn again once the adding is done, and would otherwise lose them.
   */
  const [pickedMonitorIds, setPickedMonitorIds] = useState<Array<string>>([]);

  /*
   * The group's members. The page shows its loader on the first read only:
   * after an add or a remove the table is read again in place, so the page,
   * and a dialog still open on it, do not flash away.
   */
  const fetchMonitorsInGroup: (options?: {
    showPageLoader?: boolean;
  }) => Promise<void> = async (options?: {
    showPageLoader?: boolean;
  }): Promise<void> => {
    const showPageLoader: boolean = options?.showPageLoader ?? true;

    try {
      if (showPageLoader) {
        setIsLoading(true);
      }
      const monitorGroupMonitors: ListResult<MonitorGroupResource> =
        await ModelAPI.getList<MonitorGroupResource>({
          modelType: MonitorGroupResource,
          query: {
            monitorGroupId: modelId,
          },
          select: {
            monitorId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {},
        });

      const monitorIds: ObjectID[] = monitorGroupMonitors.data.map(
        (monitorGroupMonitor: MonitorGroupResource) => {
          return monitorGroupMonitor.monitorId!;
        },
      );

      setMonitorIds(monitorIds);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError(API.getFriendlyMessage(err));
    }
  };

  /*
   * The project's live monitors, for Add Monitors to offer the ones the
   * group does not hold. Read when the dialog opens, so a monitor created
   * since the page opened is there.
   */
  const fetchProjectMonitors: PromiseVoidFunction = async (): Promise<void> => {
    setOfferState("loading");
    setOfferError("");
    setAddError("");

    try {
      const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setProjectMonitors(result.data);
      setOfferState("loaded");
    } catch (err) {
      setOfferError(API.getFriendlyMessage(err));
      setOfferState("failed");
    }
  };

  useEffect(() => {
    fetchMonitorsInGroup().catch((error: Error) => {
      setError(API.getFriendlyMessage(error));
    });
  }, []);

  useEffect(() => {
    if (showAddModal) {
      fetchProjectMonitors().catch((error: Error) => {
        setOfferError(API.getFriendlyMessage(error));
        setOfferState("failed");
      });
    }
  }, [showAddModal]);

  const closeAddModal: () => void = (): void => {
    setShowAddModal(false);
    setAddError("");
    setOfferError("");
    // Read afresh when it opens again, so it never opens on an old answer.
    setOfferState("loading");
    setPickedMonitorIds([]);
    // So a reload does not open the dialog again.
    Navigation.setQueryString({ [ADD_MONITORS_QUERY_PARAM]: null });
  };

  /*
   * One row per picked monitor. Each is created on its own, so one refusal
   * does not lose the others: the dialog stays open and says how many were
   * added, and why the rest were not.
   */
  const addMonitors: (pickedIds: Array<string>) => Promise<void> = async (
    pickedIds: Array<string>,
  ): Promise<void> => {
    setIsAddLoading(true);
    setAddError("");

    const result: MonitorGroupAddResult = {
      added: 0,
      total: pickedIds.length,
      firstError: undefined,
    };

    const notAddedIds: Array<string> = [];

    for (const monitorId of pickedIds) {
      try {
        const resource: MonitorGroupResource = new MonitorGroupResource();
        resource.monitorGroupId = modelId;
        resource.monitorId = new ObjectID(monitorId);
        resource.projectId = ProjectUtil.getCurrentProjectId()!;

        await ModelAPI.create<MonitorGroupResource>({
          model: resource,
          modelType: MonitorGroupResource,
        });

        result.added++;
      } catch (err) {
        notAddedIds.push(monitorId);

        if (!result.firstError) {
          result.firstError = API.getFriendlyMessage(err);
        }
      }
    }

    /*
     * The members first, so the picker no longer offers the ones just
     * added when it is drawn again with the picks that were not.
     */
    if (result.added > 0) {
      await fetchMonitorsInGroup({ showPageLoader: false });
    }

    setPickedMonitorIds(notAddedIds);
    setIsAddLoading(false);

    const message: string | null = getAddMonitorsErrorMessage(
      result,
      translator,
    );

    if (message) {
      setAddError(message);
      return;
    }

    closeAddModal();
  };

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * Add Monitors for whoever may put a monitor in a group; locked, with the
   * reason, for anyone else - who used to find out only when Assign failed.
   */
  const addMonitorsButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: MonitorGroupMonitorsCopy.addButton,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: () => {
          setShowAddModal(true);
        },
        icon: IconProp.Add,
        isLoading: false,
      },
      new MonitorGroupResource(),
      ModelAction.Create,
    );

  const monitorsToOffer: Array<MonitorToOffer> = getMonitorsToOffer({
    projectMonitors: projectMonitors,
    monitorIdsInGroup: monitorIds || [],
  });

  /*
   * Nothing to pick: the project has no monitor yet, or the group holds
   * every one. The dialog then says which, in place of an empty picker,
   * and offers Create Monitor (to whoever may create one). A pick kept
   * after a refusal is still something to add.
   */
  const nothingToAddMessage: string | undefined =
    offerState === "loaded" && pickedMonitorIds.length === 0
      ? getNothingToAddMessage({
          projectMonitors: projectMonitors,
          monitorsToOffer: monitorsToOffer,
        })
      : undefined;

  const canCreateMonitor: boolean = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  ).isAllowed;

  const renderAddModal: () => ReactElement = (): ReactElement => {
    // The project's monitors could not be read: why, and Try again.
    if (offerState === "failed") {
      return (
        <ConfirmModal
          title={MonitorGroupMonitorsCopy.addDialogTitle}
          description={MonitorGroupMonitorsCopy.addDialogDescription}
          error={offerError}
          submitButtonText="Try again"
          onClose={closeAddModal}
          onSubmit={() => {
            fetchProjectMonitors().catch((error: Error) => {
              setOfferError(API.getFriendlyMessage(error));
              setOfferState("failed");
            });
          }}
        />
      );
    }

    if (nothingToAddMessage) {
      if (!canCreateMonitor) {
        // A notice: its one button closes it.
        return (
          <ConfirmModal
            title={MonitorGroupMonitorsCopy.addDialogTitle}
            description={nothingToAddMessage}
            submitButtonText="Close"
            onSubmit={closeAddModal}
          />
        );
      }

      return (
        <ConfirmModal
          title={MonitorGroupMonitorsCopy.addDialogTitle}
          description={nothingToAddMessage}
          submitButtonText={MonitorGroupMonitorsCopy.createMonitorButton}
          onClose={closeAddModal}
          onSubmit={() => {
            closeAddModal();
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_CREATE] as Route,
              ),
            );
          }}
        />
      );
    }

    return (
      <BasicFormModal<AddMonitorsFormValues>
        title={MonitorGroupMonitorsCopy.addDialogTitle}
        name="Add Monitors to Group"
        description={MonitorGroupMonitorsCopy.addDialogDescription}
        isLoading={offerState === "loading" || isAddLoading}
        error={addError || undefined}
        submitButtonText={MonitorGroupMonitorsCopy.addButton}
        onClose={closeAddModal}
        onSubmit={async (values: AddMonitorsFormValues) => {
          await addMonitors(values.monitors || []);
        }}
        formProps={{
          id: "add-monitors-to-group",
          initialValues: {
            monitors: pickedMonitorIds,
          },
          fields: [
            {
              field: {
                monitors: true,
              },
              title: MonitorGroupMonitorsCopy.monitorsField,
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownOptions: monitorsToOffer,
              required: true,
              placeholder: MonitorGroupMonitorsCopy.monitorsPlaceholder,
            },
          ],
        }}
      />
    );
  };

  return (
    <Fragment>
      <MonitorsTable
        disableCreate={true}
        /*
         * The group's members: the row's action is Remove. Deleting a
         * monitor from here would delete it everywhere, not take it out of
         * this group - that belongs on the Monitors list.
         */
        isDeleteable={false}
        query={{
          _id: new Includes(monitorIds || []),
        }}
        actionButtons={[
          {
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            /*
             * A literal, as every member list's own action is: the list
             * policy (App/Tests/Dashboard/ListDeletePolicy) knows a member
             * list by it - Remove takes the row out, Delete stays off.
             */
            title: "Remove",
            icon: IconProp.Close,
            onClick: (monitor: Monitor, onCompleteAction: VoidFunction) => {
              setSelectedMonitor(monitor);
              setShowRemoveModal(true);
              onCompleteAction();
            },
          },
        ]}
        cardButtons={addMonitorsButton ? [addMonitorsButton] : []}
        title={"Monitors in Group"}
        description="The monitors in this group. The group shows the worst status among them."
        noItemsMessage={MonitorGroupMonitorsCopy.tableNoItems}
      />

      {showRemoveModal ? (
        <ConfirmModal
          title={MonitorGroupMonitorsCopy.removeDialogTitle}
          description={
            <div>
              {translator.translateTemplate(
                MonitorGroupMonitorsCopy.removeDialogDescription,
                {
                  monitorName: selectedMonitor?.name || "",
                },
              )}
            </div>
          }
          error={removeError || ""}
          isLoading={isRemoveLoading}
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText="Remove"
          onClose={() => {
            setShowRemoveModal(false);
            setRemoveError(null);
            setSelectedMonitor(null);
          }}
          onSubmit={async () => {
            try {
              setIsRemoveLoading(true);
              // The row that pairs this monitor with this group.
              const monitorGroupMonitor: ListResult<MonitorGroupResource> =
                await ModelAPI.getList<MonitorGroupResource>({
                  modelType: MonitorGroupResource,
                  query: {
                    monitorId: selectedMonitor!.id!,
                    monitorGroupId: modelId!,
                  },
                  select: {
                    _id: true,
                  },
                  limit: 1,
                  skip: 0,
                  sort: {},
                });

              if (monitorGroupMonitor.data.length === 0) {
                setRemoveError(
                  translator.translateText(
                    MonitorGroupMonitorsCopy.alreadyRemovedError,
                  ) || MonitorGroupMonitorsCopy.alreadyRemovedError,
                );
                setIsRemoveLoading(false);
                return;
              }

              await ModelAPI.deleteItem<MonitorGroupResource>({
                modelType: MonitorGroupResource,
                id: monitorGroupMonitor.data[0]!.id!,
              });

              setIsRemoveLoading(false);
              setSelectedMonitor(null);
              setShowRemoveModal(false);
              setRemoveError(null);
              fetchMonitorsInGroup({ showPageLoader: false }).catch(
                (error: Error) => {
                  setError(API.getFriendlyMessage(error));
                },
              );
            } catch (err) {
              setIsRemoveLoading(false);
              setRemoveError(API.getFriendlyMessage(err));
            }
          }}
        />
      ) : (
        <></>
      )}

      {showAddModal ? renderAddModal() : <></>}
    </Fragment>
  );
};

export default MonitorGroupMonitors;
