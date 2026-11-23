import TeamElement from "../Team/Team";
import IngestionKeyBudgetSummary from "./IngestionKeyBudgetSummary";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TelemetryIngestionTeamLabelBudget from "Common/Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryIngestionBudgetValueKind } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import LabelElement from "Common/UI/Components/Label/Label";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  getSharedNameFacts,
  getSharedNameSelect,
} from "Common/UI/Utils/SharedNameOptions";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Team and label budgets (issue #6386), on Project Settings > Telemetry &
 * APM > Usage, under More settings: a daily budget, inside the project's,
 * for the telemetry of the services, hosts and other resources a team owns
 * or that carry a label (#10101). The form asks two things: whose budget it is - one picker, the
 * project's teams and its labels in two groups - and its logs budget, what
 * a runaway service fills first; the other signals fold under More fields.
 * What happens when one is used up, and who is told, is said on the card.
 */

export const TEAM_LABEL_BUDGETS_CARD_TITLE: string = translationKey(
  "Team and Label Budgets",
);
export const TEAM_LABEL_BUDGETS_CARD_DESCRIPTION: string = translationKey(
  "A daily budget for the services, hosts and other resources a team owns or a label is on. Once it is used up, their telemetry is dropped until the reset, and Project Owners are emailed.",
);

// The form's own pick of whose budget it is: sent as teamId or labelId.
export const TEAM_OR_LABEL_FIELD_KEY: string = "telemetryBudgetTeamOrLabel";

const TEAM_VALUE_PREFIX: string = "team:";
const LABEL_VALUE_PREFIX: string = "label:";

export interface TeamOrLabelPick {
  teamId: ObjectID | null;
  labelId: ObjectID | null;
}

// A picked option's value: "team:<id>" or "label:<id>".
export const getTeamOrLabelOptionValue: (data: {
  teamId?: ObjectID | string | undefined;
  labelId?: ObjectID | string | undefined;
}) => string = (data: {
  teamId?: ObjectID | string | undefined;
  labelId?: ObjectID | string | undefined;
}): string => {
  return data.teamId
    ? `${TEAM_VALUE_PREFIX}${data.teamId.toString()}`
    : `${LABEL_VALUE_PREFIX}${data.labelId?.toString() || ""}`;
};

// What a picked value names: a team, a label, or (not a value) neither.
export const readTeamOrLabelPick: (value: unknown) => TeamOrLabelPick = (
  value: unknown,
): TeamOrLabelPick => {
  const text: string = typeof value === "string" ? value.trim() : "";

  for (const [prefix, isTeam] of [
    [TEAM_VALUE_PREFIX, true],
    [LABEL_VALUE_PREFIX, false],
  ] as Array<[string, boolean]>) {
    if (!text.startsWith(prefix)) {
      continue;
    }

    const id: string = text.slice(prefix.length);

    if (!ObjectID.isValidUUID(id)) {
      break;
    }

    return {
      teamId: isTeam ? new ObjectID(id) : null,
      labelId: isTeam ? null : new ObjectID(id),
    };
  }

  return { teamId: null, labelId: null };
};

/*
 * The budget the form creates, for the team or the label picked. The
 * server refuses one for neither, in its own words.
 */
export const applyTeamOrLabelPick: (
  item: TelemetryIngestionTeamLabelBudget,
  formValues: JSONObject,
) => TelemetryIngestionTeamLabelBudget = (
  item: TelemetryIngestionTeamLabelBudget,
  formValues: JSONObject,
): TelemetryIngestionTeamLabelBudget => {
  const pick: TeamOrLabelPick = readTeamOrLabelPick(
    formValues[TEAM_OR_LABEL_FIELD_KEY],
  );

  if (pick.teamId) {
    item.teamId = pick.teamId;
  }

  if (pick.labelId) {
    item.labelId = pick.labelId;
  }

  return item;
};

// The project's teams and labels, as the picker groups them.
export const getTeamOrLabelOptions: (data: {
  teams: Array<Team>;
  labels: Array<Label>;
  translator: Translator;
}) => Array<DropdownOptionGroup> = (data: {
  teams: Array<Team>;
  labels: Array<Label>;
  translator: Translator;
}): Array<DropdownOptionGroup> => {
  const groups: Array<DropdownOptionGroup> = [];

  const teams: Array<DropdownOption> = data.teams
    .filter((team: Team): boolean => {
      return Boolean(team.id);
    })
    .map((team: Team): DropdownOption => {
      return {
        value: getTeamOrLabelOptionValue({ teamId: team.id! }),
        label: team.name || team.id!.toString(),
        // A team's name is its owner's, drawn as written.
        isUserContent: true,
        // Teams of one name are told apart (#10064).
        sharedName: getSharedNameFacts(team),
      };
    });

  const labels: Array<DropdownOption> = data.labels
    .filter((label: Label): boolean => {
      return Boolean(label.id);
    })
    .map((label: Label): DropdownOption => {
      const option: DropdownOption = {
        value: getTeamOrLabelOptionValue({ labelId: label.id! }),
        label: label.name || label.id!.toString(),
        isUserContent: true,
        sharedName: getSharedNameFacts(label),
      };

      if (label.color) {
        option.color =
          typeof label.color === "string"
            ? Color.fromString(label.color)
            : label.color;
      }

      return option;
    });

  if (teams.length > 0) {
    groups.push({
      label: data.translator.translateText("Teams") || "Teams",
      options: teams,
    });
  }

  if (labels.length > 0) {
    groups.push({
      label: data.translator.translateText("Labels") || "Labels",
      options: labels,
    });
  }

  return groups;
};

const fetchTeamOrLabelOptions: (
  translator: Translator,
) => Promise<Array<DropdownOptionGroup>> = async (
  translator: Translator,
): Promise<Array<DropdownOptionGroup>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const [teams, labels]: [ListResult<Team>, ListResult<Label>] =
    await Promise.all([
      ModelAPI.getList<Team>({
        modelType: Team,
        query: { projectId: projectId },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: { _id: true, name: true, ...getSharedNameSelect(Team) },
        sort: { name: SortOrder.Ascending },
      }),
      ModelAPI.getList<Label>({
        modelType: Label,
        /*
         * A new budget's pick: archived labels are left out, as every
         * picker leaves them (the server refuses a budget for one).
         */
        query: ArchivedValuePicker.getPickerQuery(Label, {
          projectId: projectId,
        }),
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          _id: true,
          name: true,
          color: true,
          ...getSharedNameSelect(Label),
        },
        sort: { name: SortOrder.Ascending },
      }),
    ]);

  return getTeamOrLabelOptions({
    teams: teams.data,
    labels: labels.data,
    translator: translator,
  });
};

