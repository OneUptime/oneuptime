import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "Common/Models/DatabaseModels/Team";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import TeamOwnedRuleKinds, {
  TeamOwnedRuleKind,
} from "Common/Types/TeamOwnedRule/TeamOwnedRuleKinds";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import type Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useCallback, useMemo, useState } from "react";
import { formatNameList } from "../AiAccess/AiAccessModes";
import OwnersCell from "../ResourceOwners/OwnersCell";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";

/*
 * WHO OWNS A RULE, ON ITS LIST AND ITS FORM.
 *
 * An on-call rule, an incident owner rule or a workspace notification rule
 * can belong to teams: only their members, with those teams' permissions,
 * and the project's owners and admins change or delete it; everyone who may
 * read rules still reads it. A rule no team owns is the project's, changed
 * by everyone who may change rules - as every rule was before
 * (Common/Types/TeamOwnedRule/TeamOwnedRuleKinds). Most rule lists have no
 * page for one rule, so the list and the form carry it:
 *
 *   - an Owning Teams column, the teams on each row;
 *   - each row's Edit, Delete and Enable / Disable locked for a reader the
 *     server would refuse, saying which teams own it
 *     (Common/Types/TeamOwnedRule/TeamOwnedRuleHeld);
 *   - the form's Owning Teams field, under More fields: the teams picked are
 *     sent with the rule and saved once it is (the server's
 *     RuleOwningTeams), and the Edit form opens on the teams that own it.
 *
 * The field is offered to whoever may add owning teams to a rule of the
 * kind (the owning-team table's create permission), on Edit also to whoever
 * may remove them; the server asks again, team by team.
 */

// The form value the picked teams are kept in, and sent under.
export const RULE_OWNING_TEAMS_VALUE_KEY: string = "owningTeams";

// The field's own key in the form; nothing is sent under it.
export const RULE_OWNING_TEAMS_FIELD_KEY: string = "ruleOwningTeams";

export const RULE_OWNING_TEAMS_TITLE: string = translationKey("Owning Teams");

export const RULE_OWNING_TEAMS_DESCRIPTION: string = translationKey(
  "Only members of these teams, and project admins, can edit or delete this rule. Leave it empty and everyone who can edit rules can.",
);

/*
 * Why a row is locked for a reader whose own permissions would let them
 * change it, after the lock's first sentence ("You do not have permission
 * to edit this Incident On-Call Rule."): the teams that own it, named.
 */
export const RULE_OWNED_REASONS: Readonly<{
  oneTeam: string;
  severalTeams: string;
  unnamedTeams: string;
}> = {
  oneTeam: translationKey(
    "This rule belongs to {{team}}: only its members, with its permissions, and project admins can change it.",
  ),
  severalTeams: translationKey(
    "This rule belongs to {{teams}}: only their members, with their permissions, and project admins can change it.",
  ),
  unnamedTeams: translationKey(
    "This rule belongs to teams: only their members, with their permissions, and project admins can change it.",
  ),
};

// How many owning teams of the listed rules are read at once.
const OWNING_TEAMS_READ: number = LIMIT_PER_PROJECT;

interface OwningTeam {
  id: string;
  name: string;
}

// The lock's reason, naming the teams that own the rule.
export const getRuleOwnedReason: (data: {
  owningTeams: ReadonlyArray<OwningTeam>;
  translator: Translator;
}) => string = (data: {
  owningTeams: ReadonlyArray<OwningTeam>;
  translator: Translator;
}): string => {
  const names: Array<string> = [];

  for (const team of data.owningTeams) {
    const name: string = team.name.trim();

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return (
      data.translator.translateText(RULE_OWNED_REASONS.unnamedTeams) ||
      RULE_OWNED_REASONS.unnamedTeams
    );
  }

  if (names.length === 1) {
    return data.translator.translateTemplate(RULE_OWNED_REASONS.oneTeam, {
      team: names[0]!,
    });
  }

  return data.translator.translateTemplate(RULE_OWNED_REASONS.severalTeams, {
    teams: composedValue((sentence: Translator): string => {
      return formatNameList(names, "and", sentence);
    }),
  });
};

