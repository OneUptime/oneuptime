import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import { downloadRecordOfProcessing } from "../../Components/DataSecurity/ComplianceExport";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import {
  ConfidencePill,
  SensitivityPill,
} from "../../Components/DataSecurity/DataSecurityPills";
import {
  DataTypeNamer,
  getDataTypeInfo,
  useDataTypeNamer,
} from "../../Components/DataSecurity/IssueDataTypes";
import { getStoreViewRoute } from "../../Components/DataSecurity/IssueListRoute";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ComplianceFramework from "Common/Types/DataSecurity/ComplianceFramework";
import DataConfidence, {
  higherConfidence,
} from "Common/Types/DataSecurity/DataConfidence";
import { DataSecurityRecordOfProcessingResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "Common/Types/DataSecurity/DataSensitivity";
import { DataTypeInfo } from "Common/Types/DataSecurity/DataTypeCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHERE DOES EACH KIND OF DATA LIVE?
 *
 * Every data type the scans found, across the project's stores: what it
 * is, its category and sensitivity, how many stores hold it and at how
 * many locations, and the frameworks that protect it - the most sensitive
 * first. Picking a type lists the stores that hold it. Only findings a
 * store counts are counted here: at least Medium confidence, not marked
 * not sensitive, in a store still in its cloud.
 *
 * Under it, the GDPR record of processing (Article 30), built from the
 * same findings and each store's owners, purpose and retention, to export
 * as CSV.
 */

// The most findings read for the page, the most recently seen first.
const FINDINGS_READ_LIMIT: number = 5000;

const STORES_HOLDING: PluralTemplate = {
  one: "{{count}} store",
  other: "{{count}} stores",
};

const STORES_HOLDING_TITLE: string = translationKey("Stores Holding {{type}}");

const FINDINGS_CAPPED: string = translationKey(
  "Counted from the {{count}} most recently seen findings.",
);

interface StoreHolding {
  dataStoreId: string;
  name: string;
  kind: string;
  locations: number;
  matches: number;
  confidence: DataConfidence;
}

interface DataTypeRow {
  dataTypeId: string;
  name: string;
  description: string;
  category: string;
  sensitivity: DataSensitivity;
  frameworks: Array<ComplianceFramework>;
  stores: Array<StoreHolding>;
  storeCount: number;
  findings: number;
  matches: number;
}

// The findings read, grouped by data type and then by store.
const aggregateFindings: (
  findings: Array<DataStoreFinding>,
  namer: DataTypeNamer,
) => Array<DataTypeRow> = (
  findings: Array<DataStoreFinding>,
  namer: DataTypeNamer,
): Array<DataTypeRow> => {
  const byType: Map<
    string,
    { row: DataTypeRow; stores: Map<string, StoreHolding> }
  > = new Map();

  for (const finding of findings) {
    const dataTypeId: string = finding.dataTypeId || "";
    const storeId: string = finding.dataStoreId?.toString() || "";

    if (!dataTypeId || !storeId || finding.dataStore?.isArchived) {
      continue;
    }

    let entry:
      | { row: DataTypeRow; stores: Map<string, StoreHolding> }
      | undefined = byType.get(dataTypeId);

    if (!entry) {
      const info: DataTypeInfo | undefined = getDataTypeInfo(dataTypeId);

      entry = {
        row: {
          dataTypeId: dataTypeId,
          name: namer(dataTypeId, finding.dataTypeName),
          description: info?.description || "",
          category: info?.category || finding.dataCategory || "",
          sensitivity:
            info?.sensitivity ||
            (finding.sensitivity as DataSensitivity | undefined) ||
            DataSensitivity.Public,
          frameworks: [...(info?.frameworks || [])],
          stores: [],
          storeCount: 0,
          findings: 0,
          matches: 0,
        },
        stores: new Map<string, StoreHolding>(),
      };
      byType.set(dataTypeId, entry);
    }

    const matches: number = finding.matchCount || 0;
    const confidence: DataConfidence =
      (finding.confidence as DataConfidence | undefined) ||
      DataConfidence.Medium;

    entry.row.findings += 1;
    entry.row.matches += matches;

    const store: StoreHolding | undefined = entry.stores.get(storeId);

    if (store) {
      store.locations += 1;
      store.matches += matches;
      store.confidence = higherConfidence(store.confidence, confidence);
    } else {
      entry.stores.set(storeId, {
        dataStoreId: storeId,
        name: finding.dataStore?.name || storeId,
        kind: finding.dataStore?.kind || "",
        locations: 1,
        matches: matches,
        confidence: confidence,
      });
    }
  }

  return [...byType.values()]
    .map(
      (entry: {
        row: DataTypeRow;
        stores: Map<string, StoreHolding>;
      }): DataTypeRow => {
        const stores: Array<StoreHolding> = [...entry.stores.values()].sort(
          (a: StoreHolding, b: StoreHolding): number => {
            return b.matches - a.matches || a.name.localeCompare(b.name);
          },
        );

        return { ...entry.row, stores: stores, storeCount: stores.length };
      },
    )
    .sort((a: DataTypeRow, b: DataTypeRow): number => {
      return (
        DATA_SENSITIVITY_RANK[b.sensitivity] -
          DATA_SENSITIVITY_RANK[a.sensitivity] ||
        b.storeCount - a.storeCount ||
        b.findings - a.findings ||
        a.name.localeCompare(b.name)
      );
    });
};

const DataSecuritySensitiveDataPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const namer: DataTypeNamer = useDataTypeNamer();

  const [findings, setFindings] = useState<Array<DataStoreFinding> | null>(
    null,
  );
  const [totalFindings, setTotalFindings] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    setError("");

    ModelAPI.getList<DataStoreFinding>({
      modelType: DataStoreFinding,
      query: {
        ...(projectId ? { projectId: projectId } : {}),
        isSuppressed: false,
        confidence: new Includes([DataConfidence.High, DataConfidence.Medium]),
      },
      limit: FINDINGS_READ_LIMIT,
      skip: 0,
      select: {
        _id: true,
        dataTypeId: true,
        dataTypeName: true,
        dataCategory: true,
        sensitivity: true,
        confidence: true,
        matchCount: true,
        dataStoreId: true,
        dataStore: { name: true, kind: true, isArchived: true },
      },
      sort: { lastSeenAt: SortOrder.Descending },
    })
      .then((result: ListResult<DataStoreFinding>) => {
        if (!isCurrent) {
          return;
        }

        setFindings(result.data);
        setTotalFindings(result.count);
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

  const rows: Array<DataTypeRow> = findings
    ? aggregateFindings(findings, namer)
    : [];
  const selected: DataTypeRow | undefined = rows.find(
    (row: DataTypeRow): boolean => {
      return row.dataTypeId === selectedTypeId;
    },
  );

  const exportRecord: () => Promise<void> = async (): Promise<void> => {
    setIsExporting(true);
    setExportError("");

    try {
      const response: DataSecurityRecordOfProcessingResponse =
        await DataSecurityApi.getRecordOfProcessing();

      downloadRecordOfProcessing(response.rows || []);
    } catch (err) {
      setExportError(API.getFriendlyMessage(err));
    }

    setIsExporting(false);
  };

  const exportButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Export Record of Processing",
      icon: IconProp.Download,
      buttonStyle: ButtonStyleType.NORMAL,
      isLoading: isExporting,
      disabled: isExporting,
      onClick: () => {
        void exportRecord();
      },
    },
    new DataStore(),
    ModelAction.Read,
  );

  let body: ReactElement;

  if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setFindings(null);
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!findings) {
    body = <ComponentLoader />;
  } else if (rows.length === 0) {
    body = (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.Fingerprint}
        title="No sensitive data found yet"
        description="Data types show here once a scan finds them in a store."
        isCompact={true}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        <LocalTable<DataTypeRow>
          id="data-security-sensitive-data-types"
          data={rows}
          singularLabel="Data Type"
          pluralLabel="Data Types"
          columns={[
            {
              key: "name",
              title: "Data Type",
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-sm",
              getElement: (row: DataTypeRow): ReactElement => {
                return (
                  <div className="min-w-[10rem]">
                    {/*
                     * Its category beside its name, as a store's What's
                     * Inside tags it: a column of its own pushed the table
                     * past its card beside the side menu.
                     */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-gray-900">
                        {row.name}
                      </span>
                      {row.category ? (
                        <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                          {translator.translateText(row.category) ||
                            row.category}
                        </span>
                      ) : (
                        <></>
                      )}
                    </div>
                    {row.description ? (
                      <div className="text-xs text-gray-500">
                        {translator.translateText(row.description) ||
                          row.description}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              key: "sensitivity",
              title: "Sensitivity",
              type: FieldType.Element,
              disableSort: true,
              getElement: (row: DataTypeRow): ReactElement => {
                return <SensitivityPill sensitivity={row.sensitivity} />;
              },
            },
            {
              key: "storeCount",
              title: "Stores",
              type: FieldType.Element,
              disableSort: true,
              getElement: (row: DataTypeRow): ReactElement => {
                const isSelected: boolean = row.dataTypeId === selectedTypeId;

                return (
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-indigo-600 hover:bg-gray-50 hover:underline"
                    }`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedTypeId(isSelected ? "" : row.dataTypeId);
                    }}
                  >
                    <span className="tabular-nums">
                      {translator.translatePlural(
                        STORES_HOLDING,
                        row.storeCount,
                      )}
                    </span>
                    <Icon
                      icon={
                        isSelected
                          ? IconProp.ChevronDown
                          : IconProp.ChevronRight
                      }
                      className="h-3.5 w-3.5"
                    />
                  </button>
                );
              },
            },
            {
              key: "findings",
              title: "Findings",
              type: FieldType.Element,
              disableSort: true,
              hideOnMobile: true,
              headerTooltip: translationKey(
                "Locations it was found at: columns, fields, object paths or telemetry attributes.",
              ),
              getElement: (row: DataTypeRow): ReactElement => {
                return (
                  <span className="text-sm tabular-nums text-gray-700">
                    {translator.formatNumber(row.findings)}
                  </span>
                );
              },
            },
            {
              key: "frameworks",
              title: "Frameworks",
              type: FieldType.Element,
              disableSort: true,
              hideOnMobile: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-xs",
              getElement: (row: DataTypeRow): ReactElement => {
                if (row.frameworks.length === 0) {
                  return <span className="text-sm text-gray-400">-</span>;
                }

                return (
                  <div className="flex flex-wrap gap-1">
                    {row.frameworks.map(
                      (framework: ComplianceFramework): ReactElement => {
                        return (
                          <span
                            key={framework}
                            className="inline-flex items-center rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-700"
                          >
                            {framework}
                          </span>
                        );
                      },
                    )}
                  </div>
                );
              },
            },
          ]}
        />
        {totalFindings > findings.length ? (
          <p className="text-xs text-gray-500">
            {translator.translateTemplate(FINDINGS_CAPPED, {
              count: translator.formatNumber(findings.length),
            })}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <>
      <Card
        title="Sensitive Data"
        description="Every kind of sensitive data the scans found, and the stores holding it. Pick a type's stores to see where it lives."
      >
        {body}
      </Card>

      {selected ? (
        <Card
          title={translator.translateTemplate(STORES_HOLDING_TITLE, {
            type: selected.name,
          })}
          description="Each store where this data type was found, with how many locations hold it and how sure the scan is. Pick its stores again to close this."
        >
          <LocalTable<StoreHolding>
            id="data-security-sensitive-data-stores"
            data={selected.stores}
            singularLabel="Data Store"
            pluralLabel="Data Stores"
            columns={[
              {
                key: "name",
                title: "Data Store",
                type: FieldType.Element,
                disableSort: true,
                wrapContent: true,
                wrapMaxWidthClassName: "max-w-sm",
                getElement: (store: StoreHolding): ReactElement => {
                  return (
                    <AppLink
                      className="block min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                      to={getStoreViewRoute(store.dataStoreId)}
                    >
                      <IsolatedText text={store.name} />
                    </AppLink>
                  );
                },
              },
              {
                key: "kind",
                title: "Kind",
                type: FieldType.Element,
                disableSort: true,
                hideOnMobile: true,
                getElement: (store: StoreHolding): ReactElement => {
                  return (
                    <span className="text-sm text-gray-700">
                      {store.kind
                        ? translator.translateText(store.kind) || store.kind
                        : "-"}
                    </span>
                  );
                },
              },
              {
                key: "locations",
                title: "Locations",
                type: FieldType.Element,
                disableSort: true,
                getElement: (store: StoreHolding): ReactElement => {
                  return (
                    <span className="text-sm tabular-nums text-gray-700">
                      {translator.formatNumber(store.locations)}
                    </span>
                  );
                },
              },
              {
                key: "matches",
                title: "Matches",
                type: FieldType.Element,
                disableSort: true,
                hideOnMobile: true,
                getElement: (store: StoreHolding): ReactElement => {
                  return (
                    <span className="text-sm tabular-nums text-gray-700">
                      {translator.formatNumber(store.matches)}
                    </span>
                  );
                },
              },
              {
                key: "confidence",
                title: "Confidence",
                type: FieldType.Element,
                disableSort: true,
                getElement: (store: StoreHolding): ReactElement => {
                  return <ConfidencePill confidence={store.confidence} />;
                },
              },
            ]}
          />
        </Card>
      ) : (
        <></>
      )}

      <Card
        title="Record of Processing"
        description="GDPR Article 30 asks for a record of the personal data you process. Export one built from the scans: each store, its data, owners, purpose and retention."
        buttons={getTableHeaderButtons(exportButton ? [exportButton] : [])}
      >
        {exportError ? (
          <Alert
            type={AlertType.DANGER}
            title={exportError}
            onClose={() => {
              setExportError("");
            }}
          />
        ) : undefined}
      </Card>
    </>
  );
};

export default DataSecuritySensitiveDataPage;
