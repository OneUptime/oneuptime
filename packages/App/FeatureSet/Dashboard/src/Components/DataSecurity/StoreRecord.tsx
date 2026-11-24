import {
  ASSESSMENT_DRAFTED,
  ASSESSMENT_EDITED,
  BEFORE,
  CANCEL,
  CONFIRM,
  CONFIRMED,
  DRAFT_AGAIN,
  DRAFT_WITH_AI,
  DRAFTED_FIELDS,
  DRAFTED_NOTHING,
  EDIT,
  GONE,
  IMPACT_ASSESSMENT,
  NEEDS_ONE,
  KEEP_CURRENT,
  LEAVES_EEA,
  NO_RECIPIENTS,
  NO_TRANSFERS,
  NOT_WRITTEN_YET,
  NOW,
  NOW_IN_THE_RECORD,
  PICK_A_BASIS,
  PICK_PEOPLE,
  PROPOSED_CHANGE,
  PURPOSE_PLACEHOLDER,
  RECIPIENT_VIA,
  RECIPIENTS,
  RETENTION_PLACEHOLDER,
  SAVE,
  SAVED,
  TRANSFER_BY_REPLICATION,
  TRANSFER_IN_COPY,
  TRANSFER_LINE,
  TRANSFERS,
  USE_NEW_DRAFT,
  WHAT_CHANGED,
  WHY,
  WORKED_OUT,
  WRITE,
} from "./ComplianceDraftsCopy";
import {
  ComplianceFactLine,
  ComplianceFactsToggle,
  getCountryName,
  getFactsByKeys,
} from "./ComplianceFacts";
import DataSecurityApi from "./DataSecurityApi";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { ComplianceFact } from "Common/Types/DataSecurity/ComplianceFacts";
import {
  DataSecurityRecordDraftResult,
  DataSecurityRecordFieldResult,
  DataSecurityRecordOfProcessingRow,
  ImpactAssessmentStatus,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  isRecordLegalBasis,
  RECORD_FIELD_STATUS_TITLES,
  RECORD_FIELD_TITLES,
  RECORD_LEGAL_BASES,
  RECORD_LEGAL_BASIS_INFO,
  RECORD_LEGAL_BASIS_TITLES,
  RECORD_PEOPLE,
  RECORD_PEOPLE_TITLES,
  RECORD_RECIPIENT_KIND_TITLES,
  RECORD_DRAFT_SKIP_TEXTS,
  RECORD_TRANSFERS_UNKNOWN_TEXTS,
  RecordField,
  RecordFieldAction,
  RecordFieldDraft,
  RecordFieldStatus,
  RecordFieldValue,
  RecordFieldView,
  RecordPeople,
  RecordRecipient,
  RecordTransfer,
  RecordTransferRoute,
} from "Common/Types/DataSecurity/RecordOfProcessing";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Input from "Common/UI/Components/Input/Input";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A STORE'S RECORD OF PROCESSING, FIELD BY FIELD (#10375): what Review
 * Drafts walks through one store at a time, and what the store's Settings
 * show.
 *
 * Each of Purpose, Retention, Legal Basis and People It Is About says
 * where it stands - Drafted by OneUptime AI, Change proposed, Confirmed,
 * Written by your team, Filled in by OneUptime or empty - and what a
 * person does next is one press: Confirm a draft as it is, Edit it into
 * their own words, Use New Draft or Keep Current beside a change, Write an
 * empty one. A draft's facts are one click away, and beside a change, what
 * changed since it was confirmed. Nothing of OneUptime AI's is in the
 * record until that press.
 *
 * Recipients and Transfers are worked out from the store's flows and
 * regions, so they are shown, never drafted or edited.
 */

export const STORE_RECORD_TEST_ID: string = "data-security-store-record";

const STATUS_TONES: Readonly<Record<RecordFieldStatus, PillTone>> = {
  [RecordFieldStatus.Empty]: PillTone.Neutral,
  [RecordFieldStatus.Drafted]: PillTone.Info,
  [RecordFieldStatus.ChangeProposed]: PillTone.Warning,
  [RecordFieldStatus.Confirmed]: PillTone.Success,
  [RecordFieldStatus.Written]: PillTone.Neutral,
  [RecordFieldStatus.FilledIn]: PillTone.Neutral,
};

