import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import WorkspaceChannelName, {
  WorkspaceChannelNameDescription,
  WorkspaceChannelNameExample,
  WorkspaceChannelNumberPrefixes,
} from "Common/Utils/Workspace/WorkspaceChannelName";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE NAME OF THE CHANNEL A RULE CREATES, AS PEOPLE WILL SEE IT.
 *
 * A rule that creates a Slack or Microsoft Teams channel for each incident
 * (alert, episode, scheduled maintenance event, monitor, on-call policy)
 * names it after the record - incident INC-42's channel is inc-42 - with the
 * rule's Channel Name Prefix, when it has one, in front: prod-inc-42. Under
 * the prefix field, ChannelNamePreview shows the name an example record's
 * channel gets as the prefix is typed; on the rule's card, ChannelNameSummary
 * shows the prefix and that example, as the Number Prefix pages show a number
 * prefix. Both work the name out with the function the server names channels
 * with (Common/Utils/Workspace/WorkspaceChannelName), from the project's own
 * number prefixes (GET /workspace-notification-rule/number-prefixes), so the
 * preview is the name the channel will have.
 *
 * Every sentence is a whole sentence in the locale files, so it reads right
 * in every language. font-mono sits on each element that holds a channel
 * name itself: index.ejs gives every element Inter.
 */

/*
 * What the prefix field says it is for, by the kind of record the rule is
 * for. The preview under the field shows the name.
 *
 * A scheduled maintenance event's says what a prefix does to its name: the
 * prefix takes the place of the event's number prefix (sm-42 without one,
 * maint-42 with maint-), as rules with a prefix have always named those
 * channels (WorkspaceChannelName.forNumberedRecord). "Goes in front of that
 * name" would promise maint-sm-42, and the preview would show otherwise.
 */
export const CHANNEL_NAME_PREFIX_DESCRIPTIONS: Record<
  NotificationRuleEventType,
  string
> = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Each new channel is named after its incident. Anything you write here goes in front of that name.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Each new channel is named after its alert. Anything you write here goes in front of that name.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Each new channel is named after its incident episode. Anything you write here goes in front of that name.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Each new channel is named after its alert episode. Anything you write here goes in front of that name.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Each new channel is named after its scheduled maintenance event. Anything you write here replaces the event's number prefix.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Each new channel is named after its monitor. Anything you write here goes in front of that name.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Each new channel is named after its on-call policy. Anything you write here goes in front of that name.",
  ),
};

// Which record the example name is for: "For incident INC-42."
export const CHANNEL_NAME_EXAMPLE_RECORD_SENTENCES: Record<
  NotificationRuleEventType,
  string
> = {
  [NotificationRuleEventType.Incident]: translationKey(
    "For incident {{record}}.",
  ),
  [NotificationRuleEventType.Alert]: translationKey("For alert {{record}}."),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "For incident episode {{record}}.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "For alert episode {{record}}.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "For scheduled maintenance event {{record}}.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "For the monitor {{record}}.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "For the on-call policy {{record}}.",
  ),
};

// When the prefix lost characters on its way into the name.
export const CHANNEL_NAME_CHARACTER_NOTES: Record<WorkspaceType, string> = {
  [WorkspaceType.Slack]: translationKey(
    "Slack channel names use only lowercase letters, numbers, - and _.",
  ),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "OneUptime uses only letters, numbers, spaces, - and _ in Microsoft Teams channel names.",
  ),
};

// When the name was too long for the workspace.
export const CHANNEL_NAME_SHORTENED_NOTES: Record<WorkspaceType, string> = {
  [WorkspaceType.Slack]: translationKey(
    "Shortened to Slack's limit of {{count}} characters.",
  ),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "Shortened to the Microsoft Teams limit of {{count}} characters.",
  ),
};

// What happens when somebody has the name already.
export const CHANNEL_NAME_TAKEN_NOTES: Record<WorkspaceType, string> = {
  [WorkspaceType.Slack]: translationKey(
    "If Slack already has a channel with this name, OneUptime adds -2 to the end.",
  ),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "If the team already has a channel with this name, OneUptime adds -2 to the end.",
  ),
};

