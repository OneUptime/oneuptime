import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { NoteTemplateVariables } from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import {
  AITemplate,
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import { ReactElement } from "react";
import { NoteVisibility } from "./EventNotesUtil";

export type NoteTemplateModel = BaseModel & {
  templateName?: string | undefined;
  note?: string | undefined;
};

export interface EventNotesTemplatesConfig {
  modelType: { new (): NoteTemplateModel };
  // Where templates are managed, linked from the picker.
  settingsRoute?: Route | undefined;
}

export interface EventNotesAIConfig {
  title: string;
  description: string;
  templates: Array<AITemplate>;
  generate: (data: GenerateAIRequestData) => Promise<string>;
}

export interface EventNotesSubscriberConfig {
  // Where "Notify status page subscribers" starts on a new note.
  isNotifyingByDefault: boolean;
  // Why it starts unticked, shown while it is.
  quietDescription: string;
  /*
   * Who a new note would reach, shown under "Notify status page
   * subscribers" while it is ticked (SubscriberAudienceSummary for incidents).
   */
  audienceSummary?: ReactElement | undefined;
  /*
   * What a new note's notification would look like, from the note being
   * written ('Preview' for incident public notes), shown beside "Notify
   * status page subscribers" while it is ticked.
   */
  renderPreview?:
    | ((draft: { note: string; postedAt: Date | null }) => ReactElement)
    | undefined;
  /*
   * Offers Resend for a note whose notification went out, next to Retry for
   * one that failed, and asks before either is sent, naming who it would
   * reach now. The incident's public notes pass it; the episode and
   * scheduled maintenance notes leave it out and keep Retry only, straight
   * from the details dialog.
   */
  resend?: EventNotesResendConfig | undefined;
}

export interface EventNotesResendConfig {
  /*
   * Who a note sent again would reach now (SubscriberAudienceSummary for
   * incidents), shown in the confirmation.
   */
  audience?: ReactElement | undefined;
}

/*
 * One kind of note on one event - an incident's public notes, an alert
 * episode's private notes - and everything that makes it that kind: what it
 * is saved as and on which event, who reads it, where its files are served
 * from, its templates and their {{placeholders}}, its Draft with AI, and who
 * a public one reaches and what they are sent.
 *
 * Built in one place per event type (NoteKinds/), and read as it is by both
 * places a note is written: the event's Notes page (EventNotes) and the
 * "Add ... Note" dialog of the event's overview feed (EventNoteComposerDialog).
 * The two used to configure the same note twice - the feed's copy a
 * two-step modal form with none of the templates, AI or audience - so they
 * drifted apart.
 */
export interface EventNoteKind<TNote extends BaseModel> {
  modelType: { new (): TNote };
  visibility: NoteVisibility;
  // How the page refers to the parent: "incident", "alert", "episode"...
  eventNoun: string;
  // The note column holding the parent's id, e.g. "incidentId".
  parentIdField: string;
  parentId: ObjectID;
  /*
   * The note model's attachment download route. Note types with no such
   * route cannot serve files back, so they are offered no attachments.
   */
  attachmentApiPath?: string | undefined;
  subscriberNotifications?: EventNotesSubscriberConfig | undefined;
  templates?: EventNotesTemplatesConfig | undefined;
  /*
   * The values for the {{placeholders}} in a picked template
   * ({{incident.title}}, {{incident.customFields.impact}}...), read each time a
   * template is picked so they are the event's values at that moment. A
   * placeholder with no value - or every one, when this is left out or the
   * values cannot be read - is put in the draft as written.
   */
  templateVariables?: (() => Promise<NoteTemplateVariables>) | undefined;
  ai?: EventNotesAIConfig | undefined;
  // The other kind of note's page for the same event.
  siblingRoute?: Route | undefined;
}
