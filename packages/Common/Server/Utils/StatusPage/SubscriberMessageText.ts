import Text from "../../../Types/Text";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { writeDefaultSubscriberSms } from "../../../Utils/Sms/SubscriberSms";
import {
  composedValue,
  ComposedValue,
  TemplateValues,
  translationKey,
  Translator,
} from "../../../Types/Translator";
import { translateStateName } from "../../../Types/StatusPage/DefaultStatusNames";
import { isolateValueForReader } from "../ServerTranslation";

/*
 * ONEUPTIME'S OWN WORDS IN A STATUS PAGE'S SUBSCRIBER MESSAGES.
 *
 * The default text messages, Slack and Microsoft Teams messages and email
 * subjects a status page sends its subscribers are written whole in the
 * subscriber's language, with the translator their sender is handed
 * (Server/Utils/ServerTranslation's writeInLanguage, in the language
 * SubscriberLanguage gives). The default emails word their bodies in their
 * templates (Notification/Templates, through EmailLanguage's helpers).
 *
 * This module holds what the senders share: the pieces every message ends
 * with, the labels of the chat messages, and the ways a state's name and a
 * sentence are put in. Each sender keeps its own sentences beside it, each a
 * translationKey() template. Common/Server/Locales holds them in every
 * language (README.md there).
 *
 * Handed the English translator - what every message was written with
 * before - each piece is the English it always was, character for
 * character. Values go in as written: titles, names, notes, links. A
 * state's or a severity's name is OneUptime's default name in the reader's
 * language, or the project's own as written (translateStateName).
 *
 * A text message's links go out exactly as written (SubscriberSms): every
 * sentence keeps a space before each link, in every language
 * (Tests/Server/Utils/StatusPage/SubscriberMessageText.test.ts).
 */

// The full stop Chinese and Japanese end a sentence with.
const IDEOGRAPHIC_FULL_STOP: string = "\u{3002}";

/*
 * THE TEXT MESSAGES' SHARED PIECES.
 */
export const SubscriberSmsText: {
  readonly links: string;
  readonly incidentCreated: string;
  readonly incidentUpdate: string;
  readonly notePosted: string;
  readonly noteUpdated: string;
  readonly confirmSubscription: string;
  readonly subscribed: string;
  readonly manageSubscription: string;
} = {
  // How every notification's text message ends.
  links: translationKey("Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}"),
  // An incident, or an episode, that was just declared.
  incidentCreated: translationKey(
    "Incident {{title}} ({{severity}}) on {{statusPageName}}. Impact: {{resources}}.",
  ),
  // A note on an incident or an episode, posted or changed.
  incidentUpdate: translationKey(
    "Incident update: {{title}} on {{statusPageName}}.",
  ),
  notePosted: translationKey("A new note is posted."),
  noteUpdated: translationKey("A note has been updated."),
  /*
   * The messages about a subscription. The link to confirm one goes last,
   * so a phone shows it whole.
   */
  confirmSubscription: translationKey(
    "Confirm your subscription to {{statusPageName}} by text message within {{hours}} hours. Not you? Ignore this and you will not be subscribed. {{confirmationUrl}}",
  ),
  subscribed: translationKey(
    "You have been subscribed to {{statusPageName}}. To unsubscribe, click on the link: {{unsubscribeUrl}}",
  ),
  manageSubscription: translationKey(
    "You have selected to manage your subscription for the status page: {{statusPageName}}. You can manage your subscription here: {{manageUrl}}",
  ),
};

/*
 * THE SLACK AND MICROSOFT TEAMS MESSAGES' SHARED WORDS. A label is written
 * with the colon the reader's language puts after it ("Severity:",
 * "Gravité :", "重大度：").
 */
export const SubscriberChatText: {
  readonly incidentHeading: string;
  readonly severity: string;
  readonly resourcesAffected: string;
  readonly description: string;
  readonly status: string;
  readonly note: string;
  readonly viewStatusPage: string;
  readonly unsubscribe: string;
  readonly newIncidentNote: string;
  readonly incidentNoteUpdated: string;
} = {
  incidentHeading: translationKey("Incident - {{title}}"),
  severity: translationKey("Severity:"),
  resourcesAffected: translationKey("Resources Affected:"),
  description: translationKey("Description:"),
  status: translationKey("Status:"),
  note: translationKey("Note:"),
  viewStatusPage: translationKey("View Status Page"),
  unsubscribe: translationKey("Unsubscribe"),
  newIncidentNote: translationKey("New note has been added to an incident"),
  incidentNoteUpdated: translationKey(
    "A note on this incident has been updated",
  ),
};

