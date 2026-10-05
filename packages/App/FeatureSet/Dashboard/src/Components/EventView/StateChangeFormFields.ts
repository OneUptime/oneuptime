import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
  getBulkStateChangeNoteFieldKey,
  getBulkStateChangeNoteTemplateFieldKey,
  getNoteFromTemplate,
} from "../../Utils/BulkStateChange";

/*
 * The body of every dialog that moves an event to another state: Acknowledge,
 * Resolve and the other states on an incident, an alert, an incident or alert
 * episode and a scheduled maintenance event (Components/<event>/ChangeState),
 * and the Change State bulk action on their tables (BulkChangeStateModal).
 *
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer. A responder confirming "I'm on it"
 * at 3 a.m. was first handed an open Markdown editor for a status page note.
 * The dialogs are confirms again: their title and one sentence say what the
 * change does, and what is open is only what decides it -
 *
 *   - "Notify Status Page Subscribers", for the events that reach a status
 *     page (incidents, scheduled maintenance), starting where the event's
 *     own default puts it;
 *   - then one folded line, "Add a public note" (incidents, scheduled
 *     maintenance) or "Add a private note" (alerts, episodes). It holds the
 *     note template picker, when the project has templates, and the note.
 *     It says "Configured" while a note or template is in it, keeps what was
 *     written while folded, and the dialog grows to the wide one when it is
 *     opened (Common/UI/Components/Forms/Utils/FormModalWidth.ts).
 *
 * Nothing about what is sent changes: the note travels under the same key
 * (publicNote / privateNote), the template id under its own, and the notify
 * flag as before.
 *
 * Only someone who may post the note is offered it (noteModel,
 * canPostStateChangeNote). The server refuses a state change whose note the
 * person may not post - the whole change, not just the note, so nobody is
 * left recorded as told by a note that was never posted (Common
 * Server/Utils/StatusPage/StateChangePublicNote) - and a dialog that offered
 * the note would only lead them into that refusal.
 *
 * Build the fields with getStateChangeFormFields and hand them to the dialog
 * as they are. A guard (StateChangeDialogsFoldTheNote.test.ts) keeps every
 * state change dialog on it, its note folded, and no dialog with a template
 * picker of its own.
 */

export const STATE_CHANGE_NOTIFY_FIELD_KEY: string =
  "shouldStatusPageSubscribersBeNotified";

export const STATE_CHANGE_NOTE_SECTION_ID: string = "state-change-note";

// The folded line, worded for who reads the note.
export const STATE_CHANGE_NOTE_SECTION_TITLES: Record<
  BulkStateChangeNoteType,
  string
> = {
  [BulkStateChangeNoteType.Public]: translationKey("Add a public note"),
  [BulkStateChangeNoteType.Private]: translationKey("Add a private note"),
};

export const STATE_CHANGE_NOTE_TITLES: Record<BulkStateChangeNoteType, string> =
  {
    [BulkStateChangeNoteType.Public]: translationKey("Public Note"),
    [BulkStateChangeNoteType.Private]: translationKey("Private Note"),
  };

export interface StateChangeNotifyOptions {
  /*
   * Where the box starts: the event's own default for a state change (an
   * incident declared quietly starts it off; scheduled maintenance follows
   * the state it moves to). Seed the same value as the form's initial value
   * too: the form drops a false default, and an unsent flag falls back to
   * notifying.
   */
  byDefault: boolean;
  /*
   * The line under the box while it starts off, saying why
   * (PublicNoteSubscriberNotificationDefault). Unused while it starts on.
   */
  quietDescription?: string | undefined;
}

export interface StateChangeFormFieldsOptions {
  // Public notes reach the status page; private ones stay with the team.
  noteType: BulkStateChangeNoteType;
  // Who reads the note, in one line under it.
  noteDescription: string;
  // The note's own title. Left out, "Public Note" or "Private Note".
  noteTitle?: string | undefined;
  // The project's note templates. None: no picker.
  noteTemplates: Array<BulkStateChangeNoteTemplate>;
  /*
   * Fills a picked template's {{placeholders}} before it goes into the note
   * (an incident's {{incident.title}} and the like). Left out, a template
   * goes in as written.
   */
  fillTemplate?: ((note: string) => string) | undefined;
  /*
   * The "Notify Status Page Subscribers" box, for an event that reaches a
   * status page. Left out, the dialog has none.
   */
  notifySubscribers?: StateChangeNotifyOptions | undefined;
  /*
   * The note the change posts, as an empty model of its kind (an
   * IncidentPublicNote, an AlertInternalNote, ...). Someone who may not
   * create it is not offered it (canPostStateChangeNote): no "Add a public
   * note" / "Add a private note" line, no template picker, no editor. Left
   * out, the note is offered.
   */
  noteModel?: PermissionCheckableModel | undefined;
}

