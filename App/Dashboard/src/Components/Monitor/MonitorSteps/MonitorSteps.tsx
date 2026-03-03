import MonitorStepElement from "./MonitorStep";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Icon from "Common/UI/Components/Icon/Icon";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";

export interface ComponentProps extends CustomElementProps {
  monitorSteps: MonitorSteps;
  monitorType: MonitorType;
}

const MonitorStepsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorStatusOptions, setMonitorStatusOptions] = React.useState<
    Array<MonitorStatus>
  >([]);

  const [incidentSeverityOptions, setIncidentSeverityOptions] = React.useState<
    Array<IncidentSeverity>
  >([]);

  const [alertSeverityOptions, setAlertSeverityOptions] = React.useState<
    Array<AlertSeverity>
  >([]);

  const [onCallPolicyOptions, setOnCallPolicyOptions] = React.useState<
    Array<OnCallDutyPolicy>
  >([]);

  const [labelOptions, setLabelOptions] = React.useState<Array<Label>>([]);

  const [teamOptions, setTeamOptions] = React.useState<Array<Team>>([]);

  const [userOptions, setUserOptions] = React.useState<Array<User>>([]);

  const [incidentRoleOptions, setIncidentRoleOptions] = React.useState<
    Array<IncidentRole>
  >([]);

  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>("");

  const [defaultMonitorStatus, setDefaultMonitorStatus] = useState<
    MonitorStatus | undefined
  >(undefined);

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
            color: true,
            isOperationalState: true,
          },
          sort: {},
        });

      if (monitorStatusList.data) {
        setMonitorStatusOptions(monitorStatusList.data);
        setDefaultMonitorStatus(
          monitorStatusList.data.find((status: MonitorStatus) => {
            return status?.isOperationalState;
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
            color: true,
          },
          sort: {},
        });

      const alertSeverityList: ListResult<AlertSeverity> =
        await ModelAPI.getList({
          modelType: AlertSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            color: true,
          },
          sort: {},
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
        setIncidentSeverityOptions(
          incidentSeverityList.data as Array<IncidentSeverity>,
        );
      }

      if (alertSeverityList.data) {
        setAlertSeverityOptions(alertSeverityList.data as Array<AlertSeverity>);
      }

      if (onCallPolicyList.data) {
        setOnCallPolicyOptions(
          onCallPolicyList.data as Array<OnCallDutyPolicy>,
        );
      }

      const labelList: ListResult<Label> = await ModelAPI.getList({
        modelType: Label,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
          color: true,
        },
        sort: {},
      });

      if (labelList.data) {
        setLabelOptions(labelList.data as Array<Label>);
      }

      const teamList: ListResult<Team> = await ModelAPI.getList({
        modelType: Team,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
        },
        sort: {},
      });

      if (teamList.data) {
        setTeamOptions(teamList.data as Array<Team>);
      }

      const userList: ListResult<User> = await ModelAPI.getList({
        modelType: User,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
          email: true,
        },
        sort: {},
      });

      if (userList.data) {
        setUserOptions(userList.data as Array<User>);
      }

      const incidentRoleList: ListResult<IncidentRole> = await ModelAPI.getList(
        {
          modelType: IncidentRole,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            color: true,
            canAssignMultipleUsers: true,
          },
          sort: {},
        },
      );

      if (incidentRoleList.data) {
        setIncidentRoleOptions(incidentRoleList.data as Array<IncidentRole>);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };
  useAsyncEffect(async () => {
    await fetchDropdownOptions();
  }, []);

  if (isLoading) {
    return <ComponentLoader></ComponentLoader>;
  }

  if (!props.monitorSteps) {
    return <div>Monitor Criteria not defined for this resource.</div>;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div>
      {props.monitorSteps.data?.monitorStepsInstanceArray.map(
        (i: MonitorStep, index: number) => {
          return (
            <MonitorStepElement
              monitorType={props.monitorType}
              key={index}
              monitorStatusOptions={monitorStatusOptions}
              incidentSeverityOptions={incidentSeverityOptions}
              alertSeverityOptions={alertSeverityOptions}
              monitorStep={i}
              onCallPolicyOptions={onCallPolicyOptions}
              labelOptions={labelOptions}
              teamOptions={teamOptions}
              userOptions={userOptions}
              incidentRoleOptions={incidentRoleOptions}
            />
          );
        },
      )}

      <div className="mt-4 ml-0.5">
        <div className="flex">
          <Icon icon={IconProp.AltGlobe} className="h-5 w-5 text-gray-900" />
          <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
            <span className="font-medium text-gray-900">
              Default Monitor Status
            </span>{" "}
            When no criteria is met, monitor status should be:
            <div className="mt-3">
              {props.monitorSteps.data?.defaultMonitorStatusId && (
                <Statusbubble
                  color={
                    (monitorStatusOptions.find((option: IncidentSeverity) => {
                      return (
                        option.id?.toString() ===
                        props.monitorSteps.data?.defaultMonitorStatusId?.toString()
                      );
                    })?.color as Color) || Black
                  }
                  shouldAnimate={false}
                  text={
                    (monitorStatusOptions.find((option: IncidentSeverity) => {
                      return (
                        option.id?.toString() ===
                        props.monitorSteps.data?.defaultMonitorStatusId?.toString()
                      );
                    })?.name as string) || ""
                  }
                />
              )}

              {!props.monitorSteps.data?.defaultMonitorStatusId &&
                defaultMonitorStatus && (
                  <Statusbubble
                    color={defaultMonitorStatus.color!}
                    text={defaultMonitorStatus.name!}
                    shouldAnimate={false}
                  />
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonitorStepsElement;