// A field's value, as the record says it: a sentence, a basis, the people.
export const RecordValue: FunctionComponent<{
  field: RecordField;
  value: RecordFieldValue;
}> = (props: { field: RecordField; value: RecordFieldValue }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.field === RecordField.People && Array.isArray(props.value)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {props.value.map((category: RecordPeople): ReactElement => {
          return (
            <Pill
              key={category}
              text={RECORD_PEOPLE_TITLES[category] || category}
              tone={PillTone.Neutral}
              isDotHidden={true}
            />
          );
        })}
      </span>
    );
  }

  const text: string = Array.isArray(props.value)
    ? props.value.join(", ")
    : props.value;

  if (props.field === RecordField.LegalBasis && isRecordLegalBasis(text)) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-gray-900">
          {translator.translateText(RECORD_LEGAL_BASIS_TITLES[text])}
        </span>
        <span className="text-xs text-gray-500">
          {RECORD_LEGAL_BASIS_INFO[text].article}
        </span>
      </span>
    );
  }

  return (
    <span className="text-gray-900 [overflow-wrap:anywhere]">
      <IsolatedText text={text} />
    </span>
  );
};

// The options of a legal basis, each with its article.
export function getLegalBasisOptions(): Array<DropdownOption> {
  return RECORD_LEGAL_BASES.map((basis: string): DropdownOption => {
    return {
      value: basis,
      label:
        RECORD_LEGAL_BASIS_TITLES[
          basis as keyof typeof RECORD_LEGAL_BASIS_TITLES
        ],
      description:
        RECORD_LEGAL_BASIS_INFO[basis as keyof typeof RECORD_LEGAL_BASIS_INFO]
          .description,
    };
  });
}

export function getPeopleOptions(): Array<DropdownOption> {
  return RECORD_PEOPLE.map((category: RecordPeople): DropdownOption => {
    return { value: category, label: RECORD_PEOPLE_TITLES[category] };
  });
}

function isSameValue(a: RecordFieldValue, b: RecordFieldValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The editor of one field: a sentence, a phrase, a basis or the people.
const RecordFieldEditor: FunctionComponent<{
  field: RecordField;
  value: RecordFieldValue;
  onChange: (value: RecordFieldValue) => void;
  dataTestId: string;
  // The field's title, which names the box to a screen reader.
  labelId: string;
}> = (props: {
  field: RecordField;
  value: RecordFieldValue;
  onChange: (value: RecordFieldValue) => void;
  dataTestId: string;
  labelId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string =
    translator.translateText(RECORD_FIELD_TITLES[props.field]) ||
    RECORD_FIELD_TITLES[props.field];

  switch (props.field) {
    case RecordField.Purpose:
      return (
        <TextArea
          initialValue={typeof props.value === "string" ? props.value : ""}
          placeholder={PURPOSE_PLACEHOLDER}
          autoFocus={true}
          ariaLabelledby={props.labelId}
          dataTestId={props.dataTestId}
          onChange={(value: string) => {
            props.onChange(value);
          }}
        />
      );
    case RecordField.Retention:
      return (
        <Input
          initialValue={typeof props.value === "string" ? props.value : ""}
          placeholder={RETENTION_PLACEHOLDER}
          autoFocus={true}
          ariaLabel={label}
          dataTestId={props.dataTestId}
          onChange={(value: string) => {
            props.onChange(value);
          }}
        />
      );
    case RecordField.LegalBasis: {
      const options: Array<DropdownOption> = getLegalBasisOptions();

      return (
        <Dropdown
          options={options}
          initialValue={options.find((option: DropdownOption): boolean => {
            return option.value === props.value;
          })}
          placeholder={PICK_A_BASIS}
          ariaLabel={label}
          isAriaLabelTranslated={true}
          dataTestId={props.dataTestId}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange(typeof value === "string" ? value : "");
          }}
        />
      );
    }
    default: {
      const options: Array<DropdownOption> = getPeopleOptions();
      const chosen: Array<string> = Array.isArray(props.value)
        ? props.value
        : [];

      return (
        <Dropdown
          options={options}
          isMultiSelect={true}
          initialValue={options.filter((option: DropdownOption): boolean => {
            return chosen.includes(String(option.value));
          })}
          placeholder={PICK_PEOPLE}
          ariaLabel={label}
          isAriaLabelTranslated={true}
          dataTestId={props.dataTestId}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange(
              (Array.isArray(value) ? value : value ? [value] : []).filter(
                (item: DropdownValue): item is RecordPeople => {
                  return RECORD_PEOPLE.includes(item as RecordPeople);
                },
              ) as Array<RecordPeople>,
            );
          }}
        />
      );
    }
  }
};

