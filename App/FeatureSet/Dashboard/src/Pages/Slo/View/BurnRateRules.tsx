import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { Green, Red } from "Common/Types/BrandColors";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Pill from "Common/UI/Components/Pill/Pill";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Burn Rate Rules Work

A **burn rate** of 1 means the error budget is being spent exactly fast enough to run out at the end of the compliance window. A burn rate of 14.4 exhausts a 30-day budget in about 2 days.

A rule fires an **Alert** when the burn rate exceeds its threshold over **both** windows:

- The **long window** confirms the problem is sustained.
- The **short window** confirms it is still happening right now, so you are not paged for an outage that already ended.

---

### Recommended Defaults (Google SRE Workbook, 30-day window)

| Purpose | Threshold | Long Window | Short Window |
|---------|-----------|-------------|--------------|
| **Fast burn** (page) | 14.4× | 60 min | 5 min |
| **Slow burn** (warn) | 6× | 360 min | 30 min |

A fast-burn rule catches sudden outages within minutes; a slow-burn rule catches steady leaks that would quietly exhaust the budget over days. For other window lengths, scale the threshold proportionally.

---

### Other Settings

- **Minimum Sample Count** only applies to event-based SLIs — it stops a single failed request on a low-traffic service from firing a page.
- **Re-fire Suppression** is the quiet period after an alert resolves before the same rule may fire again.
- Alerts are created with the configured **severity** and attached **on-call duty policies**, so they page through your normal escalation.
`;

const SloBurnRateRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceLevelObjectiveBurnRateRule>
        modelType={ServiceLevelObjectiveBurnRateRule}
        id="slo-burn-rate-rules-table"
        name="SLO > Burn Rate Rules"
        userPreferencesKey="slo-burn-rate-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showRefreshButton={true}
        query={{
          serviceLevelObjectiveId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceLevelObjectiveBurnRateRule,
        ): Promise<ServiceLevelObjectiveBurnRateRule> => {
          item.serviceLevelObjectiveId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Burn Rate Rules",
          description:
            "Fire alerts when the error budget is being spent too fast. Rules alert only when both the long and short windows exceed the threshold.",
        }}
        helpContent={{
          title: "How Burn Rate Rules Work",
          description:
            "Understanding burn rates, fast/slow burn windows, and alerting",
          markdown: documentationMarkdown,
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Fast burn",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this burn rate rule.",
          },
          {
            field: {
              burnRateThreshold: true,
            },
            title: "Burn Rate Threshold",
            description:
              "Fire when the burn rate exceeds this value over both windows. 14.4 is the classic fast-burn threshold for a 30-day window.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "14.4",
          },
          {
            field: {
              longWindowInMinutes: true,
            },
            title: "Long Window (Minutes)",
            description:
              "Lookback that confirms the burn is sustained, e.g. 60 for fast burn or 360 for slow burn.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "60",
          },
          {
            field: {
              shortWindowInMinutes: true,
            },
            title: "Short Window (Minutes)",
            description:
              "Lookback that confirms the burn is still happening, e.g. 5 for fast burn or 30 for slow burn.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "5",
          },
          {
            field: {
              minimumSampleCount: true,
            },
            title: "Minimum Sample Count",
            description:
              "Only for event-based SLIs: skip this rule when the long window has fewer events than this.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "30",
          },
          {
            field: {
              refireSuppressionMinutes: true,
            },
            title: "Re-fire Suppression (Minutes)",
            description:
              "Quiet period after an alert resolves before this rule may fire again. Defaults to the long window.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
          },
          {
            field: {
              alertSeverity: true,
            },
            title: "Alert Severity",
            description: "Severity of the alert this rule creates.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Alert Severity",
          },
          {
            field: {
              onCallDutyPolicies: true,
            },
            title: "On-Call Duty Policies",
            description:
              "On-call policies to execute when this rule creates an alert.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select On-Call Policies (optional)",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              burnRateThreshold: true,
            },
            title: "Threshold",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              const threshold: number | undefined | null =
                item.burnRateThreshold;

              if (threshold === undefined || threshold === null) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-900">{threshold}×</span>
              );
            },
          },
          {
            field: {
              longWindowInMinutes: true,
            },
            title: "Windows (Long / Short)",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.longWindowInMinutes || 0}m / {""}
                  {item.shortWindowInMinutes || 0}m
                </span>
              );
            },
          },
          {
            field: {
              alertSeverity: {
                name: true,
              },
            },
            title: "Alert Severity",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              if (!item.alertSeverity?.name) {
                return <span className="text-sm text-gray-400">Default</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.alertSeverity.name}
                </span>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        selectMoreFields={{
          shortWindowInMinutes: true,
        }}
      />
    </Fragment>
  );
};

export default SloBurnRateRules;