/*
 * Whether the person signed in may post the note a state change carries:
 * the note model's create permissions (PermissionGate), the ones the server
 * asks for before it saves the change. A person it does not know yet - the
 * permissions not loaded, no permission to name - is offered the note, and
 * the server decides, as it always has.
 */
export const canPostStateChangeNote: (
  noteModel: PermissionCheckableModel,
) => boolean = (noteModel: PermissionCheckableModel): boolean => {
  const gate: PermissionGateResult = PermissionGate.check(
    noteModel,
    ModelAction.Create,
  );

  return gate.isAllowed || !gate.disabledReason;
};

export type GetStateChangeNoteSectionFunction = <TEntity>(
  noteType: BulkStateChangeNoteType,
) => FormFieldCollapsibleSection<TEntity>;

/*
 * The folded "Add a public note" / "Add a private note" line. Folded even
 * when something is in it (it says "Configured" instead), like an Advanced
 * section: the note is never what the dialog is about.
 */
export const getStateChangeNoteSection: GetStateChangeNoteSectionFunction = <
  TEntity,
>(
  noteType: BulkStateChangeNoteType,
): FormFieldCollapsibleSection<TEntity> => {
  return {
    id: STATE_CHANGE_NOTE_SECTION_ID,
    title: STATE_CHANGE_NOTE_SECTION_TITLES[noteType],
    openWhenConfigured: false,
  };
};

export type GetStateChangeFormFieldsFunction = <TEntity>(
  options: StateChangeFormFieldsOptions,
) => Fields<TEntity>;

export const getStateChangeFormFields: GetStateChangeFormFieldsFunction = <
  TEntity,
>(
  options: StateChangeFormFieldsOptions,
): Fields<TEntity> => {
  const noteFieldKey: string = getBulkStateChangeNoteFieldKey(options.noteType);
  const noteTemplateFieldKey: string = getBulkStateChangeNoteTemplateFieldKey(
    options.noteType,
  );
  const noteTemplates: Array<BulkStateChangeNoteTemplate> =
    options.noteTemplates;
  // A note the person may not post is not offered (canPostStateChangeNote).
  const isNoteOffered: boolean =
    !options.noteModel || canPostStateChangeNote(options.noteModel);

  // One section for both of its fields, so they are one folded line.
  const noteSection: FormFieldCollapsibleSection<TEntity> =
    getStateChangeNoteSection<TEntity>(options.noteType);

  const notifyFields: Fields<TEntity> = options.notifySubscribers
    ? [
        {
          // STATE_CHANGE_NOTIFY_FIELD_KEY, written out for the form scans.
          field: {
            shouldStatusPageSubscribersBeNotified: true,
          } as SelectFormFields<TEntity>,
          fieldType: FormFieldSchemaType.Checkbox,
          title: "Notify Status Page Subscribers",
          description:
            options.notifySubscribers.byDefault ||
            !options.notifySubscribers.quietDescription
              ? "Notify subscribers of this state change."
              : options.notifySubscribers.quietDescription,
          required: false,
          defaultValue: options.notifySubscribers.byDefault,
        },
      ]
    : [];

  return [
    ...notifyFields,
    {
      field: {
        [noteTemplateFieldKey]: true,
      } as SelectFormFields<TEntity>,
      fieldType: FormFieldSchemaType.Dropdown,
      title: "Select Note Template",
      description:
        "If you have a template for this state change, select it here.",
      dropdownOptions: noteTemplates.map(
        (template: BulkStateChangeNoteTemplate): DropdownOption => {
          return {
            value: template.id,
            label: template.templateName,
          };
        },
      ),
      showIf: (): boolean => {
        return isNoteOffered && noteTemplates.length > 0;
      },
      // Picking a template writes it into the note, over what was there.
      onChange: (
        value: string,
        currentValues: FormValues<TEntity>,
        setNewFormValues: (currentFormValues: FormValues<TEntity>) => void,
      ): void => {
        const template: string = getNoteFromTemplate(noteTemplates, value);
        const note: string =
          template && options.fillTemplate
            ? options.fillTemplate(template)
            : template;

        if (note) {
          setNewFormValues({
            ...currentValues,
            [noteFieldKey]: note,
          } as FormValues<TEntity>);
        }
      },
      required: false,
      overrideFieldKey: noteTemplateFieldKey,
      showEvenIfPermissionDoesNotExist: true,
      collapsibleSection: noteSection,
    },
    {
      field: {
        [noteFieldKey]: true,
      } as SelectFormFields<TEntity>,
      fieldType: FormFieldSchemaType.Markdown,
      title: options.noteTitle || STATE_CHANGE_NOTE_TITLES[options.noteType],
      description: options.noteDescription,
      showIf: (): boolean => {
        return isNoteOffered;
      },
      required: false,
      overrideFieldKey: noteFieldKey,
      showEvenIfPermissionDoesNotExist: true,
      collapsibleSection: noteSection,
    },
  ];
};
