import PageComponentProps from "../../PageComponentProps";
import {
  BURN_RATE_RULE_FORM_STEPS,
  BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE,
  describeBurnRateOutputOptions,
  describeBurnRateOutputs,
  getBurnRateRuleFormFields,
  willCreateAlert,
  willDeclareIncident,
} from "../Utils/BurnRateRuleForm";
import { isRequestSliType } from "Common/Utils/Slo/SloRequestSli";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import SloRecommendedBurnRateRulesBanner from "../../../Components/Slo/SloRecommendedBurnRateRulesBanner";
import SloRecommendedBurnRateRulesModal from "../../../Components/Slo/SloRecommendedBurnRateRulesModal";
import useSloRecommendedBurnRateRules, {
  UseSloRecommendedBurnRateRulesResult,
} from "../../../Components/Slo/useSloRecommendedBurnRateRules";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import {
  canSloFireBurnRateRules,
  isBurnRateRuleFiring,
} from "Common/Utils/Slo/SloBurnRateRuleState";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";
import { StateListType } from "Common/Utils/StateOrder";
import {
  BURN_RATE_RULE_NOTHING_PICKED,
  BurnRateRuleWindowsText,
  formatBurnRateRuleMinimumRequests,
  formatBurnRateRuleWindows,
  getNamesOrNothingPicked,
  getSeverityOrNothingPicked,
} from "../Utils/BurnRateRuleLines";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const documentationMarkdown: string = `
A burn rate rule watches how fast this SLO spends its error budget. When the budget is going too fast, the rule opens an alert, declares an incident, or both. Every SLO starts with three of them.

## The Rules Every SLO Starts With

| Rule | Fires when | Long window | Short window | Threshold at 30 days |
|------|------------|-------------|--------------|----------------------|
| **Fast burn** (page) | 2% of the budget goes in an hour | 60 min | 5 min | 14.4× |
| **Slow burn** (page) | 5% of the budget goes in six hours | 360 min | 30 min | 6× |
| **Slow leak** (ticket) | 10% of the budget goes in three days | 4320 min | 360 min | 1× |

- Fast burn and Slow burn open their alerts at the project's most severe alert severity. Slow leak opens its alert at the least severe one, at most once a day: a slow leak is for working hours, not for waking anyone up. None of them declares an incident until you turn that on.
- Send Fast burn to an on-call policy that pages, and keep Slow leak as a ticket for the team that owns the SLO.
- On an SLO shorter than 30 days, Slow leak looks back a tenth of the window instead of three days (16.8 hours on a 7-day SLO), so it still fires at 1×.

An SLO missing one of these rules shows a note above the table. **Add recommended rules** in the note shows what it will add, and adds only the missing rules. A rule counts as there when the SLO has one with the same name or the same long window, so a renamed or tuned rule is never added twice. To stop being offered a rule you do not want, disable it instead of deleting it.

## When a Rule Fires

A burn rate of 1 spends the budget exactly over the SLO's period; 14.4 spends a 30-day budget in about 2 days. A rule fires when the burn rate is above its threshold over both of its windows:

- the **long window**, which shows the burn is sustained;
- the **short window**, which shows it is still happening, so nobody is paged for an outage that has already ended.

A rule waits for one full long window of history: on a new SLO, Fast burn can fire after an hour, Slow burn after six hours and Slow leak after three days. While any monitor of the SLO is in a scheduled maintenance event, its rules do not fire. On a request SLO, **Minimum Requests** keeps a rule quiet while its long window holds fewer requests, so a quiet hour with one failure pages nobody.

## Alerts and Incidents

Each rule opens an **alert**, declares an **incident**, or both. An alert lands in the alert inbox and runs the on-call policies you give it. An incident gets a number, its own on-call policies and the whole response workflow: notes, timeline and postmortem.

The two are set up separately: each has its own title, description, severity, on-call policies, owners, labels, privacy and auto-resolve. A short alert can go to a team's rotation and a detailed incident to the major-incident rotation. A blank severity is the project's most severe one.

Both list this SLO as an affected resource, so they show on its Alerts and Incidents pages. A burn rate incident is never published to status pages or sent to subscribers: a fast burn is an engineering signal, not an outage you have declared.

## The Title and Description

Leave them empty to use the built-in text, which names the SLO and the rule, and gives the burn rates, the threshold and the error budget left.

To write your own, use these variables in the title, the description and the remediation notes. They are filled in when the rule fires:

${BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE}

A misspelled variable is left as written, so you see the typo in the alert instead of losing the value without a word.

## Owners, Labels and Privacy

- **Owner teams and users** are added to the alert or incident when it is created, and are notified.
- **Add SLO Owners as Owners** adds this SLO's owners as well. They already hear about its status changes, so they may be told twice.
- **Labels** are added to the alert or incident, so filters, owner rules and workspace notification rules can match it.
- A **private** alert or incident is seen only by its owners, Project Admins and Project Owners.

## Resolving and Firing Again

- With **Auto Resolve** on (the default), the rule resolves its alert or incident once the burn rate over the long window is back under the threshold. With it off, it stays open until someone resolves it, and the rule opens no second one meanwhile.
- After an alert or incident resolves, the rule waits its **Re-fire Suppression** before opening that one again: one long window, or 24 hours for Slow leak. The alert and the incident each wait from their own resolve.
- Resolved by hand while the budget is still burning, it is not opened again until the burn recovers and the rule fires again.
- Disabling the rule, turning an output off, deleting the rule, or disabling, archiving or deleting the SLO resolves whatever the rule has open.

## Creating a Rule

| Step | What you set |
|------|--------------|
| **Rule** | Its name, and whether it is enabled |
| **Burn Window** | The threshold, the long and short windows, and the re-fire suppression |
| **What It Declares** | An alert, an incident or both, and whether the SLO's owners are added as owners |
| **Alert** | Its title and severity, with its description, owners, labels, on-call policies and advanced options folded |
| **Incident** | The same for the incident |

The Alert and Incident steps appear only for what the rule declares. A new rule starts with a title and a description you can change.
`;

