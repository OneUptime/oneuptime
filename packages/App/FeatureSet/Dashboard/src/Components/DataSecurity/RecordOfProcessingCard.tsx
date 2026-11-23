import {
  downloadRecordOfProcessing,
  downloadRecordOfProcessingJson,
} from "./ComplianceExport";
import {
  CHANGE_PILL,
  DRAFT_PILL,
  DRAFTS_TURNED_OFF,
  LEGAL_BASIS,
  NOT_LEGAL_ADVICE,
  PEOPLE,
  RECIPIENTS,
  REVIEW,
  REVIEW_DRAFTS,
  STORES_COMPLETE,
  STORES_INCOMPLETE,
  STORES_TO_REVIEW,
} from "./ComplianceDraftsCopy";
import DataSecurityApi from "./DataSecurityApi";
import {
  RECORD_DESCRIPTION,
  RECORD_EMPTY_DESCRIPTION,
  RECORD_EMPTY_TITLE,
  WHO_CAN_READ,
  getDeclaredPurposeText,
  getDeclaredRetentionText,
} from "./DeclaredStoreCopy";
import { DeclaredStoreReadersList } from "./DeclaredStoreFacts";
import { getReviewDraftsRoute } from "./IssueListRoute";
import { sortRecordRows } from "./RecordOfProcessingRows";
import {
  ImpactAssessmentLink,
  RecordValue,
  describeTransfer,
} from "./StoreRecord";
import StoreNameCell from "./StoreNameCell";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import {
  DataSecurityRecordCounts,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
  RecordRowState,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { isDataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  RecordField,
  RecordFieldStatus,
  RecordFieldValue,
  RecordFieldView,
  RecordRecipient,
  RecordTransfer,
  isRecordFieldValueEmpty,
  readRecordFieldValue,
} from "Common/Types/DataSecurity/RecordOfProcessing";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import { joinList } from "Common/UI/Utils/ListSeparator";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE GDPR RECORD OF PROCESSING (ARTICLE 30), ON COMPLIANCE.
 *
 * Every store that holds personal data: what it holds, why, for how long,
 * on what legal basis, about whom, who receives it and where it goes, and
 * who can read it, as the server writes the record
 * (DataSecurityAPI.getRecordOfProcessing). The stores OneUptime keeps for
 * the project's security - Security Events, Network Flows, Security
 * Address Vault (#10398) - are among them, marked Declared by OneUptime,
 * with OneUptime's purpose and retention in the reader's words until the
 * team writes its own, and who can read them. A store Data Security found
 * says who can reach it on its own Who Can Reach It page, a link away.
 *
 * OneUptime AI drafts what nobody wrote (#10375): a draft shows in its
 * cell, marked Draft, and is not in the record - nor in its exports -
 * until a person confirms it. Above the table, how many stores wait for a
 * person, and Review Drafts to walk through them one at a time; "not legal
 * advice" is said once there.
 *
 * The whole record exports as CSV (Export CSV, in sight) or JSON (in the
 * header's ⋯), every column the server wrote - owners, region,
 * frameworks - included.
 */

const WHO_CAN_REACH_IT: string = translationKey("Who Can Reach It");

// The record's row as the stores list's name cell draws a store.
function asStore(row: DataSecurityRecordOfProcessingRow): DataStore {
  const store: DataStore = new DataStore();

  store._id = row.dataStoreId;
  store.name = row.name;

  if (isDataStoreKind(row.kind)) {
    store.kind = row.kind;
  }

  store.region = row.region;

  return store;
}

function fieldOf(
  row: DataSecurityRecordOfProcessingRow,
  field: RecordField,
): RecordFieldView | undefined {
  return (row.fields || []).find((view: RecordFieldView): boolean => {
    return view.field === field;
  });
}

/*
 * A field as the record says it, for a row that came without its fields'
 * standing: what the store's column holds, a person's.
 */
function recordedView(
  row: DataSecurityRecordOfProcessingRow,
  field: RecordField,
): RecordFieldView {
  const value: RecordFieldValue = readRecordFieldValue(
    field,
    field === RecordField.Purpose
      ? row.purpose
      : field === RecordField.Retention
        ? row.retention
        : field === RecordField.LegalBasis
          ? row.legalBasis
          : row.dataSubjects,
  );

  return {
    field,
    status: isRecordFieldValueEmpty(value)
      ? RecordFieldStatus.Empty
      : RecordFieldStatus.Written,
    value,
  };
}

/*
 * One field of a store's record as the table draws it: what the record
 * says; OneUptime AI's draft, marked Draft, where nobody wrote it yet;
 * Change proposed beside a confirmed value whose facts changed.
 */
const RecordFieldCell: FunctionComponent<{
  row: DataSecurityRecordOfProcessingRow;
  field: RecordField;
  // How the record says the field where a person wrote nothing, if not the plain value.
  recorded?: ReactElement | undefined;
}> = (props: {
  row: DataSecurityRecordOfProcessingRow;
  field: RecordField;
  recorded?: ReactElement | undefined;
}): ReactElement => {
  const view: RecordFieldView =
    fieldOf(props.row, props.field) || recordedView(props.row, props.field);

  if (view.status === RecordFieldStatus.Drafted && view.draft) {
    return (
      <div className="space-y-1 text-sm">
        <Pill text={DRAFT_PILL} tone={PillTone.Info} icon={IconProp.Sparkles} />
        <div className="text-gray-600">
          <RecordValue field={props.field} value={view.draft.value} />
        </div>
      </div>
    );
  }

  const value: ReactElement =
    props.recorded ||
    (isRecordFieldValueEmpty(view.value) ? (
      <TableEmptyValue />
    ) : (
      <span className="text-sm">
        <RecordValue field={props.field} value={view.value} />
      </span>
    ));

  if (view.status === RecordFieldStatus.ChangeProposed) {
    return (
      <div className="space-y-1">
        {value}
        <Pill
          text={CHANGE_PILL}
          tone={PillTone.Warning}
          icon={IconProp.Sparkles}
        />
      </div>
    );
  }

  return value;
};

// Who receives a store's data and where it goes, as a short list.
const RecipientsAndTransfersCell: FunctionComponent<{
  row: DataSecurityRecordOfProcessingRow;
}> = (props: { row: DataSecurityRecordOfProcessingRow }): ReactElement => {
  const translator: Translator = useTranslator();
  const recipients: Array<RecordRecipient> = props.row.recipients || [];
  const transfers: Array<RecordTransfer> = props.row.transfers || [];

  if (recipients.length === 0 && transfers.length === 0) {
    return <TableEmptyValue />;
  }

  return (
    <ul className="space-y-0.5 text-sm text-gray-700">
      {recipients.map((recipient: RecordRecipient): ReactElement => {
        return (
          <li
            key={`recipient:${recipient.kind}:${recipient.name}`}
            className="[overflow-wrap:anywhere]"
          >
            <IsolatedText text={recipient.name} />
          </li>
        );
      })}
      {transfers.map((transfer: RecordTransfer): ReactElement => {
        return (
          <li
            key={`transfer:${transfer.route}:${transfer.toRegion}:${transfer.copyStoreName || ""}`}
            className="text-amber-800"
          >
            {describeTransfer(transfer, translator)}
          </li>
        );
      })}
    </ul>
  );
};

/*
 * How the record stands, over the table: the stores whose drafts wait for
 * a person - with Review Drafts - the complete ones, and those with empty
 * fields; and whether OneUptime AI drafts them on its own.
 */
const RecordSummary: FunctionComponent<{
  answer: DataSecurityRecordOfProcessingResponse;
}> = (props: {
  answer: DataSecurityRecordOfProcessingResponse;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const counts: DataSecurityRecordCounts | undefined = props.answer.counts;

  if (!counts || counts.toReview + counts.complete + counts.incomplete === 0) {
    return <></>;
  }

  const parts: Array<string> = [];

  if (counts.toReview > 0) {
    parts.push(translator.translatePlural(STORES_TO_REVIEW, counts.toReview));
  }

  if (counts.complete > 0) {
    parts.push(translator.translatePlural(STORES_COMPLETE, counts.complete));
  }

  if (counts.incomplete > 0) {
    parts.push(
      translator.translatePlural(STORES_INCOMPLETE, counts.incomplete),
    );
  }

  const isDraftingOff: boolean =
    counts.incomplete > 0 &&
    props.answer.isAiEnabled === true &&
    props.answer.isAutomaticAiOn !== true;

  return (
    <div
      className="mb-4 space-y-2 border-b border-gray-100 pb-4"
      data-testid="data-security-record-of-processing-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700">{joinList(parts)}</p>
        {counts.toReview > 0 ? (
          <Button
            title={REVIEW_DRAFTS}
            icon={IconProp.Sparkles}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="data-security-record-of-processing-review"
            onClick={() => {
              Navigation.navigate(getReviewDraftsRoute());
            }}
          />
        ) : (
          <></>
        )}
      </div>
      {counts.toReview > 0 ? (
        <p className="text-xs text-gray-600">
          {translator.translateText(NOT_LEGAL_ADVICE)}
        </p>
      ) : (
        <></>
      )}
      {isDraftingOff ? (
        <p className="text-xs text-gray-600">
          {translator.translateText(DRAFTS_TURNED_OFF)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const RecordOfProcessingCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] =
    useState<DataSecurityRecordOfProcessingResponse | null>(null);
  const [rows, setRows] =
    useState<Array<DataSecurityRecordOfProcessingRow> | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    DataSecurityApi.getRecordOfProcessing()
      .then((response: DataSecurityRecordOfProcessingResponse) => {
        if (isCurrent) {
          setAnswer(response);
          setRows(sortRecordRows(response.rows || []));
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const hasRows: boolean = Boolean(rows && rows.length > 0);

  // The CSV in sight, the JSON in the header's ⋯, as a framework's report has them.
  const exportButtons: Array<CardButtonSchema> = hasRows
    ? [
        {
          title: "Export CSV",
          icon: IconProp.Download,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            downloadRecordOfProcessing(rows || []);
          },
        },
        {
          title: "Export JSON",
          icon: IconProp.Download,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: () => {
            downloadRecordOfProcessingJson(rows || []);
          },
        },
      ]
    : [];

  let body: ReactElement;

  if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setRows(null);
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!rows) {
    body = <TableSkeleton />;
  } else if (rows.length === 0) {
    body = (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.ShieldCheck}
        title={RECORD_EMPTY_TITLE}
        description={RECORD_EMPTY_DESCRIPTION}
        isCompact={true}
      />
    );
  } else {
    body = (
      <>
        {answer ? <RecordSummary answer={answer} /> : <></>}
        <LocalTable<DataSecurityRecordOfProcessingRow>
          id="data-security-record-of-processing"
          data={rows}
          singularLabel="Data Store"
          pluralLabel="Data Stores"
          columns={[
            {
              key: "name",
              title: "Data Store",
              type: FieldType.Element,
              disableSort: true,
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                return (
                  <div className="min-w-[10rem] max-w-[14rem] space-y-1">
                    <StoreNameCell store={asStore(row)} />
                    {/* A store whose drafts wait for a person: Review Drafts, at it. */}
                    {row.state === RecordRowState.ToReview ? (
                      <AppLink
                        to={getReviewDraftsRoute(row.dataStoreId)}
                        className="inline-flex text-xs font-medium text-indigo-600 hover:underline"
                      >
                        {translator.translateText(REVIEW) || REVIEW}
                      </AppLink>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              key: "dataTypeNames",
              title: "Data Types",
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[12rem]",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                const names: Array<string> = (row.dataTypeNames || []).map(
                  (name: string): string => {
                    return translator.translateText(name) || name;
                  },
                );

                return names.length > 0 ? (
                  <span className="text-sm text-gray-700">
                    {joinList(names)}
                  </span>
                ) : (
                  <TableEmptyValue />
                );
              },
            },
            {
              key: "purpose",
              title: "Purpose",
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-xs",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                if (row.declared) {
                  return (
                    <span className="text-sm text-gray-900">
                      {row.declared.isPurposeTheTeams ? (
                        <IsolatedText text={row.purpose} />
                      ) : (
                        getDeclaredPurposeText(
                          { purpose: row.purpose, declared: row.declared },
                          translator,
                        )
                      )}
                    </span>
                  );
                }

                return (
                  <RecordFieldCell row={row} field={RecordField.Purpose} />
                );
              },
            },
            {
              key: "retention",
              title: "Retention",
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[12rem]",
              hideBelowLargeScreen: true,
              foldInto: "purpose",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                if (row.declared) {
                  return (
                    <span className="text-sm text-gray-900">
                      {row.declared.isRetentionTheTeams ? (
                        <IsolatedText text={row.retention} />
                      ) : (
                        getDeclaredRetentionText(
                          { retention: row.retention, declared: row.declared },
                          translator,
                        )
                      )}
                    </span>
                  );
                }

                return (
                  <RecordFieldCell row={row} field={RecordField.Retention} />
                );
              },
            },
            {
              key: "legalBasis",
              title: LEGAL_BASIS,
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[12rem]",
              hideBelowLargeScreen: true,
              foldInto: "purpose",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                return (
                  <RecordFieldCell row={row} field={RecordField.LegalBasis} />
                );
              },
            },
            {
              key: "dataSubjects",
              title: PEOPLE,
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[12rem]",
              hideBelowLargeScreen: true,
              foldInto: "dataTypeNames",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                return <RecordFieldCell row={row} field={RecordField.People} />;
              },
            },
            {
              key: "recipients",
              title: RECIPIENTS,
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[14rem]",
              hideBelowLargeScreen: true,
              foldInto: "name",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                return <RecipientsAndTransfersCell row={row} />;
              },
            },
            {
              key: "declared",
              title: WHO_CAN_READ,
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-xs",
              hideBelowLargeScreen: true,
              foldInto: "name",
              getElement: (
                row: DataSecurityRecordOfProcessingRow,
              ): ReactElement => {
                if (row.declared) {
                  return <DeclaredStoreReadersList declared={row.declared} />;
                }

                // A store Data Security found: who can reach it is its own page.
                const accessRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_ACCESS] as Route,
                  { modelId: new ObjectID(row.dataStoreId) },
                );

                return (
                  <div className="space-y-1">
                    <AppLink
                      to={accessRoute}
                      className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                    >
                      {translator.translateText(WHO_CAN_REACH_IT) ||
                        WHO_CAN_REACH_IT}
                    </AppLink>
                    {/* Its impact assessment, for a store that needs one. */}
                    <div>
                      <ImpactAssessmentLink row={row} />
                    </div>
                  </div>
                );
              },
            },
          ]}
        />
      </>
    );
  }

  return (
    <Card
      title="Record of Processing"
      description={RECORD_DESCRIPTION}
      buttons={getTableHeaderButtons(exportButtons)}
    >
      <div data-testid="data-security-record-of-processing-card">{body}</div>
    </Card>
  );
};

export default RecordOfProcessingCard;
