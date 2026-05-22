import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertElement from "./Alert";
import { Black } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OwnersCell from "../ResourceOwners/OwnersCell";
import ResourceFiltersLayout from "../ResourceOwners/ResourceFiltersLayout";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorElement from "../Monitor/Monitor";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ObjectID from "Common/Types/ObjectID";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";

export interface ComponentProps {
  query?: Query<Alert> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  createInitialValues?: FormValues<Alert> | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
  disableCreate?: boolean | undefined;
}

const AlertsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [initialValuesForAlert, setInitialValuesForAlert] =
    useState<JSONObject>({});
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);
  const [showBulkStateChangeModal, setShowBulkStateChangeModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Alert> | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Alert>({ modelType: Alert });

  const {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    facetPanel,
    mergeFiltersIntoQuery,
  } = useResourceOwners<Alert>({
    ownerUserModelType: AlertOwnerUser,
    ownerTeamModelType: AlertOwnerTeam,
    resourceIdField: "alertId",
    showLabelsFacet: true,
  });

  // Fetch alert states on mount
  useEffect(() => {
    const fetchAlertStates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 99,
            skip: 0,
            select: {
              _id: true,
              name: true,
              color: true,
              order: true,
              isResolvedState: true,
              isAcknowledgedState: true,
              isCreatedState: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
          });
        setAlertStates(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    };

    fetchAlertStates();
  }, []);

  const handleBulkStateChange: (
    targetStateId: ObjectID,
  ) => Promise<void> = async (targetStateId: ObjectID): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    const targetState: AlertState | undefined = alertStates.find(
      (s: AlertState) => {
        return s.id?.toString() === targetStateId.toString();
      },
    );

    if (!targetState) {
      return;
    }

    const targetOrder: number = targetState.order || 0;

    onBulkActionStart();

    const inProgressItems: Array<Alert> = [...items];
    const totalItems: Array<Alert> = [...items];
    const successItems: Array<Alert> = [];
    const failedItems: Array<BulkActionFailed<Alert>> = [];

    for (const alert of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(alert), 1);

      try {
        if (!alert.id) {
          throw new Error("Alert ID not found");
        }

        // Fetch the alert's current state order since it's not loaded in the table
        const fetchedAlert: Alert | null = await ModelAPI.getItem<Alert>({
          modelType: Alert,
          id: alert.id,
          select: {
            currentAlertState: {
              order: true,
              name: true,
            },
          },
        });

        const currentOrder: number =
          fetchedAlert?.currentAlertState?.order || 0;

        // Skip if already at or past the target state
        if (currentOrder >= targetOrder) {
          const currentStateName: string =
            fetchedAlert?.currentAlertState?.name || "Unknown";
          failedItems.push({
            item: alert,
            failedMessage: `Skipped: Already at "${currentStateName}" (at or past "${targetState.name}")`,
          });
        } else {
          // Create state timeline to change state
          const stateTimeline: AlertStateTimeline = new AlertStateTimeline();
          stateTimeline.alertId = alert.id;
          stateTimeline.alertStateId = targetStateId;
          stateTimeline.projectId = ProjectUtil.getCurrentProjectId()!;

          await ModelAPI.create<AlertStateTimeline>({
            model: stateTimeline,
            modelType: AlertStateTimeline,
          });

          successItems.push(alert);
        }
      } catch (err) {
        failedItems.push({
          item: alert,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowBulkStateChangeModal(false);
    setBulkActionProps(null);

    // Trigger sidebar badge count refresh
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
  };

  const getBulkChangeStateAction: () => BulkActionButtonSchema<Alert> =
    (): BulkActionButtonSchema<Alert> => {
      return {
        title: "Change State",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.TransparentCube,
        onClick: async (
          actionProps: BulkActionOnClickProps<Alert>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowBulkStateChangeModal(true);
        },
      };
    };

  let cardbuttons: Array<CardButtonSchema> = [];

  if (!props.disableCreate) {
    cardbuttons = [
      {
        title: "Create Alert",
        onClick: () => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_CREATE] as Route,
            ),
          );
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
    ];
  }

  return (
    <>
      <ResourceFiltersLayout facetPanel={facetPanel}>
        <ModelTable<Alert>
          name="Alerts"
          userPreferencesKey="alerts-table"
          bulkActions={{
            buttons: [
              getBulkChangeStateAction(),
              ...labelBulkActions,
              ModalTableBulkDefaultActions.Delete,
            ],
          }}
          onCreateEditModalClose={(): void => {
            setInitialValuesForAlert({});
          }}
          modelType={Alert}
          id="alerts-table"
          isDeleteable={false}
          showCreateForm={Object.keys(initialValuesForAlert).length > 0}
          query={mergeFiltersIntoQuery(props.query)}
          onFetchSuccess={(data: Array<Alert>) => {
            onResourcesFetched(data);
          }}
          isEditable={false}
          isCreateable={false}
          isViewable={true}
          createInitialValues={
            Object.keys(initialValuesForAlert).length > 0
              ? initialValuesForAlert
              : props.createInitialValues
          }
          cardProps={{
            title: props.title || "Alerts",
            buttons: cardbuttons,
            description:
              props.description || "Here is a list of alerts for this project.",
          }}
          noItemsMessage={props.noItemsMessage || "No alerts found."}
          showRefreshButton={true}
          searchableFields={["title", "description"]}
          showViewIdButton={true}
          saveFilterProps={props.saveFilterProps}
          viewPageRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.ALERTS]!,
          )}
          filters={[
            {
              title: "Alert ID",
              type: FieldType.Text,
              field: {
                _id: true,
              },
            },
            {
              title: "Alert Number",
              type: FieldType.Number,
              field: {
                alertNumber: true,
              },
            },
            {
              field: {
                title: true,
              },
              title: "Title",
              type: FieldType.Text,
            },
            {
              field: {
                alertSeverity: {
                  name: true,
                },
              },
              title: "Severity",
              type: FieldType.Entity,

              filterEntityType: AlertSeverity,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                currentAlertState: {
                  name: true,
                  color: true,
                },
              },
              title: "State",
              type: FieldType.Entity,

              filterEntityType: AlertState,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                monitor: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              title: "Monitor Affected",
              type: FieldType.EntityArray,

              filterEntityType: Monitor,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              type: FieldType.Date,
            },
          ]}
          selectMoreFields={{
            alertNumberWithPrefix: true,
            isPrivate: true,
          }}
          columns={[
            {
              field: {
                alertNumber: true,
              },
              title: "Alert Number",
              type: FieldType.Text,
              getElement: (item: Alert): ReactElement => {
                if (!item.alertNumber) {
                  return <>-</>;
                }

                const numberLabel: string =
                  item.alertNumberWithPrefix || `#${item.alertNumber}`;

                return (
                  <span className="inline-flex items-center">
                    <span>{numberLabel}</span>
                    {item.isPrivate === true && (
                      <span
                        title="Private alert — visible only to its owners, project admins, and project owners"
                        className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200 align-middle"
                      >
                        <Icon icon={IconProp.Lock} className="w-3 h-3" />
                        Private
                      </span>
                    )}
                  </span>
                );
              },
            },
            {
              field: {
                title: true,
              },
              title: "Title",
              type: FieldType.Element,
              getElement: (item: Alert): ReactElement => {
                return <AlertElement alert={item} />;
              },
            },
            {
              field: {
                currentAlertState: {
                  name: true,
                  color: true,
                },
              },
              title: "State",
              type: FieldType.Entity,

              getElement: (item: Alert): ReactElement => {
                if (item["currentAlertState"]) {
                  return (
                    <Pill
                      isMinimal={true}
                      color={item.currentAlertState.color || Black}
                      text={item.currentAlertState.name || "Unknown"}
                    />
                  );
                }

                return <></>;
              },
            },
            {
              field: {
                alertSeverity: {
                  name: true,
                  color: true,
                },
              },

              title: "Severity",
              type: FieldType.Entity,

              getElement: (item: Alert): ReactElement => {
                if (item["alertSeverity"]) {
                  return (
                    <Pill
                      isMinimal={false}
                      color={item.alertSeverity.color || Black}
                      text={item.alertSeverity.name || "Unknown"}
                    />
                  );
                }

                return <></>;
              },
            },
            {
              field: {
                monitor: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              title: "Monitor Affected",
              type: FieldType.EntityArray,

              getElement: (item: Alert): ReactElement => {
                if (item["monitor"]) {
                  return <MonitorElement monitor={item["monitor"]!} />;
                }
                return <span>-</span>;
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              type: FieldType.DateTime,
              hideOnMobile: true,
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

              getElement: (item: Alert): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Owners",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: Alert): ReactElement => {
                const id: string | undefined = item.id?.toString();
                return (
                  <OwnersCell
                    owners={id ? ownersByResourceId[id] : undefined}
                    isLoading={isLoadingOwners}
                  />
                );
              },
            },
          ]}
        />
      </ResourceFiltersLayout>

      {error && (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setError("");
          }}
        />
      )}

      {labelBulkActionModals}

      {showBulkStateChangeModal && (
        <BasicFormModal
          title="Change Alert State"
          description="Select the state to change alerts to. Alerts already at or past the selected state will be skipped."
          onClose={() => {
            setShowBulkStateChangeModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Change State"
          onSubmit={async (formData: { alertStateId: ObjectID }) => {
            await handleBulkStateChange(formData.alertStateId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  alertStateId: true,
                },
                title: "Select State",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: alertStates.map((state: AlertState) => {
                  return {
                    label: state.name || "",
                    value: state.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}
    </>
  );
};

export default AlertsTable;
