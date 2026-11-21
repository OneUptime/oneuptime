import {
  ASSIGN_ISSUE,
  IssueAcceptance,
  IssueAssigneePick,
  getAcceptedUntilProblem,
  getDefaultAcceptedUntil,
  getIssueName,
  readAcceptedUntil,
} from "./IssueChanges";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityFixRepository } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * The dialogs a data security issue is worked with: Accept Risk (why, and
 * until when), Assign (a person or a team) and, for Fix with AI when the
 * person may ask in several repositories, which repository holds the code
 * to change. For one issue each stays open while the change is saved and
 * says in place why it could not be; for several (Bulk Actions) it hands
 * what was picked to the run, whose progress dialog reports each.
 */

/*
 * An issue's title is a sentence of its own ("Anyone on the internet can
 * read it"), so a sentence that names it quotes it.
 */
const ACCEPT_ONE_DESCRIPTION: string = translationKey(
  'Accept the risk of "{{issue}}" until a date. It opens again then if its check still fails.',
);

const ACCEPT_SELECTED_DESCRIPTION: PluralTemplate = {
  one: "Accept the risk of the {{count}} selected issue until a date. It opens again then if its check still fails.",
  other:
    "Accept the risk of the {{count}} selected issues until a date. Each opens again then if its check still fails.",
};

const ASSIGN_ONE_DESCRIPTION: string = translationKey(
  'Pick the person or team who fixes "{{issue}}".',
);

const NOT_AN_ISSUE_ONE_DESCRIPTION: string = translationKey(
  'Say why "{{issue}}" is not an issue. It stays closed, and keeps the reason.',
);

const NOT_AN_ISSUE_SELECTED_DESCRIPTION: PluralTemplate = {
  one: "Say why the {{count}} selected issue is not an issue. It stays closed, and keeps the reason.",
  other:
    "Say why the {{count}} selected issues are not issues. Each stays closed, and keeps the reason.",
};

const NOT_AN_ISSUE_REASON_KEY: string = "notAnIssueReason";

const REASON_KEY: string = "acceptedReason";
const UNTIL_KEY: string = "acceptedUntil";
const ASSIGN_USER_KEY: string = "assignToUserId";
const ASSIGN_TEAM_KEY: string = "assignToTeamId";
const REPOSITORY_KEY: string = "codeRepositoryId";

interface IssueChangeModalProps {
  title: string;
  // The title is in the reader's words already, drawn as given (Modal's isTitleTranslated).
  isTitleTranslated?: boolean | undefined;
  description: string;
  submitButtonText: string;
  name: string;
  fields: Array<Field<JSONObject>>;
  initialValues: JSONObject;
  isLoading?: boolean | undefined;
  // An error to show before anything is submitted (a read that failed).
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (values: FormValues<JSONObject>) => Promise<void>;
}

/*
 * One change's dialog: busy while it saves, and - when it could not be
 * saved - the server's reason at the top, over the form as submitted.
 */
const IssueChangeModal: FunctionComponent<IssueChangeModalProps> = (
  props: IssueChangeModalProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const [values, setValues] = useState<JSONObject>(props.initialValues);

  return (
    <BasicFormModal<JSONObject>
      title={props.title}
      isTitleTranslated={props.isTitleTranslated}
      description={props.description}
      submitButtonText={props.submitButtonText}
      isLoading={props.isLoading}
      isSubmitting={isSaving}
      error={error || props.error || undefined}
      onClose={props.onClose}
      formProps={{
        name: props.name,
        initialValues: values,
        fields: props.fields,
      }}
      onSubmit={async (formValues: FormValues<JSONObject>) => {
        if (isSavingRef.current) {
          return;
        }

        isSavingRef.current = true;
        setValues(formValues as JSONObject);
        setError("");
        setIsSaving(true);

        try {
          await props.onSubmit(formValues);
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }

        isSavingRef.current = false;
        setIsSaving(false);
      }}
    />
  );
};

export interface AcceptIssueRiskModalProps {
  // One issue (its page, a row's ⋯), or the issues selected.
  issues: Array<DataSecurityIssue>;
  /*
   * The reason to start from: OneUptime AI's draft, when its analysis says
   * the issue is likely by design (#10369). The person edits it, or not.
   */
  draftReason?: string | undefined;
  onClose: () => void;
  onSubmit: (acceptance: IssueAcceptance) => Promise<void>;
}