// The message a Slack or Microsoft Teams channel gets when it is subscribed.
export const SubscribedChatText: {
  readonly heading: string;
  readonly subscribed: string;
  readonly statusPage: string;
  readonly unsubscribe: string;
  readonly stopTheseNotifications: string;
  readonly youWillReceive: string;
  readonly incidents: string;
  readonly scheduledMaintenance: string;
  readonly announcements: string;
  readonly statusUpdates: string;
  readonly stayInformed: string;
} = {
  heading: translationKey("New Subscription to {{statusPageName}}"),
  subscribed: translationKey(
    "You have successfully subscribed to receive status updates!",
  ),
  statusPage: translationKey("Status Page:"),
  unsubscribe: translationKey("Unsubscribe:"),
  stopTheseNotifications: translationKey("Stop these notifications"),
  youWillReceive: translationKey(
    "You will receive real-time notifications for:",
  ),
  incidents: translationKey("Incidents and outages"),
  scheduledMaintenance: translationKey("Maintenance events"),
  announcements: translationKey("Service announcements"),
  statusUpdates: translationKey("Status updates"),
  stayInformed: translationKey("Stay informed about service availability!"),
};

/*
 * THE WORDS THE SENDERS PUT IN THE DEFAULT EMAILS AND THEIR SUBJECTS.
 */
export const SubscriberEmailText: {
  readonly incidentSubject: string;
  readonly incidentOnIsState: string;
  readonly incidentIsState: string;
  readonly none: string;
  readonly statusPage: string;
  readonly confirmSubscriptionSubject: string;
  readonly subscribedSubject: string;
  readonly manageSubscriptionSubject: string;
  readonly reportSubject: string;
} = {
  incidentSubject: translationKey("[Incident] {{title}}"),
  // The heading of a state change email, with and without its resources.
  incidentOnIsState: translationKey("Incident on {{resources}} is {{state}}"),
  incidentIsState: translationKey("Incident is {{state}}"),
  // A resource list that lists none.
  none: translationKey("None"),
  // A status page with no title and no name.
  statusPage: translationKey("Status Page"),
  confirmSubscriptionSubject: translationKey(
    "Confirm your subscription to {{statusPageName}}",
  ),
  subscribedSubject: translationKey(
    "You have been subscribed to {{statusPageName}}",
  ),
  manageSubscriptionSubject: translationKey(
    "Manage your Subscription for {{statusPageName}}",
  ),
  // The uptime report's (StatusPageService.sendEmailReport).
  reportSubject: translationKey("[Report] {{statusPageName}}"),
};

export default class SubscriberMessageText {
  /*
   * A default text message: its sentences in the reader's language, in
   * GSM-7's characters where a character has a plain look-alike, its links
   * exactly as written (writeDefaultSubscriberSms).
   */
  public static sms(
    translator: Translator,
    template: string,
    values: TemplateValues,
  ): string {
    return writeDefaultSubscriberSms(
      translator.translateTemplate(template, values),
    );
  }

  /*
   * A notification's text message: its own sentences, then the details and
   * unsubscribe links ("... Details: <link>. Unsub: <link>"). A space goes
   * between two sentences, but for one that ends in an ideographic full
   * stop, "。", which leaves its own room: Chinese and Japanese put none
   * after it.
   */
  public static smsWithLinks(
    translator: Translator,
    data: {
      sentences: Array<string>;
      detailsUrl: string;
      unsubscribeUrl: string;
    },
  ): string {
    return writeDefaultSubscriberSms(
      [
        ...data.sentences,
        translator.translateTemplate(SubscriberSmsText.links, {
          detailsUrl: data.detailsUrl,
          unsubscribeUrl: data.unsubscribeUrl,
        }),
      ]
        .filter((sentence: string): boolean => {
          return sentence.trim().length > 0;
        })
        .reduce((text: string, sentence: string): string => {
          if (!text) {
            return sentence;
          }

          return text.endsWith(IDEOGRAPHIC_FULL_STOP)
            ? `${text}${sentence}`
            : `${text} ${sentence}`;
        }, ""),
    );
  }

  /*
   * A state's or severity's name in a sentence - the value a sentence takes
   * for {{state}} or {{severity}}: OneUptime's default name in the
   * sentence's language, the project's own as written.
   */
  public static stateName(name: string | null | undefined): ComposedValue {
    return composedValue((translator: Translator): string => {
      return translateStateName(translator, name);
    });
  }

