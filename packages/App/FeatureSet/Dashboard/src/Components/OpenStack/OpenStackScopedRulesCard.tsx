import AlertLabelRule from "Common/Models/DatabaseModels/AlertLabelRule";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import IncidentLabelRule from "Common/Models/DatabaseModels/IncidentLabelRule";
import IncidentOwnerRule from "Common/Models/DatabaseModels/IncidentOwnerRule";
import Label from "Common/Models/DatabaseModels/Label";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudLabelRule from "Common/Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import NotNull from "Common/Types/BaseDatabase/NotNull";
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
 * "A project maps to a team, so its incidents reach the people who run it." A rule here is
 * an OpenStack Cloud Owner or Label Rule that names the project or domain by its ID
 * (OpenStackScopedRule), and adds to each alert and incident reaching it, whichever of the
 * cloud's monitors opens it (OpenStackScopedRules). It stays visible and editable under the
 * cloud rules' settings. A domain's ID repeats across clouds, "default" in all of them, so
 * a domain's rule also names the cloud.
 *
 * These used to be a pair of Alert and Incident rules matching a marker in the description.
 * Those keep working, so they are listed here too, and removed here too, until each is gone.
 */

export type OpenStackRuleMode = "owner" | "label";

export interface OpenStackRuleScope {
  kind: "project" | "domain";
  id: string;
  name: string;
}

// The description pattern of a rule written as a marker's pair, read as a literal.
export function getOpenStackScopePattern(scope: OpenStackRuleScope): string {
  return escapeRegExp(
    scope.kind === "project"
      ? getOpenStackProjectMarker(scope.id)
      : getOpenStackDomainMarker(scope.id),
  );
}

// What a domain's rule says about its cloud, by the only thing a rule can match it on.
export function getOpenStackCloudNamePattern(cloudName: string): string {
  return `^${escapeRegExp(cloudName)}$`;
}

/*
 * A rule's name, for the settings page it also shows on. A tenant's name can be as long as
 * Keystone allows and the column is shorter than that, so it is cut here rather than
 * refused there.
 */
const SCOPE_NAME_LIMIT: number = 40;