/*
 * Accept Risk: why the risk is acceptable, and until when - a quarter from
 * today to start with, at most a year. The issue opens again after that
 * day if its check still fails, so nobody accepts a risk for ever.
 */
export const AcceptIssueRiskModal: FunctionComponent<
  AcceptIssueRiskModalProps
> = (props: AcceptIssueRiskModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const first: DataSecurityIssue | undefined = props.issues[0];
  const isOne: boolean = props.issues.length === 1;

  // An accepted issue starts on its own reason and date, to change them.
  const currentUntil: Date | null =
    isOne && first?.acceptedUntil
      ? readAcceptedUntil(first.acceptedUntil)
      : null;

  const initialValues: JSONObject = {
    [REASON_KEY]:
      isOne && first?.acceptedReason
        ? first.acceptedReason
        : props.draftReason || "",
    [UNTIL_KEY]: OneUptimeDate.toString(
      currentUntil && !getAcceptedUntilProblem(currentUntil)
        ? currentUntil
        : getDefaultAcceptedUntil(),
    ),
  };

  return (
    <IssueChangeModal
      title="Accept Risk"
      description={
        isOne && first
          ? translator.translateTemplate(ACCEPT_ONE_DESCRIPTION, {
              issue: getIssueName(first, translator),
            })
          : translator.translatePlural(
              ACCEPT_SELECTED_DESCRIPTION,
              props.issues.length,
            )
      }
      submitButtonText="Accept Risk"
      name="data-security-issue-accept"
      initialValues={initialValues}
      fields={[
        {
          field: { [REASON_KEY]: true },
          title: "Reason",
          description:
            "Why this is acceptable for now, for whoever looks next.",
          fieldType: FormFieldSchemaType.LongText,
          required: true,
          placeholder:
            "e.g. Only test data is left in this bucket; it is deleted next month.",
        },
        {
          field: { [UNTIL_KEY]: true },
          title: "Accepted Until",
          description: "At most a year from today.",
          fieldType: FormFieldSchemaType.Date,
          required: true,
          validation: {
            dateShouldBeInTheFuture: true,
          },
          customValidation: (values: FormValues<JSONObject>): string | null => {
            const problem: string | null = getAcceptedUntilProblem(
              readAcceptedUntil((values as JSONObject)[UNTIL_KEY]),
            );

            return problem
              ? translator.translateText(problem) || problem
              : null;
          },
        },
      ]}
      onClose={props.onClose}
      onSubmit={async (values: FormValues<JSONObject>) => {
        const record: JSONObject = values as JSONObject;
        const until: Date | null = readAcceptedUntil(record[UNTIL_KEY]);
        const reason: string =
          typeof record[REASON_KEY] === "string"
            ? (record[REASON_KEY] as string).trim()
            : "";

        if (!until || !reason) {
          return;
        }

        await props.onSubmit({
          reason: reason,
          // The acceptance runs to the end of the day picked.
          until: OneUptimeDate.getEndOfDay(until),
        });
      }}
    />
  );
};

