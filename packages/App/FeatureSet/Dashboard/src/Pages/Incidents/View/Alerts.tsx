import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertElement from "../../../Components/Alert/Alert";
import UserElement from "../../../Components/User/User";
import {
  createIncidentAlertLink,
  fetchAlertLinkOptions,
  lockUnlessAllowed,
} from "../../../Components/IncidentAlert/IncidentAlertLink";
import LinkIncidentAlertModal from "../../../Components/IncidentAlert/LinkIncidentAlertModal";
import Pill from "Common/UI/Components/Pill/Pill";
import { Black } from "Common/Types/BrandColors";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

/*
 * The alerts linked to an incident (IncidentAlert rows). Linking creates a
 * row and unlinking deletes it; the alert itself is never touched.
 */
const IncidentViewAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  /*
   * Relations are only joined one level deep, so an alert's current state
   * cannot be selected through the link row - it is looked up here by id.
   */
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  useEffect(() => {
    const fetchStates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
              color: true,
            },
            sort: {},
          });
        setAlertStates(result.data);
      } catch {
        // Silently fail - states just won't show
      }
    };

    fetchStates();
  }, []);

  const getStateById: (
    stateId: ObjectID | string | undefined,
  ) => AlertState | undefined = (
    stateId: ObjectID | string | undefined,
  ): AlertState | undefined => {
    if (!stateId) {
      return undefined;
    }
    const stateIdStr: string = stateId.toString();
    return alertStates.find((state: AlertState) => {
      return state._id?.toString() === stateIdStr;
    });
  };

  const getAlertNumber: (item: IncidentAlert) => string = (
    item: IncidentAlert,
  ): string => {
    if (!item.alert?.alertNumber) {
      return "";
    }

    return item.alert.alertNumberWithPrefix || `#${item.alert.alertNumber}`;
  };

  /*
   * Linking opens a dialog of its own rather than the table's create form:
   * it lists recent alerts by number, since alerts from the same monitor
   * share titles. Being a card button, it is gated here - on creating the
   * link, and on reading alerts, since only an alert the user can see can be
   * linked (and the dialog could not list any).
   */
  const linkAlertButton: CardButtonSchema | null = lockUnlessAllowed(
    PermissionGate.gateCardButton(
      {
        title: "Link Alert",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Link,
        onClick: () => {
          setShowLinkModal(true);
        },
      },
      new IncidentAlert(),
      ModelAction.Create,
    ),
    PermissionGate.check(new Alert(), ModelAction.Read),
  );

  return (
    <Fragment>
      <ModelTable<IncidentAlert>
        modelType={IncidentAlert}
        name="Incident Linked Alerts"
        id="incident-linked-alerts-table"
        userPreferencesKey="incident-linked-alerts-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Alert"
        pluralName="Alerts"
        deleteButtonText="Unlink"
        refreshToggle={refreshToggle.toString()}
        getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
          return {
            title: "Unlink Alert",
            description:
              "Unlink this alert from the incident? The alert itself is not deleted, and it stays linked to any other incidents.",
            submitButtonText: "Unlink",
          };
        }}
        query={{
          incidentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
          deleteVerb: "Unlink",
          deleteIcon: IconProp.LinkSlash,
          deleteConfirmationWarning:
            "Only the links are removed: the alerts themselves are not deleted, and they stay linked to any other incidents.",
        }}
        filters={[]}
        cardProps={{
          title: "Linked Alerts",
          description:
            "Alerts linked to this incident. Link the alerts this incident is responding to so the whole response is tracked in one place.",
          buttons: linkAlertButton ? [linkAlertButton] : [],
        }}
        noItemsMessage="No alerts are linked to this incident."
        showRefreshButton={true}
        actionButtons={[
          {
            title: "View Alert",
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: (item: IncidentAlert, onCompleteAction: () => void) => {
              if (item.alert?._id) {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ALERT_VIEW] as Route,
                    { modelId: new ObjectID(item.alert._id.toString()) },
                  ),
                );
              }
              onCompleteAction();
            },
          } as ActionButtonSchema<IncidentAlert>,
        ]}
        columns={[
          {
            field: {
              alert: {
                alertNumber: true,
                alertNumberWithPrefix: true,
              },
            },
            title: "Alert #",
            type: FieldType.Text,
            getElement: (item: IncidentAlert): ReactElement => {
              return <>{getAlertNumber(item) || "-"}</>;
            },
            getExportValue: (item: IncidentAlert): string => {
              return getAlertNumber(item);
            },
          },
          {
            field: {
              alert: {
                title: true,
                _id: true,
                currentAlertStateId: true,
              },
            },
            title: "Title",
            type: FieldType.Element,
            getElement: (item: IncidentAlert): ReactElement => {
              if (!item.alert) {
                return <>-</>;
              }
              return <AlertElement alert={item.alert} />;
            },
            getExportValue: (item: IncidentAlert): string => {
              return item.alert?.title || "";
            },
          },
          {
            field: {
              alert: {
                currentAlertStateId: true,
              },
            },
            title: "Current State",
            type: FieldType.Element,
            getElement: (item: IncidentAlert): ReactElement => {
              const state: AlertState | undefined = getStateById(
                item.alert?.currentAlertStateId,
              );
              if (!state) {
                return <>-</>;
              }
              return (
                <Pill
                  isMinimal={true}
                  color={state.color || Black}
                  text={state.name || "Unknown"}
                />
              );
            },
            getExportValue: (item: IncidentAlert): string => {
              return getStateById(item.alert?.currentAlertStateId)?.name || "";
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Linked At",
            type: FieldType.DateTime,
          },
          {
            field: {
              createdByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Linked By",
            type: FieldType.Element,
            getElement: (item: IncidentAlert): ReactElement => {
              if (!item.createdByUser) {
                return <>-</>;
              }
              return <UserElement user={item.createdByUser} />;
            },
            getExportValue: (item: IncidentAlert): string => {
              return (
                item.createdByUser?.name?.toString() ||
                item.createdByUser?.email?.toString() ||
                ""
              );
            },
          },
        ]}
      />

      {showLinkModal && (
        <LinkIncidentAlertModal
          title="Link Alert"
          description="Select an alert to link to this incident."
          submitButtonText="Link Alert"
          fieldTitle="Alert"
          fieldDescription="Recent alerts are listed with their number. Type to search every alert by title."
          placeholder="Select an alert"
          modelType={Alert}
          loadOptions={fetchAlertLinkOptions}
          onClose={() => {
            setShowLinkModal(false);
          }}
          onSubmit={async (alertId: string): Promise<void> => {
            await createIncidentAlertLink({
              incidentId: modelId,
              alertId: new ObjectID(alertId),
            });

            setShowLinkModal(false);
            setRefreshToggle((previous: boolean): boolean => {
              return !previous;
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default IncidentViewAlerts;