  /*
   * A state as the state change messages write it in a sentence, with a
   * capital first letter ("Resolved").
   */
  public static formattedStateName(name: string): ComposedValue {
    return composedValue((translator: Translator): string => {
      return Text.uppercaseFirstLetter(
        translateStateName(translator, name.trim()),
      );
    });
  }

  /*
   * A state's or severity's name on its own (a detail row, a chat line):
   * OneUptime's default names in `translator`'s language, the project's own
   * as written.
   */
  public static nameInLanguage(
    translator: Translator,
    name: string | null | undefined,
  ): string {
    return translateStateName(translator, name);
  }

  // A fixed word or sentence in the reader's language.
  public static text(translator: Translator, text: string): string {
    return translator.translateText(text) || text;
  }

  // A chat message's bold label: "**Severity:**".
  public static chatLabel(translator: Translator, label: string): MarkdownText {
    return mdText`**${this.text(translator, label)}**`;
  }

  /*
   * "**Severity:** Major Incident": a label and its value. The value is
   * placed after the label's text, as it always was, so it is escaped as a
   * value in the middle of a line ("-" stays "-"). For a reader whose
   * language reads from the right it is set apart from the label
   * (chatValue).
   */
  public static chatLine(
    translator: Translator,
    label: string,
    value: string | MarkdownText,
  ): MarkdownText {
    return mdText`**${this.text(translator, label)}** ${this.chatValue(translator, value)}`;
  }

  /*
   * A chat line's value as its reader's language holds it: in Persian,
   * isolated - what <bdi> is on a page - so a resource named "API (EU)"
   * after "**منابع تحت تأثیر:**" keeps its closing bracket at its end, where
   * Slack and Teams, laying the line out from the right, showed it at its
   * start, and an English description keeps its full stop at its end. Of
   * Markdown of several lines, the first line, which follows the label
   * (ServerTranslation's isolateValueForReader). In every other language
   * the value is as it was, character for character.
   */
  public static chatValue(
    translator: Translator,
    value: string | MarkdownText,
  ): string | MarkdownText {
    if (typeof value === "string") {
      return isolateValueForReader(translator.language, value);
    }

    const markdown: string = value.toString();
    const isolated: string = isolateValueForReader(
      translator.language,
      markdown,
    );

    // Invisible marks around Markdown that stays the Markdown it was.
    return isolated === markdown ? value : FeedMarkdown.asMarkdown(isolated);
  }

  /*
   * "[View Status Page](<url>) | [Unsubscribe](<url>)": the links a default
   * chat message ends with.
   */
  public static chatLinks(
    translator: Translator,
    data: { statusPageUrl: string; unsubscribeUrl: string },
  ): MarkdownText {
    return mdText`[${this.text(translator, SubscriberChatText.viewStatusPage)}](${data.statusPageUrl}) | [${this.text(translator, SubscriberChatText.unsubscribe)}](${data.unsubscribeUrl})`;
  }

  /*
   * The default Slack and Microsoft Teams message about an incident's (or
   * an episode's) new state: its heading, the resources it affects when the
   * page lists any, its severity and state, the fields marked "Include in
   * Subscriber Notifications" when it has them, and the links.
   */
  public static incidentStateChangeChatMessage(
    translator: Translator,
    data: {
      title: string | null | undefined;
      resourcesAffected: string;
      severityName: string | null | undefined;
      stateName: string;
      customFields?: MarkdownText | undefined;
      statusPageUrl: string;
      unsubscribeUrl: string;
    },
  ): string {
    let message: string =
      mdText`## 🚨 ${translator.translateTemplate(SubscriberChatText.incidentHeading, { title: data.title || " - " })}

`.toString();

    if (data.resourcesAffected) {
      message += mdText`
${this.chatLine(translator, SubscriberChatText.resourcesAffected, data.resourcesAffected)}`.toString();
    }

    message += mdText`
${this.chatLine(translator, SubscriberChatText.severity, data.severityName ? this.nameInLanguage(translator, data.severityName) : " - ")}
${this.chatLine(translator, SubscriberChatText.status, this.nameInLanguage(translator, data.stateName))}${data.customFields || FeedMarkdown.empty()}

${this.chatLinks(translator, { statusPageUrl: data.statusPageUrl, unsubscribeUrl: data.unsubscribeUrl })}`.toString();

    return message;
  }

