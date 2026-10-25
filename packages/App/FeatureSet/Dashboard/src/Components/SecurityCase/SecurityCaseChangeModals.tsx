import {
  VERDICT_CARD_OPTIONS,
  getCloseVerdictAiRead,
  getInitialCloseVerdict,
} from "./SecurityCaseActionModals";
import { SecurityCaseAiCopy } from "./SecurityCaseAiTriage";
import {
  ASSIGN_FIELD_DESCRIPTION,
  ASSIGN_FIELD_TITLE,
  ASSIGN_ONE_DESCRIPTION,
  ASSIGN_PICKER_ADD_TEXT,
  ASSIGN_PICKER_EMPTY_TEXT,
  ASSIGN_PICKER_SEARCH_PLACEHOLDER,
  ASSIGN_SELECTED_DESCRIPTION,
  ASSIGN_SUBMIT,
  ASSIGN_TO_SOMEONE_ELSE,
  CHANGE_PRIORITY,
  CHANGE_PRIORITY_ONE_DESCRIPTION,
  CHANGE_PRIORITY_SELECTED_DESCRIPTION,
  CHANGE_STATUS,
  CHANGE_STATUS_ONE_DESCRIPTION,
  CHANGE_STATUS_SELECTED_DESCRIPTION,
  CURRENT_VALUE,
  SecurityCaseAssigneePick,
  SecurityCaseStatusPick,
  SecurityCaseValueChoice,
  doesStatusCloseAnySecurityCase,
  getSecurityCasePriorityChoices,
  getSecurityCaseStatusChoices,
} from "./SecurityCaseChanges";
import { SecurityCaseValueLists } from "./SecurityCaseValues";
import { getSecurityCaseRecordName } from "./SecurityCaseViewSelect";
import useAiOffered from "../../Utils/UseAiOffered";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import { JSONObject } from "Common/Types/JSON";
import SecurityCaseAiVerdict from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import API from "Common/UI/Utils/API/API";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The dialogs of Assign to Someone Else, Change Status and Change Priority,
 * one of each wherever a case is worked: a row's ⋯ menu (one case), Bulk
 * Actions (the cases selected) and the case's own header (its case). What
 * each change writes, and whether it changes a case at all, is
 * SecurityCaseChanges'; a dialog asks, and hands what was picked to whoever
 * opened it.
 *
 * For one case, the dialog stays open while the change is saved, and says
 * in place why it could not be - with what was picked still picked, so
 * nobody starts again. For several, the dialog closes on submit and Bulk
 * Actions' progress dialog reports each case.
 */

// The form values the assignee picker keeps its one pick in.
export const ASSIGN_USER_KEY: string = "assignToUserId";
export const ASSIGN_TEAM_KEY: string = "assignToTeamId";

export const SECURITY_CASE_CHANGE_MODAL_NAMES: {
  assign: string;
  status: string;
  priority: string;
} = {
  assign: "security-case-assign",
  status: "security-case-change-status",
  priority: "security-case-change-priority",
};

const STATUS_PLACEHOLDER: string = translationKey("Choose a status");
// What Change Status's button says when it closes the case.
const CLOSE_CASE: string = translationKey("Close Case");
const PRIORITY_PLACEHOLDER: string = translationKey("Choose a priority");

// Under Closing Note, for several cases: the one note goes on every case it closes.
const BULK_CLOSING_NOTE_DESCRIPTION: string = translationKey(
  "What was found and what was done, kept on each case this closes.",
);

/*
 * A status or a priority as the dialog's dropdown lists it: its colour,
 * Archived for the retired one a case still has, and the case's own marked
 * Current - listed, so the reader sees where the case stands, but never
 * picked again.
 */
export function toSecurityCaseValueOptions(
  choices: ReadonlyArray<SecurityCaseValueChoice>,
): Array<DropdownOption> {
  return choices.map((choice: SecurityCaseValueChoice): DropdownOption => {
    return {
      value: choice.id,
      label: choice.name,
      ...(choice.color ? { color: choice.color } : {}),
      ...(choice.isArchived ? { isArchived: true } : {}),
      ...(choice.isCurrent
        ? { description: CURRENT_VALUE, isDisabled: true }
        : {}),
    };
  });
}

// The case a one-case dialog names: "CASE-142".
function nameOf(securityCases: ReadonlyArray<SecurityCase>): string {
  const first: SecurityCase | undefined = securityCases[0];

  return first ? getSecurityCaseRecordName(first) || "" : "";
}

interface ChangeModalProps {
  title: string;
  description: string;
  submitButtonText: string;
  /*
   * The button's words for what the form holds now, where they follow it:
   * Change Status says Close Case once the status picked closes the case.
   */
  getSubmitButtonText?:
    | ((values: FormValues<JSONObject>) => string)
    | undefined;
  name: string;
  modalWidth?: ModalWidth | undefined;
  fields: Array<Field<JSONObject>>;
  initialValues: JSONObject;
  onClose: () => void;
  onSubmit: (values: FormValues<JSONObject>) => Promise<void>;
}

