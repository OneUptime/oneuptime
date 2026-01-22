import MonitorStepElement from "./MonitorStep";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import useAsyncEffect from "use-async-effect";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeUtil from "../../../Utils/Probe";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";

export interface ComponentProps extends CustomElementProps {
  error?: string | undefined;
  onChange?: ((value: MonitorSteps) => void) | undefined;
  onBlur?: () => void;
  initialValue?: MonitorSteps;
  monitorType: MonitorType;
  monitorName?: string | undefined; // this is used to prefill incident title and description. If not provided then it will be empty.
  monitorId?: ObjectID | undefined; // this is used to populate secrets when testing the monitor.
}

const MonitorStepsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorStatusDropdownOptions, setMonitorStatusDropdownOptions] =
    React.useState<Array<DropdownOption>>([]);

  const [incidentSeverityDropdownOptions, setIncidentSeverityDropdownOptions] =
    React.useState<Array<DropdownOption>>([]);

  const [alertSeverityDropdownOptions, setAlertSeverityDropdownOptions] =
    React.useState<Array<DropdownOption>>([]);

  const [onCallPolicyDropdownOptions, setOnCallPolicyDropdownOptions] =
    React.useState<Array<DropdownOption>>([]);

  const [probes, setProbes] = React.useState<Array<Probe>>([]);

  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>();

  useEffect(() => {
    setError(props.error);
  }, [props.error]);

  const fetchDropdownOptions: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const monitorStatusList: ListResult<MonitorStatus> =
        await ModelAPI.getList({
          modelType: MonitorStatus,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            isOperationalState: true,
            isOfflineState: true,
          },

          sort: {},
        });

      if (monitorStatusList.data) {
        setMonitorStatusDropdownOptions(
          monitorStatusList.data.map((i: MonitorStatus) => {
            return {
              value: i._id!,
              label: i.name!,
            };
          }),
        );
      }

      const incidentSeverityList: ListResult<IncidentSeverity> =
        await ModelAPI.getList({
          modelType: IncidentSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      const alertSeverityList: ListResult<AlertSeverity> =
        await ModelAPI.getList({
          modelType: AlertSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      const onCallPolicyList: ListResult<OnCallDutyPolicy> =
        await ModelAPI.getList({
          modelType: OnCallDutyPolicy,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
          },
          sort: {},
        });

      if (incidentSeverityList.data) {
        setIncidentSeverityDropdownOptions(
          incidentSeverityList.data.map((i: IncidentSeverity) => {
            return {
              value: i._id!,
              label: i.name!,
            };
          }),
        );
      }

      if (alertSeverityList.data) {
        setAlertSeverityDropdownOptions(
          alertSeverityList.data.map((i: AlertSeverity) => {
            return {
              value: i._id!,
              label: i.name!,
            };
          }),
        );
      }

      if (onCallPolicyList.data) {
        setOnCallPolicyDropdownOptions(
          onCallPolicyList.data.map((i: OnCallDutyPolicy) => {
            return {
              value: i._id!,
              label: i.name!,
            };
          }),
        );
      }

      // if there is no initial value then....

      if (!monitorSteps) {
        setMonitorSteps(
          MonitorSteps.getDefaultMonitorSteps({
            monitorType: props.monitorType,
            monitorName: props.monitorName || "",
            defaultMonitorStatusId: monitorStatusList.data.find(
              (i: MonitorStatus) => {
                return i.isOperationalState;
              },
            )!.id!,
            onlineMonitorStatusId: monitorStatusList.data.find(
              (i: MonitorStatus) => {
                return i.isOperationalState;
              },
            )!.id!,
            offlineMonitorStatusId: monitorStatusList.data.find(
              (i: MonitorStatus) => {
                return i.isOfflineState;
              },
            )!.id!,
            defaultIncidentSeverityId: incidentSeverityList.data[0]!.id!,
            defaultAlertSeverityId: alertSeverityList.data[0]!.id!,
          }),
        );
      }

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();
      setProbes(probes);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };
  useAsyncEffect(async () => {
    await fetchDropdownOptions();
  }, []);

  const [monitorSteps, setMonitorSteps] = React.useState<
    MonitorSteps | undefined
  >(props.initialValue ? MonitorSteps.fromJSON(props.initialValue) : undefined);

  useEffect(() => {
    if (monitorSteps && props.onChange) {
      props.onChange(monitorSteps);
    }

    if (props.onBlur) {
      props.onBlur();
    }
  }, [monitorSteps]);

  if (isLoading) {
    return <ComponentLoader></ComponentLoader>;
  }

  return (
    <div>
      {monitorSteps?.data?.monitorStepsInstanceArray?.map(
        (i: MonitorStep, index: number) => {
          return (
            <MonitorStepElement
              monitorType={props.monitorType}
              allMonitorSteps={monitorSteps}
              key={index}
              monitorStatusDropdownOptions={monitorStatusDropdownOptions}
              incidentSeverityDropdownOptions={incidentSeverityDropdownOptions}
              alertSeverityDropdownOptions={alertSeverityDropdownOptions}
              onCallPolicyDropdownOptions={onCallPolicyDropdownOptions}
              value={i}
              probes={probes}
              monitorId={props.monitorId}
              /*
               * onDelete={() => {
               *     // remove the criteria filter
               * const index: number | undefined =
               * monitorSteps.data?.monitorStepsInstanceArray.findIndex((item: MonitorStep) => {
               *     return item.data?.id === value.data?.id;
               * })
               */

              /*
               * if (index === undefined) {
               *     return;
               * }
               *     const newMonitorSteps: Array<MonitorStep> = [
               *         ...(monitorSteps.data
               *             ?.monitorStepsInstanceArray || []),
               *     ];
               *     newMonitorSteps.splice(index, 1);
               *     setMonitorSteps(
               *         new MonitorSteps().fromJSON({
               *             _type: 'MonitorSteps',
               *             value: {
               *                 monitorStepsInstanceArray:
               *                     newMonitorSteps,
               *             },
               *         })
               *     );
               * }}
               */
              onChange={(value: MonitorStep) => {
                const index: number | undefined =
                  monitorSteps.data?.monitorStepsInstanceArray.findIndex(
                    (item: MonitorStep) => {
                      return item.data?.id === value.data?.id;
                    },
                  );

                if (index === undefined) {
                  return;
                }

                const newMonitorSteps: Array<MonitorStep> = [
                  ...(monitorSteps.data?.monitorStepsInstanceArray || []),
                ];
                newMonitorSteps[index] = value;
                monitorSteps.setMonitorStepsInstanceArray(newMonitorSteps);
                setMonitorSteps(MonitorSteps.clone(monitorSteps));
              }}
            />
          );
        },
      )}

      {/* <Button
                title="Add Step"
                onClick={() => {
                    const newMonitorSteps: Array<MonitorStep> = [
                        ...(monitorSteps.data?.monitorStepsInstanceArray || []),
                    ];
                    newMonitorSteps.push(new MonitorStep());

                    monitorSteps.data = {
                        monitorStepsInstanceArray: newMonitorSteps,
                    };

                    setMonitorSteps(
                        new MonitorSteps().fromJSON(monitorSteps.toJSON())
                    );
                }}
            /> */}

      <HorizontalRule />

      <div className="mt-4">
        <FieldLabelElement
          title="Default Monitor Status"
          description="What should the monitor status be when none of the above criteria is met?"
          required={true}
        />

        <Dropdown
          value={monitorStatusDropdownOptions.find((i: DropdownOption) => {
            return (
              i.value ===
                monitorSteps?.data?.defaultMonitorStatusId?.toString() ||
              undefined
            );
          })}
          options={monitorStatusDropdownOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            monitorSteps?.setDefaultMonitorStatusId(
              value ? new ObjectID(value.toString()) : undefined,
            );
            setMonitorSteps(
              MonitorSteps.clone(monitorSteps || new MonitorSteps()),
            );
          }}
        />
      </div>

      {error ? (
        <div className="mt-4">
          <Alert title={error} type={AlertType.DANGER} />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default MonitorStepsElement;
