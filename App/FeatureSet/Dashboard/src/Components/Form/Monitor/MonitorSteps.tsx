import MonitorStepElement from "./MonitorStep";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
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
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import useAsyncEffect from "use-async-effect";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeUtil from "../../../Utils/Probe";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import MonitorCriteriaAlignmentUtil, {
  CriteriaSeedIds,
  MonitorStepsAlignmentResult,
} from "../../../Utils/Form/Monitor/MonitorCriteriaAlignment";

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

  const [labelDropdownOptions, setLabelDropdownOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [teamDropdownOptions, setTeamDropdownOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [userDropdownOptions, setUserDropdownOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [incidentRoleOptions, setIncidentRoleOptions] = React.useState<
    Array<IncidentRoleOption>
  >([]);

  const [probes, setProbes] = React.useState<Array<Probe>>([]);

  // IDs needed for Kubernetes template criteria
  const [onlineMonitorStatusId, setOnlineMonitorStatusId] = React.useState<
    ObjectID | undefined
  >(undefined);
  const [offlineMonitorStatusId, setOfflineMonitorStatusId] = React.useState<
    ObjectID | undefined
  >(undefined);
  const [defaultIncidentSeverityId, setDefaultIncidentSeverityId] =
    React.useState<ObjectID | undefined>(undefined);
  const [defaultAlertSeverityId, setDefaultAlertSeverityId] = React.useState<
    ObjectID | undefined
  >(undefined);

  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>();

  /*
   * The status and severity ids the criteria were (or would have been)
   * seeded with. Held in a ref rather than state because the effect that
   * re-seeds criteria after a monitor type change needs them in the same
   * tick they are fetched.
   */
  const criteriaSeedIdsRef: React.MutableRefObject<
    CriteriaSeedIds | undefined
  > = React.useRef<CriteriaSeedIds | undefined>(undefined);

  // The monitor type the criteria currently on screen have been aligned to.
  const alignedMonitorTypeRef: React.MutableRefObject<MonitorType | undefined> =
    React.useRef<MonitorType | undefined>(undefined);

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

        // Extract online (operational) and offline status IDs for template criteria
        const onlineStatus: MonitorStatus | undefined =
          monitorStatusList.data.find((i: MonitorStatus) => {
            return i.isOperationalState;
          });
        const offlineStatus: MonitorStatus | undefined =
          monitorStatusList.data.find((i: MonitorStatus) => {
            return i.isOfflineState;
          });

        if (onlineStatus?._id) {
          setOnlineMonitorStatusId(new ObjectID(onlineStatus._id));
        }
        if (offlineStatus?._id) {
          setOfflineMonitorStatusId(new ObjectID(offlineStatus._id));
        }
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

        // Use the first (highest priority) severity as default for templates
        if (
          incidentSeverityList.data.length > 0 &&
          incidentSeverityList.data[0]?._id
        ) {
          setDefaultIncidentSeverityId(
            new ObjectID(incidentSeverityList.data[0]._id),
          );
        }
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

        // Use the first (highest priority) severity as default for templates
        if (
          alertSeverityList.data.length > 0 &&
          alertSeverityList.data[0]?._id
        ) {
          setDefaultAlertSeverityId(
            new ObjectID(alertSeverityList.data[0]._id),
          );
        }
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

      // Fetch labels
      const labelList: ListResult<Label> = await ModelAPI.getList({
        modelType: Label,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
          color: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      if (labelList.data) {
        setLabelDropdownOptions(
          labelList.data.map((i: Label) => {
            return {
              value: i._id!,
              label: i.name!,
            };
          }),
        );
      }

      // Fetch teams
      const teamList: ListResult<Team> = await ModelAPI.getList({
        modelType: Team,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      if (teamList.data) {
        setTeamDropdownOptions(
          teamList.data.map((i: Team) => {
            return {
              value: i._id!,
              label: i.name!,
            };
          }),
        );
      }

      // Fetch users
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (projectId) {
        const userOptions: Array<DropdownOption> =
          await ProjectUser.fetchProjectUsersAsDropdownOptions(projectId);
        setUserDropdownOptions(userOptions);
      }

      // Fetch incident roles
      const incidentRoleList: ListResult<IncidentRole> = await ModelAPI.getList(
        {
          modelType: IncidentRole,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            color: true,
            canAssignMultipleUsers: true,
          },
          sort: {
            isPrimaryRole: SortOrder.Descending,
            name: SortOrder.Ascending,
          },
        },
      );

      if (incidentRoleList.data) {
        setIncidentRoleOptions(
          incidentRoleList.data.map((i: IncidentRole) => {
            return {
              id: i._id!,
              name: i.name || "Unknown Role",
              color: i.color?.toString(),
              canAssignMultipleUsers: i.canAssignMultipleUsers || false,
            };
          }),
        );
      }

      const operationalMonitorStatusId: ObjectID | undefined =
        monitorStatusList.data.find((i: MonitorStatus) => {
          return i.isOperationalState;
        })?.id || undefined;

      const offlineStatusId: ObjectID | undefined =
        monitorStatusList.data.find((i: MonitorStatus) => {
          return i.isOfflineState;
        })?.id || undefined;

      const incidentSeverityId: ObjectID | undefined =
        incidentSeverityList.data[0]?.id || undefined;

      const alertSeverityId: ObjectID | undefined =
        alertSeverityList.data[0]?.id || undefined;

      /*
       * Remember what the out-of-the-box criteria for a monitor type would
       * be seeded with, so the alignment effect below can tell criteria the
       * user has edited from criteria that are still untouched defaults.
       */
      if (
        operationalMonitorStatusId &&
        offlineStatusId &&
        incidentSeverityId &&
        alertSeverityId
      ) {
        criteriaSeedIdsRef.current = {
          onlineMonitorStatusId: operationalMonitorStatusId,
          offlineMonitorStatusId: offlineStatusId,
          defaultIncidentSeverityId: incidentSeverityId,
          defaultAlertSeverityId: alertSeverityId,
        };
      }

      // if there is no initial value then....

      if (!monitorSteps) {
        setMonitorSteps(
          MonitorSteps.getDefaultMonitorSteps({
            monitorType: props.monitorType,
            monitorName: props.monitorName || "",
            defaultMonitorStatusId: operationalMonitorStatusId!,
            onlineMonitorStatusId: operationalMonitorStatusId!,
            offlineMonitorStatusId: offlineStatusId!,
            defaultIncidentSeverityId: incidentSeverityId!,
            defaultAlertSeverityId: alertSeverityId!,
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

  /*
   * Monitor type is picked on an earlier step of the create form than the
   * criteria are, and the criteria step's fields are unmounted while the
   * user is on another step. So the criteria handed back to us can have
   * been seeded for a monitor type the user has since changed their mind
   * about: their filters name checks the new type does not offer, and the
   * "Filter Type" dropdown renders an empty "Select..." over a rule the
   * server would never match.
   *
   * Bring them back in line with the monitor type - re-seeding criteria
   * that are still untouched defaults, and repairing only the unusable
   * filters of criteria the user has edited. Criteria that already suit
   * the monitor type come back untouched, so this is a no-op on the
   * ordinary path (including opening an existing monitor's criteria).
   */
  useEffect(() => {
    const criteriaSeedIds: CriteriaSeedIds | undefined =
      criteriaSeedIdsRef.current;

    if (isLoading || !monitorSteps || !criteriaSeedIds) {
      return;
    }

    if (alignedMonitorTypeRef.current === props.monitorType) {
      return;
    }

    alignedMonitorTypeRef.current = props.monitorType;

    const result: MonitorStepsAlignmentResult =
      MonitorCriteriaAlignmentUtil.alignMonitorStepsWithMonitorType({
        monitorSteps: monitorSteps,
        monitorType: props.monitorType,
        seedOptions: {
          ...criteriaSeedIds,
          monitorName: props.monitorName || "",
        },
      });

    if (result.didChange) {
      setMonitorSteps(result.monitorSteps);
    }
  }, [props.monitorType, isLoading, monitorSteps]);

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
              key={i.data?.id || index}
              monitorStatusDropdownOptions={monitorStatusDropdownOptions}
              incidentSeverityDropdownOptions={incidentSeverityDropdownOptions}
              alertSeverityDropdownOptions={alertSeverityDropdownOptions}
              onCallPolicyDropdownOptions={onCallPolicyDropdownOptions}
              labelDropdownOptions={labelDropdownOptions}
              teamDropdownOptions={teamDropdownOptions}
              userDropdownOptions={userDropdownOptions}
              incidentRoleOptions={incidentRoleOptions}
              value={i}
              probes={probes}
              monitorId={props.monitorId}
              onlineMonitorStatusId={onlineMonitorStatusId}
              offlineMonitorStatusId={offlineMonitorStatusId}
              defaultIncidentSeverityId={defaultIncidentSeverityId}
              defaultAlertSeverityId={defaultAlertSeverityId}
              monitorName={props.monitorName}
              onChange={(value: MonitorStep) => {
                const index: number | undefined =
                  monitorSteps.data?.monitorStepsInstanceArray.findIndex(
                    (item: MonitorStep) => {
                      return item.data?.id === value.data?.id;
                    },
                  );

                if (index === undefined || index < 0) {
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

      <div className="mt-5 grid grid-cols-1 items-center gap-3 border-t border-gray-200 pt-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div>
          <FieldLabelElement
            title="Default status"
            description="Use this status when no enabled rule matches."
            required={true}
          />
        </div>

        <Dropdown
          ariaLabel="Default status"
          isClearable={false}
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