// A channel name as the workspace shows it: #inc-42 in Slack, inc-42 in Microsoft Teams.
export const getShownChannelName: (
  workspaceType: WorkspaceType,
  name: string,
) => string = (workspaceType: WorkspaceType, name: string): string => {
  return workspaceType === WorkspaceType.Slack ? `#${name}` : name;
};

// What a channel name is shown for: the rule, its prefix and the project.
export interface ChannelNameExampleInput {
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
  // The prefix as the rule holds it, or as the field holds it while typed.
  prefix: unknown;
  /*
   * The project's number prefixes. Until they are known, nothing is shown
   * for a numbered record: its channel is named after its number.
   */
  numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
  // A monitor's or on-call policy's name to show the name with.
  exampleRecordName?: string | undefined;
}

export interface ChannelNameExampleProps extends ChannelNameExampleInput {
  /*
   * The element's id. The prefix field names the preview as what describes
   * it (aria-describedby), so a screen reader reads the channel name with
   * the field.
   */
  id?: string | undefined;
  dataTestId?: string | undefined;
}

export interface ChannelNameExample {
  example: WorkspaceChannelNameExample;
  description: WorkspaceChannelNameDescription;
  prefix: string;
}

// The prefix a value holds: "" for none, as the server reads it.
const getPrefixOf: (value: unknown) => string = (value: unknown): string => {
  return WorkspaceChannelName.getPrefix({
    newChannelTemplateName: typeof value === "string" ? value : undefined,
  });
};

/*
 * The name an example record's channel gets with the prefix, or null while
 * the project's number prefixes are not known.
 */
export const getChannelNameExample: (
  props: ChannelNameExampleInput,
) => ChannelNameExample | null = (
  props: ChannelNameExampleInput,
): ChannelNameExample | null => {
  if (
    WorkspaceChannelName.isNumberedRecord(props.eventType) &&
    !props.numberPrefixes
  ) {
    return null;
  }

  const prefix: string = getPrefixOf(props.prefix);

  const example: WorkspaceChannelNameExample = WorkspaceChannelName.getExample({
    eventType: props.eventType,
    numberPrefixes: props.numberPrefixes,
    recordName: props.exampleRecordName,
  });

  return {
    example: example,
    prefix: prefix,
    description: WorkspaceChannelName.describe({
      workspaceType: props.workspaceType,
      prefix: prefix,
      parts: example.parts,
    }),
  };
};

/*
 * The sentences under a preview about the name shown, in the reader's
 * language: which record the example is for, and what the workspace changed
 * in what was typed.
 */
export const getChannelNamePreviewNotes: (data: {
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
  example: ChannelNameExample;
  translator: Translator;
}) => Array<string> = (data: {
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
  example: ChannelNameExample;
  translator: Translator;
}): Array<string> => {
  const notes: Array<string> = [
    data.translator.translateTemplate(
      CHANNEL_NAME_EXAMPLE_RECORD_SENTENCES[data.eventType],
      {
        record: data.example.example.recordName,
      },
    ),
  ];

  if (data.example.description.prefixChanged) {
    notes.push(
      data.translator.translateText(
        CHANNEL_NAME_CHARACTER_NOTES[data.workspaceType],
      ) || "",
    );
  }

  if (data.example.description.shortened) {
    notes.push(
      data.translator.translateTemplate(
        CHANNEL_NAME_SHORTENED_NOTES[data.workspaceType],
        {
          count: String(WorkspaceChannelName.getMaxLength(data.workspaceType)),
        },
      ),
    );
  }

  return notes.filter((note: string): boolean => {
    return Boolean(note);
  });
};

/*
 * What happens when the workspace already has a channel by the name, in the
 * reader's language. The same for every name, so the preview gives it a line
 * of its own, under the sentences about the name shown.
 */