/*
 * The reason a row's `action` is locked for the reader, or undefined: a rule
 * some teams own, which the reader's own permissions would let them change
 * but none of their teams that own it lets them (PermissionGate with what
 * they hold on it). A rule no team owns, or an action their own permissions
 * refuse - the table locks that for every row already - is not locked here.
 */
export const getRuleLockReason: (data: {
  model: BaseModel;
  action: ModelAction.Update | ModelAction.Delete;
  owningTeams: ReadonlyArray<OwningTeam>;
  translator: Translator;
}) => string | undefined = (data: {
  model: BaseModel;
  action: ModelAction.Update | ModelAction.Delete;
  owningTeams: ReadonlyArray<OwningTeam>;
  translator: Translator;
}): string | undefined => {
  if (
    data.owningTeams.length === 0 ||
    !PermissionGate.check(data.model, data.action).isAllowed
  ) {
    return undefined;
  }

  const result: PermissionGateResult = PermissionGate.checkTeamOwnedRule(
    data.model,
    data.action,
    {
      owningTeamIds: data.owningTeams.map((team: OwningTeam): string => {
        return team.id;
      }),
      reason: getRuleOwnedReason({
        owningTeams: data.owningTeams,
        translator: data.translator,
      }),
    },
  );

  return result.isAllowed ? undefined : result.disabledReason;
};

// The Owning Teams field of a rule's form: teams only, from one picker.
export const getRuleOwningTeamsFormField: <TEntity>(options: {
  owningTeamModelType: { new (): BaseModel };
  stepId: string;
  collapsibleSection?: FormFieldCollapsibleSection<TEntity> | undefined;
}) => Field<TEntity> = <TEntity,>(options: {
  owningTeamModelType: { new (): BaseModel };
  stepId: string;
  collapsibleSection?: FormFieldCollapsibleSection<TEntity> | undefined;
}): Field<TEntity> => {
  const owningTeam: BaseModel = new options.owningTeamModelType();

  // Who may add owning teams sees the field; on Edit, also who may remove them.
  const mayAdd: boolean = PermissionGate.check(
    owningTeam,
    ModelAction.Create,
  ).isAllowed;
  const mayRemove: boolean = PermissionGate.check(
    owningTeam,
    ModelAction.Delete,
  ).isAllowed;

  const field: Field<TEntity> = {
    title: RULE_OWNING_TEAMS_TITLE,
    description: RULE_OWNING_TEAMS_DESCRIPTION,
    required: false,
    stepId: options.stepId,
    field: {
      [RULE_OWNING_TEAMS_FIELD_KEY]: true,
    } as unknown as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: {
      kinds: [
        {
          kind: PeoplePickerKind.Team,
          valueKey: RULE_OWNING_TEAMS_VALUE_KEY,
        },
      ],
      addButtonText: "Add team",
      searchPlaceholder: "Search teams...",
      emptyText: "No teams available.",
    },
    formOnly: true,
    showIf: (): boolean => {
      return mayAdd || mayRemove;
    },
  };

  if (options.collapsibleSection) {
    field.collapsibleSection = options.collapsibleSection;
  }

  return field;
};

export interface RuleOwningTeamsTable<TRule extends BaseModel> {
  // For the table's onFetchSuccess: reads who owns the listed rules.
  onRulesFetched: (rules: Array<TRule>) => void;
  // The Owning Teams column.
  owningTeamsColumn: Column<TRule>;
  // For the table's getEditDisabledReason and getDeleteDisabledReason.
  getEditDisabledReason: (rule: TRule) => string | undefined;
  getDeleteDisabledReason: (rule: TRule) => string | undefined;
  // For the table's onEditFormItemFetched: the Edit form opens on them.
  onEditFormItemFetched: (rule: TRule) => Promise<TRule>;
  // The form's Owning Teams field.
  getFormField: (options: {
    stepId: string;
    collapsibleSection?: FormFieldCollapsibleSection<TRule> | undefined;
  }) => Field<TRule>;
}