/*
 * One change's dialog: busy while the change is saved, and - when it could
 * not be - the server's reason at the top, over the form as it was
 * submitted.
 */
const SecurityCaseChangeModal: FunctionComponent<ChangeModalProps> = (
  props: ChangeModalProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  /*
   * The form is redrawn after a save that failed: it starts again on what
   * was submitted, not on the dialog's first values.
   */
  const [values, setValues] = useState<JSONObject>(props.initialValues);
  const [submitButtonText, setSubmitButtonText] = useState<string>(
    props.getSubmitButtonText?.(props.initialValues) || props.submitButtonText,
  );

  return (
    <BasicFormModal<JSONObject>
      title={props.title}
      description={props.description}
      submitButtonText={submitButtonText}
      modalWidth={props.modalWidth}
      isLoading={isLoading}
      error={error || undefined}
      onClose={props.onClose}
      formProps={{
        name: props.name,
        initialValues: values,
        fields: props.fields,
        onChange: (formValues: FormValues<JSONObject>) => {
          if (props.getSubmitButtonText) {
            setSubmitButtonText(props.getSubmitButtonText(formValues));
          }
        },
      }}
      onSubmit={async (formValues: FormValues<JSONObject>) => {
        setValues(formValues as JSONObject);
        setError("");
        setIsLoading(true);

        try {
          await props.onSubmit(formValues);
        } catch (err) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      }}
    />
  );
};

export interface AssignSecurityCaseModalProps {
  // One case (a row's ⋯, the case's page), or the cases selected.
  securityCases: Array<SecurityCase>;
  onClose: () => void;
  // Gives the cases to the one person or team picked.
  onSubmit: (pick: SecurityCaseAssigneePick) => Promise<void>;
}

/*
 * Assign to Someone Else: one pick, of a person or a team, in the people
 * picker every OneUptime form uses - people first, then teams. A person
 * works the case; a team takes it into its queue (SecurityCaseChanges).
 */
export const AssignSecurityCaseModal: FunctionComponent<
  AssignSecurityCaseModalProps
> = (props: AssignSecurityCaseModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const isOne: boolean = props.securityCases.length === 1;

  return (
    <SecurityCaseChangeModal
      title={ASSIGN_TO_SOMEONE_ELSE}
      description={
        isOne
          ? translator.translateTemplate(ASSIGN_ONE_DESCRIPTION, {
              case: nameOf(props.securityCases),
            })
          : translator.translatePlural(
              ASSIGN_SELECTED_DESCRIPTION,
              props.securityCases.length,
            )
      }
      submitButtonText={ASSIGN_SUBMIT}
      name={SECURITY_CASE_CHANGE_MODAL_NAMES.assign}
      initialValues={{}}
      fields={[
        {
          field: { assignTo: true },
          title: ASSIGN_FIELD_TITLE,
          description: ASSIGN_FIELD_DESCRIPTION,
          fieldType: FormFieldSchemaType.PeoplePicker,
          required: true,
          peoplePicker: {
            kinds: [
              { kind: PeoplePickerKind.User, valueKey: ASSIGN_USER_KEY },
              { kind: PeoplePickerKind.Team, valueKey: ASSIGN_TEAM_KEY },
            ],
            isSinglePick: true,
            addButtonText: ASSIGN_PICKER_ADD_TEXT,
            searchPlaceholder: ASSIGN_PICKER_SEARCH_PLACEHOLDER,
            emptyText: ASSIGN_PICKER_EMPTY_TEXT,
          },
        },
      ]}
      onClose={props.onClose}
      onSubmit={async (values: FormValues<JSONObject>) => {
        const record: JSONObject = values as JSONObject;

        await props.onSubmit({
          userId: toPeoplePickerIds(record[ASSIGN_USER_KEY])[0] || undefined,
          teamId: toPeoplePickerIds(record[ASSIGN_TEAM_KEY])[0] || undefined,
        });
      }}
    />
  );
};

export interface ChangeSecurityCaseStatusModalProps {
  securityCases: Array<SecurityCase>;
  // The project's priorities and statuses (Security Events > Settings).
  values: SecurityCaseValueLists;
  onClose: () => void;
  onSubmit: (pick: SecurityCaseStatusPick) => Promise<void>;
}

/*
 * Change Status: the project's statuses, in order. A status that closes a
 * case asks what Close Case asks - the verdict, OneUptime AI's read of one
 * case over it, and an optional closing note - before it closes anything.
 */
export const ChangeSecurityCaseStatusModal: FunctionComponent<
  ChangeSecurityCaseStatusModalProps
> = (props: ChangeSecurityCaseStatusModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const isOne: boolean = props.securityCases.length === 1;
  const statuses: ReadonlyArray<unknown> = props.values.statuses;
  const firstCase: SecurityCase | undefined = props.securityCases[0];

  // OneUptime AI's read of one case, over its verdicts, as Close Case says it.
  const aiRead: SecurityCaseAiVerdict | undefined =
    isOne && firstCase
      ? getCloseVerdictAiRead(firstCase, isAiOffered)
      : undefined;

  const isClosing: (values: FormValues<JSONObject>) => boolean = (
    values: FormValues<JSONObject>,
  ): boolean => {
    const statusId: string = String(
      (values as JSONObject)["securityCaseStatusId"] || "",
    );

    return (
      Boolean(statusId) &&
      doesStatusCloseAnySecurityCase({
        securityCases: props.securityCases,
        statusId: statusId,
        statuses: statuses,
      })
    );
  };

  return (
    <SecurityCaseChangeModal
      title={CHANGE_STATUS}
      description={
        isOne
          ? translator.translateTemplate(CHANGE_STATUS_ONE_DESCRIPTION, {
              case: nameOf(props.securityCases),
            })
          : translator.translatePlural(
              CHANGE_STATUS_SELECTED_DESCRIPTION,
              props.securityCases.length,
            )
      }
      submitButtonText={CHANGE_STATUS}
      /*
       * Closing one case, the button says so, as the header's own does;
       * several keep Change Status, the verdict field saying they close.
       */
      getSubmitButtonText={(values: FormValues<JSONObject>): string => {
        return isOne && isClosing(values) ? CLOSE_CASE : CHANGE_STATUS;
      }}
      name={SECURITY_CASE_CHANGE_MODAL_NAMES.status}
      // The verdicts are cards with a sentence each, as in Close Case.
      modalWidth={ModalWidth.Medium}
      /*
       * One case starts on the verdict Close Case would: its own, else the
       * one OneUptime AI's read suggests. Several start on none: the reader
       * says what they all turned out to be.
       */
      initialValues={
        isOne && firstCase
          ? { verdict: getInitialCloseVerdict(firstCase, isAiOffered) }
          : {}
      }
      fields={[
        {
          field: { securityCaseStatusId: true },
          title: "Status",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: STATUS_PLACEHOLDER,
          dropdownOptions: toSecurityCaseValueOptions(
            getSecurityCaseStatusChoices({
              statuses: props.values.statuses,
              securityCases: props.securityCases,
            }),
          ),
        },
        {
          field: { verdict: true },
          title: "Verdict",
          ...(aiRead
            ? {
                description: translator.translateTemplate(
                  SecurityCaseAiCopy.closeVerdictHint,
                  { read: translatableTerm(aiRead) },
                ),
              }
            : {}),
          fieldType: FormFieldSchemaType.CardSelect,
          required: true,
          cardSelectOptions: VERDICT_CARD_OPTIONS,
          cardSelectSingleColumn: true,
          showIf: isClosing,
        },
        {
          field: { closingNote: true },
          title: "Closing Note",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          description: isOne
            ? "What was found and what was done, for whoever reads this case next."
            : BULK_CLOSING_NOTE_DESCRIPTION,
          placeholder: "e.g. Confirmed with the user; the sign-ins were theirs.",
          showIf: isClosing,
        },
      ]}
      onClose={props.onClose}
      onSubmit={async (values: FormValues<JSONObject>) => {
        const record: JSONObject = values as JSONObject;
        const closing: boolean = isClosing(values);

        await props.onSubmit({
          statusId: String(record["securityCaseStatusId"] || ""),
          ...(closing
            ? {
                verdict: (record["verdict"] as string) || undefined,
                closingNote:
                  typeof record["closingNote"] === "string"
                    ? (record["closingNote"] as string)
                    : undefined,
              }
            : {}),
        });
      }}
    />
  );
};

export interface ChangeSecurityCasePriorityModalProps {
  securityCases: Array<SecurityCase>;
  values: SecurityCaseValueLists;
  onClose: () => void;
  onSubmit: (priorityId: string) => Promise<void>;
}

// Change Priority: the project's priorities, most urgent first.
export const ChangeSecurityCasePriorityModal: FunctionComponent<
  ChangeSecurityCasePriorityModalProps
> = (props: ChangeSecurityCasePriorityModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const isOne: boolean = props.securityCases.length === 1;

  return (
    <SecurityCaseChangeModal
      title={CHANGE_PRIORITY}
      description={
        isOne
          ? translator.translateTemplate(CHANGE_PRIORITY_ONE_DESCRIPTION, {
              case: nameOf(props.securityCases),
            })
          : translator.translatePlural(
              CHANGE_PRIORITY_SELECTED_DESCRIPTION,
              props.securityCases.length,
            )
      }
      submitButtonText={CHANGE_PRIORITY}
      name={SECURITY_CASE_CHANGE_MODAL_NAMES.priority}
      initialValues={{}}
      fields={[
        {
          field: { securityCasePriorityId: true },
          title: "Priority",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: PRIORITY_PLACEHOLDER,
          dropdownOptions: toSecurityCaseValueOptions(
            getSecurityCasePriorityChoices({
              priorities: props.values.priorities,
              securityCases: props.securityCases,
            }),
          ),
        },
      ]}
      onClose={props.onClose}
      onSubmit={async (values: FormValues<JSONObject>) => {
        await props.onSubmit(
          String((values as JSONObject)["securityCasePriorityId"] || ""),
        );
      }}
    />
  );
};
