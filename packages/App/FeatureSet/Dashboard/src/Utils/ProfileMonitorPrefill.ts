import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
  PROFILE_MONITOR_FUNCTION_MAX_LENGTH,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import ObjectID from "Common/Types/ObjectID";
import {
  getGlobalTranslator,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ProfileCategory,
  getProfileCategory,
  getQueryProfileTypes,
  isProfileCategory,
} from "Common/Utils/Profiles/ProfileTypes";
import { LlmMonitorSeedIds } from "./LlmMonitorPrefill";
import {
  PROFILE_KIND_NOUNS,
  PROFILE_MONITOR_QUERY_PARAMS,
} from "./ProfilesView";

/*
 * MONITOR CREATE, OPENED FROM THE PROFILER.
 *
 * The function panel's "Alert me when its share passes 25%" links to
 * Monitor Create with the service, the function, the kind of profile and
 * the threshold (ProfilesView.buildProfileMonitorRoute). This reads that
 * link and builds the monitor from it: a Profiles monitor of the service,
 * reading the kind over five minutes, whose Function Share criteria raises
 * an alert (which resolves itself) and marks the monitor degraded while
 * the function takes more than the threshold - and its healthy mirror,
 * which brings it back.
 *
 * An alert, not an incident: a function growing heavier is worth a look,
 * and rarely an outage. The incident is filled in and switched off, so a
 * team that wants to page on it flips one switch.
 *
 * Pure: everything it needs is handed in, so every rule is pinned by tests
 * without mounting the page.
 */

export interface ProfileMonitorLink {
  serviceId?: string | undefined;
  functionName: string;
  // A kind ("cpu") or one raw type.
  profileType: string;
  // 1-99: the share, in percent, the alert fires above.
  threshold: number;
}

export const PROFILE_MONITOR_NAME: string = translationKey(
  "{{function}}: share of the {{kind}}",
);
export const PROFILE_MONITOR_DESCRIPTION: string = translationKey(
  "Alerts when {{function}} takes more than {{threshold}} of the {{kind}}.",
);
export const PROFILE_MONITOR_HEALTHY_NAME: string = translationKey(
  "Within its usual share",
);
export const PROFILE_MONITOR_HEALTHY_DESCRIPTION: string = translationKey(
  "The function takes no more than its usual share.",
);
export const PROFILE_MONITOR_UNHEALTHY_DESCRIPTION: string = translationKey(
  "{{function}} takes more than {{threshold}} of the {{kind}}.",
);

// Raw type names: letters, digits and "_", "-", ".", ":".
const PROFILE_TYPE_PATTERN_MAX: number = 64;

function isProfileTypeText(value: string): boolean {
  if (!value || value.length > PROFILE_TYPE_PATTERN_MAX) {
    return false;
  }

  for (const character of value) {
    const isAllowed: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === "_" ||
      character === "-" ||
      character === "." ||
      character === ":";

    if (!isAllowed) {
      return false;
    }
  }

  return true;
}

/*
 * The link's monitor, or null when the address is not one: a function is
 * needed; a service id that is not one, a kind this build does not know or
 * a threshold out of range is read as its default (every service, CPU
 * time, 25%).
 */
export function readProfileMonitorLink(
  getParam: (name: string) => string | null,
): ProfileMonitorLink | null {
  const functionName: string = (
    getParam(PROFILE_MONITOR_QUERY_PARAMS.functionName) || ""
  ).trim();

  if (
    !functionName ||
    functionName.length > PROFILE_MONITOR_FUNCTION_MAX_LENGTH
  ) {
    return null;
  }

  const link: ProfileMonitorLink = {
    functionName,
    profileType: ProfileCategory.Cpu,
    threshold: 25,
  };

  const serviceId: string = (
    getParam(PROFILE_MONITOR_QUERY_PARAMS.serviceId) || ""
  ).trim();

  if (serviceId && ObjectID.isValidUUID(serviceId)) {
    link.serviceId = serviceId;
  }

  const profileType: string = (
    getParam(PROFILE_MONITOR_QUERY_PARAMS.profileType) || ""
  ).trim();

  if (isProfileTypeText(profileType)) {
    link.profileType = profileType;
  }

  const threshold: number = Number(
    getParam(PROFILE_MONITOR_QUERY_PARAMS.threshold),
  );

  if (Number.isFinite(threshold) && threshold >= 1 && threshold <= 99) {
    link.threshold = Math.round(threshold * 10) / 10;
  }

  return link;
}