export function getOpenStackScopeRuleName(data: {
  scope: OpenStackRuleScope;
  mode: OpenStackRuleMode;
}): string {
  const word: string = data.scope.kind === "project" ? "project" : "domain";
  const what: string =
    data.mode === "owner" ? "owners of its" : "labels on its";
  const name: string =
    data.scope.name.length > SCOPE_NAME_LIMIT
      ? `${data.scope.name.substring(0, SCOPE_NAME_LIMIT)}…`
      : data.scope.name;
  return `OpenStack ${word} ${name}: ${what} alerts and incidents`;
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

type ScopedRuleTable = "Cloud" | "Alerts" | "Incidents";

interface ScopedRule {
  id: ObjectID;
  table: ScopedRuleTable;
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
  // The cloud a domain picked here is in, which its rule has to name.
  openStackCloudId?: ObjectID | undefined;
}

interface AddFormValues {
  scope?: unknown;
  teams?: Array<unknown> | undefined;
  users?: Array<unknown> | undefined;
  labels?: Array<unknown> | undefined;
}

// The one rule a choice is, on the cloud rules' own table.
export async function createOpenStackScopeRules(data: {
  projectId: ObjectID;
  scope: OpenStackRuleScope;
  mode: OpenStackRuleMode;
  cloudName?: string | undefined;
  teamIds?: Array<string> | undefined;
  userIds?: Array<string> | undefined;
  labelIds?: Array<string> | undefined;
}): Promise<void> {
  const rule: OpenStackCloudOwnerRule | OpenStackCloudLabelRule =
    data.mode === "owner"
      ? new OpenStackCloudOwnerRule()
      : new OpenStackCloudLabelRule();

  rule.projectId = data.projectId;
  rule.name = getOpenStackScopeRuleName({
    scope: data.scope,
    mode: data.mode,
  });
  rule.isEnabled = true;

  if (data.scope.kind === "project") {
    rule.openStackProjectId = data.scope.id;
  } else {
    rule.openStackDomainId = data.scope.id;
    if (data.cloudName) {
      rule.openStackCloudNamePattern = getOpenStackCloudNamePattern(
        data.cloudName,
      );
    }
  }

  if (rule instanceof OpenStackCloudOwnerRule) {
    rule.ownerTeams = (data.teamIds || []).map((id: string): Team => {
      const team: Team = new Team();
      team._id = id;
      return team;
    });
    rule.ownerUsers = (data.userIds || []).map((id: string): User => {
      const user: User = new User();
      user._id = id;
      return user;
    });
    await ModelAPI.create<OpenStackCloudOwnerRule>({
      model: rule,
      modelType: OpenStackCloudOwnerRule,
    });
    return;
  }

  rule.labelsToAdd = (data.labelIds || []).map((id: string): Label => {
    const label: Label = new Label();
    label._id = id;
    return label;
  });
  await ModelAPI.create<OpenStackCloudLabelRule>({
    model: rule,
    modelType: OpenStackCloudLabelRule,
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

    // What a rule of this kind names, so one read finds exactly what this card lists.
    const cloudRuleQueries: Array<{
      openStackProjectId?: string | NotNull;
      openStackDomainId?: string | NotNull;
    }> = props.scope
      ? [
          props.scope.kind === "project"
            ? { openStackProjectId: props.scope.id }
            : { openStackDomainId: props.scope.id },
        ]
      : props.choices
        ? [{ openStackDomainId: new NotNull() }]
        : [
            { openStackProjectId: new NotNull() },
            { openStackDomainId: new NotNull() },
          ];

    const readCloudRules: Promise<
      Array<ListResult<OpenStackCloudOwnerRule | OpenStackCloudLabelRule>>
    > = Promise.all(
      cloudRuleQueries.map(
        (query: {
          openStackProjectId?: string | NotNull;
          openStackDomainId?: string | NotNull;
        }): Promise<
          ListResult<OpenStackCloudOwnerRule | OpenStackCloudLabelRule>
        > => {
          return isOwner
            ? ModelAPI.getList<OpenStackCloudOwnerRule>({
                modelType: OpenStackCloudOwnerRule,
                query: query as never,
                limit: 200,
                skip: 0,
                select: {
                  name: true,
                  ownerTeams: { name: true },
                  ownerUsers: { name: true },
                },
                sort: {},
              })
            : ModelAPI.getList<OpenStackCloudLabelRule>({
                modelType: OpenStackCloudLabelRule,
                query: query as never,
                limit: 200,
                skip: 0,
                select: {
                  name: true,
                  labelsToAdd: { name: true },
                },
                sort: {},
              });
        },
      ),
    );

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
      table: ScopedRuleTable,
      row: Record<string, unknown>,
    ) => ScopedRule = (
      table: ScopedRuleTable,
      row: Record<string, unknown>,
    ): ScopedRule => {
      const named: Array<{ name?: string }> = [
        ...((row["ownerTeams"] as Array<{ name?: string }>) || []),
        ...((row["ownerUsers"] as Array<{ name?: string }>) || []),
        ...((row["labelsToAdd"] as Array<{ name?: string }>) || []),
      ];
      return {
        id: row["_id"] as unknown as ObjectID,
        table,
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

    Promise.all([readCloudRules, readAlerts, readIncidents])
      .then(
        ([cloudRules, alerts, incidents]: [
          Array<ListResult<OpenStackCloudOwnerRule | OpenStackCloudLabelRule>>,
          ListResult<AlertOwnerRule | AlertLabelRule>,
          ListResult<IncidentOwnerRule | IncidentLabelRule>,
        ]) => {
          const seen: Set<string> = new Set();

          setRules([
            // A rule naming both a project and a domain comes back from both reads.
            ...cloudRules
              .flatMap(
                (
                  result: ListResult<
                    OpenStackCloudOwnerRule | OpenStackCloudLabelRule
                  >,
                ): Array<OpenStackCloudOwnerRule | OpenStackCloudLabelRule> => {
                  return result.data;
                },
              )
              .map(
                (
                  row: OpenStackCloudOwnerRule | OpenStackCloudLabelRule,
                ): ScopedRule => {
                  return toRule(
                    "Cloud",
                    row as unknown as Record<string, unknown>,
                  );
                },
              )
              .filter((rule: ScopedRule): boolean => {
                const id: string = rule.id.toString();
                if (seen.has(id)) {
                  return false;
                }
                seen.add(id);
                return true;
              }),
            ...[
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
          ]);
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

    // A domain's ID repeats across clouds, so its rule has to say which cloud it means.
    const cloud: OpenStackCloud | null =
      scope.kind === "domain" && props.openStackCloudId
        ? await ModelAPI.getItem<OpenStackCloud>({
            modelType: OpenStackCloud,
            id: props.openStackCloudId,
            select: { name: true },
          })
        : null;

    await createOpenStackScopeRules({
      projectId: ProjectUtil.getCurrentProjectId()!,
      scope,
      mode: props.mode,
      cloudName: cloud?.name,
      teamIds: idsOf(values.teams),
      userIds: idsOf(values.users),
      labelIds: idsOf(values.labels),
    });
  };

  const removeRule: (rule: ScopedRule) => Promise<void> = async (
    rule: ScopedRule,
  ): Promise<void> => {
    if (rule.table === "Cloud") {
      await ModelAPI.deleteItem(
        isOwner
          ? { modelType: OpenStackCloudOwnerRule, id: rule.id }
          : { modelType: OpenStackCloudLabelRule, id: rule.id },
      );
    } else if (rule.table === "Alerts") {
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
                  key={`${rule.table}/${rule.id.toString()}`}
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
