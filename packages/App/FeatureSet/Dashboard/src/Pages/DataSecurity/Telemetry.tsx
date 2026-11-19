import PageComponentProps from "../PageComponentProps";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import AppLink from "../../Components/AppLink/AppLink";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import {
  ConfidencePill,
  SensitivityPill,
} from "../../Components/DataSecurity/DataSecurityPills";
import FindingRecordsPanel from "../../Components/DataSecurity/FindingRecordsPanel";
import {
  DataTypeNamer,
  useDataTypeNamer,
} from "../../Components/DataSecurity/IssueDataTypes";
import { getStoreViewRoute } from "../../Components/DataSecurity/IssueListRoute";
import IssueMoment from "../../Components/DataSecurity/IssueMoment";
import { TelemetryStoreOfFindings } from "../../Components/DataSecurity/IssueTelemetryFindings";
import {
  getRulesRoute,
  getScrubItGates,
  getScrubItState,
  isScrubItOfferedAtAll,
  SCRUB_IT,
  SCRUB_NOTICES,
  SCRUB_UNAVAILABLE_SENTENCES,
  ScrubItGates,
  ScrubItState,
  VIEW_RULES,
} from "../../Components/DataSecurity/TelemetryScrubIt";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  DataSecurityScrubResult,
  DataSecurityScrubSignal,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataConfidence, {
  ALL_DATA_CONFIDENCES,
} from "Common/Types/DataSecurity/DataConfidence";
import {
  DataStoreKindInfo,
  TELEMETRY_DATA_STORE_KINDS,
  getDataStoreKindInfo,
} from "Common/Types/DataSecurity/DataStoreKind";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
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
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * IS SENSITIVE DATA LEAKING INTO YOUR TELEMETRY?
 *
 * What Data Security found in the logs, traces, metrics, exceptions,
 * session replays and AI conversations each service sends OneUptime: the
 * service, the signal, where in it (an attribute, a body, a metric's
 * name), the data type, how sure the scan is and how many values matched -
 * and whether a rule already masks it at ingest. The page opens on what is
 * not masked yet.
 *
 * Show Records, in each row, opens the records the finding was seen in
 * beside the list (FindingRecordsPanel, issue #9605) - the log lines,
 * spans and metric data points themselves, the data marked and masked -
 * for a reader who may read the masked samples, as an issue's Where It Was
 * Found shows them. Scrub It, in the row and in the panel, makes the rule
 * that masks that data type at that place from now on - a log or trace
 * scrub rule, or a metric pipeline rule that redacts a metric's attribute
 * - for anyone who may create that rule, the rule being theirs, and says
 * which rule it made; where no rule reaches the place, it says why.
 */

const SHOW_RECORDS: string = translationKey("Show Records");

const SCRUBBED: string = translationKey("Scrubbed");

// How many values matched, under where they were found.
const MATCHES: PluralTemplate = {
  one: "{{count}} match",
  other: "{{count}} matches",
};
const NOT_SCRUBBED: string = translationKey("Not scrubbed");

const PAGE_TITLE: string = translationKey("In Your Telemetry");
const PAGE_DESCRIPTION: string = translationKey(
  "Sensitive data found in the logs, traces, metrics, exceptions, replays and AI conversations your services send. Scrub It masks it at ingest.",
);

type ScrubView = "notScrubbed" | "all";

/*
 * One telemetry store: a service's logs, traces, metrics, exceptions,
 * replays or AI conversations - with what its records panel reads of it.
 */
interface TelemetryStore extends TelemetryStoreOfFindings {
  name: string;
  kind: string;
  serviceName: string;
}

interface ScrubNotice {
  ruleName: string;
  signal: DataSecurityScrubSignal;
}

const DataSecurityTelemetryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const namer: DataTypeNamer = useDataTypeNamer();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [stores, setStores] = useState<Map<string, TelemetryStore> | null>(
    null,
  );
  const [storesError, setStoresError] = useState<string>("");
  const [storesReadCount, setStoresReadCount] = useState<number>(0);
  const [scrubView, setScrubView] = useState<ScrubView>("notScrubbed");
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [notice, setNotice] = useState<ScrubNotice | null>(null);
  // The finding whose records are open beside the list.
  const [openFinding, setOpenFinding] = useState<DataStoreFinding | null>(null);
  const [isPanelScrubbing, setIsPanelScrubbing] = useState<boolean>(false);
  const [panelScrubError, setPanelScrubError] = useState<string>("");

  // The project's telemetry stores, which the findings below are in.
  useEffect(() => {
    let isCurrent: boolean = true;

    setStoresError("");

    ModelAPI.getList<DataStore>({
      modelType: DataStore,
      query: {
        ...(projectId ? { projectId: projectId } : {}),
        kind: new Includes([...TELEMETRY_DATA_STORE_KINDS]),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        kind: true,
        serviceId: true,
        storeKey: true,
        service: { name: true },
      },
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<DataStore>) => {
        if (!isCurrent) {
          return;
        }

        const map: Map<string, TelemetryStore> = new Map();

        for (const store of result.data) {
          const id: string = store._id?.toString() || "";

          if (id) {
            map.set(id, {
              name: store.name || "",
              kind: store.kind || "",
              serviceName: store.service?.name?.toString() || "",
              serviceId: store.serviceId,
              storeKey: store.storeKey,
            });
          }
        }

        setStores(map);
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setStoresError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [storesReadCount]);

  /*
   * The records and the masked samples are evidence about real records:
   * only a reader who may read the samples opens them (DataStoreFinding's
   * restricted columns), as on an issue's Where It Was Found.
   */
  const canReadSamples: boolean = PermissionGate.canReadColumn(
    new DataStoreFinding(),
    "maskedSamples",
  );
  // Who may make each kind of rule Scrub It makes.
  const scrubGates: ScrubItGates = getScrubItGates();

  const storeOf: (finding: DataStoreFinding) => TelemetryStore | undefined = (
    finding: DataStoreFinding,
  ): TelemetryStore | undefined => {
    return stores?.get(finding.dataStoreId?.toString() || "");
  };

  const scrubItOf: (finding: DataStoreFinding) => ScrubItState = (
    finding: DataStoreFinding,
  ): ScrubItState => {
    return getScrubItState({
      kind: storeOf(finding)?.kind || finding.dataStore?.kind,
      location: finding.location,
      gates: scrubGates,
    });
  };

  // Scrub It on a finding: the rule made, said on the page, the list read again.
  const scrubFinding: (finding: DataStoreFinding) => Promise<void> = async (
    finding: DataStoreFinding,
  ): Promise<void> => {
    const id: string = finding._id?.toString() || "";

    if (!id) {
      return;
    }

    const result: DataSecurityScrubResult = await DataSecurityApi.scrubFinding(
      new ObjectID(id),
    );

    setNotice({
      ruleName: result.scrubRuleName,
      signal: result.signal,
    });
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  const actionButtons: Array<ActionButtonSchema<DataStoreFinding>> = [];

  if (canReadSamples) {
    actionButtons.push({
      title: SHOW_RECORDS,
      icon: IconProp.List,
      buttonStyleType: ButtonStyleType.NORMAL,
      // What the row is opened for: the records, then whether to scrub.
      placement: ActionButtonPlacement.Primary,
      isVisible: (finding: DataStoreFinding): boolean => {
        return Boolean(finding._id);
      },
      onClick: (
        finding: DataStoreFinding,
        onCompleteAction: VoidFunction,
      ): void => {
        setPanelScrubError("");
        setOpenFinding(finding);
        onCompleteAction();
      },
    });
  }

  if (isScrubItOfferedAtAll(scrubGates)) {
    actionButtons.push({
      title: SCRUB_IT,
      icon: IconProp.EyeSlash,
      buttonStyleType: ButtonStyleType.OUTLINE,
      isVisible: (finding: DataStoreFinding): boolean => {
        const scrubIt: ScrubItState = scrubItOf(finding);

        return (
          !finding.isScrubbed &&
          (scrubIt.isShown || Boolean(scrubIt.unavailableReason))
        );
      },
      /*
       * Locked on the rows it cannot scrub, saying why: no rule reaches
       * the place, or the reader may not make the rule it takes.
       */
      getDisabledReason: (finding: DataStoreFinding): string | undefined => {
        const scrubIt: ScrubItState = scrubItOf(finding);

        if (scrubIt.unavailableReason) {
          const sentence: string =
            SCRUB_UNAVAILABLE_SENTENCES[scrubIt.unavailableReason];

          return translator.translateText(sentence) || sentence;
        }

        return scrubIt.isAllowed ? undefined : scrubIt.disabledReason;
      },
      onClick: async (
        finding: DataStoreFinding,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): Promise<void> => {
        try {
          await scrubFinding(finding);
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    });
  }

  const storeIds: Array<string> = stores ? [...stores.keys()] : [];

  const query: Query<DataStoreFinding> = {
    ...(projectId ? { projectId: projectId } : {}),
    dataStoreId: new Includes(storeIds),
    ...(scrubView === "notScrubbed" ? { isScrubbed: false } : {}),
  };

  const filterBar: ReactElement = (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <FilterButtons
        ariaLabel="Scrubbed"
        selectedValue={scrubView}
        onSelect={(value: string) => {
          setScrubView(value === "all" ? "all" : "notScrubbed");
        }}
        options={[
          { label: "Not scrubbed only", value: "notScrubbed" },
          { label: "All findings", value: "all" },
        ]}
      />
    </div>
  );

  if (storesError) {
    return (
      <Card title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <ErrorMessage
          message={storesError}
          onRefreshClick={() => {
            setStores(null);
            setStoresReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      </Card>
    );
  }

  if (!stores) {
    return (
      <Card title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <TableSkeleton />
      </Card>
    );
  }

  if (stores.size === 0) {
    return (
      <Card title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Logs}
          title="No telemetry scanned yet"
          description="Data Security scans the telemetry your services send OneUptime once they send some."
          isCompact={true}
        />
      </Card>
    );
  }

  return (
    <>
      {notice ? (
        <Alert
          type={AlertType.SUCCESS}
          dataTestId="data-security-scrub-notice"
          title={
            <span>
              {translator.translateTemplate(
                SCRUB_NOTICES[notice.signal] || SCRUB_NOTICES.log,
                { name: notice.ruleName },
              )}{" "}
              <AppLink
                className="font-medium underline"
                to={getRulesRoute(notice.signal)}
              >
                {translator.translateText(
                  VIEW_RULES[notice.signal] || VIEW_RULES.log,
                ) || VIEW_RULES[notice.signal]}
              </AppLink>
            </span>
          }
          onClose={() => {
            setNotice(null);
          }}
        />
      ) : (
        <></>
      )}

      {openFinding ? (
        <FindingRecordsPanel
          finding={openFinding}
          store={storeOf(openFinding)}
          scrubIt={scrubItOf(openFinding)}
          isScrubbing={isPanelScrubbing}
          scrubError={panelScrubError || undefined}
          onScrub={() => {
            setIsPanelScrubbing(true);
            setPanelScrubError("");
            scrubFinding(openFinding)
              .then(() => {
                setOpenFinding(null);
              })
              .catch((err: unknown) => {
                setPanelScrubError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsPanelScrubbing(false);
              });
          }}
          onClose={() => {
            setOpenFinding(null);
            setPanelScrubError("");
          }}
        />
      ) : (
        <></>
      )}

      <ModelTable<DataStoreFinding>
        modelType={DataStoreFinding}
        id="data-security-telemetry-findings"
        name="Data Security > In Your Telemetry"
        userPreferencesKey="data-security-telemetry-findings"
        query={query}
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="matchCount"
        sortOrder={SortOrder.Descending}
        actionButtons={actionButtons}
        topContent={filterBar}
        cardProps={{
          title: PAGE_TITLE,
          description: PAGE_DESCRIPTION,
        }}
        noItemsMessage={
          scrubView === "notScrubbed"
            ? "Nothing unmasked. Every finding in your telemetry is scrubbed at ingest."
            : "No sensitive data in your telemetry."
        }
        emptyState={{ isAllClear: true }}
        showRefreshButton={true}
        searchableFields={["location"]}
        selectMoreFields={{
          dataStoreId: true,
          dataTypeName: true,
          isScrubbed: true,
          locationKind: true,
          sensitivity: true,
          // What a finding's records panel says of it.
          valueCount: true,
          matchCount: true,
          lastSeenAt: true,
          ...(canReadSamples ? { maskedSamples: true } : {}),
        }}
        filters={[
          {
            field: { confidence: true },
            title: "Confidence",
            type: FieldType.Dropdown,
            filterDropdownOptions: ALL_DATA_CONFIDENCES.map(
              (confidence: DataConfidence): DropdownOption => {
                return { value: confidence, label: confidence };
              },
            ),
          },
        ]}
        columns={[
          {
            field: { dataStoreId: true },
            title: "Service",
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getExportValue: (finding: DataStoreFinding): string => {
              const store: TelemetryStore | undefined = stores.get(
                finding.dataStoreId?.toString() || "",
              );

              return store?.serviceName || store?.name || "";
            },
            getElement: (finding: DataStoreFinding): ReactElement => {
              const storeId: string = finding.dataStoreId?.toString() || "";
              const store: TelemetryStore | undefined = stores.get(storeId);
              const kind: string = store?.kind || finding.dataStore?.kind || "";
              const info: DataStoreKindInfo | undefined =
                getDataStoreKindInfo(kind);

              if (!storeId) {
                return <TableEmptyValue />;
              }

              /*
               * The signal it was found in, under the service: a column of
               * its own pushed the table past its card beside the side menu.
               */
              return (
                <div className="min-w-0">
                  <AppLink
                    className="block min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                    to={getStoreViewRoute(storeId)}
                  >
                    <IsolatedText
                      text={store?.serviceName || store?.name || storeId}
                    />
                  </AppLink>
                  {kind && store?.serviceName ? (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                      <Icon
                        icon={info?.icon || IconProp.Logs}
                        className="h-3.5 w-3.5 text-gray-400"
                      />
                      <span>{translator.translateText(kind) || kind}</span>
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { dataStore: { kind: true } },
            title: "Signal",
            type: FieldType.Element,
            disableSort: true,
            isHiddenByDefault: true,
            getExportValue: (finding: DataStoreFinding): string => {
              return (
                stores.get(finding.dataStoreId?.toString() || "")?.kind || ""
              );
            },
            getElement: (finding: DataStoreFinding): ReactElement => {
              const kind: string =
                stores.get(finding.dataStoreId?.toString() || "")?.kind ||
                finding.dataStore?.kind ||
                "";
              const info: DataStoreKindInfo | undefined =
                getDataStoreKindInfo(kind);

              if (!kind) {
                return <TableEmptyValue />;
              }

              return (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700">
                  <Icon
                    icon={info?.icon || IconProp.Logs}
                    className="h-4 w-4 text-gray-400"
                  />
                  <span>{translator.translateText(kind) || kind}</span>
                </span>
              );
            },
          },
          {
            field: { location: true },
            title: "Location",
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-sm",
            getElement: (finding: DataStoreFinding): ReactElement => {
              return (
                <div className="min-w-0">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere] [box-decoration-break:clone]">
                    {finding.location || ""}
                  </code>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {finding.locationKind ? (
                      <span>
                        {translator.translateText(finding.locationKind) ||
                          finding.locationKind}
                      </span>
                    ) : (
                      <></>
                    )}
                    {finding.locationKind ? (
                      <span aria-hidden="true">
                        <InlineSeparator />
                      </span>
                    ) : (
                      <></>
                    )}
                    <span>
                      {translator.translatePlural(
                        MATCHES,
                        finding.matchCount || 0,
                      )}
                    </span>
                  </div>
                </div>
              );
            },
          },
          {
            field: { dataTypeId: true },
            title: "Data Type",
            type: FieldType.Element,
            disableSort: true,
            getExportValue: (finding: DataStoreFinding): string => {
              return namer(finding.dataTypeId || "", finding.dataTypeName);
            },
            getElement: (finding: DataStoreFinding): ReactElement => {
              return (
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <span className="text-sm text-gray-900">
                    {namer(finding.dataTypeId || "", finding.dataTypeName)}
                  </span>
                  {finding.sensitivity ? (
                    <SensitivityPill sensitivity={finding.sensitivity} />
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { confidence: true },
            title: "Confidence",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (finding: DataStoreFinding): ReactElement => {
              return <ConfidencePill confidence={finding.confidence} />;
            },
          },
          {
            field: { matchCount: true },
            title: "Matches",
            type: FieldType.Element,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (finding: DataStoreFinding): ReactElement => {
              return (
                <span className="text-sm tabular-nums text-gray-700">
                  {translator.formatNumber(finding.matchCount || 0)}
                </span>
              );
            },
          },
          {
            field: { isScrubbed: true },
            title: "Scrubbed",
            type: FieldType.Element,
            disableSort: true,
            getExportValue: (finding: DataStoreFinding): string => {
              return finding.isScrubbed ? SCRUBBED : NOT_SCRUBBED;
            },
            getElement: (finding: DataStoreFinding): ReactElement => {
              return finding.isScrubbed ? (
                <Pill text={SCRUBBED} color={Green500} />
              ) : (
                <Pill text={NOT_SCRUBBED} color={Gray500} />
              );
            },
          },
          {
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.Element,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (finding: DataStoreFinding): ReactElement => {
              return <IssueMoment value={finding.lastSeenAt} />;
            },
          },
        ]}
      />
    </>
  );
};

export default DataSecurityTelemetryPage;