export interface NotAnIssueModalProps {
  // One issue (its page, a row's ⋯), or the issues selected.
  issues: Array<DataSecurityIssue>;
  /*
   * The reason to start from: OneUptime AI's draft, when its analysis says
   * the finding is likely wrong (#10369).
   */
  draftReason?: string | undefined;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

/*
 * Not an Issue (#10369): why the finding was wrong, as Accept Risk asks
 * why the risk is acceptable. The issue stays closed, and keeps the reason,
 * which OneUptime AI learns from which findings are noise.
 */
export const NotAnIssueModal: FunctionComponent<NotAnIssueModalProps> = (
  props: NotAnIssueModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const first: DataSecurityIssue | undefined = props.issues[0];
  const isOne: boolean = props.issues.length === 1;

  return (
    <IssueChangeModal
      title="Not an Issue"
      description={
        isOne && first
          ? translator.translateTemplate(NOT_AN_ISSUE_ONE_DESCRIPTION, {
              issue: getIssueName(first, translator),
            })
          : translator.translatePlural(
              NOT_AN_ISSUE_SELECTED_DESCRIPTION,
              props.issues.length,
            )
      }
      submitButtonText="Not an Issue"
      name="data-security-issue-not-an-issue"
      initialValues={{ [NOT_AN_ISSUE_REASON_KEY]: props.draftReason || "" }}
      fields={[
        {
          field: { [NOT_AN_ISSUE_REASON_KEY]: true },
          title: "Reason",
          description:
            "Why the finding was wrong, for whoever looks next. The issue and its timeline keep it.",
          fieldType: FormFieldSchemaType.LongText,
          required: true,
          placeholder:
            "e.g. The detector read an order number as a card number.",
        },
      ]}
      onClose={props.onClose}
      onSubmit={async (values: FormValues<JSONObject>) => {
        const record: JSONObject = values as JSONObject;
        const reason: string =
          typeof record[NOT_AN_ISSUE_REASON_KEY] === "string"
            ? (record[NOT_AN_ISSUE_REASON_KEY] as string).trim()
            : "";

        if (!reason) {
          return;
        }

        await props.onSubmit(reason);
      }}
    />
  );
};

export interface AssignIssueModalProps {
  issue: DataSecurityIssue;
  onClose: () => void;
  onSubmit: (pick: IssueAssigneePick) => Promise<void>;
}

/*
 * Assign: one pick, of a person or a team, in the people picker every
 * OneUptime form uses - people first, then teams.
 */
export const AssignIssueModal: FunctionComponent<AssignIssueModalProps> = (
  props: AssignIssueModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <IssueChangeModal
      title={ASSIGN_ISSUE}
      description={translator.translateTemplate(ASSIGN_ONE_DESCRIPTION, {
        issue: getIssueName(props.issue, translator),
      })}
      submitButtonText={ASSIGN_ISSUE}
      name="data-security-issue-assign"
      initialValues={{}}
      fields={[
        {
          field: { assignTo: true },
          title: "Person or Team",
          fieldType: FormFieldSchemaType.PeoplePicker,
          required: true,
          peoplePicker: {
            kinds: [
              { kind: PeoplePickerKind.User, valueKey: ASSIGN_USER_KEY },
              { kind: PeoplePickerKind.Team, valueKey: ASSIGN_TEAM_KEY },
            ],
            isSinglePick: true,
            addButtonText: translationKey("Choose someone or a team"),
            searchPlaceholder: translationKey("Search people or teams..."),
            emptyText: translationKey("No people or teams available."),
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

export interface IssueRepositoryModalProps {
  /*
   * The repositories to choose from: those the person may ask OneUptime AI
   * to work in, as the server answered Fix with AI (#10362).
   */
  repositories: Array<DataSecurityFixRepository>;
  // A telemetry issue is fixed in its service's code, any other in infrastructure code.
  isTelemetry: boolean;
  onClose: () => void;
  onSubmit: (codeRepositoryId: ObjectID) => Promise<void>;
}

const PICK_INFRASTRUCTURE_REPOSITORY: string = translationKey(
  "Pick the repository that holds this store's infrastructure code. OneUptime AI opens a pull request there.",
);

const PICK_SERVICE_REPOSITORY: string = translationKey(
  "Pick the repository that holds this service's code. OneUptime AI opens a pull request there.",
);

/*
 * Fix with AI when the person may ask in several repositories: which one
 * holds the code to change. It offers only the repositories the server
 * said they may ask OneUptime AI to work in - never one they could not
 * start a task in from Code.
 */
export const IssueRepositoryModal: FunctionComponent<
  IssueRepositoryModalProps
> = (props: IssueRepositoryModalProps): ReactElement => {
  const options: Array<DropdownOption> = props.repositories.map(
    (repository: DataSecurityFixRepository): DropdownOption => {
      return {
        value: repository.id,
        label: repository.name || repository.id,
        isUserContent: true,
      };
    },
  );

  return (
    <IssueChangeModal
      title="Fix with AI"
      description={
        props.isTelemetry
          ? PICK_SERVICE_REPOSITORY
          : PICK_INFRASTRUCTURE_REPOSITORY
      }
      submitButtonText="Fix with AI"
      name="data-security-issue-fix-repository"
      initialValues={{}}
      fields={[
        {
          field: { [REPOSITORY_KEY]: true },
          title: "Repository",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Choose a repository",
          dropdownOptions: options,
        },
      ]}
      onClose={props.onClose}
      onSubmit={async (values: FormValues<JSONObject>) => {
        const id: string = String((values as JSONObject)[REPOSITORY_KEY] || "");

        if (!id) {
          return;
        }

        await props.onSubmit(new ObjectID(id));
      }}
    />
  );
};