// The owning teams of each rule, read off the owning-team rows.
const groupByRule: (
  rows: Array<BaseModel>,
  kind: TeamOwnedRuleKind,
) => Map<string, Array<OwningTeam>> = (
  rows: Array<BaseModel>,
  kind: TeamOwnedRuleKind,
): Map<string, Array<OwningTeam>> => {
  const byRule: Map<string, Array<OwningTeam>> = new Map<
    string,
    Array<OwningTeam>
  >();

  for (const row of rows) {
    const ruleId: string | undefined = (
      row.getValue(kind.ruleKey) as ObjectID | string | undefined
    )
      ?.toString()
      .toLowerCase();
    const team: Team | undefined = row.getValue("team") as Team | undefined;
    const teamId: string | undefined = (
      (row.getValue("teamId") as ObjectID | string | undefined) || team?._id
    )?.toString();

    if (!ruleId || !teamId) {
      continue;
    }

    const teams: Array<OwningTeam> = byRule.get(ruleId) || [];

    if (
      !teams.some((owning: OwningTeam): boolean => {
        return owning.id.toLowerCase() === teamId.toLowerCase();
      })
    ) {
      teams.push({ id: teamId, name: team?.name?.toString() || "" });
    }

    byRule.set(ruleId, teams);
  }

  return byRule;
};

/*
 * The owning teams of a list of rules of one kind: read once the rows are,
 * shown in their column, and locking each row's changes for a reader the
 * server would refuse.
 */