export interface ComponentProps {
  // How many budgets the project has, as the table reads them.
  onCountChange?: ((count: number) => void) | undefined;
}

const TeamLabelBudgetsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const moreSignals: FormFieldCollapsibleSection<TelemetryIngestionTeamLabelBudget> =
    getAdvancedFormSection<TelemetryIngestionTeamLabelBudget>();

  return (
    <ModelTable<TelemetryIngestionTeamLabelBudget>
      modelType={TelemetryIngestionTeamLabelBudget}
      id="telemetry-ingestion-team-label-budgets"
      name="Settings > Telemetry > Usage > Team and Label Budgets"
      userPreferencesKey="telemetry-ingestion-team-label-budgets"
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      singularName="Budget"
      documentationLink={Route.fromString(
        "/docs/telemetry/ingestion-budgets#give-a-team-or-a-label-its-own-budget",
      )}
      cardProps={{
        title: TEAM_LABEL_BUDGETS_CARD_TITLE,
        description: TEAM_LABEL_BUDGETS_CARD_DESCRIPTION,
      }}
      noItemsMessage={"No team or label budgets yet."}
      showRefreshButton={true}
      // A project has a budget for a few teams and labels: nothing to filter.
      filters={[]}
      onFetchSuccess={(
        _data: Array<TelemetryIngestionTeamLabelBudget>,
        totalCount: number,
      ) => {
        props.onCountChange?.(totalCount);
      }}
      onBeforeCreate={(
        item: TelemetryIngestionTeamLabelBudget,
        _miscDataProps: JSONObject,
        formValues: JSONObject,
      ): Promise<TelemetryIngestionTeamLabelBudget> => {
        return Promise.resolve(applyTeamOrLabelPick(item, formValues));
      }}
      formFields={[
        {
          /*
           * Not a column: the pick, which onBeforeCreate turns into the
           * budget's teamId or labelId. Its permission is teamId's.
           */
          overrideField: { teamId: true },
          overrideFieldKey: TEAM_OR_LABEL_FIELD_KEY,
          formOnly: true,
          title: "Team or Label",
          fieldType: FormFieldSchemaType.Dropdown,
          fetchDropdownOptions: () => {
            return fetchTeamOrLabelOptions(translator);
          },
          required: true,
          doNotShowWhenEditing: true,
          hideColumnDescription: true,
          placeholder: "Choose a team or a label",
        },
        {
          field: { logsDailyIngestionBudgetInGB: true },
          title: "Logs (GB per day)",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          hideColumnDescription: true,
          description:
            "Leave a signal empty for no budget of its own: the project's still applies.",
          placeholder: "No budget of its own",
          validation: { minValue: 0 },
        },
        {
          field: { tracesDailyIngestionBudgetInGB: true },
          title: "Traces (GB per day)",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          hideColumnDescription: true,
          placeholder: "No budget of its own",
          validation: { minValue: 0 },
          collapsibleSection: moreSignals,
        },
        {
          field: { metricsDailyIngestionBudgetInGB: true },
          title: "Metrics (GB per day)",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          hideColumnDescription: true,
          placeholder: "No budget of its own",
          validation: { minValue: 0 },
          collapsibleSection: moreSignals,
        },
        {
          field: { profilesDailyIngestionBudgetInGB: true },
          title: "Profiles (GB per day)",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          hideColumnDescription: true,
          placeholder: "No budget of its own",
          validation: { minValue: 0 },
          collapsibleSection: moreSignals,
        },
      ]}
      columns={[
        {
          field: {
            team: { name: true, _id: true },
            label: { name: true, color: true, _id: true },
          },
          title: "Team or Label",
          type: FieldType.Element,
          getElement: (
            item: TelemetryIngestionTeamLabelBudget,
          ): ReactElement => {
            if (item.team) {
              return <TeamElement team={item.team} />;
            }

            if (item.label) {
              return <LabelElement label={item.label} />;
            }

            return <></>;
          },
        },
        {
          field: {
            logsDailyIngestionBudgetInGB: true,
            tracesDailyIngestionBudgetInGB: true,
            metricsDailyIngestionBudgetInGB: true,
            profilesDailyIngestionBudgetInGB: true,
          },
          title: "Daily Budgets",
          type: FieldType.Element,
          getElement: (
            item: TelemetryIngestionTeamLabelBudget,
          ): ReactElement => {
            return (
              <IngestionKeyBudgetSummary
                item={item}
                kind={TelemetryIngestionBudgetValueKind.DailyBudget}
              />
            );
          },
        },
      ]}
    />
  );
};

export default TeamLabelBudgetsTable;
