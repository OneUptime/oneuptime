import MonitorStepElement from "./MonitorStep";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import API from "Common/UI/Utils/API/API";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Color from "Common/Types/Color";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
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
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import CriteriaNameUtil from "../../../Utils/Form/Monitor/CriteriaName";

export interface ComponentProps extends CustomElementProps {
  error?: string | undefined;
  onChange?: ((value: MonitorSteps) => void) | undefined;
  onBlur?: () => void;
  initialValue?: MonitorSteps;
  monitorType: MonitorType;
  isMonitorTemplate?: boolean | undefined;
  monitorName?: string | undefined; // this is used to prefill incident title and description. If not provided then it will be empty.
  monitorId?: ObjectID | undefined; // this is used to populate secrets when testing the monitor.
}

const MonitorStepsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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

  /*
   * Whether the statuses and the rest have been fetched at least once.
   * isLoading alone cannot say: it starts out false, before the fetch has
   * even begun, when every status still looks missing.
   */
  const [hasLoadedOptions, setHasLoadedOptions] =
    React.useState<boolean>(false);
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

  // Whether criteria that arrived without a name have been given one.
  const hasNamedUnnamedCriteriaRef: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  /*
   * The "More fields" section under the criteria, which holds the status
   * the monitor falls back to when no criteria match. Folded: a new monitor
   * falls back to its operational status, and the header says which status
   * it is, so nobody has to open it to know.
   */
  const [isAdvancedCollapsed, setIsAdvancedCollapsed] =
    React.useState<boolean>(true);

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
            color: true,
            isOperationalState: true,
            isOfflineState: true,
            priority: true,
          },

          sort: {
            priority: SortOrder.Ascending,
          },
        });

      /*
       * Statuses, severities and labels are offered with their colours, the
       * way every other picker of them shows them: "Change monitor status to"
       * reads as red for Offline before the name is read.
       */
      if (monitorStatusList.data) {
        setMonitorStatusDropdownOptions(
          DropdownUtil.getDropdownOptionsFromEntityArray({
            array: monitorStatusList.data,
            labelField: "name",
            valueField: "_id",
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
            color: true,
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
            color: true,
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
          DropdownUtil.getDropdownOptionsFromEntityArray({
            array: incidentSeverityList.data,
            labelField: "name",
            valueField: "_id",
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
          DropdownUtil.getDropdownOptionsFromEntityArray({
            array: alertSeverityList.data,
            labelField: "name",
            valueField: "_id",
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
          DropdownUtil.getDropdownOptionsFromEntityArray({
            array: labelList.data,
            labelField: "name",
            valueField: "_id",
          }),
        );
      }

      /*
       * Owners are picked with the people picker, which searches the
       * project's people and teams itself.
       */

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
       * The "expires soon" alert a new SSL Certificate or Domain monitor
       * starts with is a heads-up, so it takes the project's Warning alert
       * severity - the second one, "Low" on a new project - rather than the
       * most severe one every other default alert takes. The list is sorted
       * by order, so its position is its rank.
       */
      const warningAlertSeverityId: ObjectID | undefined =
        MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
          alertSeverityList.data
            .map((alertSeverity: AlertSeverity) => {
              return alertSeverity.id;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return Boolean(id);
            }),
        ).Warning || alertSeverityId;

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
          warningAlertSeverityId: warningAlertSeverityId,
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
            warningAlertSeverityId: warningAlertSeverityId,
          }),
        );
      }

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();
      setProbes(probes);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setHasLoadedOptions(true);
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

  /*
   * A criteria cannot be saved without a name, and one can arrive without:
   * the API never asked for one. Name those after their filters, once, when
   * the form has loaded - the same name "Add Criteria" gives a new one.
   *
   * Once only, never on later changes: a user clearing the name field to
   * type a new one must not get the old one back mid-edit. And through the
   * updater form, so it lands on top of whatever the alignment above has
   * just set in the same pass instead of overwriting it.
   */
  useEffect(() => {
    if (
      !hasLoadedOptions ||
      isLoading ||
      !monitorSteps ||
      hasNamedUnnamedCriteriaRef.current
    ) {
      return;
    }

    hasNamedUnnamedCriteriaRef.current = true;

    setMonitorSteps((current: MonitorSteps | undefined) => {
      if (!current) {
        return current;
      }

      return CriteriaNameUtil.nameUnnamedCriteria(current).monitorSteps;
    });
  }, [hasLoadedOptions, isLoading, monitorSteps]);

  /*
   * The status picked for when no criteria match, as one of the status
   * options. Missing when none is picked, or when the one picked has since
   * been deleted - either way the monitor cannot be saved until a status is
   * chosen, so the section opens by itself to show the field.
   */
  const defaultMonitorStatusOption: DropdownOption | undefined =
    monitorStatusDropdownOptions.find((i: DropdownOption) => {
      return i.value === monitorSteps?.data?.defaultMonitorStatusId?.toString();
    });

  const isDefaultMonitorStatusMissing: boolean = !defaultMonitorStatusOption;

  useEffect(() => {
    if (hasLoadedOptions && !isLoading && isDefaultMonitorStatusMissing) {
      setIsAdvancedCollapsed(false);
    }
  }, [hasLoadedOptions, isLoading, isDefaultMonitorStatusMissing]);

  if (isLoading) {
    return <ComponentLoader></ComponentLoader>;
  }

  const defaultMonitorStatusColor: string | undefined =
    defaultMonitorStatusOption?.color
      ? new Color(defaultMonitorStatusOption.color).toString()
      : undefined;

  // The line under the folded section's title: the status, in its colour.
  const defaultMonitorStatusSummary: ReactElement = (
    <span
      className="inline-flex max-w-full items-center gap-2"
      data-testid="monitor-default-status-summary"
    >
      {defaultMonitorStatusColor ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-none rounded-full"
          style={{
            backgroundColor: defaultMonitorStatusColor,
          }}
        ></span>
      ) : (
        <></>
      )}
      <span className="truncate">
        {defaultMonitorStatusOption
          ? translator.translateTemplate("When no criteria match: {{status}}", {
              status: translatableTerm(defaultMonitorStatusOption.label),
            })
          : translator.translateText("No default monitor status")}
      </span>
    </span>
  );

  return (
    <div>
      {monitorSteps?.data?.monitorStepsInstanceArray?.map(
        (i: MonitorStep, index: number) => {
          return (
            <MonitorStepElement
              monitorType={props.monitorType}
              isMonitorTemplate={props.isMonitorTemplate}
              allMonitorSteps={monitorSteps}
              key={index}
              monitorStatusDropdownOptions={monitorStatusDropdownOptions}
              incidentSeverityDropdownOptions={incidentSeverityDropdownOptions}
              alertSeverityDropdownOptions={alertSeverityDropdownOptions}
              onCallPolicyDropdownOptions={onCallPolicyDropdownOptions}
              labelDropdownOptions={labelDropdownOptions}
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

      {/*
       * Rarely changed, so folded under More fields: what the monitor shows
       * when none of the criteria above match. It used to sit open under
       * every criteria list as a required field, already filled in.
       *
       * Drawn once the statuses are in, so its header never flashes "No
       * default monitor status" on the frame before they are fetched.
       */}
      {hasLoadedOptions ? (
        <FoldedSection
          title={MORE_FIELDS_SECTION_TITLE}
          icon={MORE_SECTION_ICON}
          // The gap MonitorStep leaves between its own sections (space-y-6).
          className="mt-6"
          isCollapsed={isAdvancedCollapsed}
          onToggle={(isCollapsed: boolean) => {
            setIsAdvancedCollapsed(isCollapsed);
          }}
          summary={defaultMonitorStatusSummary}
          dataTestId="monitor-criteria-more-fields"
        >
          <div data-testid="monitor-default-status-field">
            <FieldLabelElement
              title="Default Monitor Status"
              description="What should the monitor status be when none of the above criteria is met?"
              required={true}
            />

            <Dropdown
              value={defaultMonitorStatusOption}
              options={monitorStatusDropdownOptions}
              error={
                isDefaultMonitorStatusMissing
                  ? translator.translateText(
                      "Pick the status the monitor shows when no criteria match.",
                    )
                  : undefined
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                monitorSteps?.setDefaultMonitorStatusId(
                  value ? new ObjectID(value.toString()) : undefined,
                );
                setMonitorSteps(
                  MonitorSteps.clone(monitorSteps || new MonitorSteps()),
                );
              }}
            />
          </div>
        </FoldedSection>
      ) : (
        <></>
      )}

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
