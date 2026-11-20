import ManagedDevice from "Common/Models/DatabaseModels/ManagedDevice";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/Types/Translator";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AlertsTable from "../Alert/AlertsTable";
import IncidentsTable from "../Incident/IncidentsTable";
import { getConnectionRecommendationsRoute } from "./DeviceManagementConnectionsTable";
import {
  MANAGED_DEVICE_ALERT_SUBJECT_SELECT,
  ManagedDeviceAlertScope,
  ManagedDeviceAlertSubject,
  ManagedDeviceRecordKind,
  getManagedDeviceAlertQuery,
  getManagedDeviceIncidentQuery,
  loadManagedDeviceAlertScope,
  toManagedDeviceAlertSubject,
} from "./ManagedDeviceAlerts";

/*
 * A managed device's alerts, or its incidents, on its Inventory item's
 * Alerts and Incidents pages (#10007): the ones its device manager's
 * monitors raised about it (ManagedDeviceAlerts), in the list every such
 * page draws. A device the Android agent does not report is no Host, so
 * these are what its item has; with none yet, the list says how to get
 * them - its connection's Set up alerts.
 */

export interface ComponentProps {
  managedDeviceId: ObjectID;
  kind: ManagedDeviceRecordKind;
}

// A query no record matches: a device no monitor has raised anything about.
const NO_RECORD: ObjectID = ObjectID.getZeroObjectID();

const ManagedDeviceRecordsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [scope, setScope] = useState<ManagedDeviceAlertScope | null>(null);
  const [connectionId, setConnectionId] = useState<ObjectID | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const device: ManagedDevice | null =
          await ModelAPI.getItem<ManagedDevice>({
            modelType: ManagedDevice,
            id: props.managedDeviceId,
            select: { ...MANAGED_DEVICE_ALERT_SUBJECT_SELECT },
          });
        const subject: ManagedDeviceAlertSubject | null = device
          ? toManagedDeviceAlertSubject(device)
          : null;
        const found: ManagedDeviceAlertScope =
          subject && projectId
            ? await loadManagedDeviceAlertScope({
                kind: props.kind,
                projectId,
                device: subject,
              })
            : { seriesNames: [], monitorIds: [] };

        if (isCurrent) {
          setScope(found);
          setConnectionId(device?.connectionId || null);
          setError("");
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err as Error));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [props.managedDeviceId.toString(), props.kind]);

  if (isLoading) {
    return <DetailListSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
  const found: ManagedDeviceAlertScope = scope || {
    seriesNames: [],
    monitorIds: [],
  };
  // No monitor has raised one about it yet: a list that says so.
  const listed: ManagedDeviceAlertScope =
    found.seriesNames.length > 0 && found.monitorIds.length > 0
      ? found
      : { seriesNames: found.seriesNames, monitorIds: [NO_RECORD] };

  /*
   * Its connection's recommended monitors are how a device gets any: the
   * one way forward from an empty list. A record created by hand would not
   * be about the device, so the list offers none.
   */
  const emptyState: EmptyStateOptions = {
    description: translationKey(
      "What its device manager's monitors raise about this device: when it stops checking in, runs low on battery, fills its storage or falls behind on security patches.",
    ),
    hideCreateButton: true,
    ...(connectionId
      ? {
          actions: [
            {
              title: "Set up alerts",
              icon: IconProp.Bell,
              onClick: () => {
                Navigation.navigate(
                  getConnectionRecommendationsRoute(connectionId),
                );
              },
              dataTestId: "managed-device-set-up-alerts",
            },
          ],
        }
      : {}),
  };

  if (props.kind === "incident") {
    return (
      <IncidentsTable
        query={getManagedDeviceIncidentQuery({ projectId, scope: listed })}
        disableCreate={true}
        emptyState={emptyState}
      />
    );
  }

  return (
    <AlertsTable
      query={getManagedDeviceAlertQuery({ projectId, scope: listed })}
      disableCreate={true}
      emptyState={emptyState}
    />
  );
};

export default ManagedDeviceRecordsTable;
