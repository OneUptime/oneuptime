import PageComponentProps from "../../PageComponentProps";
import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_FORM_STEPS,
  BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE,
  describeBurnRateOutputOptions,
  describeBurnRateOutputs,
  willCreateAlert,
  willDeclareIncident,
  withOwnerUserDropdownOptions,
} from "../Utils/BurnRateRuleForm";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ProjectUser from "../../../Utils/ProjectUser";
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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
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

const documentationMarkdown: string = `
### How Burn Rate Rules Work

A **burn rate** of 1 means the error budget is being spent exactly fast enough to run out at the end of the compliance window. A burn rate of 14.4 exhausts a 30-day budget in about 2 days.

A rule fires when the burn rate exceeds its threshold over **both** windows:

- The **long window** confirms the problem is sustained.
- The **short window** confirms it is still happening right now, so you are not paged for an outage that already ended.

---

### What a Rule Declares

Each rule can raise an **Alert**, declare an **Incident**, or both — and it must do at least one of the two.

- An **Alert** is the lightweight signal: it lands in the alert inbox and runs whatever on-call policies you attach to it.
- An **Incident** is the heavyweight one: it takes an incident number, runs its own on-call policies, and carries the whole response workflow (notes, timeline, postmortem).

The two are independent. Each has its own title, description, severity, on-call policies, owners, labels, privacy and auto-resolve setting, so you can send a terse Alert to a team rotation and a detailed Incident to the major-incident rotation. Each also has its own quiet period after it resolves — resolving the Incident does not reset the Alert's, or the other way around.

Every alert and incident a rule creates lists the SLO as an **affected resource**, so it shows up on the SLO's Alerts and Incidents tabs.

Burn rate incidents are **not** published to status pages and do not notify subscribers: an error budget burning fast is an internal engineering signal, not a declared customer-facing outage.

---

### What Each Record Says

Leave the title and description empty and the rule uses its built-in text, which names the SLO and the rule and states both burn rates, the threshold and the error budget remaining.

To write your own, use these variables in the title, the description and the remediation notes. They are filled in at the moment the rule fires:

${BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE}

A variable that is misspelled is left exactly as written, so a typo shows up in the alert instead of silently disappearing.

---

### Owners, Labels and Privacy

- **Owner teams and owner users** are added to the record when it is created, and are notified.
- **Add SLO Owners as Owners** also adds this SLO's owners — its owner users and the members of its owner teams. They already hear about the SLO's status changes, so this can notify them twice.
- **Labels** are added to the record, so filters, owner rules and workspace notification rules can match it.
- A **private** record is visible only to its owners, project admins and project owners.

---

### Auto-Resolve

With **Auto Resolve** on (the default), the rule resolves its record once the burn rate over the long window drops back below the threshold.

Turn it off and the record stays open until someone resolves it. The rule will not open another one on top of it; once it has been resolved by hand and the burn has recovered, the rule can fire again.

If you resolve the Incident by hand while the budget is still burning, the rule will not re-declare it either way. It stays closed until the burn recovers and the rule genuinely fires again.

Disabling the rule, switching an output off, deleting the rule, or disabling, archiving or deleting the SLO always resolves what the rule has open — whatever the auto-resolve setting says.

---

### The Rules You Already Have

Every SLO is created with two rules, with thresholds scaled to its compliance window:

| Rule | Meaning | Long Window | Short Window | 30-day threshold |
|------|---------|-------------|--------------|------------------|
| **Fast burn** (page) | 2% of the budget in an hour | 60 min | 5 min | 14.4× |
| **Slow burn** (warn) | 5% of the budget in six hours | 360 min | 30 min | 6× |

Route the fast-burn rule to a paging on-call policy at a high severity, and let the slow-burn rule raise a lower-severity alert for working-hours follow-up.

---

### Creating One

The form walks the questions a rule answers:

| Step | What you set |
|------|--------------|
| **Rule** | Its name, and whether it is enabled. |
| **Burn Window** | The threshold, the long and short windows, and the re-fire suppression. |
| **What It Declares** | Alert, Incident, or both, and whether the SLO's owners are added as owners. |
| **Alert** | Title and severity, with expandable sections for description, ownership and labels, on-call policies, and advanced options. |
| **Incident** | The incident’s own title, severity and optional settings, grouped in the same way. |

New rules prefill the alert and incident titles and descriptions with editable defaults. Sections open automatically when they contain a prefilled description or saved settings.

The alert and incident steps appear and disappear with the toggles on **What It Declares**, so a rule that only raises alerts is never asked about incidents.

---

### Other Settings

- A rule cannot fire until the SLO has at least a full long window of monitoring history, so a brand-new monitor cannot page you on its first blip. That means a fresh SLO will not fire Fast burn for its first hour, or Slow burn for its first six.
- **Re-fire Suppression** is the quiet period after an alert or incident resolves before the same rule may declare that record again. Each output is suppressed independently, measured from its own resolve. It defaults to the long window.
- Leave a severity blank and the project's most severe one is used.
- While any monitor on the SLO is under an active scheduled maintenance window, the rule is suppressed entirely — planned work should not page anyone.
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
  BURN_RATE_RULE_OWNER_USER_COLUMNS,
  BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE,
  describeBurnRateOutputOptions,
  describeBurnRateOutputs,
  validateBurnRateOutputs,
  validateBurnRateThreshold,
  validateBurnRateWindows,
  willCreateAlert,
  willDeclareIncident,
  withOwnerUserDropdownOptions,
} from "../Utils/BurnRateRuleForm";
export type {
  BurnRateRuleOptionFlags,
  BurnRateRuleOutputFlags,
  DescribeBurnRateOutputOptionsFunction,
  DescribeBurnRateOutputsFunction,
  FetchBurnRateRuleOwnerUserOptionsFunction,
  ReadsBurnRateOutputFlagFunction,
  ValidateBurnRateOutputsFunction,
  ValidateBurnRateThresholdFunction,
  ValidateBurnRateWindowsFunction,
  WithOwnerUserDropdownOptionsFunction,
} from "../Utils/BurnRateRuleForm";

/*
 * The form fields, with the two owner-user pickers given their options. User
 * is not a project-listable model, so a dropdownModal cannot list it; the
 * project's users come from its team members instead. Built once at module
 * level: the loader reads the current project when it RUNS, not when this is
 * built, and a stable array keeps ModelTable from seeing new form fields on
 * every render.
 */
const BURN_RATE_RULE_FORM_FIELDS_WITH_OWNER_USERS: Array<
  ModelField<ServiceLevelObjectiveBurnRateRule>
> = withOwnerUserDropdownOptions(
  BURN_RATE_RULE_FORM_FIELDS,
  async (): Promise<Array<DropdownOption>> => {
    return await ProjectUser.fetchProjectUsersAsDropdownOptions(
      ProjectUtil.getCurrentProjectId()!,
    );
  },
);

type RenderLinesFunction = (lines: Array<string>) => ReactElement;

// One line per output, or a dash when the rule declares nothing that applies.
const renderLines: RenderLinesFunction = (
  lines: Array<string>,
): ReactElement => {
  if (lines.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
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
) => string;

const describeOwners: DescribeOwnersFunction = (
  teams: Array<Team> | undefined,
  users: Array<User> | undefined,
): string => {
  const names: Array<string> = [
    ...(teams || []).map((team: Team): string => {
      return team.name || "";
    }),
    ...(users || []).map((user: User): string => {
      return user.name?.toString() || user.email?.toString() || "";
    }),
  ].filter((name: string): boolean => {
    return Boolean(name);
  });

  return names.length > 0 ? names.join(", ") : "None";
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
          setCanFire(canSloFireBurnRateRules(slo));
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
            "Raise alerts and declare incidents when the error budget is being spent too fast. Rules fire only when both the long and short windows exceed the threshold.",
        }}
        noItemsMessage="No burn rate rules on this SLO — nothing will page anyone when the error budget starts burning. Create a fast-burn rule to get paged before the budget runs out."
        helpContent={{
          title: "How Burn Rate Rules Work",
          description:
            "Burn rates, fast and slow burn windows, what each alert and incident says, and where it goes",
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
        formFields={BURN_RATE_RULE_FORM_FIELDS_WITH_OWNER_USERS}
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
                    {describeBurnRateOutputs(item)}
                  </div>
                  {options.map((option: string) => {
                    return (
                      <div key={option} className="text-xs text-gray-500">
                        {option}
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
                  <span className="text-sm text-gray-400">Never fired</span>
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
                  Last fired {OneUptimeDate.fromNow(lastFiredAt)}
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
                lines.push(`Alert: ${item.alertSeverity?.name || "Default"}`);
              }

              if (willDeclareIncident(item)) {
                lines.push(
                  `Incident: ${item.incidentSeverity?.name || "Default"}`,
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
                const names: Array<string> = (policies || [])
                  .map((policy: OnCallDutyPolicy) => {
                    return policy.name || "";
                  })
                  .filter(Boolean);

                /*
                 * A rule with no policy still declares its alert or incident,
                 * but nothing escalates it — worth saying, because "I have a
                 * fast-burn rule" is usually shorthand for "I will get paged".
                 */
                return names.length > 0 ? names.join(", ") : "No escalation";
              };

              const lines: Array<string> = [];

              if (willCreateAlert(item)) {
                lines.push(
                  `Alert: ${describePolicies(
                    item.onCallDutyPolicies as Array<OnCallDutyPolicy>,
                  )}`,
                );
              }

              if (willDeclareIncident(item)) {
                lines.push(
                  `Incident: ${describePolicies(
                    item.incidentOnCallDutyPolicies as Array<OnCallDutyPolicy>,
                  )}`,
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
                  `Alert: ${describeOwners(
                    item.alertOwnerTeams,
                    item.alertOwnerUsers,
                  )}`,
                );
              }

              if (willDeclareIncident(item)) {
                lines.push(
                  `Incident: ${describeOwners(
                    item.incidentOwnerTeams,
                    item.incidentOwnerUsers,
                  )}`,
                );
              }

              if (lines.length > 0 && item.addSloOwnersAsOwners === true) {
                lines.push("+ SLO owners");
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
                return <span className="text-sm text-gray-400">—</span>;
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
    </Fragment>
  );
};

export default SloBurnRateRules;
