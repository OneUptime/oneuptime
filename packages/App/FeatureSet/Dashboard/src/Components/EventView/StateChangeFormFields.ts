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
  PermissionGateOptions,
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
 *     opened (Common/UI/Components/Forms/Utils/FormModalWidth.ts);
 *   - and, when the change resolves an incident or an alert, one more
 *     folded line, "Add the root cause" (#7765, getStateChangeRootCauseFields):
 *     why it happened, saved as the record's root cause, what OneUptime AI's
 *     investigation of it is graded against.
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

/*
 * Resolving an incident or an alert asks for its root cause too (#7765),
 * folded under "Add the root cause", after the note: why it happened, saved
 * as the record's root cause, and what OneUptime AI's investigation of it is
 * graded against (InvestigationGrader). Optional, like the note: leaving it
 * empty resolves as before, and the record keeps the root cause it has.
 *
 * It travels with the change under writtenRootCause, which the server reads
 * (Common/Server/Utils/StateChangeRootCause): it refuses a change whose root
 * cause its sender may not write, so it is offered only to someone who may
 * edit the record (recordModel).
 *
 * Only the incident and alert dialogs ask it, with their own builder
 * (getStateChangeRootCauseFields): the bulk dialog, which shares
 * getStateChangeFormFields, does not, and the form scans read a builder at
 * its largest.
 */
export const STATE_CHANGE_ROOT_CAUSE_SECTION_ID: string =
  "state-change-root-cause";

export const STATE_CHANGE_ROOT_CAUSE_SECTION_TITLE: string =
  translationKey("Add the root cause");

export const STATE_CHANGE_ROOT_CAUSE_FIELD_KEY: string = "writtenRootCause";

export interface StateChangeRootCauseOptions {
  // One line under the field: what it becomes, worded for the record.
  description: string;
  /*
   * The record whose root cause it writes, as an empty model of its kind (an
   * Alert, an Incident). Someone who may not edit it is not offered the
   * root cause.
   */
  recordModel: PermissionCheckableModel;
  // The page's private record scope, when it is open on one.
  recordGateOptions?: PermissionGateOptions | undefined;
}

/*
 * Whether the person signed in may write the record's root cause: the
 * record's update permissions (PermissionGate), the ones the server asks
 * for. A person it does not know yet is offered it, and the server decides.
 */
export const canWriteStateChangeRootCause: (
  recordModel: PermissionCheckableModel,
  options?: PermissionGateOptions | undefined,
) => boolean = (
  recordModel: PermissionCheckableModel,
  options?: PermissionGateOptions | undefined,
): boolean => {
  const gate: PermissionGateResult = PermissionGate.check(
    recordModel,
    ModelAction.Update,
    options,
  );

  return gate.isAllowed || !gate.disabledReason;
};

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
  /*
   * The page's private record scope, when it is open on one: the note is
   * then offered only when a team of the reader's that owns the record may
   * post it (PrivateRecordScope).
   */
  noteGateOptions?: PermissionGateOptions | undefined;
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
  options?: PermissionGateOptions | undefined,
) => boolean = (
  noteModel: PermissionCheckableModel,
  options?: PermissionGateOptions | undefined,
): boolean => {
  const gate: PermissionGateResult = PermissionGate.check(
    noteModel,
    ModelAction.Create,
    options,
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
    !options.noteModel ||
    canPostStateChangeNote(options.noteModel, options.noteGateOptions);

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
            isUserContent: true,
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

export type GetStateChangeRootCauseFieldsFunction = <TEntity>(
  rootCause: StateChangeRootCauseOptions | undefined,
) => Fields<TEntity>;

/*
 * The folded "Add the root cause" line of a resolve (#7765), for the
 * incident and alert dialogs to put after getStateChangeFormFields' fields:
 * one Markdown field, folded even with something in it, like the note.
 * Handed nothing - a change that does not resolve the record - it is no
 * field at all.
 */
export const getStateChangeRootCauseFields: GetStateChangeRootCauseFieldsFunction =
  <TEntity>(
    rootCause: StateChangeRootCauseOptions | undefined,
  ): Fields<TEntity> => {
    // Offered only to someone who may write the record's root cause.
    const isRootCauseOffered: boolean = Boolean(
      rootCause &&
        canWriteStateChangeRootCause(
          rootCause.recordModel,
          rootCause.recordGateOptions,
        ),
    );

    const rootCauseSection: FormFieldCollapsibleSection<TEntity> = {
      id: STATE_CHANGE_ROOT_CAUSE_SECTION_ID,
      title: STATE_CHANGE_ROOT_CAUSE_SECTION_TITLE,
      openWhenConfigured: false,
    };

    return rootCause
      ? [
          {
            // STATE_CHANGE_ROOT_CAUSE_FIELD_KEY, written out for the form scans.
            field: {
              writtenRootCause: true,
            } as SelectFormFields<TEntity>,
            fieldType: FormFieldSchemaType.Markdown,
            title: "Root Cause",
            description: rootCause.description,
            showIf: (): boolean => {
              return isRootCauseOffered;
            },
            required: false,
            overrideFieldKey: STATE_CHANGE_ROOT_CAUSE_FIELD_KEY,
            showEvenIfPermissionDoesNotExist: true,
            collapsibleSection: rootCauseSection,
          },
        ]
      : [];
  };
