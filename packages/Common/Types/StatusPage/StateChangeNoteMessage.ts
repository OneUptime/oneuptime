import Text from "../Text";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import {
  composedValue,
  ComposedValue,
  createTranslator,
  translationKey,
  Translator,
} from "../Translator";
import { translateStateName } from "./DefaultStatusNames";

/*
 * WHAT A PUBLIC NOTE POSTED WITH A STATE CHANGE ADDS TO ITS MESSAGES.
 *
 * With "Notify Status Page Subscribers" on, the public note posted with a
 * state change is the one message subscribers get about the change, for
 * incidents and scheduled maintenance alike
 * (StateChangeSubscriberNotification). The note's default messages never
 * said what the change was, so subscribers did not learn the state. Such a
 * note now carries the state the event moved to
 * (Server/Utils/StatusPage/StateChangePublicNote), and every default message
 * of it names that state, in the words the state change's own message used:
 *
 *   - the email: a "Status" row in its details, and the subject the state
 *     change email had ("[Resolved Incident] Checkout is down");
 *   - the SMS: "Incident Checkout is down on Acme Status is Resolved.";
 *   - Slack and Microsoft Teams: a "**Status:** Resolved" line;
 *   - the webhook payload: `incidentState` / `scheduledMaintenanceState` in
 *     `data`, named as in the state change's own payload.
 *
 * A note posted on its own carries no state, and its messages are as they
 * always were. Custom templates already have the state, as
 * {{incidentState}} and {{scheduledMaintenanceState}}: for a note posted
 * with a state change it is the state the change moved to.
 *
 * Each message is written in the language of the translator it is handed -
 * a subscriber's (Server/Utils/StatusPage/SubscriberLanguage), with
 * OneUptime's default state names in that language and a project's own as
 * written. Without one it is the English it always was.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

export const StateChangeNoteText: {
  readonly incidentEmailSubject: string;
  readonly incidentCustomTemplateEmailSubject: string;
  readonly scheduledMaintenanceEmailSubject: string;
  readonly scheduledMaintenanceCustomTemplateEmailSubject: string;
  readonly incidentSmsHeadline: string;
  readonly scheduledMaintenanceSmsHeadline: string;
  readonly chatStatusLabel: string;
} = {
  incidentEmailSubject: translationKey("[{{state}} Incident] {{title}}"),
  incidentCustomTemplateEmailSubject: translationKey(
    "[Incident {{state}}] {{title}}",
  ),
  scheduledMaintenanceEmailSubject: translationKey(
    "[{{state}} Scheduled Maintenance] {{title}}",
  ),
  scheduledMaintenanceCustomTemplateEmailSubject: translationKey(
    "[Scheduled Maintenance {{state}}] {{title}}",
  ),
  incidentSmsHeadline: translationKey(
    "Incident {{title}} on {{statusPageName}} is {{state}}.",
  ),
  scheduledMaintenanceSmsHeadline: translationKey(
    "Maintenance {{title}} on {{statusPageName}} is {{state}}.",
  ),
  chatStatusLabel: translationKey("Status:"),
};

export default class StateChangeNoteMessage {
  // The label of the line every chat message and email names the state on.
  public static readonly statusLabel: string = "Status";

  // A state as the state change messages always wrote it: "Resolved".
  public static formatStateName(stateName: string): string {
    return Text.uppercaseFirstLetter(stateName.trim());
  }

  /*
   * A state as a sentence names it: as formatStateName writes it, with
   * OneUptime's default names in the sentence's language.
   */
  public static stateInSentence(stateName: string): ComposedValue {
    return composedValue((translator: Translator): string => {
      return StateChangeNoteMessage.formatStateName(
        translateStateName(translator, stateName.trim()),
      );
    });
  }

  // The default incident email's subject: "[Resolved Incident] <title>".
  public static getIncidentEmailSubject(data: {
    stateName: string;
    incidentTitle: string;
    translator?: Translator | undefined;
  }): string {
    return (data.translator || ENGLISH).translateTemplate(
      StateChangeNoteText.incidentEmailSubject,
      {
        state: this.stateInSentence(data.stateName),
        title: data.incidentTitle,
      },
    );
  }

  /*
   * A custom incident email template's subject when it has none of its own:
   * "[Incident Resolved] <title>", as the state change's was.
   */
  public static getIncidentCustomTemplateEmailSubject(data: {
    stateName: string;
    incidentTitle: string;
    translator?: Translator | undefined;
  }): string {
    return (data.translator || ENGLISH).translateTemplate(
      StateChangeNoteText.incidentCustomTemplateEmailSubject,
      {
        state: this.stateInSentence(data.stateName),
        title: data.incidentTitle,
      },
    );
  }

  /*
   * The default scheduled maintenance email's subject:
   * "[Ongoing Scheduled Maintenance] <title>".
   */
  public static getScheduledMaintenanceEmailSubject(data: {
    stateName: string;
    eventTitle: string;
    translator?: Translator | undefined;
  }): string {
    return (data.translator || ENGLISH).translateTemplate(
      StateChangeNoteText.scheduledMaintenanceEmailSubject,
      {
        state: this.stateInSentence(data.stateName),
        title: data.eventTitle,
      },
    );
  }

  /*
   * A custom scheduled maintenance email template's subject when it has
   * none of its own: "[Scheduled Maintenance Ongoing] <title>".
   */
  public static getScheduledMaintenanceCustomTemplateEmailSubject(data: {
    stateName: string;
    eventTitle: string;
    translator?: Translator | undefined;
  }): string {
    return (data.translator || ENGLISH).translateTemplate(
      StateChangeNoteText.scheduledMaintenanceCustomTemplateEmailSubject,
      {
        state: this.stateInSentence(data.stateName),
        title: data.eventTitle,
      },
    );
  }

  // How the default incident SMS starts: "Incident <title> on <page> is Resolved."
  public static getIncidentSmsHeadline(data: {
    stateName: string;
    incidentTitle: string;
    statusPageName: string;
    translator?: Translator | undefined;
  }): string {
    return (data.translator || ENGLISH).translateTemplate(
      StateChangeNoteText.incidentSmsHeadline,
      {
        title: data.incidentTitle,
        statusPageName: data.statusPageName,
        state: this.stateInSentence(data.stateName),
      },
    );
  }

  /*
   * How the default scheduled maintenance SMS starts:
   * "Maintenance <title> on <page> is Ongoing."
   */
  public static getScheduledMaintenanceSmsHeadline(data: {
    stateName: string;
    eventTitle: string;
    statusPageName: string;
    translator?: Translator | undefined;
  }): string {
    return (data.translator || ENGLISH).translateTemplate(
      StateChangeNoteText.scheduledMaintenanceSmsHeadline,
      {
        title: data.eventTitle,
        statusPageName: data.statusPageName,
        state: this.stateInSentence(data.stateName),
      },
    );
  }

  /*
   * The line a default Slack or Microsoft Teams message names the state on.
   * The state's name is plain text in a Markdown message, placed as text
   * (mdText), so it reads as typed - OneUptime's default names in the
   * reader's language, a project's own as written.
   */
  public static getChatStatusLine(
    stateName: string,
    translator?: Translator | undefined,
  ): MarkdownText {
    const reader: Translator = translator || ENGLISH;
    const label: string =
      reader.translateText(StateChangeNoteText.chatStatusLabel) ||
      StateChangeNoteText.chatStatusLabel;

    return mdText`**${label}** ${translateStateName(reader, stateName.trim())}`;
  }
}
