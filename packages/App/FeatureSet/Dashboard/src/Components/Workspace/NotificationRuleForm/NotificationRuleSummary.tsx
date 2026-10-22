import {
  MicrosoftTeamsChat,
  MicrosoftTeamsTeam,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { WorkspaceChannelNumberPrefixes } from "Common/Utils/Workspace/WorkspaceChannelName";
import { toPeoplePickerIds } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  ChannelNameExample,
  getChannelNameExample,
  getShownChannelName,
} from "./ChannelNamePreview";
import {
  getNothingChosenSentence,
  getNotificationRuleSummary,
} from "./NotificationRuleCopy";

/*
 * WHAT A RULE DOES, AS A FEW SENTENCES.
 *
 * Under the rule form's Destination step, following the choices as they
 * are made, and on the rule's card: "Creates a channel like #inc-42 for
 * each incident. Invites on-call responders as they are paged, the
 * Incident Commander and other incident roles as they are assigned and
 * owners as they are added. Archives the channel when the incident is
 * resolved. Posts updates in #ops." The sentences come from
 * NotificationRuleCopy; this finds the names they need.
 */

// The rule, and what it refers to by id: the names its sentences need.
export interface RuleSummarySource {
  rule: Partial<IncidentNotificationRule> | undefined;
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
  users: Array<User>;
  teams: Array<Team>;
  // The project's on-call schedules, to name those whose on-call person joins.
  onCallSchedules?: Array<OnCallDutyPolicySchedule> | undefined;
  microsoftTeamsTeams?: Array<MicrosoftTeamsTeam> | undefined;
  microsoftTeamsChats?: Array<MicrosoftTeamsChat> | undefined;
  numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
  exampleRecordName?: string | undefined;
}

export interface NotificationRuleSummaryProps extends RuleSummarySource {
  // Say what is still to choose when the rule posts nowhere (the form).
  showWhenEmpty?: boolean | undefined;
  dataTestId?: string | undefined;
}

function namesOf<T extends { _id?: string | undefined }>(data: {
  ids: Array<string>;
  rows: Array<T>;
  nameOf: (row: T) => string | undefined;
}): Array<string> {
  return data.ids
    .map((id: string): string => {
      const row: T | undefined = data.rows.find((candidate: T): boolean => {
        return candidate._id?.toString() === id;
      });

      return (row && data.nameOf(row)) || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });
}

export const getRuleSummarySentences: (
  props: RuleSummarySource & { translator: Translator },
) => Array<string> = (
  props: RuleSummarySource & { translator: Translator },
): Array<string> => {
  const rule: Partial<IncidentNotificationRule> = props.rule || {};

  const example: ChannelNameExample | null = getChannelNameExample({
    workspaceType: props.workspaceType,
    eventType: props.eventType,
    prefix: rule.newChannelTemplateName,
    numberPrefixes: props.numberPrefixes,
    exampleRecordName: props.exampleRecordName,
  });

  const channelTeam: MicrosoftTeamsTeam | undefined = (
    props.microsoftTeamsTeams || []
  ).find((team: MicrosoftTeamsTeam): boolean => {
    return team.id === rule.teamToCreateChannelIn;
  });

  const chatIds: Array<string> = toPeoplePickerIds(rule.existingChatIds);

  return getNotificationRuleSummary({
    rule: rule,
    eventType: props.eventType,
    workspaceType: props.workspaceType,
    translator: props.translator,
    exampleChannelName: example
      ? getShownChannelName(props.workspaceType, example.description.name)
      : undefined,
    userNames: namesOf<User>({
      ids: toPeoplePickerIds(rule.inviteUsersToNewChannel),
      rows: props.users,
      nameOf: (user: User): string | undefined => {
        return user.name?.toString() || user.email?.toString() || undefined;
      },
    }),
    teamNames: namesOf<Team>({
      ids: toPeoplePickerIds(rule.inviteTeamsToNewChannel),
      rows: props.teams,
      nameOf: (team: Team): string | undefined => {
        return team.name?.toString() || undefined;
      },
    }),
    scheduleNames: namesOf<OnCallDutyPolicySchedule>({
      ids: toPeoplePickerIds(rule.inviteOnCallSchedulesToNewChannel),
      rows: props.onCallSchedules || [],
      nameOf: (schedule: OnCallDutyPolicySchedule): string | undefined => {
        return schedule.name?.toString() || undefined;
      },
    }),
    channelTeamName: channelTeam?.name,
    chatNames: chatIds
      .map((chatId: string): string => {
        return (
          (props.microsoftTeamsChats || []).find(
            (chat: MicrosoftTeamsChat): boolean => {
              return chat.id === chatId;
            },
          )?.name || ""
        );
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      }),
  });
};

const NotificationRuleSummary: FunctionComponent<
  NotificationRuleSummaryProps
> = (props: NotificationRuleSummaryProps): ReactElement => {
  const translator: Translator = useTranslator();

  const sentences: Array<string> = getRuleSummarySentences({
    rule: props.rule,
    eventType: props.eventType,
    workspaceType: props.workspaceType,
    users: props.users,
    teams: props.teams,
    onCallSchedules: props.onCallSchedules,
    microsoftTeamsTeams: props.microsoftTeamsTeams,
    microsoftTeamsChats: props.microsoftTeamsChats,
    numberPrefixes: props.numberPrefixes,
    exampleRecordName: props.exampleRecordName,
    translator: translator,
  });

  if (sentences.length === 0) {
    if (!props.showWhenEmpty) {
      return <></>;
    }

    return (
      <p data-testid={props.dataTestId} className="text-sm text-gray-500">
        {translator.translateText(
          getNothingChosenSentence({
            eventType: props.eventType,
            workspaceType: props.workspaceType,
          }),
        )}
      </p>
    );
  }

  return (
    <ul
      data-testid={props.dataTestId}
      className="list-disc space-y-1 pl-5 text-sm text-gray-700 marker:text-gray-400"
    >
      {sentences.map((sentence: string, index: number): ReactElement => {
        return (
          <li key={index} className="break-words">
            {sentence}
          </li>
        );
      })}
    </ul>
  );
};

export default NotificationRuleSummary;
