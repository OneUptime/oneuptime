import PageComponentProps from "../PageComponentProps";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import AppLink from "../../Components/AppLink/AppLink";
import {
  ConfidencePill,
  SensitivityPill,
} from "../../Components/DataSecurity/DataSecurityPills";
import FindingRecordsPanel from "../../Components/DataSecurity/FindingRecordsPanel";
import {
  FindingDecisions,
  useFindingDecisions,
} from "../../Components/DataSecurity/FindingDecisions";
import {
  FINDING_ROW_NOTE_SELECT,
  getFindingRowNote,
} from "../../Components/DataSecurity/FindingRowNote";
import {
  DataTypeNamer,
  useDataTypeNamer,
} from "../../Components/DataSecurity/IssueDataTypes";
import { getStoreViewRoute } from "../../Components/DataSecurity/IssueListRoute";
import IssueMoment from "../../Components/DataSecurity/IssueMoment";
import {
  getTelemetryStoreOwnerName,
  TelemetryStoreOfFindings,
} from "../../Components/DataSecurity/IssueTelemetryFindings";
import DropMetricModal from "../../Components/DataSecurity/DropMetricModal";
import ScrubItModal from "../../Components/DataSecurity/ScrubItModal";
import {
  DROP_METRIC,
  DROP_NOTICE,
  DROPPED,
  DROPPED_TOOLTIP,
  DropMetricState,
  getDropMetricState,
  getRulesRoute,
  getScrubItGates,
  getScrubItState,
  isScrubItOfferedAtAll,
  SCRUB_IT,
  SCRUB_NOTICES,
  SCRUB_UNAVAILABLE_SENTENCES,
  ScrubItGates,
  ScrubItState,
} from "../../Components/DataSecurity/TelemetryScrubIt";
import TelemetryRuleNotice from "../../Components/DataSecurity/TelemetryRuleNotice";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  DataSecurityDropMetricResult,
  DataSecurityScrubResult,
  DataSecurityScrubSignal,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { isMetricNameFinding } from "Common/Types/DataSecurity/TelemetryScrubTarget";
