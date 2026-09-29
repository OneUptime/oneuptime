import MonitorCriteriaElement from "./MonitorCriteria";
import MonitorStepMetricPreview from "./MonitorStepMetricPreview";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Service from "Common/Models/DatabaseModels/Service";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import Includes from "Common/Types/BaseDatabase/Includes";
import ServicesElement from "../../Service/ServiceElements";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import MonitorStepViewModel, {
  MonitorStepViewRow,
  MonitorStepViewValue,
  MonitorStepViewValueType,
} from "../../../Utils/MonitorStepViewModel";

export interface ComponentProps {
  monitorStatusOptions: Array<MonitorStatus>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  alertSeverityOptions: Array<AlertSeverity>;
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
}

type MonitorStepDetailItem = Record<string, MonitorStepViewValue>;

const fieldTypeByValueType: Record<MonitorStepViewValueType, FieldType> = {
  [MonitorStepViewValueType.Text]: FieldType.Text,
  [MonitorStepViewValueType.Number]: FieldType.Number,
  [MonitorStepViewValueType.Port]: FieldType.Port,
  [MonitorStepViewValueType.Boolean]: FieldType.Boolean,
  [MonitorStepViewValueType.ArrayOfText]: FieldType.ArrayOfText,
  [MonitorStepViewValueType.DictionaryOfStrings]: FieldType.DictionaryOfStrings,
  [MonitorStepViewValueType.JSON]: FieldType.JSON,
  [MonitorStepViewValueType.JavaScript]: FieldType.JavaScript,
  [MonitorStepViewValueType.Code]: FieldType.Code,
  // Both are resolved to a model by this component and rendered as elements.
  [MonitorStepViewValueType.TelemetryServices]: FieldType.Element,
  [MonitorStepViewValueType.NetworkDevice]: FieldType.Text,
};

