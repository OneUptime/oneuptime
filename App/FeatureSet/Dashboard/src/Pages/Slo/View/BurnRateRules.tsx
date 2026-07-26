import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import {
  canSloFireBurnRateAlerts,
  isBurnRateRuleFiring,
} from "Common/Utils/Slo/SloBurnRateRuleState";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const documentationMarkdown: string = `
### How Burn Rate Rules Work

A **burn rate** of 1 means the error budget is being spent exactly fast enough to run out at the end of the compliance window. A burn rate of 14.4 exhausts a 30-day budget in about 2 days.

A rule fires an **Alert** when the burn rate exceeds its threshold over **both** windows:

- The **long window** confirms the problem is sustained.
- The **short window** confirms it is still happening right now, so you are not paged for an outage that already ended.

---

### The Rules You Already Have

Every SLO is created with two rules, with thresholds scaled to its compliance window:

| Rule | Meaning | Long Window | Short Window | 30-day threshold |
|------|---------|-------------|--------------|------------------|
| **Fast burn** (page) | 2% of the budget in an hour | 60 min | 5 min | 14.4× |
| **Slow burn** (warn) | 5% of the budget in six hours | 360 min | 30 min | 6× |

Route the fast-burn rule to a paging on-call policy at a high severity, and let the slow-burn rule raise a lower-severity alert for working-hours follow-up.

---

### Other Settings

- A rule cannot fire until the SLO has at least a full long window of monitoring history, so a brand-new monitor cannot page you on its first blip. That means a fresh SLO will not fire Fast burn for its first hour, or Slow burn for its first six.
- **Re-fire Suppression** is the quiet period after an alert resolves before the same rule may fire again. It defaults to the long window.
- Alerts are created with the configured **severity** and attached **on-call duty policies**, so they page through your normal escalation.
- While any monitor on the SLO is under an active scheduled maintenance window, alert creation is suppressed — planned work should not page anyone.
`;

/*
 * Client-side mirrors of ServiceLevelObjectiveBurnRateRuleService's
 * validators. The server compares the two windows and rejects
 * short >= long, but that only surfaced after a failed round-trip that
 * re-rendered the raw exception — and the windows are exactly the pair a
 * user is most likely to transpose.
 */
export type ValidateBurnRateWindowsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateWindows: ValidateBurnRateWindowsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  const longWindow: number = Number(value.longWindowInMinutes);
  const shortWindow: number = Number(value.shortWindowInMinutes);

  if (!isFinite(longWindow) || !isFinite(shortWindow)) {
    return null;
  }

  if (shortWindow >= longWindow) {
    return "The short window must be shorter than the long window.";
  }

  return null;
};

export type ValidateBurnRateThresholdFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateThreshold: ValidateBurnRateThresholdFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  const threshold: number = Number(value.burnRateThreshold);

  if (!isFinite(threshold) || threshold <= 0) {
    return "The burn rate threshold must be greater than 0.";
  }

  return null;
};

const SloBurnRateRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * Whether the owning SLO could have a rule firing at all. A rule's own
   * lastAlertCreatedAt/lastAlertResolvedAt columns are left mid-lifecycle
   * when the SLO-level resolve paths close its alerts (they deliberately
   * do not stamp the resolve), so reading them alone would pin a red
   * "Firing" pill on a rule with nothing open. Defaults to true so a
   * failed or in-flight fetch never hides a genuinely firing rule.
   */
  const [canFire, setCanFire] = useState<boolean>(true);

  useEffect(() => {
    let cancelled: boolean = false;

    const fetchSlo: PromiseVoidFunction = async (): Promise<void> => {
      try {
        const slo: ServiceLevelObjective | null =
          await ModelAPI.getItem<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            id: modelId,
            select: {
              isEnabled: true,
              sloStatus: true,
            },
          });

        if (!cancelled && slo) {
          setCanFire(canSloFireBurnRateAlerts(slo));
        }
      } catch {
        // Keep the optimistic default; the notice banner owns real errors.
      }
    };

    fetchSlo().catch(() => {
      // Handled above.
    });

    return () => {
      cancelled = true;
    };
  }, [modelId.toString()]);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
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
        noItemsMessage="No burn rate rules on this SLO — nothing will page anyone when the error budget starts burning. Create a fast-burn rule to get paged before the budget runs out."
        helpContent={{
          title: "How Burn Rate Rules Work",
          description:
            "Understanding burn rates, fast/slow burn windows, and alerting",
          markdown: documentationMarkdown,
        }}
        documentationLink={new Route("/docs/slo/burn-rate-alerts")}
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
            customValidation: validateBurnRateThreshold,
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
            validation: {
              minValue: 1,
            },
          },
          {
            field: {
              shortWindowInMinutes: true,
            },
            title: "Short Window (Minutes)",
            description:
              "Lookback that confirms the burn is still happening, e.g. 5 for fast burn or 30 for slow burn. Must be shorter than the long window.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "5",
            validation: {
              minValue: 1,
            },
            customValidation: validateBurnRateWindows,
          },
          /*
           * Minimum Sample Count is intentionally absent. It only guards
           * event-based (Metric) SLIs, which OneUptime does not evaluate
           * yet — the worker never reads the column, so offering the knob
           * promised a noise guard that does nothing. The column and its
           * server-side validation remain for that later phase.
           */
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
            validation: {
              minValue: 1,
            },
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
              /*
               * The worker falls back to the long window when no explicit
               * suppression is set, so show the effective value rather
               * than a blank that reads as "no suppression".
               */
              const suppressionMinutes: number =
                item.refireSuppressionMinutes ?? item.longWindowInMinutes ?? 0;

              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {item.longWindowInMinutes || 0}m / {""}
                    {item.shortWindowInMinutes || 0}m
                  </div>
                  <div className="text-xs text-gray-500">
                    Suppress {suppressionMinutes}m after resolve
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              lastAlertCreatedAt: true,
            },
            title: "Alert Status",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              if (canFire && isBurnRateRuleFiring(item)) {
                return <Pill color={Red} text="Firing" size={PillSize.Small} />;
              }

              if (!item.lastAlertCreatedAt) {
                return (
                  <span className="text-sm text-gray-400">Never fired</span>
                );
              }

              const lastAlertCreatedAt: Date = OneUptimeDate.fromString(
                item.lastAlertCreatedAt,
              );

              return (
                <span
                  className="text-sm text-gray-900"
                  title={OneUptimeDate.getDateAsLocalFormattedString(
                    lastAlertCreatedAt,
                  )}
                >
                  Last fired {OneUptimeDate.fromNow(lastAlertCreatedAt)}
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
              onCallDutyPolicies: {
                name: true,
              },
            },
            title: "On-Call Policies",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              const policies: Array<OnCallDutyPolicy> =
                (item.onCallDutyPolicies as Array<OnCallDutyPolicy>) || [];

              if (policies.length === 0) {
                /*
                 * A rule with no policy still creates an Alert, but nothing
                 * escalates it — worth saying, because "I have a fast-burn
                 * rule" is usually shorthand for "I will get paged".
                 */
                return (
                  <span className="text-sm text-gray-400">No escalation</span>
                );
              }

              return (
                <span className="text-sm text-gray-900">
                  {policies
                    .map((policy: OnCallDutyPolicy) => {
                      return policy.name || "";
                    })
                    .filter(Boolean)
                    .join(", ")}
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
              return <Pill color={Gray500} text="Disabled" />;
            },
          },
        ]}
        /*
         * Read by getElement callbacks above but not owned by a column of
         * their own: without these the cells silently render their fallback.
         */
        selectMoreFields={{
          shortWindowInMinutes: true,
          refireSuppressionMinutes: true,
          lastAlertResolvedAt: true,
        }}
      />
    </Fragment>
  );
};

export default SloBurnRateRules;
