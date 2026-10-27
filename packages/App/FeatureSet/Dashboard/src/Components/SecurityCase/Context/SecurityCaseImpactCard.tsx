import AppLink from "../../AppLink/AppLink";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { formatTrafficBytes } from "../../NetworkTraffic/NetworkTrafficFormat";
import {
  CONNECTION_KIND_ICONS,
  CONNECTION_KIND_LABELS,
  CONNECTED_POSSIBLE_PILL,
  CONNECTED_POSSIBLE_TOOLTIP,
} from "../../SecurityConnections/SecurityConnectionsCopy";
import { getMonitorRoute } from "../../SecurityConnections/SecurityConnectionsModel";
import {
  IMPACT_AT_RISK_HEADING,
  IMPACT_CALLED_BY,
  IMPACT_CALLS,
  IMPACT_CHANGE_AFTER,
  IMPACT_CHANGE_BEFORE,
  IMPACT_DESCRIPTION,
  IMPACT_DOWNSTREAM,
  IMPACT_EMPTY_DESCRIPTION,
  IMPACT_EMPTY_TITLE,
  IMPACT_EVIDENCE,
  IMPACT_EXPOSURE_HEADING,
  IMPACT_FAILED,
  IMPACT_FLOW_RECEIVED,
  IMPACT_FLOW_SENT,
  IMPACT_HIDE_DETAILS,
  IMPACT_INTERNET,
  IMPACT_INTERNET_UNKNOWN,
  IMPACT_INTERNET_UNKNOWN_DETAIL,
  IMPACT_INTERNET_YES,
  IMPACT_LAST_CHANGE,
  IMPACT_MONITORS,
  IMPACT_MORE,
  IMPACT_MORE_RECORDS,
  IMPACT_NOTHING,
  IMPACT_NOT_ON_MAP,
  IMPACT_NO_CHANGE,
  IMPACT_NO_OWNERS,
  IMPACT_OWNERS,
  IMPACT_RECORDS,
  IMPACT_RUNS_ON,
  IMPACT_SHOWN_ON,
  IMPACT_SHOW_DETAILS,
  IMPACT_SOURCE_NAMES,
  IMPACT_STATUS_PAGES,
  IMPACT_TALKED_TO_HEADING,
  IMPACT_TITLE,
  IMPACT_UNREADABLE,
  IMPACT_UPSTREAM,
  IMPACT_VERSION,
  IMPACT_WATCHED_BY,
  SECURITY_CASE_CONTEXT_TEST_IDS,
  STORY_OUTCOME_LABELS,
} from "./SecurityCaseContextCopy";
import SecurityCaseContextApi from "./SecurityCaseContextApi";
import {
  getImpactLeadingChange,
  getImpactOwners,
  getImpactRecordRoute,
  getRecordStatusPages,
  getStatusPageRoute,
  getTopFlowPeers,
} from "./SecurityCaseContextModel";
import Route from "Common/Types/API/Route";
import { Gray500, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_IMPACT_MAX_FLOW_PEERS,
  SecurityCaseExposureEvidenceJson,
  SecurityCaseExposureEvidenceKind,
  SecurityCaseFlowPeerJson,
  SecurityCaseImpactJson,
  SecurityCaseImpactPeerJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseImpactSource,
  SecurityCaseImpactStatusPageJson,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectionCertainty,
  SecurityConnectionRecordJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import { isSecurityEventRequestOutcome } from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  SecurityCaseImpactSummary,
  getImpactRecordsInOrder,
  summarizeImpact,
} from "Common/Utils/SecurityCase/SecurityCaseImpactFacts";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import API from "Common/UI/Utils/API/API";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

/*
 * A SECURITY CASE'S IMPACT, on its Overview: what the case puts at risk, as
 * the rest of OneUptime knows it (Server/Utils/SecurityCase/Context/
 * SecurityCaseImpact.ts reads it).
 *
 * Most important first: one line of figures - reachable from the internet
 * or not known to be, how many records the case names, what they call and
 * what calls them, the monitors and status pages watching them. Then the
 * exposure an analyst acts on: why OneUptime says the records are reachable
 * (only on evidence: "not known" otherwise), who owns them, and what last
 * changed on them before the attack. What is at risk record by record - its
 * calls, callers, hosts, monitors and status pages - and the machines its
 * addresses talked to are folded under a button, for when they are wanted.
 */

export interface ComponentProps {
  caseId: ObjectID;
  refreshToken?: string | number | undefined;
}

// How many peers a record's row names before "+N more".
const PEERS_SHOWN: number = 3;

const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

const FACT_ROW_CLASS_NAME: string =
  "grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-[8rem_minmax(0,1fr)]";