  /*
   * The default Slack and Microsoft Teams message about a note on an
   * incident (or an episode): its heading, what happened ("New note has been
   * added to an incident"), the resources and the severity, "**Status:**
   * Resolved" for a note posted with a state change, the fields marked
   * "Include in Subscriber Notifications" when it has them, the note as it
   * was written, and the links.
   */
  public static incidentNoteChatMessage(
    translator: Translator,
    data: {
      title: string | null | undefined;
      sentence: string;
      resourcesAffected: string;
      severityName: string | null | undefined;
      stateChangeName?: string | undefined;
      customFields?: MarkdownText | undefined;
      note: string | null | undefined;
      statusPageUrl: string;
      unsubscribeUrl: string;
    },
  ): string {
    const statusLine: MarkdownText = data.stateChangeName
      ? mdText`${this.chatLine(translator, SubscriberChatText.status, this.nameInLanguage(translator, data.stateChangeName.trim()))}\n`
      : FeedMarkdown.empty();

    return mdText`## ${translator.translateTemplate(SubscriberChatText.incidentHeading, { title: data.title || "" })}

**${this.text(translator, data.sentence)}**

${this.chatLine(translator, SubscriberChatText.resourcesAffected, data.resourcesAffected)}
${this.chatLine(translator, SubscriberChatText.severity, data.severityName ? this.nameInLanguage(translator, data.severityName) : " - ")}
${statusLine}${data.customFields || FeedMarkdown.empty()}
${this.chatLabel(translator, SubscriberChatText.note)}
${FeedMarkdown.asMarkdown(data.note || "")}

${this.chatLinks(translator, { statusPageUrl: data.statusPageUrl, unsubscribeUrl: data.unsubscribeUrl })}`.toString();
  }

  /*
   * The Slack and Microsoft Teams message a channel gets when it is
   * subscribed: what it will hear about, and the links to the page and to
   * unsubscribe. The page's name is plain text its admins typed: escaped in
   * the heading and inside the link's own words, so it reads as typed, and
   * in the link set apart as every chat line's value is (chatValue).
   */
  public static subscribedChatMessage(
    translator: Translator,
    data: {
      statusPageName: string;
      statusPageUrl: string;
      unsubscribeUrl: string;
    },
  ): string {
    const text: (words: string) => string = (words: string): string => {
      return this.text(translator, words);
    };

    return mdText`## 📢 ${translator.translateTemplate(SubscribedChatText.heading, { statusPageName: data.statusPageName })}

**${text(SubscribedChatText.subscribed)}**

🔗 **${text(SubscribedChatText.statusPage)}** [${this.chatValue(translator, data.statusPageName)}](${data.statusPageUrl})
🔕 **${text(SubscribedChatText.unsubscribe)}** [${text(SubscribedChatText.stopTheseNotifications)}](${data.unsubscribeUrl})

${text(SubscribedChatText.youWillReceive)}
• ${text(SubscribedChatText.incidents)} 
• ${text(SubscribedChatText.scheduledMaintenance)}  
• ${text(SubscribedChatText.announcements)}
• ${text(SubscribedChatText.statusUpdates)}

${text(SubscribedChatText.stayInformed)} 🚀`.toString();
  }

  /*
   * The heading of a default state change email: "Incident on <resources>
   * is <state>", or "Incident is <state>" when the page lists none of the
   * incident's resources.
   */
  public static incidentStateChangeEmailTitle(
    translator: Translator,
    data: { resources: string; state: string },
  ): string {
    return data.resources
      ? translator.translateTemplate(SubscriberEmailText.incidentOnIsState, {
          resources: data.resources,
          state: this.stateName(data.state),
        })
      : translator.translateTemplate(SubscriberEmailText.incidentIsState, {
          state: this.stateName(data.state),
        });
  }

  // A resource list that lists none: "None" in the reader's language.
  public static noResources(translator: Translator): string {
    return this.text(translator, SubscriberEmailText.none);
  }

  /*
   * A status page's name in a message: its title, else its name, else
   * "Status Page" in the reader's language.
   */
  public static statusPageName(
    translator: Translator,
    statusPage: {
      pageTitle?: string | null | undefined;
      name?: string | null | undefined;
    },
  ): string {
    return (
      statusPage.pageTitle ||
      statusPage.name ||
      this.text(translator, SubscriberEmailText.statusPage)
    );
  }

  // Markdown a person wrote - a description, a note - placed as it is.
  public static asMarkdown(text: string | null | undefined): MarkdownText {
    return FeedMarkdown.asMarkdown(text || "");
  }
}