export const getChannelNameTakenNote: (data: {
  workspaceType: WorkspaceType;
  translator: Translator;
}) => string = (data: {
  workspaceType: WorkspaceType;
  translator: Translator;
}): string => {
  return (
    data.translator.translateText(
      CHANNEL_NAME_TAKEN_NOTES[data.workspaceType],
    ) || ""
  );
};

/*
 * Under the Channel Name Prefix field: the name an example record's channel
 * gets with the prefix as it is typed - "Preview: #prod-inc-42" - then which
 * record that is and what the workspace changed, and on a line of its own
 * what happens to a name that is taken.
 *
 * The name runs on from its label as text does, so the two share a baseline
 * whatever the fonts, and a long name wraps after the label rather than
 * leaving it alone on a line.
 */
export const ChannelNamePreview: FunctionComponent<ChannelNameExampleProps> = (
  props: ChannelNameExampleProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const example: ChannelNameExample | null = getChannelNameExample({
    workspaceType: props.workspaceType,
    eventType: props.eventType,
    prefix: props.prefix,
    numberPrefixes: props.numberPrefixes,
    exampleRecordName: props.exampleRecordName,
  });

  if (!example) {
    return <></>;
  }

  const notes: Array<string> = getChannelNamePreviewNotes({
    workspaceType: props.workspaceType,
    eventType: props.eventType,
    example: example,
    translator: translator,
  });

  const takenNote: string = getChannelNameTakenNote({
    workspaceType: props.workspaceType,
    translator: translator,
  });

  return (
    <div
      id={props.id}
      data-testid={props.dataTestId}
      className="mt-2 space-y-1 text-sm text-gray-500"
    >
      <p>
        {translator.translateText("Preview:")}{" "}
        <span
          data-testid="channel-name-preview"
          className="ml-1 break-words font-mono font-medium text-gray-900"
        >
          {getShownChannelName(props.workspaceType, example.description.name)}
        </span>
      </p>
      <p data-testid="channel-name-preview-notes">{joinSentences(notes)}</p>
      {takenNote ? (
        <p data-testid="channel-name-preview-taken">{takenNote}</p>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * On a rule's card: the rule's prefix, or "No prefix", and the name an
 * example record's channel gets - "prod-   Example: #prod-inc-42", as the
 * Number Prefix pages show a prefix and its number.
 *
 * "Example:" and its name are one piece that wraps as a whole, so a long
 * prefix never leaves the label at the end of one line and its name on the
 * next; the pieces share a baseline, and a prefix or name longer than the
 * card wraps inside it.
 */
export const ChannelNameSummary: FunctionComponent<ChannelNameExampleProps> = (
  props: ChannelNameExampleProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const prefix: string = getPrefixOf(props.prefix);

  const example: ChannelNameExample | null = getChannelNameExample({
    workspaceType: props.workspaceType,
    eventType: props.eventType,
    prefix: props.prefix,
    numberPrefixes: props.numberPrefixes,
    exampleRecordName: props.exampleRecordName,
  });

  return (
    <div
      data-testid={props.dataTestId}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
    >
      {prefix ? (
        <code
          data-testid="channel-name-prefix-value"
          className="min-w-0 break-words rounded-md bg-gray-100 px-2 py-0.5 font-mono text-sm font-semibold text-gray-900"
        >
          {prefix}
        </code>
      ) : (
        <span
          data-testid="channel-name-prefix-value"
          className="text-sm text-gray-500"
        >
          {translator.translateText("No prefix")}
        </span>
      )}
      {example ? (
        <>
          {" "}
          <span className="min-w-0 text-sm text-gray-500">
            {translator.translateText("Example:")}{" "}
            <span
              data-testid="channel-name-example"
              className="ml-1 break-words font-mono text-gray-900"
            >
              {getShownChannelName(
                props.workspaceType,
                example.description.name,
              )}
            </span>
          </span>
        </>
      ) : (
        <></>
      )}
    </div>
  );
};