function sourceNames(
  translator: Translator,
  sources: Array<SecurityCaseImpactSource>,
): string {
  return formatNameList(
    sources.map((source: SecurityCaseImpactSource): string => {
      return (
        translator.translateText(IMPACT_SOURCE_NAMES[source]) ||
        IMPACT_SOURCE_NAMES[source]
      );
    }),
    "and",
    translator,
  );
}

const FactRow: FunctionComponent<{ label: string; children: ReactNode }> = (props: {
  label: string;
  children: ReactNode;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className={FACT_ROW_CLASS_NAME}>
      <dt className="text-sm font-medium text-gray-700">
        {translator.translateText(props.label) || props.label}
      </dt>
      <dd className="min-w-0 text-sm text-gray-600">{props.children}</dd>
    </div>
  );
};

// A summary figure: a short phrase in a quiet chip.
const Figure: FunctionComponent<{ text: string; icon: IconProp }> = (props: {
  text: string;
  icon: IconProp;
}): ReactElement => {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
      <Icon icon={props.icon} className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      <span>{props.text}</span>
    </li>
  );
};

// A record's peers on the service map: a few names, then "+N more".
const PeerList: FunctionComponent<{
  peers: Array<SecurityCaseImpactPeerJson> | null;
}> = (props: {
  peers: Array<SecurityCaseImpactPeerJson> | null;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.peers) {
    return (
      <span className="text-gray-500">
        {translator.translateText(IMPACT_NOT_ON_MAP)}
      </span>
    );
  }

  if (props.peers.length === 0) {
    return (
      <span className="text-gray-500">
        {translator.translateText(IMPACT_NOTHING)}
      </span>
    );
  }

  const shown: Array<SecurityCaseImpactPeerJson> = props.peers.slice(
    0,
    PEERS_SHOWN,
  );
  const more: number = props.peers.length - shown.length;

  return (
    <span className="[overflow-wrap:anywhere]">
      {shown.map(
        (peer: SecurityCaseImpactPeerJson, index: number): ReactElement => {
          return (
            <React.Fragment key={peer.key}>
              {index > 0 ? ", " : ""}
              <bdi className="text-gray-900">{peer.name}</bdi>
            </React.Fragment>
          );
        },
      )}
      {more > 0 ? (
        <span className="text-gray-500">
          {" "}
          {translator.translatePlural(IMPACT_MORE, more)}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

const ImpactRecord: FunctionComponent<{
  record: SecurityCaseImpactRecordJson;
  statusPages: Array<SecurityCaseImpactStatusPageJson> | null;
}> = (props: {
  record: SecurityCaseImpactRecordJson;
  statusPages: Array<SecurityCaseImpactStatusPageJson> | null;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const record: SecurityCaseImpactRecordJson = props.record;
  const route: Route | null = getImpactRecordRoute(record);
  const pages: Array<SecurityCaseImpactStatusPageJson> = getRecordStatusPages(
    record,
    props.statusPages,
  );
  const name: ReactElement = <bdi>{record.name}</bdi>;

  return (
    <li
      className="py-3 first:pt-0 last:pb-0"
      data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactRecord}
      data-kind={record.kind}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200">
          <Icon
            icon={CONNECTION_KIND_ICONS[record.kind]}
            className="h-4 w-4 text-gray-600"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {route ? (
              <AppLink
                to={route}
                className="text-sm font-semibold text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]"
              >
                {name}
              </AppLink>
            ) : (
              <span className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">
                {name}
              </span>
            )}
            <span className="text-xs font-medium text-gray-500">
              {translator.translateText(CONNECTION_KIND_LABELS[record.kind])}
            </span>
            {record.certainty === SecurityConnectionCertainty.Possible ? (
              <Pill
                text={CONNECTED_POSSIBLE_PILL}
                color={Yellow}
                size={PillSize.Small}
                tooltip={CONNECTED_POSSIBLE_TOOLTIP}
              />
            ) : (
              <></>
            )}
          </div>
          <dl className="mt-2 space-y-1">
            <FactRow label={IMPACT_CALLS}>
              <PeerList peers={record.calls} />
            </FactRow>
            {record.calledBy && record.calledBy.length > 0 ? (
              <FactRow label={IMPACT_CALLED_BY}>
                <PeerList peers={record.calledBy} />
              </FactRow>
            ) : (
              <></>
            )}
            {record.runsOn && record.runsOn.length > 0 ? (
              <FactRow label={IMPACT_RUNS_ON}>
                <PeerList peers={record.runsOn} />
              </FactRow>
            ) : (
              <></>
            )}
            {record.monitors && record.monitors.count > 0 ? (
              <FactRow label={IMPACT_WATCHED_BY}>
                <ul className="space-y-0.5">
                  {record.monitors.items.map(
                    (monitor: SecurityConnectionRecordJson): ReactElement => {
                      const monitorRoute: Route | null = getMonitorRoute(
                        monitor.id,
                      );

                      return (
                        <li
                          key={monitor.id}
                          className="flex flex-wrap items-center gap-x-2"
                        >
                          {monitorRoute ? (
                            <AppLink
                              to={monitorRoute}
                              className="text-gray-900 hover:text-indigo-700 hover:underline"
                            >
                              <bdi>{monitor.title}</bdi>
                            </AppLink>
                          ) : (
                            <bdi className="text-gray-900">{monitor.title}</bdi>
                          )}
                          {monitor.stateName ? (
                            <Pill
                              text={monitor.stateName}
                              color={
                                monitor.stateColor
                                  ? new Color(monitor.stateColor)
                                  : Gray500
                              }
                              size={PillSize.Small}
                            />
                          ) : (
                            <></>
                          )}
                        </li>
                      );
                    },
                  )}
                  {record.monitors.count > record.monitors.items.length ? (
                    <li className="text-gray-500">
                      {translator.translatePlural(
                        IMPACT_MORE,
                        record.monitors.count - record.monitors.items.length,
                      )}
                    </li>
                  ) : (
                    <></>
                  )}
                </ul>
              </FactRow>
            ) : (
              <></>
            )}
            {pages.length > 0 ? (
              <FactRow label={IMPACT_SHOWN_ON}>
                <span className="[overflow-wrap:anywhere]">
                  {pages.map(
                    (
                      page: SecurityCaseImpactStatusPageJson,
                      index: number,
                    ): ReactElement => {
                      const pageRoute: Route | null = getStatusPageRoute(
                        page.id,
                      );

                      return (
                        <React.Fragment key={page.id}>
                          {index > 0 ? ", " : ""}
                          {pageRoute ? (
                            <AppLink
                              to={pageRoute}
                              className="text-gray-900 hover:text-indigo-700 hover:underline"
                            >
                              <bdi>{page.name}</bdi>
                            </AppLink>
                          ) : (
                            <bdi className="text-gray-900">{page.name}</bdi>
                          )}
                        </React.Fragment>
                      );
                    },
                  )}
                </span>
              </FactRow>
            ) : (
              <></>
            )}
          </dl>
        </div>
      </div>
    </li>
  );
};

// Why OneUptime says the records are reachable from the internet: one line a piece.
const EvidenceLine: FunctionComponent<{
  evidence: SecurityCaseExposureEvidenceJson;
}> = (props: { evidence: SecurityCaseExposureEvidenceJson }): ReactElement => {
  const translator: Translator = useTranslator();
  const evidence: SecurityCaseExposureEvidenceJson = props.evidence;

  if (
    evidence.kind === SecurityCaseExposureEvidenceKind.PublicRequestReachedApp
  ) {
    const outcome: string = isSecurityEventRequestOutcome(
      evidence.requestOutcome,
    )
      ? translator.translateText(
          STORY_OUTCOME_LABELS[evidence.requestOutcome],
        ) || STORY_OUTCOME_LABELS[evidence.requestOutcome]
      : "";

    return (
      <li>
        {translator.translateTemplate(IMPACT_EVIDENCE[evidence.kind], {
          address: evidence.address,
          outcome,
          time: evidence.time ? OneUptimeDate.fromNow(new Date(evidence.time)) : "",
        })}
      </li>
    );
  }

  return (
    <li>
      {translator.translateTemplate(IMPACT_EVIDENCE[evidence.kind], {
        name: evidence.recordName || "",
        address: evidence.address,
      })}
    </li>
  );
};

const SecurityCaseImpactCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [impact, setImpact] = useState<SecurityCaseImpactJson | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    SecurityCaseContextApi.getImpact(props.caseId)
      .then((result: SecurityCaseImpactJson) => {
        if (isCurrent) {
          setImpact(result);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err as Error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.caseId.toString(), props.refreshToken, readCount]);

  const reread: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  let body: ReactElement;

  if (error) {
    body = (
      <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.error}>
        <ErrorMessage message={error} onRefreshClick={reread} />
      </div>
    );
  } else if (!impact) {
    body = <ComponentLoader />;
  } else if (
    impact.records.length === 0 &&
    impact.internet.evidence.length === 0
  ) {
    body = (
      <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactEmpty}>
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.ShieldCheck}
          title={translator.translateText(IMPACT_EMPTY_TITLE) || ""}
          description={translator.translateText(IMPACT_EMPTY_DESCRIPTION)}
          isCompact={true}
        />
      </div>
    );
  } else {
    const summary: SecurityCaseImpactSummary = summarizeImpact(impact);
    const records: Array<SecurityCaseImpactRecordJson> =
      getImpactRecordsInOrder(impact.records);
    const owners: ReturnType<typeof getImpactOwners> = getImpactOwners(records);
    const leading: ReturnType<typeof getImpactLeadingChange> =
      getImpactLeadingChange(records);
    const flows: Array<SecurityCaseFlowPeerJson> = getTopFlowPeers(
      impact.flowPeers,
      SECURITY_CASE_IMPACT_MAX_FLOW_PEERS,
    );
    // "Nothing changed" is said only when the changes could be read.
    const canSayNothingChanged: boolean =
      records.length > 0 &&
      !impact.unreadableSources.includes(SecurityCaseImpactSource.Changes) &&
      !impact.failedSources.includes(SecurityCaseImpactSource.Changes);

    body = (
      <div className="space-y-5">
        <ul
          className="flex flex-wrap gap-1.5"
          data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactSummary}
        >
          <li data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactInternet}>
            <Pill
              text={
                summary.isInternetFacing
                  ? IMPACT_INTERNET_YES
                  : IMPACT_INTERNET_UNKNOWN
              }
              color={summary.isInternetFacing ? Red : Gray500}
              size={PillSize.Small}
            />
          </li>
          {summary.recordCount > 0 ? (
            <Figure
              icon={IconProp.Layers}
              text={translator.translatePlural(
                IMPACT_RECORDS,
                summary.recordCount,
              )}
            />
          ) : (
            <></>
          )}
          {summary.downstreamCount > 0 ? (
            <Figure
              icon={IconProp.ArrowRight}
              text={translator.translatePlural(
                IMPACT_DOWNSTREAM,
                summary.downstreamCount,
              )}
            />
          ) : (
            <></>
          )}
          {summary.upstreamCount > 0 ? (
            <Figure
              icon={IconProp.ArrowLeft}
              text={translator.translatePlural(
                IMPACT_UPSTREAM,
                summary.upstreamCount,
              )}
            />
          ) : (
            <></>
          )}
          {summary.monitorCount > 0 ? (
            <Figure
              icon={IconProp.Heartbeat}
              text={translator.translatePlural(
                IMPACT_MONITORS,
                summary.monitorCount,
              )}
            />
          ) : (
            <></>
          )}
          {summary.statusPageCount > 0 ? (
            <Figure
              icon={IconProp.Window}
              text={translator.translatePlural(
                IMPACT_STATUS_PAGES,
                summary.statusPageCount,
              )}
            />
          ) : (
            <></>
          )}
        </ul>

        <section>
          <h3 className={`mb-2 ${SECTION_HEADING_CLASS_NAME}`}>
            {translator.translateText(IMPACT_EXPOSURE_HEADING)}
          </h3>
          <dl className="space-y-2">
            <FactRow label={IMPACT_INTERNET}>
              {impact.internet.evidence.length > 0 ? (
                <ul className="space-y-0.5 [overflow-wrap:anywhere]">
                  {impact.internet.evidence.map(
                    (
                      evidence: SecurityCaseExposureEvidenceJson,
                      index: number,
                    ): ReactElement => {
                      return (
                        <EvidenceLine
                          key={`${evidence.kind}-${evidence.address}-${index}`}
                          evidence={evidence}
                        />
                      );
                    },
                  )}
                </ul>
              ) : (
                <span className="text-gray-500">
                  {translator.translateText(IMPACT_INTERNET_UNKNOWN_DETAIL)}
                </span>
              )}
            </FactRow>
            {owners.isKnown ? (
              <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactOwners}>
                <FactRow label={IMPACT_OWNERS}>
                  {owners.teams.length + owners.users.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {owners.teams.map(
                        (team: { id: string; name: string }): ReactElement => {
                          return (
                            <span
                              key={`team-${team.id}`}
                              className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                            >
                              <Icon icon={IconProp.Team} className="h-3 w-3" />
                              <bdi>{team.name}</bdi>
                            </span>
                          );
                        },
                      )}
                      {owners.users.map(
                        (user: { id: string; name: string }): ReactElement => {
                          return (
                            <span
                              key={`user-${user.id}`}
                              className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
                            >
                              <Icon icon={IconProp.User} className="h-3 w-3" />
                              <bdi>{user.name}</bdi>
                            </span>
                          );
                        },
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      {translator.translateText(IMPACT_NO_OWNERS)}
                    </span>
                  )}
                </FactRow>
              </div>
            ) : (
              <></>
            )}
            {leading || canSayNothingChanged ? (
              <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactLastChange}>
                <FactRow label={IMPACT_LAST_CHANGE}>
                  {leading ? (
                    <span className="[overflow-wrap:anywhere]">
                      {translator.translateTemplate(
                        leading.change.isBeforeFirstDetection
                          ? IMPACT_CHANGE_BEFORE
                          : IMPACT_CHANGE_AFTER,
                        {
                          title:
                            leading.change.title || leading.change.eventType,
                          name: leading.record.name,
                          time: OneUptimeDate.fromNow(
                            new Date(leading.change.time),
                          ),
                        },
                      )}
                      {leading.change.version ? (
                        <span className="ml-1.5 font-mono text-xs text-gray-500">
                          {translator.translateTemplate(IMPACT_VERSION, {
                            version: leading.change.version,
                          })}
                        </span>
                      ) : (
                        <></>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      {translator.translateText(IMPACT_NO_CHANGE)}
                    </span>
                  )}
                </FactRow>
              </div>
            ) : (
              <></>
            )}
          </dl>
        </section>

        {records.length > 0 || flows.length > 0 ? (
          <div>
            <button
              type="button"
              aria-expanded={isExpanded}
              className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => {
                setIsExpanded(!isExpanded);
              }}
              data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactToggle}
            >
              <Icon
                icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
                className="h-4 w-4"
              />
              {translator.translateText(
                isExpanded ? IMPACT_HIDE_DETAILS : IMPACT_SHOW_DETAILS,
              )}
            </button>

            {isExpanded ? (
              <div
                className="mt-4 space-y-5"
                data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactDetails}
              >
                {records.length > 0 ? (
                  <section>
                    <h3 className={`mb-2 ${SECTION_HEADING_CLASS_NAME}`}>
                      {translator.translateText(IMPACT_AT_RISK_HEADING)}
                    </h3>
                    <ul className="divide-y divide-gray-100">
                      {records.map(
                        (record: SecurityCaseImpactRecordJson): ReactElement => {
                          return (
                            <ImpactRecord
                              key={`${record.kind}:${record.id}`}
                              record={record}
                              statusPages={impact.statusPages}
                            />
                          );
                        },
                      )}
                    </ul>
                  </section>
                ) : (
                  <></>
                )}

                {flows.length > 0 ? (
                  <section data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactFlows}>
                    <h3 className={`mb-2 ${SECTION_HEADING_CLASS_NAME}`}>
                      {translator.translateText(IMPACT_TALKED_TO_HEADING)}
                    </h3>
                    <ul className="space-y-1 text-sm text-gray-600 [overflow-wrap:anywhere]">
                      {flows.map(
                        (
                          peer: SecurityCaseFlowPeerJson,
                          index: number,
                        ): ReactElement => {
                          return (
                            <li
                              key={`${peer.caseAddress}-${peer.peerAddress}-${peer.direction}-${index}`}
                            >
                              {translator.translateTemplate(
                                peer.direction === "out"
                                  ? IMPACT_FLOW_SENT
                                  : IMPACT_FLOW_RECEIVED,
                                {
                                  address: peer.caseAddress,
                                  peer: peer.peerAddress,
                                  bytes: formatTrafficBytes(peer.bytes),
                                },
                              )}
                            </li>
                          );
                        },
                      )}
                    </ul>
                  </section>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {impact.hasMoreRecords ||
        impact.unreadableSources.length > 0 ||
        impact.failedSources.length > 0 ? (
          <div
            className="space-y-1 text-sm text-gray-500"
            data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactNotes}
          >
            {impact.hasMoreRecords ? (
              <p>{translator.translateText(IMPACT_MORE_RECORDS)}</p>
            ) : (
              <></>
            )}
            {impact.unreadableSources.length > 0 ? (
              <p>
                {translator.translateTemplate(IMPACT_UNREADABLE, {
                  sources: composedValue((sentence: Translator): string => {
                    return sourceNames(sentence, impact.unreadableSources);
                  }),
                })}
              </p>
            ) : (
              <></>
            )}
            {impact.failedSources.length > 0 ? (
              <p className="text-amber-700">
                {translator.translateTemplate(IMPACT_FAILED, {
                  sources: composedValue((sentence: Translator): string => {
                    return sourceNames(sentence, impact.failedSources);
                  }),
                })}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impact}>
      <Card title={IMPACT_TITLE} description={IMPACT_DESCRIPTION}>
        {body}
      </Card>
    </div>
  );
};

export default SecurityCaseImpactCard;