import DataConfidence, {
  ALL_DATA_CONFIDENCES,
} from "Common/Types/DataSecurity/DataConfidence";
import {
  DataStoreKindInfo,
  TELEMETRY_DATA_STORE_KINDS,
  getDataStoreKindInfo,
} from "Common/Types/DataSecurity/DataStoreKind";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { isFindingAwaitingJudgement } from "Common/Utils/DataSecurity/FindingJudgement";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
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
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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
 * which rule it made; where no rule reaches the place, it says why. On a
 * metric's name, which no rule scrubs, Drop This Metric makes a metric
 * pipeline rule that drops the service's metrics so named instead (#9757),
 * once a dialog has said what that loses and the reader has agreed.
 *
 * OneUptime AI's verdict on a finding that waits for a person reads across
 * its row - Confirm it, Not sensitive or Cannot tell, why, and the team's
 * decisions it rests on (FindingRowNote, #10372) - and such a finding can
 * be confirmed or marked not sensitive here, then the decision applied to
 * the findings like it on every service (FindingDecisions).
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
  // A Drop rule Drop This Metric made, rather than Scrub It's rule.
  isDrop?: boolean | undefined;
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
  // The finding Scrub It's dialog is open on (ScrubItModal, #10433).
  const [scrubbing, setScrubbing] = useState<DataStoreFinding | null>(null);
  // The finding in a metric's name whose metrics the reader is asked about dropping.
  const [dropping, setDropping] = useState<DataStoreFinding | null>(null);

  // Not Sensitive and Confirm on a finding that waits, then Apply to similar (#10372).
  const decisions: FindingDecisions = useFindingDecisions((): void => {
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  });
  const editGate: PermissionGateResult = PermissionGate.check(
    new DataStoreFinding(),
    ModelAction.Update,
  );

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

  const dropMetricOf: (finding: DataStoreFinding) => DropMetricState = (
    finding: DataStoreFinding,
  ): DropMetricState => {
    return getDropMetricState({
      kind: storeOf(finding)?.kind || finding.dataStore?.kind,
      location: finding.location,
      gates: scrubGates,
    });
  };

  // A scrubbed finding in a metric's name is one a Drop rule keeps out.
  const isDroppedFinding: (finding: DataStoreFinding) => boolean = (
    finding: DataStoreFinding,
  ): boolean => {
    return isMetricNameFinding(
      storeOf(finding)?.kind || finding.dataStore?.kind,
      finding.location,
    );
  };

  /*
   * Scrub It on a finding: a dialog says what the rule does, whose records
   * it changes and what reads the data first (#10433), then makes it; the
   * page says so and reads the list again.
   */
  const onScrubbed: (result: DataSecurityScrubResult) => void = (
    result: DataSecurityScrubResult,
  ): void => {
    setNotice({
      ruleName: result.scrubRuleName,
      signal: result.signal,
    });
    setScrubbing(null);
    setOpenFinding(null);
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
      onClick: (
        finding: DataStoreFinding,
        onCompleteAction: VoidFunction,
      ): void => {
        setScrubbing(finding);
        onCompleteAction();
      },
    });
  }

  /*
   * A metric's name, which Scrub It cannot reach: its metrics can be
   * dropped instead (#9757) - in a dialog that says what that loses first.
   */
  if (scrubGates.metric.isAllowed || scrubGates.metric.disabledReason) {
    actionButtons.push({
      title: DROP_METRIC,
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.HOVER_DANGER_OUTLINE,
      isVisible: (finding: DataStoreFinding): boolean => {
        return !finding.isScrubbed && dropMetricOf(finding).isShown;
      },
      getDisabledReason: (finding: DataStoreFinding): string | undefined => {
        const drop: DropMetricState = dropMetricOf(finding);

        return drop.isAllowed ? undefined : drop.disabledReason;
      },
      onClick: (
        finding: DataStoreFinding,
        onCompleteAction: VoidFunction,
      ): void => {
        setDropping(finding);
        onCompleteAction();
      },
    });
  }

  /*
   * A finding that waits for a person - the scan was not sure of it, or it
   * shows a sign of a wrong match - is confirmed or marked not sensitive
   * here, as on its store's What's Inside.
   */
  actionButtons.push(
    {
      title: "Confirm",
      icon: IconProp.Check,
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (finding: DataStoreFinding): boolean => {
        return (
          isFindingAwaitingJudgement(finding) &&
          finding.confidence === DataConfidence.Low
        );
      },
      getDisabledReason: (): string | undefined => {
        return editGate.isAllowed ? undefined : editGate.disabledReason;
      },
      getConfirmation: () => {
        return {
          title: "Confirm This Finding",
          description:
            "You confirm this location holds this kind of data. It then counts toward this store's sensitivity and its checks as High confidence.",
          submitButtonText: "Confirm",
        };
      },
      onClick: async (
        finding: DataStoreFinding,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): Promise<void> => {
        try {
          await ModelAPI.updateById<DataStoreFinding>({
            modelType: DataStoreFinding,
            id: new ObjectID(finding._id!.toString()),
            data: { isConfirmed: true },
          });
          onCompleteAction();
          setRefreshCount((count: number): number => {
            return count + 1;
          });
          decisions.afterConfirm(finding);
        } catch (err) {
          onCompleteAction();
          onError(err as Error);
        }
      },
    },
    {
      title: "Not Sensitive",
      icon: IconProp.Close,
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (finding: DataStoreFinding): boolean => {
        return isFindingAwaitingJudgement(finding);
      },
      getDisabledReason: (): string | undefined => {
        return editGate.isAllowed ? undefined : editGate.disabledReason;
      },
      onClick: (
        finding: DataStoreFinding,
        onCompleteAction: VoidFunction,
      ): void => {
        decisions.markNotSensitive(finding);
        onCompleteAction();
      },
    },
  );

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
        <TelemetryRuleNotice
          template={
            notice.isDrop
              ? DROP_NOTICE
              : SCRUB_NOTICES[notice.signal] || SCRUB_NOTICES.log
          }
          ruleName={notice.ruleName}
          rulesRoute={getRulesRoute(notice.signal)}
          dataTestId={
            notice.isDrop
              ? "data-security-drop-notice"
              : "data-security-scrub-notice"
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
          isScrubbing={false}
          onScrub={() => {
            setScrubbing(openFinding);
          }}
          dropMetric={dropMetricOf(openFinding)}
          onDropMetric={() => {
            setDropping(openFinding);
          }}
          onClose={() => {
            setOpenFinding(null);
          }}
        />
      ) : (
        <></>
      )}

      {scrubbing?._id ? (
        <ScrubItModal
          findingId={new ObjectID(scrubbing._id.toString())}
          onClose={() => {
            setScrubbing(null);
          }}
          onScrubbed={onScrubbed}
        />
      ) : (
        <></>
      )}

      {decisions.dialogs}

      {dropping?._id ? (
        <DropMetricModal
          findingId={new ObjectID(dropping._id.toString())}
          dataTypeName={namer(dropping.dataTypeId || "", dropping.dataTypeName)}
          serviceName={getTelemetryStoreOwnerName(storeOf(dropping))}
          onClose={() => {
            setDropping(null);
          }}
          onDropped={(result: DataSecurityDropMetricResult) => {
            setNotice({
              ruleName: result.ruleName,
              signal: "metric",
              isDrop: true,
            });
            setDropping(null);
            setOpenFinding(null);
            setRefreshCount((count: number): number => {
              return count + 1;
            });
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
          // What OneUptime AI says of it, across its row (#10372).
          ...FINDING_ROW_NOTE_SELECT,
          dataStoreId: true,
          dataTypeName: true,
          isScrubbed: true,
          sensitivity: true,
          // What a finding's records panel says of it.
          valueCount: true,
          lastSeenAt: true,
          ...(canReadSamples ? { maskedSamples: true } : {}),
        }}
        getRowNote={getFindingRowNote}
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
            /*
             * Under the data type, where the list does not fit its card
             * (TableFit): in German at 1280px, beside the side menu, each
             * row's Show Records and its ⋯ pushed the list past its card.
             */
            hideBelowLargeScreen: true,
            foldInto: "dataTypeId",
            getExportValue: (finding: DataStoreFinding): string => {
              if (!finding.isScrubbed) {
                return NOT_SCRUBBED;
              }

              return isDroppedFinding(finding) ? DROPPED : SCRUBBED;
            },
            getElement: (finding: DataStoreFinding): ReactElement => {
              if (!finding.isScrubbed) {
                return <Pill text={NOT_SCRUBBED} color={Gray500} />;
              }

              // A metric's name is not scrubbed: a Drop rule keeps its metrics out.
              return isDroppedFinding(finding) ? (
                <Pill
                  text={DROPPED}
                  color={Green500}
                  tooltip={DROPPED_TOOLTIP}
                />
              ) : (
                <Pill text={SCRUBBED} color={Green500} />
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
