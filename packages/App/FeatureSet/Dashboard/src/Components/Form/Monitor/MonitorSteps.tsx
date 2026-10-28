import MonitorStepElement from "./MonitorStep";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
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
import {
  INCIDENT_ROLE_CHOICE_SELECT,
  toIncidentRoleChoice,
} from "../../IncidentRole/IncidentRoleAssignments";
import ProjectUtil from "Common/UI/Utils/Project";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorCriteriaAlignmentUtil, {
  CriteriaSeedIds,
  MonitorStepsAlignmentResult,
} from "../../../Utils/Form/Monitor/MonitorCriteriaAlignment";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import TelemetryAlertRuleUtil from "Common/Types/Monitor/TelemetryAlertRule";
import CriteriaNameUtil from "../../../Utils/Form/Monitor/CriteriaName";
import {
  applyRecipe,
  getDefaultRecipe,
  getRecipe,
  TelemetryRuleRecipe,
  TelemetryRuleRecipeKey,
  TelemetryRuleSeeds,
} from "../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import {
  applyTelemetryMonitorLinkQuery,
  getTelemetryMonitorLinkRecipeKey,
  TelemetryMonitorLinkQuery,
} from "../../../Utils/Form/Monitor/TelemetryRule/TelemetryMonitorLink";

export interface ComponentProps extends CustomElementProps {
  error?: string | undefined;
  onChange?: ((value: MonitorSteps) => void) | undefined;
  initialValue?: MonitorSteps;
  monitorType: MonitorType;
  isMonitorTemplate?: boolean | undefined;
  monitorName?: string | undefined; // this is used to prefill incident title and description. If not provided then it will be empty.
  monitorId?: ObjectID | undefined; // this is used to populate secrets when testing the monitor.
  /*
   * Fold each criteria to its one-line header (MonitorCriteria:
   * foldDefaultCriteria). Create Monitor turns it on.
   */
  foldDefaultCriteria?: boolean | undefined;
  /*
   * What a "Create monitor" link from the logs or traces explorer, or an
   * exception's page, shows (TelemetryMonitorLink): a new monitor of the
   * link's type starts watching just that, on the recipe that suits it.
   */
  seedQuery?: TelemetryMonitorLinkQuery | undefined;
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
   * The project's statuses and severities a telemetry rule is made with
   * (TelemetryRuleRecipes): the operational, degraded and offline statuses
   * and the most severe incident and alert severities.
   */
  const [ruleSeeds, setRuleSeeds] = React.useState<
    Omit<TelemetryRuleSeeds, "monitorName">
  >({});

  /*
   * Whether this form started a new monitor from nothing (no steps handed
   * in): only then does it offer a telemetry monitor's recipes.
   */
  const [isNewMonitor] = React.useState<boolean>(!props.initialValue);

  /*
   * The criteria a recipe seeded, as MonitorCriteriaAlignmentUtil
   * fingerprints them. While the step's criteria still read the same, they
   * are nobody's work: a change of monitor type seeds the new type afresh.
   */
  const recipeSeedFingerprintRef: React.MutableRefObject<string | null> =
    React.useRef<string | null>(null);

  /*
   * Whether the statuses and the rest have been fetched at least once.
   * isLoading alone cannot say: it starts out false, before the fetch has
   * even begun, when every status still looks missing.
   */
  const [hasLoadedOptions, setHasLoadedOptions] =
    React.useState<boolean>(false);
  // Why the statuses, severities or probes could not be read.
  const [loadError, setLoadError] = React.useState<string>();

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

