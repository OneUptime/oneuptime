import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import MonitorElement from "../../../Components/Monitor/Monitor";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
  SloAddableMonitorOption,
  SloMonitorActionAvailability,
  SloMonitorMembership,
  SloMonitorSource,
  applySloMonitorChange,
  buildSloMonitorsUpdateData,
  describeSloMonitorCounts,
  getAddMonitorsAvailability,
  getAddableMonitorOptions,
  getRemoveMonitorAvailability,
  getSelectedMonitorIds,
  getSloMonitorMembership,
  getSloMonitorSource,
} from "../Utils/SloMonitorSource";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black, Blue500, Gray500, Red500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface SloMonitorState {
  membership: SloMonitorMembership;
  enabledMonitorRuleCount: number;
}

interface SloAddMonitorsFormValues {
  monitors: Array<string>;
}

type FetchSloMonitorStateFunction = () => Promise<SloMonitorState>;

type SaveMonitorChangeFunction = (data: {
  addMonitorIds?: Array<string> | undefined;
  removeMonitorIds?: Array<string> | undefined;
}) => Promise<void>;

/*
 * The monitors an SLO measures, and where each one came from.
 *
 * A dedicated ModelTable over Monitor rather than the shared MonitorsTable on
 * purpose: that table brings the monitor-level bulk actions (enable/disable a
 * monitor, add/remove probes, labels, owners), and none of those belong on an
 * SLO page - "disable" here would read as "take it off this SLO" and instead
 * switch monitoring off everywhere.
 *
 * Membership lives on the SLO itself (`monitors`, with `autoAddedMonitors` as
 * the rule-attached subset), so the page reads it off the SLO and lists
 * exactly those ids. Adds and removes write the SLO's monitor list; the server
 * guard in ServiceLevelObjectiveService is the real enforcement of "no hand
 * edits while rules are enabled" - the disabled buttons here only keep the
 * page from offering what the API would refuse.
 */