// The kind the link reads, as its sentences name it.
export function getProfileMonitorKind(
  link: ProfileMonitorLink,
): ProfileCategory {
  return isProfileCategory(link.profileType)
    ? link.profileType
    : getProfileCategory(link.profileType);
}

// The step: the service's profiles of the kind, over five minutes.
export function buildProfileMonitorStep(
  link: ProfileMonitorLink,
): MonitorStepProfileMonitor {
  return {
    ...MonitorStepProfileMonitorUtil.getDefault(),
    profileTypes: getQueryProfileTypes(link.profileType) || [],
    telemetryServiceIds: link.serviceId ? [new ObjectID(link.serviceId)] : [],
    functionName: link.functionName,
  };
}

function words(
  link: ProfileMonitorLink,
  translator: Translator,
): { name: string; description: string; unhealthy: string } {
  const values: {
    function: string;
    threshold: string;
    kind: ReturnType<typeof translatableTerm>;
  } = {
    function: link.functionName,
    threshold: `${link.threshold}%`,
    kind: translatableTerm(PROFILE_KIND_NOUNS[getProfileMonitorKind(link)], {
      inSentence: true,
    }),
  };

  return {
    name: translator.translateTemplate(PROFILE_MONITOR_NAME, values),
    description: translator.translateTemplate(
      PROFILE_MONITOR_DESCRIPTION,
      values,
    ),
    unhealthy: translator.translateTemplate(
      PROFILE_MONITOR_UNHEALTHY_DESCRIPTION,
      values,
    ),
  };
}

export function buildProfileMonitorCriteria(data: {
  link: ProfileMonitorLink;
  seeds: LlmMonitorSeedIds;
  translator?: Translator | undefined;
}): MonitorCriteria {
  const translator: Translator = data.translator || getGlobalTranslator();
  const text: { name: string; description: string; unhealthy: string } = words(
    data.link,
    translator,
  );

  const incidentSeverityId: ObjectID | null =
    MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
      data.seeds.rankedIncidentSeverityIds,
    )["Warning"] || null;
  const alertSeverityId: ObjectID | null =
    MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
      data.seeds.rankedAlertSeverityIds,
    )["Warning"] || null;

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.unhealthyMonitorStatusId || undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.ProfileFunctionShare,
        filterType: FilterType.GreaterThan,
        value: data.link.threshold,
      },
    ],
    incidents: incidentSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: text.name,
            description: text.unhealthy,
            incidentSeverityId: incidentSeverityId,
            autoResolveIncident: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    alerts: alertSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: text.name,
            description: text.unhealthy,
            alertSeverityId: alertSeverityId,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: Boolean(data.seeds.unhealthyMonitorStatusId),
    createIncidents: false,
    createAlerts: Boolean(alertSeverityId),
    isEnabled: true,
    name: text.name,
    description: text.unhealthy,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.operationalMonitorStatusId || undefined,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.ProfileFunctionShare,
        filterType: FilterType.LessThanOrEqualTo,
        value: data.link.threshold,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: Boolean(data.seeds.operationalMonitorStatusId),
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name:
      translator.translateText(PROFILE_MONITOR_HEALTHY_NAME) ||
      PROFILE_MONITOR_HEALTHY_NAME,
    description:
      translator.translateText(PROFILE_MONITOR_HEALTHY_DESCRIPTION) ||
      PROFILE_MONITOR_HEALTHY_DESCRIPTION,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

// Monitor Create's initial values for the link.
export function buildProfileMonitorPrefill(data: {
  link: ProfileMonitorLink;
  seeds: LlmMonitorSeedIds;
  translator?: Translator | undefined;
}): JSONObject | null {
  const translator: Translator = data.translator || getGlobalTranslator();
  const monitorSteps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!step?.data) {
    return null;
  }

  step.setProfileMonitor(buildProfileMonitorStep(data.link));
  step.setMonitorCriteria(
    buildProfileMonitorCriteria({
      link: data.link,
      seeds: data.seeds,
      translator,
    }),
  );

  // A prefilled MonitorSteps must carry its default status itself.
  if (data.seeds.operationalMonitorStatusId) {
    monitorSteps.setDefaultMonitorStatusId(
      data.seeds.operationalMonitorStatusId,
    );
  }

  const text: { name: string; description: string; unhealthy: string } = words(
    data.link,
    translator,
  );

  return {
    name: text.name,
    description: text.description,
    monitorType: MonitorType.Profiles,
    monitorSteps: monitorSteps.toJSON(),
  };
}