const getTelemetryServiceIds: (
  rows: Array<MonitorStepViewRow>,
) => Array<string> = (rows: Array<MonitorStepViewRow>): Array<string> => {
  const ids: Array<string> = [];

  for (const row of rows) {
    if (row.valueType !== MonitorStepViewValueType.TelemetryServices) {
      continue;
    }

    for (const id of (row.value as Array<string> | undefined) || []) {
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
};

const getNetworkDeviceId: (
  rows: Array<MonitorStepViewRow>,
) => string | undefined = (
  rows: Array<MonitorStepViewRow>,
): string | undefined => {
  for (const row of rows) {
    if (
      row.valueType === MonitorStepViewValueType.NetworkDevice &&
      typeof row.value === "string" &&
      row.value
    ) {
      return row.value;
    }
  }

  return undefined;
};

const MonitorStepElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * The single source of truth for what this page shows. Every monitor type
   * goes through it, so a type can no longer fall through to a blank
   * section the way it used to when this was a chain of if/else branches.
   */
  const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
    monitorStep: props.monitorStep,
    monitorType: props.monitorType,
  });

  const telemetryServiceIds: Array<string> = getTelemetryServiceIds(rows);
  const networkDeviceId: string | undefined = getNetworkDeviceId(rows);

  /*
   * Most monitor types reference nothing outside the step, so they must not
   * pay for a fetch — or flash a loader — on the way in.
   */
  const hasReferencesToResolve: boolean =
    telemetryServiceIds.length > 0 || Boolean(networkDeviceId);

  /*
   * The effect keys off this joined string rather than the array itself:
   * `rows` is rebuilt on every render, so array identity would refetch
   * forever.
   */
  const telemetryServiceIdsKey: string = telemetryServiceIds.join(",");

  const [isLoading, setIsLoading] = useState<boolean>(hasReferencesToResolve);
  const [error, setError] = useState<string | undefined>(undefined);
  const [telemetryServices, setServices] = useState<Array<Service>>([]);
  const [networkDeviceName, setNetworkDeviceName] = useState<
    string | undefined
  >(undefined);

  const fetchServices: PromiseVoidFunction = async (): Promise<void> => {
    if (telemetryServiceIds.length === 0) {
      setServices([]);
      return;
    }

    const telemetryServicesResult: ListResult<Service> =
      await ModelAPI.getList<Service>({
        modelType: Service,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          _id: new Includes(
            telemetryServiceIds.map((id: string) => {
              return new ObjectID(id);
            }),
          ),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          serviceColor: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

    if (telemetryServicesResult instanceof HTTPErrorResponse) {
      throw telemetryServicesResult;
    }

    setServices(telemetryServicesResult.data);
  };

  const fetchNetworkDevice: PromiseVoidFunction = async (): Promise<void> => {
    if (!networkDeviceId) {
      setNetworkDeviceName(undefined);
      return;
    }

    const networkDevice: NetworkDevice | null =
      await ModelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: new ObjectID(networkDeviceId),
        select: {
          name: true,
        },
      });

    setNetworkDeviceName(networkDevice?.name || undefined);
  };

  const loadComponent: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError(undefined);

    try {
      await fetchServices();
      await fetchNetworkDevice();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!hasReferencesToResolve) {
      setServices([]);
      setNetworkDeviceName(undefined);
      setIsLoading(false);
      return;
    }

    loadComponent();
  }, [props.monitorType, telemetryServiceIdsKey, networkDeviceId]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const item: MonitorStepDetailItem = {};
  const fields: Array<Field<MonitorStepDetailItem>> = [];

  for (const row of rows) {
    if (row.valueType === MonitorStepViewValueType.TelemetryServices) {
      const ids: Array<string> = (row.value as Array<string> | undefined) || [];

      const services: Array<Service> = telemetryServices.filter(
        (service: Service) => {
          return ids.includes(service.id?.toString() || "");
        },
      );

      item[row.key] = ids;

      fields.push({
        key: row.key,
        title: row.title,
        description: row.description,
        fieldType: FieldType.Element,
        placeholder: row.placeholder,
        getElement: (): ReactElement => {
          return <ServicesElement services={services} />;
        },
      });

      continue;
    }

    /*
     * A device that has since been deleted resolves to no name; showing the
     * stored id then beats showing nothing, because it is what the criteria
     * are still pointed at.
     */
    item[row.key] =
      row.valueType === MonitorStepViewValueType.NetworkDevice
        ? networkDeviceName || row.value
        : row.value;

    fields.push({
      key: row.key,
      title: row.title,
      description: row.description,
      fieldType: fieldTypeByValueType[row.valueType],
      placeholder: row.placeholder,
    });
  }

  const showMetricPreview: boolean = MonitorStepViewModel.hasMetricPreview(
    props.monitorType,
  );

  return (
    <div className="mt-5">
      {fields.length > 0 && (
        <div data-testid="monitor-step-details">
          <FieldLabelElement
            title={"Monitor Details"}
            description={
              "Here are the details of the request we will send to monitor your resource status."
            }
            required={true}
            isHeading={true}
          />
          <div className="mt-5">
            <Detail<MonitorStepDetailItem>
              id={"monitor-step"}
              item={item}
              fields={fields}
            />
          </div>
        </div>
      )}

      {showMetricPreview && (
        <MonitorStepMetricPreview
          metricsViewConfig={MonitorStepViewModel.getMetricsViewConfig(
            props.monitorStep,
          )}
          rollingTime={MonitorStepViewModel.getRollingTime(props.monitorStep)}
        />
      )}

      {fields.length > 0 && <HorizontalRule />}

      <div className="mt-5">
        <FieldLabelElement
          title="Criteria"
          isHeading={true}
          description={
            "Criteria we will use to determine your resource status."
          }
          required={true}
        />

        <MonitorCriteriaElement
          onCallPolicyOptions={props.onCallPolicyOptions}
          monitorStatusOptions={props.monitorStatusOptions}
          incidentSeverityOptions={props.incidentSeverityOptions}
          alertSeverityOptions={props.alertSeverityOptions}
          labelOptions={props.labelOptions}
          teamOptions={props.teamOptions}
          userOptions={props.userOptions}
          incidentRoleOptions={props.incidentRoleOptions}
          monitorCriteria={
            props.monitorStep?.data?.monitorCriteria as MonitorCriteria
          }
        />
      </div>
    </div>
  );
};

export default MonitorStepElement;
