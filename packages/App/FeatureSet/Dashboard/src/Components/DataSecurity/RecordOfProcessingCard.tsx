import {
  downloadRecordOfProcessing,
  downloadRecordOfProcessingJson,
} from "./ComplianceExport";
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
import { sortRecordRows } from "./RecordOfProcessingRows";
import StoreNameCell from "./StoreNameCell";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import {
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { isDataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
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
 * Every store that holds personal data: what it holds, why, for how long
 * and who can read it, as the server writes the record
 * (DataSecurityAPI.getRecordOfProcessing). The stores OneUptime keeps for
 * the project's security - Security Events, Network Flows, Security
 * Address Vault (#10398) - are among them, marked Declared by OneUptime,
 * with OneUptime's purpose and retention in the reader's words until the
 * team writes its own, and who can read them. A store Data Security found
 * says who can reach it on its own Who Can Reach It page, a link away.
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

const RecordOfProcessingCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
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
                <div className="min-w-[10rem] max-w-[14rem]">
                  <StoreNameCell store={asStore(row)} />
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
                <span className="text-sm text-gray-700">{joinList(names)}</span>
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

              return row.purpose ? (
                <span className="text-sm text-gray-900">
                  <IsolatedText text={row.purpose} />
                </span>
              ) : (
                <TableEmptyValue />
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

              return row.retention ? (
                <span className="text-sm text-gray-900">
                  <IsolatedText text={row.retention} />
                </span>
              ) : (
                <TableEmptyValue />
              );
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
                <AppLink
                  to={accessRoute}
                  className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                >
                  {translator.translateText(WHO_CAN_REACH_IT) ||
                    WHO_CAN_REACH_IT}
                </AppLink>
              );
            },
          },
        ]}
      />
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
