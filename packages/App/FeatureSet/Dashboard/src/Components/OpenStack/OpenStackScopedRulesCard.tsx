import AlertLabelRule from "Common/Models/DatabaseModels/AlertLabelRule";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import IncidentLabelRule from "Common/Models/DatabaseModels/IncidentLabelRule";
import IncidentOwnerRule from "Common/Models/DatabaseModels/IncidentOwnerRule";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Search from "Common/Types/BaseDatabase/Search";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_DOMAIN_MARKER_START,
  OPENSTACK_PROJECT_MARKER_START,
  getOpenStackDomainMarker,
  getOpenStackProjectMarker,
} from "Common/Types/OpenStack/OpenStackBlastRadius";
import escapeRegExp from "Common/Utils/RegExpEscape";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * WHICH TEAM OR LABELS A PROJECT'S OR DOMAIN'S ALERTS AND INCIDENTS GET.
 *
 * "A project maps to a team, so its incidents reach the people who run it." An alert or
 * incident on an OpenStack part names each project and domain it reaches, by ID, in its
 * description (OpenStackAlertContext). So a project's owner rule is an ordinary Alert
 * Owner Rule and Incident Owner Rule that match that line: they run when every alert and
 * incident is created, say so in its feed, notify as owners are notified, and import and
 * export where those rules do. This card writes and reads the two together, and each pair
 * stays visible and editable under Alerts and Incidents.
 *
 * A rule's conditions can only name a column of its own table, and no rule table has a
 * project column, so this matches what every such alert and incident writes instead.
 */

export type OpenStackRuleMode = "owner" | "label";

export interface OpenStackRuleScope {
  kind: "project" | "domain";
  id: string;
  name: string;
}

// The description pattern for a scope: its marker, read as a literal.
export function getOpenStackScopePattern(scope: OpenStackRuleScope): string {
  return escapeRegExp(
    scope.kind === "project"
      ? getOpenStackProjectMarker(scope.id)
      : getOpenStackDomainMarker(scope.id),
  );
}

/*
 * A rule's name, for the Alerts and Incidents pages it also shows on. A tenant's name can
 * be as long as Keystone allows and the column is shorter than that, so it is cut here
 * rather than refused there.
 */
const SCOPE_NAME_LIMIT: number = 40;

export function getOpenStackScopeRuleName(data: {
  scope: OpenStackRuleScope;
  mode: OpenStackRuleMode;
  subject: "Alerts" | "Incidents";
}): string {
  const word: string = data.scope.kind === "project" ? "project" : "domain";
  const what: string =
    data.mode === "owner" ? "owners of its" : "labels on its";
  const name: string =
    data.scope.name.length > SCOPE_NAME_LIMIT
      ? `${data.scope.name.substring(0, SCOPE_NAME_LIMIT)}…`
      : data.scope.name;
  return `OpenStack ${word} ${name}: ${what} ${data.subject.toLowerCase()}`;
}

// What a stored pattern says it is about, for the list of every project's rules.
export function describeOpenStackScopePattern(pattern: string): string {
  return pattern.replace(/\\/g, "");
}

function idsOf(values: unknown): Array<string> {
  return (Array.isArray(values) ? values : []).map((value: unknown): string => {
    return String(
      typeof value === "object" && value !== null
        ? (value as { _id?: unknown; value?: unknown })._id ||
            (value as { value?: unknown }).value
        : value,
    );
  });
}

interface ScopedRule {
  id: ObjectID;
  subject: "Alerts" | "Incidents";
  name: string;
  pattern: string;
  adds: Array<string>;
}

export interface ComponentProps {
  mode: OpenStackRuleMode;
  // One project or domain, whose rules this adds and lists. Without it, every one's.
  scope?: OpenStackRuleScope | undefined;
  // Or the ones this can add a rule for, picked when adding: a page's domains.
  choices?: Array<OpenStackRuleScope> | undefined;
}

interface AddFormValues {
  scope?: unknown;
  teams?: Array<unknown> | undefined;
  users?: Array<unknown> | undefined;
  labels?: Array<unknown> | undefined;
}

/*
 * The two rule rows one choice is: one for alerts and one for incidents, because they are
 * two tables, and a project's incidents and alerts both have to reach its people.
 */