const SloMonitors: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // The route is <sloId>/monitors, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitorState, setMonitorState] = useState<SloMonitorState | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState<number>(0);

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showNothingToAddModal, setShowNothingToAddModal] =
    useState<boolean>(false);
  const [isLoadingAddOptions, setIsLoadingAddOptions] =
    useState<boolean>(false);
  const [addOptions, setAddOptions] = useState<Array<SloAddableMonitorOption>>(
    [],
  );
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [monitorToRemove, setMonitorToRemove] = useState<Monitor | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const fetchSloMonitorState: FetchSloMonitorStateFunction =
    async (): Promise<SloMonitorState> => {
      const [slo, enabledMonitorRuleCount]: [
        ServiceLevelObjective | null,
        number,
      ] = await Promise.all([
        ModelAPI.getItem<ServiceLevelObjective>({
          modelType: ServiceLevelObjective,
          id: modelId,
          select: {
            monitors: {
              _id: true,
            },
            autoAddedMonitors: {
              _id: true,
            },
          },
        }),
        ModelAPI.count<ServiceLevelObjectiveMonitorRule>({
          modelType: ServiceLevelObjectiveMonitorRule,
          query: {
            serviceLevelObjectiveId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
            isEnabled: true,
          },
        }),
      ]);

      if (!slo) {
        throw new BadDataException("Service Level Objective not found.");
      }

      return {
        membership: getSloMonitorMembership(slo),
        enabledMonitorRuleCount: enabledMonitorRuleCount,
      };
    };

  /*
   * Re-reads the membership and bumps the table and the notice banner, so a
   * change shows up everywhere on the page at once - including the "no
   * monitors attached" banner disappearing after the first add.
   */
  const reload: PromiseVoidFunction = async (): Promise<void> => {
    setMonitorState(await fetchSloMonitorState());
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    reload()
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [modelId.toString()]);

  /*
   * Applies one add or remove to the monitor list as it is NOW, not as it was
   * when the page loaded: a rule sync (or a colleague) may have changed it
   * while the modal was open, and writing back a stale copy would undo that.
   * The rule check is repeated on the fresh read for the same reason.
   */
  const saveMonitorChange: SaveMonitorChangeFunction = async (data: {
    addMonitorIds?: Array<string> | undefined;
    removeMonitorIds?: Array<string> | undefined;
  }): Promise<void> => {
    const current: SloMonitorState = await fetchSloMonitorState();

    if ((data.addMonitorIds || []).length > 0) {
      const availability: SloMonitorActionAvailability =
        getAddMonitorsAvailability({
          enabledMonitorRuleCount: current.enabledMonitorRuleCount,
        });

      if (!availability.isAllowed) {
        setMonitorState(current);
        throw new BadDataException(availability.disabledReason || "");
      }
    }

    for (const monitorId of data.removeMonitorIds || []) {
      const availability: SloMonitorActionAvailability =
        getRemoveMonitorAvailability({
          monitorId: monitorId,
          ruleAttachedMonitorIds: current.membership.ruleAttachedMonitorIds,
          enabledMonitorRuleCount: current.enabledMonitorRuleCount,
        });

      if (!availability.isAllowed) {
        setMonitorState(current);
        throw new BadDataException(availability.disabledReason || "");
      }
    }

    await ModelAPI.updateById<ServiceLevelObjective>({
      modelType: ServiceLevelObjective,
      id: modelId,
      data: buildSloMonitorsUpdateData(
        applySloMonitorChange({
          currentMonitorIds: current.membership.monitorIds,
          addMonitorIds: data.addMonitorIds,
          removeMonitorIds: data.removeMonitorIds,
        }),
      ),
    });

    await reload();
  };

  /*
   * The add modal only offers monitors that are not already on the SLO, so
   * the list is fetched when the modal opens - a monitor created a moment ago
   * is immediately selectable.
   */
  const openAddModal: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingAddOptions(true);
    setAddError(null);

    try {
      const [monitors, current]: [ListResult<Monitor>, SloMonitorState] =
        await Promise.all([
          ModelAPI.getList<Monitor>({
            modelType: Monitor,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            select: {
              _id: true,
              name: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          }),
          fetchSloMonitorState(),
        ]);

      setMonitorState(current);

      const options: Array<SloAddableMonitorOption> = getAddableMonitorOptions({
        monitors: monitors.data,
        attachedMonitorIds: current.membership.monitorIds,
      });

      setAddOptions(options);

      if (options.length === 0) {
        setShowNothingToAddModal(true);
        return;
      }

      setShowAddModal(true);
    } catch (err) {
      setAddOptions([]);
      setAddError(API.getFriendlyMessage(err));
      setShowAddModal(true);
    } finally {
      setIsLoadingAddOptions(false);
    }
  };

  if (error) {
    return (
      <Fragment>
        <SloNoticeBanner sloId={modelId} />
        <ErrorMessage message={error} />
      </Fragment>
    );
  }

  if (isLoading || !monitorState) {
    return <PageLoader isVisible={true} />;
  }

  const { membership, enabledMonitorRuleCount } = monitorState;

  const monitorRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_MONITOR_RULES] as Route,
    { modelId: modelId },
  );

  const addAvailability: SloMonitorActionAvailability =
    getAddMonitorsAvailability({
      enabledMonitorRuleCount: enabledMonitorRuleCount,
    });

  /*
   * Adding and removing both write the SLO, so both need Edit permission on
   * it. A missing permission locks the buttons with the permission it needs;
   * a permission snapshot that has not loaded yet hides them instead of
   * accusing the user of lacking something they may well hold.
   */
  const canEditSlo: PermissionGateResult = PermissionGate.check(
    new ServiceLevelObjective(),
    ModelAction.Update,
  );

  const addMonitorsButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: "Add Monitors",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
        isLoading: isLoadingAddOptions,
        disabled: !addAvailability.isAllowed,
        tooltip: addAvailability.disabledReason,
        onClick: () => {
          if (!addAvailability.isAllowed) {
            return;
          }

          openAddModal().catch((err: Error) => {
            setAddError(API.getFriendlyMessage(err));
          });
        },
      },
      new ServiceLevelObjective(),
      ModelAction.Update,
    );

  const isRemovable: (monitor: Monitor) => boolean = (
    monitor: Monitor,
  ): boolean => {
    return getRemoveMonitorAvailability({
      monitorId: monitor._id,
      ruleAttachedMonitorIds: membership.ruleAttachedMonitorIds,
      enabledMonitorRuleCount: enabledMonitorRuleCount,
    }).isAllowed;
  };

  const removeActionButtons: Array<ActionButtonSchema<Monitor>> =
    !canEditSlo.isAllowed && !canEditSlo.disabledReason
      ? []
      : [
          {
            title: "Remove",
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            icon: IconProp.Close,
            disabled: !canEditSlo.isAllowed,
            tooltip: canEditSlo.disabledReason,
            isVisible: (monitor: Monitor): boolean => {
              return isRemovable(monitor);
            },
            onClick: (monitor: Monitor, onCompleteAction: VoidFunction) => {
              setRemoveError(null);
              setMonitorToRemove(monitor);
              onCompleteAction();
            },
          },
          /*
           * Rule-attached rows keep a Remove button, locked, rather than
           * losing it: a row that silently lacks an action its neighbours have
           * reads as a bug, and the tooltip is where the reason lives.
           */
          {
            title: "Remove",
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            icon: IconProp.Close,
            disabled: true,
            tooltip: SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
            isVisible: (monitor: Monitor): boolean => {
              return !isRemovable(monitor);
            },
            onClick: (_monitor: Monitor, onCompleteAction: VoidFunction) => {
              onCompleteAction();
            },
          },
        ];

  return (
    <Fragment>
      <SloNoticeBanner
        sloId={modelId}
        refreshToggle={refreshCount.toString()}
      />

      {enabledMonitorRuleCount > 0 ? (
        <AlertBanner
          title="This SLO's monitors are managed by its monitor rules"
          type={AlertBannerType.Info}
          icon={IconProp.Filter}
          className="mb-5"
          dataTestId="slo-monitors-managed-by-rules"
          rightElement={
            <AppLink
              className="text-sm font-medium underline"
              to={monitorRulesRoute}
            >
              Manage Monitor Rules
            </AppLink>
          }
        >
          <span>
            {enabledMonitorRuleCount === 1
              ? "An enabled monitor rule decides"
              : `${enabledMonitorRuleCount} enabled monitor rules decide`}{" "}
            which monitors this SLO measures. Matching monitors are attached
            automatically, so monitors cannot be added by hand, and monitors a
            rule attached cannot be removed here. Monitors attached by hand
            before the rules were enabled can still be removed. Disable every
            rule to pick monitors yourself.
          </span>
        </AlertBanner>
      ) : (
        <></>
      )}

      <ModelTable<Monitor>
        modelType={Monitor}
        id="slo-monitors-table"
        name="SLO > Monitors"
        userPreferencesKey="slo-monitors-table"
        saveFilterProps={{
          tableId: "slo-monitors-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        refreshToggle={refreshCount.toString()}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          /*
           * An empty list is safe: Includes over no ids matches no rows, so
           * an SLO with nothing attached shows the empty state, never the
           * whole project.
           */
          _id: new Includes(membership.monitorIds),
        }}
        cardProps={{
          title: "Monitors",
          description: `The monitors whose uptime this SLO measures. ${describeSloMonitorCounts(membership)}.`,
          buttons: addMonitorsButton ? [addMonitorsButton] : [],
        }}
        noItemsMessage={
          enabledMonitorRuleCount > 0
            ? "No monitors match this SLO's enabled monitor rules yet. Monitors are attached as soon as one matches."
            : "No monitors attached. Add monitors by hand, or create a monitor rule to attach matching monitors automatically."
        }
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          disableActiveMonitoring: true,
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <MonitorElement monitor={item} />;
            },
          },
          {
            field: {
              currentMonitorStatus: {
                color: true,
                name: true,
              },
            },
            title: "Current Status",
            type: FieldType.Entity,
            getElement: (item: Monitor): ReactElement => {
              if (item.disableActiveMonitoring) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Gray500}
                    text={"Disabled"}
                  />
                );
              }

              if (item.isNoProbeEnabledOnThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Not Enabled"}
                  />
                );
              }

              if (item.isAllProbesDisconnectedFromThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Disconnected"}
                  />
                );
              }

              /*
               * A monitor that has not reported a status yet still belongs
               * on the list; say so instead of failing the whole row.
               */
              if (!item.currentMonitorStatus) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Gray500}
                    text={"Unknown"}
                  />
                );
              }

              return (
                <Statusbubble
                  color={item.currentMonitorStatus.color || Black}
                  shouldAnimate={true}
                  text={item.currentMonitorStatus.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Source",
            type: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return getSloMonitorSource({
                monitorId: item._id,
                ruleAttachedMonitorIds: membership.ruleAttachedMonitorIds,
              }) === SloMonitorSource.Rule ? (
                <Pill
                  color={Blue500}
                  text="Rule"
                  size={PillSize.Small}
                  tooltip="Attached by one of this SLO's monitor rules"
                />
              ) : (
                <Pill
                  color={Gray500}
                  text="Manual"
                  size={PillSize.Small}
                  tooltip="Attached by hand"
                />
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: Monitor): ReactElement => {
              return <LabelsElement labels={item.labels || []} />;
            },
          },
        ]}
        actionButtons={removeActionButtons}
        viewPageRoute={Navigation.getCurrentRoute()}
      />

      {showAddModal ? (
        <BasicFormModal<SloAddMonitorsFormValues>
          title="Add Monitors"
          name="SLO > Add Monitors"
          description="Pick the monitors whose uptime this SLO should measure. Only monitors not already attached are listed."
          submitButtonText="Add Monitors"
          isLoading={isAdding}
          error={addError || undefined}
          onClose={() => {
            setShowAddModal(false);
            setAddError(null);
          }}
          onSubmit={(values: SloAddMonitorsFormValues) => {
            const monitorIds: Array<string> = getSelectedMonitorIds(
              values.monitors,
            );

            if (monitorIds.length === 0) {
              setAddError("Select at least one monitor to add.");
              return;
            }

            setIsAdding(true);
            setAddError(null);

            saveMonitorChange({ addMonitorIds: monitorIds })
              .then(() => {
                setShowAddModal(false);
              })
              .catch((err: Error) => {
                setAddError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsAdding(false);
              });
          }}
          formProps={{
            name: "SLO > Add Monitors",
            fields: [
              {
                field: {
                  monitors: true,
                },
                title: "Monitors",
                description:
                  "Every monitor you pick counts towards this SLO's SLI and error budget.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: true,
                placeholder: "Select monitors",
                dropdownOptions: addOptions,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {showNothingToAddModal ? (
        <ConfirmModal
          title="Nothing to Add"
          description="Every monitor in this project is already attached to this SLO."
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setShowNothingToAddModal(false);
          }}
          onClose={() => {
            setShowNothingToAddModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {monitorToRemove ? (
        <ConfirmModal
          title="Remove Monitor from SLO"
          description={
            <div>
              Remove <strong>{monitorToRemove.name || "this monitor"}</strong>{" "}
              from this SLO? It will no longer count towards the SLO&apos;s SLI
              and error budget. The monitor itself is not changed.
            </div>
          }
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError || undefined}
          onClose={() => {
            setMonitorToRemove(null);
            setRemoveError(null);
          }}
          onSubmit={() => {
            const monitorId: string = monitorToRemove._id?.toString() || "";

            if (!monitorId) {
              setMonitorToRemove(null);
              return;
            }

            setIsRemoving(true);
            setRemoveError(null);

            saveMonitorChange({ removeMonitorIds: [monitorId] })
              .then(() => {
                setMonitorToRemove(null);
              })
              .catch((err: Error) => {
                setRemoveError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsRemoving(false);
              });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SloMonitors;
