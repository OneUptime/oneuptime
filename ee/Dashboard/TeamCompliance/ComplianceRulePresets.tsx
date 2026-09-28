import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "Common/Types/Team/ComplianceRule";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The rules most teams want first, one click from an empty page. A preset
 * never creates anything by itself: it opens the rule form already filled in,
 * so the admin sees - and can change - exactly what is about to be enforced
 * before it is. "Critical" is not a name every project uses (the default alert
 * severities are High and Low), so the "critical" presets preselect whatever
 * this project ranks most severe.
 */
export interface ComplianceRulePreset {
  id: string;
  title: string;
  description: string;
  icon: IconProp;
  ruleType: ComplianceRuleType;
  notificationChannel?: ComplianceNotificationChannel | undefined;
  // Preselect the most severe severity of this kind.
  mostSevere?: ComplianceSeverityKind | undefined;
}

export const COMPLIANCE_RULE_PRESETS: ReadonlyArray<ComplianceRulePreset> = [
  {
    id: "call-for-critical-incidents",
    title: "Call for critical incidents",
    description:
      "Every member has an incident on-call rule that phones them for your most severe incidents.",
    icon: IconProp.Call,
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    notificationChannel: ComplianceNotificationChannel.Call,
    mostSevere: ComplianceSeverityKind.Incident,
  },
  {
    id: "push-for-critical-alerts",
    title: "Push for critical alerts",
    description:
      "Every member gets a push notification when your most severe alerts page them.",
    icon: IconProp.DevicePhoneMobile,
    ruleType: ComplianceRuleType.HasAlertOnCallRules,
    notificationChannel: ComplianceNotificationChannel.Push,
    mostSevere: ComplianceSeverityKind.Alert,
  },
  {
    id: "incident-rules-for-every-severity",
    title: "Incident on-call rules for every severity",
    description:
      "Every member is notified, on any channel, for every incident severity - including ones added later.",
    icon: IconProp.Alert,
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
  },
  {
    id: "verified-phone-for-calls",
    title: "Verified phone for calls",
    description: "Every member has a verified phone number that can be called.",
    icon: IconProp.Phone,
    ruleType: ComplianceRuleType.HasNotificationCallMethod,
  },
];

/*
 * The id of the project's most severe severity of a kind (the lowest
 * `order`), or null when there is none or it cannot be read - a viewer
 * without permission to list severities, say. The preset then opens with no
 * severity preselected, which the form reads as "every severity" and the
 * admin can narrow.
 */
export const getMostSevereSeverityId: (
  kind: ComplianceSeverityKind,
) => Promise<string | null> = async (
  kind: ComplianceSeverityKind,
): Promise<string | null> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  try {
    if (kind === ComplianceSeverityKind.Alert) {
      const result: ListResult<AlertSeverity> =
        await ModelAPI.getList<AlertSeverity>({
          modelType: AlertSeverity,
          query: projectId ? { projectId: projectId } : {},
          limit: 1,
          skip: 0,
          select: { _id: true, name: true, order: true },
          sort: { order: SortOrder.Ascending },
        });

      return result.data[0]?._id?.toString() || null;
    }

    const result: ListResult<IncidentSeverity> =
      await ModelAPI.getList<IncidentSeverity>({
        modelType: IncidentSeverity,
        query: projectId ? { projectId: projectId } : {},
        limit: 1,
        skip: 0,
        select: { _id: true, name: true, order: true },
        sort: { order: SortOrder.Ascending },
      });

    return result.data[0]?._id?.toString() || null;
  } catch {
    return null;
  }
};

export const getPresetInitialValues: (
  preset: ComplianceRulePreset,
) => Promise<FormValues<TeamComplianceSetting>> = async (
  preset: ComplianceRulePreset,
): Promise<FormValues<TeamComplianceSetting>> => {
  const values: FormValues<TeamComplianceSetting> = {
    ruleType: preset.ruleType,
    enabled: true,
  };

  if (preset.notificationChannel) {
    values.notificationChannel = preset.notificationChannel;
  }

  if (preset.mostSevere) {
    const severityId: string | null = await getMostSevereSeverityId(
      preset.mostSevere,
    );

    /*
     * Ids, the shape the form itself loads an existing rule's severities in
     * (ModelForm turns each into a model on submit).
     */
    if (severityId && preset.mostSevere === ComplianceSeverityKind.Alert) {
      values.alertSeverities = [severityId];
    }

    if (severityId && preset.mostSevere === ComplianceSeverityKind.Incident) {
      values.incidentSeverities = [severityId];
    }
  }

  return values;
};

export interface ComponentProps {
  onChoose: (initialValues: FormValues<TeamComplianceSetting>) => void;
}

const ComplianceRulePresets: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [loadingPresetId, setLoadingPresetId] = useState<string>("");

  return (
    <section
      aria-labelledby="compliance-presets-heading"
      data-testid="compliance-presets"
      className="mt-6"
    >
      <h3
        id="compliance-presets-heading"
        className="text-xs font-semibold uppercase tracking-wide text-gray-400"
      >
        Recommended rules
      </h3>
      <p className="mt-1 text-sm text-gray-500">
        Start from one of these. Nothing is saved until you review it and press
        Add rule.
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {COMPLIANCE_RULE_PRESETS.map(
          (preset: ComplianceRulePreset): ReactElement => {
            const isLoading: boolean = loadingPresetId === preset.id;

            return (
              <li key={preset.id}>
                <button
                  type="button"
                  data-testid={`compliance-preset-${preset.id}`}
                  aria-busy={isLoading}
                  disabled={Boolean(loadingPresetId)}
                  onClick={async () => {
                    setLoadingPresetId(preset.id);

                    try {
                      const values: FormValues<TeamComplianceSetting> =
                        await getPresetInitialValues(preset);
                      props.onChoose(values);
                    } finally {
                      setLoadingPresetId("");
                    }
                  }}
                  className="group flex h-full w-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                    <Icon
                      icon={isLoading ? IconProp.Spinner : preset.icon}
                      className={`h-4 w-4 text-indigo-600 ${
                        isLoading ? "animate-spin" : ""
                      }`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900">
                      {preset.title}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-gray-500">
                      {preset.description}
                    </span>
                  </span>
                  <Icon
                    icon={IconProp.ChevronRight}
                    className="mt-2 h-4 w-4 flex-shrink-0 text-gray-300 transition-colors group-hover:text-indigo-500"
                  />
                </button>
              </li>
            );
          },
        )}
      </ul>
    </section>
  );
};

export default ComplianceRulePresets;