export async function createOpenStackScopeRules(data: {
  projectId: ObjectID;
  scope: OpenStackRuleScope;
  mode: OpenStackRuleMode;
  teamIds?: Array<string> | undefined;
  userIds?: Array<string> | undefined;
  labelIds?: Array<string> | undefined;
}): Promise<void> {
  const pattern: string = getOpenStackScopePattern(data.scope);
  const nameFor: (subject: "Alerts" | "Incidents") => string = (
    subject: "Alerts" | "Incidents",
  ): string => {
    return getOpenStackScopeRuleName({
      scope: data.scope,
      mode: data.mode,
      subject,
    });
  };

  if (data.mode === "owner") {
    const teams: Array<Team> = (data.teamIds || []).map((id: string): Team => {
      const team: Team = new Team();
      team._id = id;
      return team;
    });
    const users: Array<User> = (data.userIds || []).map((id: string): User => {
      const user: User = new User();
      user._id = id;
      return user;
    });

    const alertRule: AlertOwnerRule = new AlertOwnerRule();
    alertRule.projectId = data.projectId;
    alertRule.name = nameFor("Alerts");
    alertRule.alertDescriptionPattern = pattern;
    alertRule.ownerTeams = teams;
    alertRule.ownerUsers = users;
    alertRule.isEnabled = true;

    const incidentRule: IncidentOwnerRule = new IncidentOwnerRule();
    incidentRule.projectId = data.projectId;
    incidentRule.name = nameFor("Incidents");
    incidentRule.incidentDescriptionPattern = pattern;
    incidentRule.ownerTeams = teams;
    incidentRule.ownerUsers = users;
    incidentRule.isEnabled = true;

    await ModelAPI.create<AlertOwnerRule>({
      model: alertRule,
      modelType: AlertOwnerRule,
    });
    await ModelAPI.create<IncidentOwnerRule>({
      model: incidentRule,
      modelType: IncidentOwnerRule,
    });
    return;
  }

  const labels: Array<Label> = (data.labelIds || []).map(
    (id: string): Label => {
      const label: Label = new Label();
      label._id = id;
      return label;
    },
  );

  const alertRule: AlertLabelRule = new AlertLabelRule();
  alertRule.projectId = data.projectId;
  alertRule.name = nameFor("Alerts");
  alertRule.alertDescriptionPattern = pattern;
  alertRule.labelsToAdd = labels;
  alertRule.isEnabled = true;

  const incidentRule: IncidentLabelRule = new IncidentLabelRule();
  incidentRule.projectId = data.projectId;
  incidentRule.name = nameFor("Incidents");
  incidentRule.incidentDescriptionPattern = pattern;
  incidentRule.labelsToAdd = labels;
  incidentRule.isEnabled = true;

  await ModelAPI.create<AlertLabelRule>({
    model: alertRule,
    modelType: AlertLabelRule,
  });
  await ModelAPI.create<IncidentLabelRule>({
    model: incidentRule,
    modelType: IncidentLabelRule,
  });
}

const OpenStackScopedRulesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [rules, setRules] = useState<Array<ScopedRule>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [toRemove, setToRemove] = useState<ScopedRule | null>(null);

  const isOwner: boolean = props.mode === "owner";

  const load: () => void = useCallback((): void => {
    setIsLoading(true);
    setError("");

    // Each marker starts with this, so one read finds a project's and a domain's alike.
    const pattern: string | Search<string> = props.scope
      ? getOpenStackScopePattern(props.scope)
      : new Search(
          props.choices
            ? OPENSTACK_DOMAIN_MARKER_START
            : OPENSTACK_PROJECT_MARKER_START.substring(0, "OpenStack ".length),
        );

    const readAlerts: Promise<ListResult<AlertOwnerRule | AlertLabelRule>> =
      isOwner
        ? ModelAPI.getList<AlertOwnerRule>({
            modelType: AlertOwnerRule,
            query: { alertDescriptionPattern: pattern as string },
            limit: 200,
            skip: 0,
            select: {
              name: true,
              alertDescriptionPattern: true,
              ownerTeams: { name: true },
              ownerUsers: { name: true },
            },
            sort: {},
          })
        : ModelAPI.getList<AlertLabelRule>({
            modelType: AlertLabelRule,
            query: { alertDescriptionPattern: pattern as string },
            limit: 200,
            skip: 0,
            select: {
              name: true,
              alertDescriptionPattern: true,
              labelsToAdd: { name: true },
            },
            sort: {},
          });

    const readIncidents: Promise<
      ListResult<IncidentOwnerRule | IncidentLabelRule>
    > = isOwner
      ? ModelAPI.getList<IncidentOwnerRule>({
          modelType: IncidentOwnerRule,
          query: { incidentDescriptionPattern: pattern as string },
          limit: 200,
          skip: 0,
          select: {
            name: true,
            incidentDescriptionPattern: true,
            ownerTeams: { name: true },
            ownerUsers: { name: true },
          },
          sort: {},
        })
      : ModelAPI.getList<IncidentLabelRule>({
          modelType: IncidentLabelRule,
          query: { incidentDescriptionPattern: pattern as string },
          limit: 200,
          skip: 0,
          select: {
            name: true,
            incidentDescriptionPattern: true,
            labelsToAdd: { name: true },
          },
          sort: {},
        });

    const toRule: (
      subject: "Alerts" | "Incidents",
      row: Record<string, unknown>,
    ) => ScopedRule = (
      subject: "Alerts" | "Incidents",
      row: Record<string, unknown>,
    ): ScopedRule => {
      const named: Array<{ name?: string }> = [
        ...((row["ownerTeams"] as Array<{ name?: string }>) || []),
        ...((row["ownerUsers"] as Array<{ name?: string }>) || []),
        ...((row["labelsToAdd"] as Array<{ name?: string }>) || []),
      ];
      return {
        id: row["_id"] as unknown as ObjectID,
        subject,
        name: String(row["name"] || ""),
        pattern: String(
          row["alertDescriptionPattern"] ||
            row["incidentDescriptionPattern"] ||
            "",
        ),
        adds: named
          .map((item: { name?: string }): string => {
            return item.name || "";
          })
          .filter(Boolean),
      };
    };

    Promise.all([readAlerts, readIncidents])
      .then(
        ([alerts, incidents]: [
          ListResult<AlertOwnerRule | AlertLabelRule>,
          ListResult<IncidentOwnerRule | IncidentLabelRule>,
        ]) => {
          setRules(
            [
              ...alerts.data.map((row: AlertOwnerRule | AlertLabelRule) => {
                return toRule(
                  "Alerts",
                  row as unknown as Record<string, unknown>,
                );
              }),
              ...incidents.data.map(
                (row: IncidentOwnerRule | IncidentLabelRule) => {
                  return toRule(
                    "Incidents",
                    row as unknown as Record<string, unknown>,
                  );
                },
              ),
            ].filter((rule: ScopedRule): boolean => {
              const pattern: string = describeOpenStackScopePattern(
                rule.pattern,
              );
              return (
                pattern.startsWith(OPENSTACK_PROJECT_MARKER_START) ||
                pattern.startsWith(OPENSTACK_DOMAIN_MARKER_START)
              );
            }),
          );
        },
      )
      .catch((err: unknown) => {
        setError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [props.mode, props.scope?.kind, props.scope?.id, Boolean(props.choices)]);

  useEffect(() => {
    load();
  }, [load]);

  const addRules: (values: AddFormValues) => Promise<void> = async (
    values: AddFormValues,
  ): Promise<void> => {
    const chosen: string = idsOf([values.scope])[0] || "";
    const scope: OpenStackRuleScope | undefined =
      props.scope ||
      props.choices?.find((choice: OpenStackRuleScope): boolean => {
        return choice.id === chosen;
      });

    if (!scope) {
      throw new Error("Pick what this rule is for.");
    }

    await createOpenStackScopeRules({
      projectId: ProjectUtil.getCurrentProjectId()!,
      scope,
      mode: props.mode,
      teamIds: idsOf(values.teams),
      userIds: idsOf(values.users),
      labelIds: idsOf(values.labels),
    });
  };

  const removeRule: (rule: ScopedRule) => Promise<void> = async (
    rule: ScopedRule,
  ): Promise<void> => {
    if (rule.subject === "Alerts") {
      await ModelAPI.deleteItem(
        isOwner
          ? { modelType: AlertOwnerRule, id: rule.id }
          : { modelType: AlertLabelRule, id: rule.id },
      );
    } else {
      await ModelAPI.deleteItem(
        isOwner
          ? { modelType: IncidentOwnerRule, id: rule.id }
          : { modelType: IncidentLabelRule, id: rule.id },
      );
    }
  };

  return (
    <Card
      title={
        isOwner ? "Who is told about this" : "Labels on what opens about this"
      }
      description={
        isOwner
          ? "Owners added to every alert and incident that reaches this project or domain, by its ID, so a rename breaks nothing."
          : "Labels added to every alert and incident that reaches this project or domain, by its ID, so a rename breaks nothing."
      }
      buttons={
        props.scope || props.choices?.length
          ? [
              <Button
                key="add"
                title={isOwner ? "Add Owners" : "Add Labels"}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="openstack-scoped-rule-add"
                onClick={() => {
                  setIsAdding(true);
                }}
              />,
            ]
          : []
      }
    >
      <div data-testid={`openstack-scoped-rules-${props.mode}`}>
        {isLoading ? <ComponentLoader /> : null}
        {error ? (
          <p className="px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}
        {!isLoading && !error && rules.length === 0 ? (
          <p
            data-testid="openstack-scoped-rules-empty"
            className="px-4 py-3 text-sm text-gray-600"
          >
            {props.scope
              ? translator.translateText(
                  "No rule names this yet, so what opens about it goes only to the cloud's own owners.",
                )
              : translator.translateText(
                  "No project or domain has a rule yet. Add one from a project's page or the Domains page.",
                )}
          </p>
        ) : null}
        {rules.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {rules.map((rule: ScopedRule): ReactElement => {
              return (
                <li
                  key={`${rule.subject}/${rule.id.toString()}`}
                  data-testid="openstack-scoped-rule"
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">
                      <bdi>{rule.name}</bdi>
                    </span>
                    <span className="block text-gray-600">
                      {rule.adds.join(", ")}
                    </span>
                  </span>
                  <Button
                    title="Remove"
                    buttonStyle={ButtonStyleType.OUTLINE}
                    dataTestId="openstack-scoped-rule-remove"
                    onClick={() => {
                      setToRemove(rule);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {isAdding ? (
        <BasicFormModal<AddFormValues>
          title={isOwner ? "Add Owners" : "Add Labels"}
          description={
            props.scope
              ? translator.translateTemplate(
                  "Added to every alert and incident that reaches {{name}}.",
                  { name: props.scope.name },
                )
              : translator.translateText(
                  "Added to every alert and incident that reaches this domain.",
                )
          }
          onClose={() => {
            setIsAdding(false);
          }}
          onSubmit={(values: AddFormValues) => {
            addRules(values)
              .then(() => {
                setIsAdding(false);
                load();
              })
              .catch((err: unknown) => {
                setIsAdding(false);
                setError(API.getFriendlyMessage(err));
              });
          }}
          formProps={{
            initialValues: {},
            fields: [
              ...(props.choices
                ? [
                    {
                      field: { scope: true },
                      title: "Domain",
                      fieldType: FormFieldSchemaType.Dropdown,
                      dropdownOptions: props.choices.map(
                        (choice: OpenStackRuleScope) => {
                          return {
                            value: choice.id,
                            label: choice.name,
                            isUserContent: true,
                          };
                        },
                      ),
                      required: true,
                    },
                  ]
                : []),
              ...(isOwner
                ? [
                    {
                      field: { teams: true },
                      title: "Teams",
                      fieldType: FormFieldSchemaType.MultiSelectDropdown,
                      dropdownModal: {
                        type: Team,
                        labelField: "name",
                        valueField: "_id",
                      },
                      required: false,
                    },
                    {
                      field: { users: true },
                      title: "Users",
                      fieldType: FormFieldSchemaType.MultiSelectDropdown,
                      dropdownModal: {
                        type: User,
                        labelField: "name",
                        valueField: "_id",
                      },
                      required: false,
                    },
                  ]
                : [
                    {
                      field: { labels: true },
                      title: "Labels",
                      fieldType: FormFieldSchemaType.MultiSelectDropdown,
                      dropdownModal: {
                        type: Label,
                        labelField: "name",
                        valueField: "_id",
                      },
                      required: true,
                    },
                  ]),
            ],
          }}
        />
      ) : (
        <></>
      )}
      {toRemove ? (
        <ConfirmModal
          title="Remove this rule?"
          description={translator.translateTemplate(
            "{{name}} stops adding to what opens from now on. What it already added stays.",
            { name: toRemove.name },
          )}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setToRemove(null);
          }}
          onSubmit={() => {
            removeRule(toRemove)
              .then(() => {
                setToRemove(null);
                load();
              })
              .catch((err: unknown) => {
                setToRemove(null);
                setError(API.getFriendlyMessage(err));
              });
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default OpenStackScopedRulesCard;