/*
 * The form's pure half lives in a React-free sibling: App has no react, and
 * a node test that wants these functions must be able to import them
 * without pulling this page - and the whole component graph - into App's
 * program. Re-exported here so importers of the page are unchanged.
 * See Pages/Slo/Utils/BurnRateRuleForm.
 */
export {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_FORM_STEPS,
  BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE,
  describeBurnRateOutputOptions,
  describeBurnRateOutputs,
  validateBurnRateOutputs,
  validateBurnRateThreshold,
  validateBurnRateWindows,
  willCreateAlert,
  willDeclareIncident,
} from "../Utils/BurnRateRuleForm";
export type {
  BurnRateRuleOptionFlags,
  BurnRateRuleOutputFlags,
  DescribeBurnRateOutputOptionsFunction,
  DescribeBurnRateOutputsFunction,
  ReadsBurnRateOutputFlagFunction,
  ValidateBurnRateOutputsFunction,
  ValidateBurnRateThresholdFunction,
  ValidateBurnRateWindowsFunction,
} from "../Utils/BurnRateRuleForm";

type RenderLinesFunction = (lines: Array<string>) => ReactElement;

// One line per output, or a dash when the rule declares nothing that applies.
const renderLines: RenderLinesFunction = (
  lines: Array<string>,
): ReactElement => {
  if (lines.length === 0) {
    return <TableEmptyValue />;
  }

  return (
    <div>
      {lines.map((line: string) => {
        return (
          <div key={line} className="text-sm text-gray-900">
            {line}
          </div>
        );
      })}
    </div>
  );
};

type DescribeOwnersFunction = (
  teams: Array<Team> | undefined,
  users: Array<User> | undefined,
  translator: Translator,
) => string;

const describeOwners: DescribeOwnersFunction = (
  teams: Array<Team> | undefined,
  users: Array<User> | undefined,
  translator: Translator,
): string => {
  // Each name as the line says it, or the reader's word for none.
  return getNamesOrNothingPicked(
    [
      ...(teams || []).map((team: Team): string => {
        return team.name || "";
      }),
      ...(users || []).map((user: User): string => {
        return user.name?.toString() || user.email?.toString() || "";
      }),
    ],
    BURN_RATE_RULE_NOTHING_PICKED.owners,
    translator,
  );
};

const SloBurnRateRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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

  /*
   * An archived SLO is not evaluated, so its rules never fire: the note
   * offering the recommended ones is not drawn there. Null until the SLO is
   * read, so the note never flashes on an archived SLO's page first.
   */
  const [isArchived, setIsArchived] = useState<boolean | null>(null);

  /*
   * A request SLO's rules can skip a quiet window (#8442): its form asks
   * for Minimum Requests, and the table says a rule's minimum.
   */
  const [isRequestSlo, setIsRequestSlo] = useState<boolean>(false);
  // A Metric SLO's rule counts its metric's events (#8445).
  const [isMetricSlo, setIsMetricSlo] = useState<boolean>(false);

  /*
   * "Add recommended rules": offered in a note above the table while the SLO
   * is missing one of the rules OneUptime recommends (an SLO created before
   * Slow leak existed, or one whose rule was deleted), with a confirmation
   * of exactly what it adds. Nothing is added by itself, so upgrading never
   * starts raising alerts.
   */
  const recommended: UseSloRecommendedBurnRateRulesResult =
    useSloRecommendedBurnRateRules(modelId);
  const [isRecommendedModalOpen, setIsRecommendedModalOpen] =
    useState<boolean>(false);
  const [isAddingRecommended, setIsAddingRecommended] =
    useState<boolean>(false);
  const [addRecommendedError, setAddRecommendedError] = useState<string>("");
  const [rulesRefreshToggle, setRulesRefreshToggle] = useState<string>("");

  const addRecommendedRules: PromiseVoidFunction = async (): Promise<void> => {
    setIsAddingRecommended(true);
    setAddRecommendedError("");

    try {
      await recommended.addMissingRules();
      setIsRecommendedModalOpen(false);
    } catch (err) {
      setAddRecommendedError(API.getFriendlyMessage(err));
    }

    setIsAddingRecommended(false);
    // The table reads its rows again, and with them what is still missing.
    setRulesRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
  };

  // Locked with the reason, like the table's own Create button.
  const createGate: PermissionGateResult = PermissionGate.check(
    new ServiceLevelObjectiveBurnRateRule(),
    ModelAction.Create,
  );

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
              isArchived: true,
              sliType: true,
            },
          });

        if (!cancelled && slo) {
          setCanFire(canSloFireBurnRateRules(slo));
          setIsArchived(slo.isArchived === true);
          setIsRequestSlo(isRequestSliType(slo.sliType));
          setIsMetricSlo(slo.sliType === SliType.Metric);
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
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id="slo-burn-rate-rules-table"
        name="SLO > Burn Rate Rules"
        userPreferencesKey="slo-burn-rate-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        /*
         * Show ID in each row's ⋯ menu: a workflow that turns a feature flag
         * off when this rule fires is told which rule by its ID (#8447).
         */
        showViewIdButton={true}
        showRefreshButton={true}
        refreshToggle={rulesRefreshToggle}
        topContent={
          <SloRecommendedBurnRateRulesBanner
            rules={isArchived === false ? recommended.missingRules : []}
            createGate={createGate}
            onAdd={() => {
              setAddRecommendedError("");
              setIsRecommendedModalOpen(true);
            }}
          />
        }
        onFetchSuccess={(
          rules: Array<ServiceLevelObjectiveBurnRateRule>,
          totalCount: number,
        ) => {
          recommended.onRulesFetched(rules, totalCount);
        }}
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
            "Raise alerts and declare incidents when the error budget is being spent too fast. Rules fire only when both the long and short windows exceed the threshold.",
        }}
        noItemsMessage="No burn rate rules yet, so nothing pages anyone when the error budget burns. Add a fast-burn rule."
        helpContent={{
          title: "How Burn Rate Rules Work",
          description:
            "Get alerted, or open an incident, when this SLO's error budget burns too fast.",
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
        createEditModalWidth={ModalWidth.Large}
        formSteps={BURN_RATE_RULE_FORM_STEPS}
        formFields={getBurnRateRuleFormFields({
          isRequestSlo: isRequestSlo,
          isMetricSlo: isMetricSlo,
        })}
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
              // "14,4×" in German, as the rule's card on the Overview writes it.
              const threshold: string | null = formatSloBurnRate(
                item.burnRateThreshold,
                translator,
              );

              if (threshold === null) {
                return <TableEmptyValue />;
              }
              return <span className="text-sm text-gray-900">{threshold}</span>;
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
              // "۶۰ دقیقه / ۵ دقیقه" in Persian, beside its "۱۴٫۴×".
              const windows: BurnRateRuleWindowsText =
                formatBurnRateRuleWindows(item, translator);

              // "At least 100 requests" ("events" for a Metric SLO), for a rule that has one.
              const minimumRequests: string | null =
                isRequestSlo || isMetricSlo
                  ? formatBurnRateRuleMinimumRequests(
                      item.minimumSampleCount,
                      translator,
                      isMetricSlo,
                    )
                  : null;

              return (
                <div>
                  <div className="text-sm text-gray-900">{windows.windows}</div>
                  <div className="text-xs text-gray-500">
                    {windows.suppression}
                  </div>
                  {minimumRequests ? (
                    <div
                      className="text-xs text-gray-500"
                      data-testid="burn-rate-rule-minimum-requests"
                    >
                      {minimumRequests}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              shouldCreateAlert: true,
            },
            title: "Declares",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              /*
               * The options that change what a responder sees - a record that
               * stays open until resolved by hand, or one most of the project
               * cannot see - are listed under the label, because nothing else
               * in the row would reveal them.
               */
              const options: Array<string> =
                describeBurnRateOutputOptions(item);

              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {translator.translateText(describeBurnRateOutputs(item))}
                  </div>
                  {options.map((option: string) => {
                    return (
                      <div key={option} className="text-xs text-gray-500">
                        {translator.translateText(option)}
                      </div>
                    );
                  })}
                </div>
              );
            },
          },
          {
            field: {
              lastAlertCreatedAt: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              if (canFire && isBurnRateRuleFiring(item)) {
                return <Pill color={Red} text="Firing" size={PillSize.Small} />;
              }

              /*
               * "Last fired" is the most recent of the two lifecycles: an
               * incident-only rule has no lastAlertCreatedAt at all, and a
               * rule switched from one output to the other has both — the
               * later one is the one the reader means.
               */
              const firedAtCandidates: Array<Date> = [
                item.lastAlertCreatedAt,
                item.lastIncidentCreatedAt,
              ]
                .filter((firedAt: Date | undefined): boolean => {
                  return Boolean(firedAt);
                })
                .map((firedAt: Date | undefined): Date => {
                  return OneUptimeDate.fromString(firedAt!);
                });

              if (firedAtCandidates.length === 0) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Never fired")}
                  </span>
                );
              }

              const lastFiredAt: Date = firedAtCandidates.reduce(
                (latest: Date, candidate: Date): Date => {
                  return candidate.getTime() > latest.getTime()
                    ? candidate
                    : latest;
                },
              );

              return (
                <span
                  className="text-sm text-gray-900"
                  title={OneUptimeDate.getDateAsLocalFormattedString(
                    lastFiredAt,
                  )}
                >
                  {translator.translateTemplate("Last fired {{time}}", {
                    time: OneUptimeDate.fromNow(lastFiredAt),
                  })}
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
            title: "Severity",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              /*
               * One cell for both outputs, labelled, and only for the outputs
               * the rule actually declares — an incident-only rule showing an
               * "Alert Severity" column reads as a promise of an alert that
               * will never arrive.
               */
              const lines: Array<string> = [];

              if (willCreateAlert(item)) {
                lines.push(
                  translator.translateTemplate(
                    "Alert: {{severity}}",
                    {
                      severity: getSeverityOrNothingPicked(
                        StateListType.AlertSeverity,
                        item.alertSeverity?.name,
                        translator,
                      ),
                    },
                    // A Latin name stays in order on a right-to-left page.
                    { setsValuesApart: true },
                  ),
                );
              }

              if (willDeclareIncident(item)) {
                lines.push(
                  translator.translateTemplate(
                    "Incident: {{severity}}",
                    {
                      severity: getSeverityOrNothingPicked(
                        StateListType.IncidentSeverity,
                        item.incidentSeverity?.name,
                        translator,
                      ),
                    },
                    { setsValuesApart: true },
                  ),
                );
              }

              return renderLines(lines);
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
              const describePolicies: (
                policies: Array<OnCallDutyPolicy> | undefined,
              ) => string = (
                policies: Array<OnCallDutyPolicy> | undefined,
              ): string => {
                const names: Array<string> = (policies || []).map(
                  (policy: OnCallDutyPolicy): string => {
                    return policy.name || "";
                  },
                );

                /*
                 * A rule with no policy still declares its alert or incident,
                 * but nothing escalates it — worth saying, because "I have a
                 * fast-burn rule" is usually shorthand for "I will get paged".
                 */
                return getNamesOrNothingPicked(
                  names,
                  BURN_RATE_RULE_NOTHING_PICKED.onCallPolicies,
                  translator,
                );
              };

              const lines: Array<string> = [];

              if (willCreateAlert(item)) {
                lines.push(
                  translator.translateTemplate("Alert: {{policies}}", {
                    policies: describePolicies(
                      item.onCallDutyPolicies as Array<OnCallDutyPolicy>,
                    ),
                  }),
                );
              }

              if (willDeclareIncident(item)) {
                lines.push(
                  translator.translateTemplate("Incident: {{policies}}", {
                    policies: describePolicies(
                      item.incidentOnCallDutyPolicies as Array<OnCallDutyPolicy>,
                    ),
                  }),
                );
              }

              return renderLines(lines);
            },
          },
          {
            field: {
              alertOwnerTeams: {
                name: true,
              },
            },
            title: "Owners",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              /*
               * Per output, like the severity and on-call cells: owners are
               * configured per output, and the pair routinely differs.
               */
              const lines: Array<string> = [];

              if (willCreateAlert(item)) {
                lines.push(
                  translator.translateTemplate("Alert: {{owners}}", {
                    owners: describeOwners(
                      item.alertOwnerTeams,
                      item.alertOwnerUsers,
                      translator,
                    ),
                  }),
                );
              }

              if (willDeclareIncident(item)) {
                lines.push(
                  translator.translateTemplate("Incident: {{owners}}", {
                    owners: describeOwners(
                      item.incidentOwnerTeams,
                      item.incidentOwnerUsers,
                      translator,
                    ),
                  }),
                );
              }

              if (lines.length > 0 && item.addSloOwnersAsOwners === true) {
                lines.push(translator.translateTemplate("+ SLO owners"));
              }

              return renderLines(lines);
            },
          },
          {
            field: {
              alertLabels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (
              item: ServiceLevelObjectiveBurnRateRule,
            ): ReactElement => {
              /*
               * One set of chips for both outputs, deduplicated: a label is
               * the same label whichever record carries it, and two identical
               * chips side by side read as a rendering bug.
               */
              const labels: Array<Label> = [];
              const seenLabelKeys: Set<string> = new Set<string>();

              const addLabels: (
                candidates: Array<Label> | undefined,
              ) => void = (candidates: Array<Label> | undefined): void => {
                for (const label of candidates || []) {
                  const key: string = label.id?.toString() || label.name || "";

                  if (!key || seenLabelKeys.has(key)) {
                    continue;
                  }

                  seenLabelKeys.add(key);
                  labels.push(label);
                }
              };

              if (willCreateAlert(item)) {
                addLabels(item.alertLabels);
              }

              if (willDeclareIncident(item)) {
                addLabels(item.incidentLabels);
              }

              if (labels.length === 0) {
                return <TableEmptyValue />;
              }

              return <LabelsElement labels={labels} />;
            },
          },
          {
            field: {
              isEnabled: true,
            },
            /*
             * "Enabled", not "Status": the Status column above now reports the
             * rule's firing lifecycle, and two columns called Status in one
             * table is a coin toss for the reader. This one renders the
             * Enabled/Disabled pill, so it is named for what it shows.
             */
            title: "Enabled",
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
          // A request SLO's "At least 100 requests" (#8442).
          minimumSampleCount: true,
          shouldCreateIncident: true,
          isAlertPrivate: true,
          autoResolveAlert: true,
          isIncidentPrivate: true,
          autoResolveIncident: true,
          addSloOwnersAsOwners: true,
          lastAlertResolvedAt: true,
          lastIncidentCreatedAt: true,
          lastIncidentResolvedAt: true,
          incidentSeverity: {
            name: true,
          },
          incidentOnCallDutyPolicies: {
            name: true,
          },
          alertOwnerUsers: {
            name: true,
            email: true,
          },
          incidentOwnerTeams: {
            name: true,
          },
          incidentOwnerUsers: {
            name: true,
            email: true,
          },
          incidentLabels: {
            name: true,
            color: true,
          },
        }}
      />
      {isRecommendedModalOpen ? (
        <SloRecommendedBurnRateRulesModal
          rules={recommended.missingRules}
          isLoading={isAddingRecommended}
          error={addRecommendedError}
          onSubmit={() => {
            addRecommendedRules().catch(() => {
              // addRecommendedRules handles its own errors.
            });
          }}
          onClose={() => {
            setIsRecommendedModalOpen(false);
            setAddRecommendedError("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SloBurnRateRules;