export function useRuleOwningTeams<TRule extends BaseModel>(data: {
  ruleModelType: { new (): TRule };
  owningTeamModelType: { new (): BaseModel };
}): RuleOwningTeamsTable<TRule> {
  const translator: Translator = useTranslator();
  const ruleModel: TRule = useMemo((): TRule => {
    return new data.ruleModelType();
  }, [data.ruleModelType]);

  const kind: TeamOwnedRuleKind = useMemo((): TeamOwnedRuleKind => {
    const found: TeamOwnedRuleKind | null = TeamOwnedRuleKinds.getKindOfRule(
      ruleModel.tableName,
    );

    if (!found) {
      throw new Error(`${ruleModel.tableName} is not a rule teams can own.`);
    }

    return found;
  }, [ruleModel]);

  const [owningTeamsByRule, setOwningTeamsByRule] = useState<
    Map<string, Array<OwningTeam>>
  >(new Map<string, Array<OwningTeam>>());
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const readOwningTeams: (
    ruleIds: Array<string>,
  ) => Promise<Map<string, Array<OwningTeam>>> = useCallback(
    async (ruleIds: Array<string>): Promise<Map<string, Array<OwningTeam>>> => {
      if (ruleIds.length === 0) {
        return new Map<string, Array<OwningTeam>>();
      }

      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: data.owningTeamModelType,
        query: {
          [kind.ruleKey]: new Includes(ruleIds),
          projectId: ProjectUtil.getCurrentProjectId()!,
        } as Query<BaseModel>,
        limit: OWNING_TEAMS_READ,
        skip: 0,
        select: {
          _id: true,
          [kind.ruleKey]: true,
          teamId: true,
          team: {
            _id: true,
            name: true,
          },
        } as Record<string, unknown>,
        sort: {},
      });

      return groupByRule(result.data, kind);
    },
    [data.owningTeamModelType, kind],
  );

  const onRulesFetched: (rules: Array<TRule>) => void = useCallback(
    (rules: Array<TRule>): void => {
      const ruleIds: Array<string> = rules
        .map((rule: TRule): string | undefined => {
          return rule._id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        });

      setIsLoading(true);

      readOwningTeams(ruleIds)
        .then((byRule: Map<string, Array<OwningTeam>>) => {
          setOwningTeamsByRule(byRule);
        })
        .catch(() => {
          // Who owns them goes unsaid; the server still refuses what it must.
          setOwningTeamsByRule(new Map<string, Array<OwningTeam>>());
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [readOwningTeams],
  );

  const getOwningTeams: (rule: TRule) => Array<OwningTeam> = useCallback(
    (rule: TRule): Array<OwningTeam> => {
      const ruleId: string | undefined = rule._id?.toString().toLowerCase();

      return (ruleId && owningTeamsByRule.get(ruleId)) || [];
    },
    [owningTeamsByRule],
  );

  const getEditDisabledReason: (rule: TRule) => string | undefined =
    useCallback(
      (rule: TRule): string | undefined => {
        return getRuleLockReason({
          model: ruleModel,
          action: ModelAction.Update,
          owningTeams: getOwningTeams(rule),
          translator: translator,
        });
      },
      [ruleModel, getOwningTeams, translator],
    );

  const getDeleteDisabledReason: (rule: TRule) => string | undefined =
    useCallback(
      (rule: TRule): string | undefined => {
        return getRuleLockReason({
          model: ruleModel,
          action: ModelAction.Delete,
          owningTeams: getOwningTeams(rule),
          translator: translator,
        });
      },
      [ruleModel, getOwningTeams, translator],
    );

  const onEditFormItemFetched: (rule: TRule) => Promise<TRule> = useCallback(
    async (rule: TRule): Promise<TRule> => {
      const ruleId: string | undefined = rule._id?.toString();

      if (!ruleId) {
        return rule;
      }

      const byRule: Map<string, Array<OwningTeam>> = await readOwningTeams([
        ruleId,
      ]);

      (rule as unknown as Record<string, unknown>)[
        RULE_OWNING_TEAMS_VALUE_KEY
      ] = (byRule.get(ruleId.toLowerCase()) || []).map(
        (team: OwningTeam): string => {
          return team.id;
        },
      );

      return rule;
    },
    [readOwningTeams],
  );

  const owningTeamsColumn: Column<TRule> = useMemo((): Column<TRule> => {
    return {
      field: {
        _id: true,
      } as unknown as Column<TRule>["field"],
      title: RULE_OWNING_TEAMS_TITLE,
      type: FieldType.Element,
      hideOnMobile: true,
      disableSort: true,
      // A list of cards names the teams only on the rules they own.
      showInListIf: (rule: TRule): boolean => {
        return getOwningTeams(rule).length > 0;
      },
      getElement: (rule: TRule): ReactElement => {
        const owners: Array<ResourceOwnerEntry> = getOwningTeams(rule).map(
          (team: OwningTeam): ResourceOwnerEntry => {
            const owningTeam: Team = new Team();
            owningTeam._id = team.id;
            owningTeam.name = team.name;

            return { kind: "team", team: owningTeam };
          },
        );

        return <OwnersCell owners={owners} isLoading={isLoading} />;
      },
    };
  }, [getOwningTeams, isLoading]);

  const getFormField: RuleOwningTeamsTable<TRule>["getFormField"] =
    useCallback(
      (options: {
        stepId: string;
        collapsibleSection?: FormFieldCollapsibleSection<TRule> | undefined;
      }): Field<TRule> => {
        return getRuleOwningTeamsFormField<TRule>({
          owningTeamModelType: data.owningTeamModelType,
          stepId: options.stepId,
          collapsibleSection: options.collapsibleSection,
        });
      },
      [data.owningTeamModelType],
    );

  return {
    onRulesFetched,
    owningTeamsColumn,
    getEditDisabledReason,
    getDeleteDisabledReason,
    onEditFormItemFetched,
    getFormField,
  };
}

export default useRuleOwningTeams;