  /*
   * A new monitor's steps: the type's out-of-the-box criteria, or - for a
   * Logs, Traces, Exceptions or Metrics monitor - the rule its first recipe
   * makes ("Too many errors"), with the part of the query it goes with.
   */
  const seedNewMonitorSteps: (data: {
    monitorType: MonitorType;
    seeds: Omit<TelemetryRuleSeeds, "monitorName">;
    criteriaSeedOptions: {
      defaultMonitorStatusId: ObjectID;
      onlineMonitorStatusId: ObjectID;
      offlineMonitorStatusId: ObjectID;
      defaultIncidentSeverityId: ObjectID;
      defaultAlertSeverityId: ObjectID;
      warningAlertSeverityId?: ObjectID | undefined;
    };
  }) => MonitorSteps = (data: {
    monitorType: MonitorType;
    seeds: Omit<TelemetryRuleSeeds, "monitorName">;
    criteriaSeedOptions: {
      defaultMonitorStatusId: ObjectID;
      onlineMonitorStatusId: ObjectID;
      offlineMonitorStatusId: ObjectID;
      defaultIncidentSeverityId: ObjectID;
      defaultAlertSeverityId: ObjectID;
      warningAlertSeverityId?: ObjectID | undefined;
    };
  }): MonitorSteps => {
    const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      monitorType: data.monitorType,
      monitorName: props.monitorName || "",
      ...data.criteriaSeedOptions,
    });

    const linkRecipeKey: TelemetryRuleRecipeKey | undefined = props.seedQuery
      ? getTelemetryMonitorLinkRecipeKey({
          monitorType: data.monitorType,
          query: props.seedQuery,
        })
      : undefined;

    const recipe: TelemetryRuleRecipe | null = linkRecipeKey
      ? getRecipe(linkRecipeKey)
      : getDefaultRecipe(data.monitorType);
    const firstStep: MonitorStep | undefined =
      steps.data?.monitorStepsInstanceArray[0];

    if (!recipe || !firstStep) {
      recipeSeedFingerprintRef.current = null;
      return steps;
    }

    const recipeStep: MonitorStep = applyRecipe({
      monitorStep: firstStep,
      recipe,
      seeds: { ...data.seeds, monitorName: props.monitorName || "" },
      translator: translator,
    });

    // What the link shows, over the recipe's part of the query.
    const seededStep: MonitorStep = props.seedQuery
      ? applyTelemetryMonitorLinkQuery({
          monitorType: data.monitorType,
          monitorStep: recipeStep,
          query: props.seedQuery,
        })
      : recipeStep;

    steps.setMonitorStepsInstanceArray([seededStep]);

    recipeSeedFingerprintRef.current = MonitorCriteriaAlignmentUtil.fingerprint(
      seededStep.data!.monitorCriteria,
    );

    return steps;
  };

  const fetchDropdownOptions: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);

    /*
     * Archived statuses, severities, labels and roles are never offered for
     * a new pick (Common/Utils/ArchivableValues): every list is read with
     * the archive switch, and only the archived values this monitor's saved
     * criteria already use are kept as options - so its form still shows
     * them, marked Archived and never offered for anything new.
     */
    const keptArchivedIds: (values: Array<BaseModel>) => Array<string> = (
      values: Array<BaseModel>,
    ): Array<string> => {
      /*
       * Read as text, whatever shape the steps arrived in: a saved monitor's
       * are a MonitorSteps (JSON.stringify calls its toJSON), and a prefilled
       * one's - Create Monitor from an AI insight, a link or a template -
       * are plain JSON, which has no toJSON() to call: calling it threw, and
       * the form drew "props.initialValue.toJSON is not a function" with no
       * statuses to pick from.
       */
      return ArchivedValuePicker.getIdsNamedIn(
        props.initialValue || null,
        values
          .filter((value: BaseModel): boolean => {
            return ArchivedValuePicker.isArchived(value);
          })
          .map((value: BaseModel): string => {
            return value._id?.toString() || "";
          }),
      );
    };

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
            isArchived: true,
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
          ArchivedValuePicker.getPickerOptions({
            values: monitorStatusList.data,
            options: DropdownUtil.getDropdownOptionsFromEntityArray({
              array: monitorStatusList.data,
              labelField: "name",
              valueField: "_id",
            }),
            keptIds: keptArchivedIds(monitorStatusList.data),
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
            isArchived: true,
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
            isArchived: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      // The severities a new criteria may take: the ones not archived.
      const liveIncidentSeverities: Array<IncidentSeverity> =
        ArchivedValuePicker.getLiveValues(incidentSeverityList.data || []);
      const liveAlertSeverities: Array<AlertSeverity> =
        ArchivedValuePicker.getLiveValues(alertSeverityList.data || []);

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
          ArchivedValuePicker.getPickerOptions({
            values: incidentSeverityList.data,
            options: DropdownUtil.getDropdownOptionsFromEntityArray({
              array: incidentSeverityList.data,
              labelField: "name",
              valueField: "_id",
            }),
            keptIds: keptArchivedIds(incidentSeverityList.data),
          }),
        );

        // Use the first (highest priority) live severity as default for templates
        if (
          liveIncidentSeverities.length > 0 &&
          liveIncidentSeverities[0]?._id
        ) {
          setDefaultIncidentSeverityId(
            new ObjectID(liveIncidentSeverities[0]._id),
          );
        }
      }

      if (alertSeverityList.data) {
        setAlertSeverityDropdownOptions(
          ArchivedValuePicker.getPickerOptions({
            values: alertSeverityList.data,
            options: DropdownUtil.getDropdownOptionsFromEntityArray({
              array: alertSeverityList.data,
              labelField: "name",
              valueField: "_id",
            }),
            keptIds: keptArchivedIds(alertSeverityList.data),
          }),
        );

        // Use the first (highest priority) live severity as default for templates
        if (liveAlertSeverities.length > 0 && liveAlertSeverities[0]?._id) {
          setDefaultAlertSeverityId(new ObjectID(liveAlertSeverities[0]._id));
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
          isArchived: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      if (labelList.data) {
        setLabelDropdownOptions(
          ArchivedValuePicker.getPickerOptions({
            values: labelList.data,
            options: DropdownUtil.getDropdownOptionsFromEntityArray({
              array: labelList.data,
              labelField: "name",
              valueField: "_id",
            }),
            keptIds: keptArchivedIds(labelList.data),
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

      /*
       * Fetch incident roles, once for every rule's incidents: each draws
       * the declare form's role picker, which reads what it shows of a role
       * - its icon and whether it is primary too.
       */
      const incidentRoleList: ListResult<IncidentRole> = await ModelAPI.getList(
        {
          modelType: IncidentRole,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: INCIDENT_ROLE_CHOICE_SELECT,
          sort: {
            isPrimaryRole: SortOrder.Descending,
            name: SortOrder.Ascending,
          },
        },
      );

      if (incidentRoleList.data) {
        /*
         * Every role, archived ones marked: each incident's picker shows an
         * archived role only where its criteria already assign it
         * (getPickableIncidentRoleChoices).
         */
        setIncidentRoleOptions(incidentRoleList.data.map(toIncidentRoleChoice));
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
        liveIncidentSeverities[0]?.id || undefined;

      const alertSeverityId: ObjectID | undefined =
        liveAlertSeverities[0]?.id || undefined;

      /*
       * The "expires soon" alert a new SSL Certificate or Domain monitor
       * starts with is a heads-up, so it takes the project's Warning alert
       * severity - the second one, "Low" on a new project - rather than the
       * most severe one every other default alert takes. The list is sorted
       * by order, so its position is its rank.
       */
      const warningAlertSeverityId: ObjectID | undefined =
        MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
          liveAlertSeverities
            .map((alertSeverity: AlertSeverity) => {
              return alertSeverity.id;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return Boolean(id);
            }),
        ).Warning || alertSeverityId;

      /*
       * The status a telemetry rule's monitor shows while an alert is open:
       * the first status between operational and offline, by priority
       * (Degraded on a new project).
       */
      const degradedStatusId: ObjectID | undefined =
        ArchivedValuePicker.getLiveValues(monitorStatusList.data || []).find(
          (status: MonitorStatus) => {
            return !status.isOperationalState && !status.isOfflineState;
          },
        )?.id || undefined;

      const seeds: Omit<TelemetryRuleSeeds, "monitorName"> = {
        operationalStatusId: operationalMonitorStatusId,
        degradedStatusId: degradedStatusId,
        offlineStatusId: offlineStatusId,
        incidentSeverityId: incidentSeverityId,
        alertSeverityId: alertSeverityId,
      };

      setRuleSeeds(seeds);

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
          seedNewMonitorSteps({
            monitorType: props.monitorType,
            seeds,
            criteriaSeedOptions: {
              defaultMonitorStatusId: operationalMonitorStatusId!,
              onlineMonitorStatusId: operationalMonitorStatusId!,
              offlineMonitorStatusId: offlineStatusId!,
              defaultIncidentSeverityId: incidentSeverityId!,
              defaultAlertSeverityId: alertSeverityId!,
              warningAlertSeverityId: warningAlertSeverityId,
            },
          }),
        );
      }

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();
      setProbes(probes);
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
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

  /*
   * Hands every change to the form. It no longer marks the field touched as
   * well: this runs when the steps are first drawn and when the defaults are
   * filled in, so a new monitor's criteria step opened on a red "Monitor
   * Destination is required." before anyone had typed a thing. The form
   * shows the step's problem when Next or the form's action is pressed
   * (BasicForm touches every field of the step then), and the destination
   * field still says what is wrong with an address as soon as it is left.
   */
  useEffect(() => {
    if (monitorSteps && props.onChange) {
      props.onChange(monitorSteps);
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

    /*
     * Still the rule a recipe seeded, untouched: nobody's work, so the new
     * type starts afresh, on its own recipe when it has one.
     */
    const firstStep: MonitorStep | undefined =
      monitorSteps.data?.monitorStepsInstanceArray[0];

    if (
      isNewMonitor &&
      recipeSeedFingerprintRef.current &&
      firstStep?.data?.monitorCriteria &&
      monitorSteps.data?.monitorStepsInstanceArray.length === 1 &&
      MonitorCriteriaAlignmentUtil.fingerprint(
        firstStep.data.monitorCriteria,
      ) === recipeSeedFingerprintRef.current
    ) {
      const reSeeded: MonitorSteps = seedNewMonitorSteps({
        monitorType: props.monitorType,
        seeds: ruleSeeds,
        criteriaSeedOptions: {
          defaultMonitorStatusId:
            monitorSteps.data?.defaultMonitorStatusId ||
            criteriaSeedIds.onlineMonitorStatusId,
          onlineMonitorStatusId: criteriaSeedIds.onlineMonitorStatusId,
          offlineMonitorStatusId: criteriaSeedIds.offlineMonitorStatusId,
          defaultIncidentSeverityId: criteriaSeedIds.defaultIncidentSeverityId,
          defaultAlertSeverityId: criteriaSeedIds.defaultAlertSeverityId,
          warningAlertSeverityId: criteriaSeedIds.warningAlertSeverityId,
        },
      });

      setMonitorSteps(reSeeded);
      return;
    }

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

  /*
   * The form's message for the steps, drawn in the same render that brings
   * it - not copied into state by an effect, a render later: after Next the
   * form looks for the message to bring into view in that render
   * (BringIntoView's bringFieldInErrorIntoView). Else why the lists could
   * not be read.
   */
  const error: string | undefined = props.error || loadError;

  /*
   * A telemetry monitor whose criteria read as one rule (TelemetryRuleEditor)
   * says "the rule", not "criteria", in the fold below it.
   */
  const firstMonitorStep: MonitorStep | undefined =
    monitorSteps?.data?.monitorStepsInstanceArray[0];

  const isOneRule: boolean = Boolean(
    firstMonitorStep &&
      monitorSteps?.data?.monitorStepsInstanceArray.length === 1 &&
      TelemetryAlertRuleUtil.read({
        monitorType: props.monitorType,
        monitorStep: firstMonitorStep,
        defaultMonitorStatusId: monitorSteps?.data?.defaultMonitorStatusId,
      }).rule,
  );

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
          ? isOneRule
            ? translator.translateTemplate(
                "When the rule does not match: {{status}}",
                {
                  status: translatableTerm(defaultMonitorStatusOption.label),
                },
              )
            : translator.translateTemplate(
                "When no criteria match: {{status}}",
                {
                  status: translatableTerm(defaultMonitorStatusOption.label),
                },
              )
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
              foldDefaultCriteria={props.foldDefaultCriteria}
              defaultMonitorStatusId={monitorSteps.data?.defaultMonitorStatusId}
              ruleSeeds={{
                ...ruleSeeds,
                monitorName: props.monitorName || "",
              }}
              offerRecipes={isNewMonitor}
              showErrors={Boolean(error)}
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
              description={
                isOneRule
                  ? "The monitor's status while the rule does not match."
                  : "What should the monitor status be when none of the above criteria is met?"
              }
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

      {/*
       * The field's error message, marked as every field's is: after Next or
       * Create, the form brings it into view (BringIntoView's
       * bringFieldInErrorIntoView), a screen or more below the steps' start.
       */}
      {error ? (
        <div className="mt-4">
          <Alert
            title={error}
            type={AlertType.DANGER}
            dataTestId="error-message"
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default MonitorStepsElement;