export interface RecordFieldRowProps {
  dataStoreId: string;
  view: RecordFieldView;
  facts: ReadonlyArray<ComplianceFact>;
  canEdit: boolean;
  onRowChange: (row: DataSecurityRecordOfProcessingRow) => void;
  // Whether a person is mid-edit here, for the page to ask before leaving.
  onEditingChange?: ((isEditing: boolean) => void) | undefined;
}

// What changed under a confirmed value: each fact as it was, and as it is now.
const ChangedFacts: FunctionComponent<{
  view: RecordFieldView;
  facts: ReadonlyArray<ComplianceFact>;
}> = (props: {
  view: RecordFieldView;
  facts: ReadonlyArray<ComplianceFact>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const keys: Array<string> = props.view.changedFactKeys || [];

  if (keys.length === 0) {
    return <></>;
  }

  return (
    <div className="space-y-2 rounded-md bg-amber-50 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
        {translator.translateText(WHAT_CHANGED)}
      </p>
      {keys.map((key: string): ReactElement => {
        const before: ComplianceFact | undefined = (
          props.view.previousFacts || []
        ).find((fact: ComplianceFact): boolean => {
          return fact.key === key;
        });
        const now: ComplianceFact | undefined = props.facts.find(
          (fact: ComplianceFact): boolean => {
            return fact.key === key;
          },
        );

        return (
          <div key={key} className="grid gap-1 sm:grid-cols-2 sm:gap-3">
            <div className="space-y-0.5">
              <p className="text-xs text-gray-600">
                {translator.translateText(BEFORE)}
              </p>
              {before ? <ComplianceFactLine fact={before} /> : <EmptyValue />}
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-gray-600">
                {translator.translateText(NOW)}
              </p>
              {now ? (
                <ComplianceFactLine fact={now} />
              ) : (
                <p className="text-sm text-gray-600">
                  {translator.translateText(GONE)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// A draft's or a proposal's value, why, and the facts it rests on.
const DraftBody: FunctionComponent<{
  field: RecordField;
  draft: RecordFieldDraft;
  facts: ReadonlyArray<ComplianceFact>;
  dataTestId: string;
}> = (props: {
  field: RecordField;
  draft: RecordFieldDraft;
  facts: ReadonlyArray<ComplianceFact>;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="space-y-1.5">
      <div className="rounded-md border border-dashed border-indigo-200 bg-indigo-50/40 px-3 py-2 text-sm">
        <RecordValue field={props.field} value={props.draft.value} />
      </div>
      {props.draft.reason ? (
        <p className="text-sm text-gray-600 [overflow-wrap:anywhere]">
          {translator.translateTemplate(WHY, {
            reason: props.draft.reason,
          })}
        </p>
      ) : (
        <></>
      )}
      <ComplianceFactsToggle
        facts={getFactsByKeys(props.facts, props.draft.factKeys)}
        dataTestId={`${props.dataTestId}-facts`}
      />
    </div>
  );
};

export const RecordFieldRow: FunctionComponent<RecordFieldRowProps> = (
  props: RecordFieldRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const view: RecordFieldView = props.view;
  const testId: string = `${STORE_RECORD_TEST_ID}-${view.field}`;
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [edited, setEdited] = useState<RecordFieldValue>(view.value);
  const [pressing, setPressing] = useState<RecordFieldAction | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    props.onEditingChange?.(isEditing && !isSameValue(edited, view.value));
  }, [isEditing, edited]);

  const press: (
    action: RecordFieldAction,
    extra?: {
      value?: RecordFieldValue | null | undefined;
      shownDraftedAt?: string | undefined;
    },
  ) => Promise<void> = async (
    action: RecordFieldAction,
    extra: {
      value?: RecordFieldValue | null | undefined;
      shownDraftedAt?: string | undefined;
    } = {},
  ): Promise<void> => {
    setPressing(action);
    setError("");

    try {
      const result: DataSecurityRecordFieldResult =
        await DataSecurityApi.applyRecordField({
          dataStoreId: props.dataStoreId,
          field: view.field,
          action,
          value: extra.value,
          shownDraftedAt: extra.shownDraftedAt,
        });

      setIsEditing(false);
      props.onRowChange(result.row);
      Toast.success(
        translator.translateText(
          action === RecordFieldAction.Write ? SAVED : CONFIRMED,
        ) || "",
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setPressing(null);
    }
  };

  const startEditing: (from: RecordFieldValue) => void = (
    from: RecordFieldValue,
  ): void => {
    setEdited(from);
    setError("");
    setIsEditing(true);
  };

  const fieldTitle: string =
    translator.translateText(RECORD_FIELD_TITLES[view.field]) ||
    RECORD_FIELD_TITLES[view.field];
  const showsPill: boolean =
    view.status !== RecordFieldStatus.Empty &&
    view.status !== RecordFieldStatus.Written;
  let body: ReactElement;
  let actions: Array<ReactElement> = [];

  if (isEditing) {
    body = (
      <RecordFieldEditor
        field={view.field}
        value={edited}
        onChange={setEdited}
        dataTestId={`${testId}-editor`}
        labelId={`${testId}-title`}
      />
    );
    actions = [
      <Button
        key="save"
        title={SAVE}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        isLoading={pressing === RecordFieldAction.Write}
        dataTestId={`${testId}-save`}
        onClick={() => {
          void press(RecordFieldAction.Write, {
            value:
              Array.isArray(edited) && edited.length === 0
                ? null
                : !Array.isArray(edited) && !edited.trim()
                  ? null
                  : edited,
          });
        }}
      />,
      <Button
        key="cancel"
        title={CANCEL}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        dataTestId={`${testId}-cancel`}
        onClick={() => {
          setIsEditing(false);
          setError("");
        }}
      />,
    ];
  } else if (view.status === RecordFieldStatus.Drafted && view.draft) {
    const draft: RecordFieldDraft = view.draft;

    body = (
      <DraftBody
        field={view.field}
        draft={draft}
        facts={props.facts}
        dataTestId={testId}
      />
    );
    actions = props.canEdit
      ? [
          <Button
            key="confirm"
            title={CONFIRM}
            icon={IconProp.Check}
            buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
            buttonSize={ButtonSize.Small}
            isLoading={pressing === RecordFieldAction.Confirm}
            dataTestId={`${testId}-confirm`}
            onClick={() => {
              void press(RecordFieldAction.Confirm, {
                shownDraftedAt: draft.draftedAt,
              });
            }}
          />,
          <Button
            key="edit"
            title={EDIT}
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={`${testId}-edit`}
            onClick={() => {
              startEditing(draft.value);
            }}
          />,
        ]
      : [];
  } else if (
    view.status === RecordFieldStatus.ChangeProposed &&
    view.proposed
  ) {
    const proposed: RecordFieldDraft = view.proposed;

    body = (
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs text-gray-600">
            {translator.translateText(NOW_IN_THE_RECORD)}
          </p>
          <div className="text-sm">
            <RecordValue field={view.field} value={view.value} />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-gray-600">
            {translator.translateText(PROPOSED_CHANGE)}
          </p>
          <DraftBody
            field={view.field}
            draft={proposed}
            facts={props.facts}
            dataTestId={testId}
          />
        </div>
        <ChangedFacts view={view} facts={props.facts} />
      </div>
    );
    actions = props.canEdit
      ? [
          <Button
            key="use"
            title={USE_NEW_DRAFT}
            icon={IconProp.Check}
            buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
            buttonSize={ButtonSize.Small}
            isLoading={pressing === RecordFieldAction.UseProposal}
            dataTestId={`${testId}-use`}
            onClick={() => {
              void press(RecordFieldAction.UseProposal, {
                shownDraftedAt: proposed.draftedAt,
              });
            }}
          />,
          <Button
            key="keep"
            title={KEEP_CURRENT}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            isLoading={pressing === RecordFieldAction.KeepConfirmed}
            dataTestId={`${testId}-keep`}
            onClick={() => {
              void press(RecordFieldAction.KeepConfirmed);
            }}
          />,
          <Button
            key="edit"
            title={EDIT}
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={`${testId}-edit`}
            onClick={() => {
              startEditing(proposed.value);
            }}
          />,
        ]
      : [];
  } else if (view.status === RecordFieldStatus.Empty) {
    body = (
      <p className="text-sm text-gray-500">
        {translator.translateText(NOT_WRITTEN_YET)}
      </p>
    );
    actions = props.canEdit
      ? [
          <Button
            key="write"
            title={WRITE}
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={`${testId}-write`}
            onClick={() => {
              startEditing(view.field === RecordField.People ? [] : "");
            }}
          />,
        ]
      : [];
  } else {
    body = (
      <div className="text-sm">
        <RecordValue field={view.field} value={view.value} />
      </div>
    );
    actions = props.canEdit
      ? [
          <Button
            key="edit"
            title={EDIT}
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={`${testId}-edit`}
            onClick={() => {
              startEditing(view.value);
            }}
          />,
        ]
      : [];
  }

  return (
    <div
      className="grid gap-2 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6"
      data-testid={testId}
      data-status={view.status}
    >
      <div className="space-y-1.5">
        <div
          className="text-sm font-medium text-gray-900"
          id={`${testId}-title`}
        >
          {fieldTitle}
        </div>
        {showsPill ? (
          <Pill
            text={RECORD_FIELD_STATUS_TITLES[view.status]}
            tone={STATUS_TONES[view.status]}
            {...(view.status === RecordFieldStatus.Drafted ||
            view.status === RecordFieldStatus.ChangeProposed
              ? { icon: IconProp.Sparkles }
              : {})}
          />
        ) : (
          <></>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        {body}
        {error ? <ErrorLine message={error} /> : <></>}
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">{actions}</div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

// A recipient, as one line in the reader's words.
function describeRecipient(
  recipient: RecordRecipient,
  translator: Translator,
): string {
  return recipient.via.length > 0
    ? translator.translateTemplate(RECIPIENT_VIA, {
        name: recipient.name,
        services: formatList(recipient.via, translator),
      })
    : recipient.name;
}

// A transfer, as one line in the reader's words: "Germany to United States".
export function describeTransfer(
  transfer: RecordTransfer,
  translator: Translator,
): string {
  const from: string = formatList(
    transfer.fromCountries.map((country: string): string => {
      return getCountryName(country, translator);
    }),
    translator,
  );
  const to: string = `${getCountryName(transfer.toCountry, translator)} (${transfer.toRegion})`;

  return translator.translateTemplate(
    transfer.route === RecordTransferRoute.Replication
      ? TRANSFER_BY_REPLICATION
      : transfer.route === RecordTransferRoute.Copy
        ? TRANSFER_IN_COPY
        : TRANSFER_LINE,
    {
      from: composedValue((): string => {
        return from;
      }),
      to: composedValue((): string => {
        return to;
      }),
      store: transfer.copyStoreName || "",
    },
  );
}

// Who receives the store's data, and where it goes, worked out by plain code.
export const RecordRecipientsAndTransfers: FunctionComponent<{
  row: DataSecurityRecordOfProcessingRow;
}> = (props: { row: DataSecurityRecordOfProcessingRow }): ReactElement => {
  const translator: Translator = useTranslator();
  const recipients: Array<RecordRecipient> = props.row.recipients || [];
  const transfers: Array<RecordTransfer> = props.row.transfers || [];

  return (
    <div className="space-y-4 border-t border-gray-100 py-4">
      <p className="text-xs text-gray-600">
        {translator.translateText(WORKED_OUT)}
      </p>
      <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
        <div className="text-sm font-medium text-gray-900">
          {translator.translateText(RECIPIENTS)}
        </div>
        {recipients.length > 0 ? (
          <ul
            className="space-y-1"
            data-testid={`${STORE_RECORD_TEST_ID}-recipients`}
          >
            {recipients.map((recipient: RecordRecipient): ReactElement => {
              return (
                <li
                  key={`${recipient.kind}:${recipient.name}`}
                  className="flex flex-wrap items-center gap-2 text-sm text-gray-800"
                >
                  <Pill
                    text={RECORD_RECIPIENT_KIND_TITLES[recipient.kind]}
                    tone={PillTone.Neutral}
                    isDotHidden={true}
                  />
                  <span className="[overflow-wrap:anywhere]">
                    <IsolatedText
                      text={describeRecipient(recipient, translator)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">
            {translator.translateText(NO_RECIPIENTS)}
          </p>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
        <div className="text-sm font-medium text-gray-900">
          {translator.translateText(TRANSFERS)}
        </div>
        {transfers.length > 0 ? (
          <ul
            className="space-y-1"
            data-testid={`${STORE_RECORD_TEST_ID}-transfers`}
          >
            {transfers.map((transfer: RecordTransfer): ReactElement => {
              return (
                <li
                  key={`${transfer.route}:${transfer.toRegion}:${transfer.copyStoreName || ""}`}
                  className="flex flex-wrap items-center gap-2 text-sm text-gray-800"
                >
                  <span>{describeTransfer(transfer, translator)}</span>
                  {transfer.leavesEea ? (
                    <Pill text={LEAVES_EEA} tone={PillTone.Warning} />
                  ) : (
                    <></>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">
            {props.row.transfersUnknownBecause
              ? translator.translateText(
                  RECORD_TRANSFERS_UNKNOWN_TEXTS[
                    props.row.transfersUnknownBecause
                  ],
                )
              : translator.translateText(NO_TRANSFERS)}
          </p>
        )}
      </div>
    </div>
  );
};

/*
 * A store's whole record: its four fields, then its recipients and
 * transfers. `onUnsavedChange` says whether a person is mid-edit, for the
 * page to ask before it is left.
 */
export const StoreRecordFields: FunctionComponent<{
  row: DataSecurityRecordOfProcessingRow;
  canEdit: boolean;
  onRowChange: (row: DataSecurityRecordOfProcessingRow) => void;
  onUnsavedChange?: ((hasUnsaved: boolean) => void) | undefined;
}> = (props: {
  row: DataSecurityRecordOfProcessingRow;
  canEdit: boolean;
  onRowChange: (row: DataSecurityRecordOfProcessingRow) => void;
  onUnsavedChange?: ((hasUnsaved: boolean) => void) | undefined;
}): ReactElement => {
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    props.onUnsavedChange?.(Object.values(editing).some(Boolean));
  }, [editing]);

  return (
    <div data-testid={STORE_RECORD_TEST_ID}>
      <div className="divide-y divide-gray-100">
        {(props.row.fields || []).map((view: RecordFieldView): ReactElement => {
          return (
            <RecordFieldRow
              key={`${props.row.dataStoreId}:${view.field}:${view.status}`}
              dataStoreId={props.row.dataStoreId}
              view={view}
              facts={props.row.facts || []}
              canEdit={props.canEdit}
              onRowChange={props.onRowChange}
              onEditingChange={(isEditing: boolean) => {
                setEditing((current: Record<string, boolean>) => {
                  return current[view.field] === isEditing
                    ? current
                    : { ...current, [view.field]: isEditing };
                });
              }}
            />
          );
        })}
      </div>
      <RecordRecipientsAndTransfers row={props.row} />
    </div>
  );
};

// Whether a store's record has an empty field, or a draft no person confirmed.
export function getRecordDraftNeed(row: DataSecurityRecordOfProcessingRow): {
  hasEmpty: boolean;
  hasDrafts: boolean;
} {
  const fields: Array<RecordFieldView> = row.fields || [];

  return {
    hasEmpty: fields.some((view: RecordFieldView): boolean => {
      return view.status === RecordFieldStatus.Empty;
    }),
    hasDrafts: fields.some((view: RecordFieldView): boolean => {
      return view.status === RecordFieldStatus.Drafted;
    }),
  };
}

/*
 * OneUptime AI's drafts of one store's record, now: Draft with OneUptime AI
 * where a field is empty, Draft Again where every draft waits for a person
 * (a confirmed field or a person's words are never drafted again). Drawn
 * only for a store Data Security found, to a reader who may draft.
 */
export const DraftRecordButton: FunctionComponent<{
  row: DataSecurityRecordOfProcessingRow;
  canDraft: boolean;
  // While a field is being edited: a draft would not land under it.
  disabled?: boolean | undefined;
  onRowChange: (row: DataSecurityRecordOfProcessingRow) => void;
  dataTestId: string;
}> = (props: {
  row: DataSecurityRecordOfProcessingRow;
  canDraft: boolean;
  disabled?: boolean | undefined;
  onRowChange: (row: DataSecurityRecordOfProcessingRow) => void;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const { hasEmpty, hasDrafts } = getRecordDraftNeed(props.row);

  useEffect(() => {
    setError("");
  }, [props.row.dataStoreId]);

  if (!props.canDraft || props.row.declared || !(hasEmpty || hasDrafts)) {
    return <></>;
  }

  const draft: () => Promise<void> = async (): Promise<void> => {
    setIsDrafting(true);
    setError("");

    try {
      const result: DataSecurityRecordDraftResult =
        await DataSecurityApi.draftRecord({
          dataStoreId: props.row.dataStoreId,
          force: !hasEmpty,
        });
      const drafted: number =
        result.draftedFields.length + result.proposedFields.length;

      props.onRowChange(result.row);

      if (drafted > 0) {
        Toast.success(translator.translatePlural(DRAFTED_FIELDS, drafted));
      } else {
        Toast.info(
          translator.translateText(
            result.nothingDraftedBecause
              ? RECORD_DRAFT_SKIP_TEXTS[result.nothingDraftedBecause]
              : DRAFTED_NOTHING,
          ) || "",
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsDrafting(false);
    }
  };

  return (
    <div className="space-y-2">
      {error ? <ErrorLine message={error} /> : <></>}
      <Button
        title={hasEmpty ? DRAFT_WITH_AI : DRAFT_AGAIN}
        icon={IconProp.Sparkles}
        buttonStyle={ButtonStyleType.OUTLINE}
        isLoading={isDrafting}
        disabled={props.disabled}
        dataTestId={props.dataTestId}
        onClick={() => {
          void draft();
        }}
      />
    </div>
  );
};

const ASSESSMENT_STATUS_WORDS: Readonly<
  Partial<Record<ImpactAssessmentStatus, { text: string; tone: PillTone }>>
> = {
  [ImpactAssessmentStatus.Needed]: { text: NEEDS_ONE, tone: PillTone.Warning },
  [ImpactAssessmentStatus.Drafted]: {
    text: ASSESSMENT_DRAFTED,
    tone: PillTone.Info,
  },
  [ImpactAssessmentStatus.Edited]: {
    text: ASSESSMENT_EDITED,
    tone: PillTone.Success,
  },
};

// A link to the store's impact assessment, with where it stands - for a store that needs one.
export const ImpactAssessmentLink: FunctionComponent<{
  row: DataSecurityRecordOfProcessingRow;
}> = (props: { row: DataSecurityRecordOfProcessingRow }): ReactElement => {
  const translator: Translator = useTranslator();
  const status: ImpactAssessmentStatus | undefined =
    props.row.impactAssessment?.status;
  const words: { text: string; tone: PillTone } | undefined = status
    ? ASSESSMENT_STATUS_WORDS[status]
    : undefined;

  if (!words) {
    return <></>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_IMPACT_ASSESSMENT] as Route,
          { modelId: new ObjectID(props.row.dataStoreId) },
        )}
        className="text-sm font-medium text-indigo-600 hover:underline"
      >
        {translator.translateText(IMPACT_ASSESSMENT) || IMPACT_ASSESSMENT}
      </AppLink>
      <Pill text={words.text} tone={words.tone} />
    </span>
  );
};
