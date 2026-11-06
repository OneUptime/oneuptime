import AppLink from "../AppLink/AppLink";
import DataSecurityApi from "./DataSecurityApi";
import { SensitivityPill } from "./DataSecurityPills";
import FindingOccurrences from "./FindingOccurrences";
import { getTelemetryStoreOwnerRoute } from "./FindingOccurrenceLinks";
import { DataTypeNamer, useDataTypeNamer } from "./IssueDataTypes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green500 } from "Common/Types/BrandColors";
import { DataSecurityScrubResult } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  FINDING_FRESHNESS_IN_DAYS,
  getTelemetryCheckIdOfDataType,
  isUnscrubbedTelemetryFinding,
  isFindingCounted,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import DataConfidence from "Common/Types/DataSecurity/DataConfidence";
import { getDataStoreKindInfo } from "Common/Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Pill from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  Translator,
  translatableTerm,
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
 * WHAT A TELEMETRY ISSUE FOUND, WHERE, AND THE RECORDS IT WAS IN.
 *
 * "Please tell me what kind data it is, where is it coming from. Show me
 * actual data like traces / logs" (issue #5594). The findings behind a
 * telemetry issue, by the rules its check counts them with
 * (isUnscrubbedTelemetryFinding): each data type and the place it sits -
 * an attribute, a log's body, a prompt - with how many sampled values
 * matched, when a scan last saw it, its masked samples, Scrub It, and the
 * newest records that carry it (FindingOccurrences), which open in the
 * trace view, the logs explorer, the exception or the session replay. A
 * finding a scrub rule already masks stays on the list, marked, so a
 * person sees what is left.
 *
 * Masked samples and the records they were seen in are evidence about
 * real records: only a reader who may read the masked samples is asked
 * for them (DataStoreFinding's restricted columns) - a Security Viewer
 * reads what was found and where, and is told why the rest is not shown.
 */

export const ISSUE_TELEMETRY_FINDINGS_TEST_ID: string =
  "data-security-issue-findings";

// The most findings of one store the card reads.
export const MAX_ISSUE_FINDINGS_READ: number = 100;

const WHERE_IT_IS: string = translationKey("In the {{signal}} of {{owner}}");
const VALUES_MATCHED: string = translationKey(
  "{{matches}} of {{sampled}} sampled values matched",
);
const MATCHES_ONLY: PluralTemplate = {
  one: "{{count}} sampled value matched",
  other: "{{count}} sampled values matched",
};
const CONFIRMED_BY_A_PERSON: string = translationKey("Confirmed by a person");
const LAST_SEEN: string = translationKey("Last seen {{time}}");
const MASKED_SAMPLES: string = translationKey("Masked samples");
const SHOW_RECORDS: string = translationKey("Show the records it was seen in");
const HIDE_RECORDS: string = translationKey("Hide the records");
const SCRUBBED: string = translationKey("Scrubbed");
const SCRUBBED_TOOLTIP: string = translationKey(
  "A scrub rule masks this data at ingest. What was stored before keeps it until its retention ends.",
);
const SCRUB_IT: string = translationKey("Scrub It");
const SCRUB_LOCKED: string = translationKey(
  "You do not have permission to create scrub rules.",
);
const SCRUBBED_LOGS: string = translationKey(
  "The scrub rule {{name}} now masks this data in new logs.",
);
const SCRUBBED_TRACES: string = translationKey(
  "The scrub rule {{name}} now masks this data in new traces.",
);
const VIEW_SCRUB_RULES: string = translationKey("View scrub rules");
const RESOLVES_WHEN_SCRUBBED: string = translationKey(
  "The issue resolves once every finding here is scrubbed and the store is checked again.",
);
const NO_SAMPLES_FOR_ROLE: string = translationKey(
  "Your role does not show masked samples, or the records they were seen in.",
);
const NOTHING_LEFT: string = translationKey(
  "Nothing is left to scrub: every finding behind this issue is masked at ingest, or no longer seen.",
);
const MORE_IN_STORE: string = translationKey(
  "See everything found in this store",
);

interface ScrubNotice {
  ruleName: string;
  signal: "log" | "trace";
}

export interface ComponentProps {
  issue: DataSecurityIssue;
  store: DataStore | undefined;
  // The issue changed: its page reads it again.
  onChanged: () => void;
}

// What the card reads of each finding: the masked samples only for a reader who may.
export function getIssueFindingsSelect(
  canReadSamples: boolean,
): Select<DataStoreFinding> {
  return {
    _id: true,
    dataTypeId: true,
    dataTypeName: true,
    sensitivity: true,
    location: true,
    locationKind: true,
    confidence: true,
    matchCount: true,
    valueCount: true,
    isScrubbed: true,
    isSuppressed: true,
    isConfirmed: true,
    isAiSuggested: true,
    lastSeenAt: true,
    ...(canReadSamples ? { maskedSamples: true } : {}),
  };
}

/*
 * The findings behind an issue of one of the telemetry checks: those that
 * count, at least Medium sure, of the check's data types (secrets for the
 * one, everything else for the other) - the ones no scrub rule masks yet
 * first, then those already scrubbed. The read is newest-matched first.
 */
export function getFindingsBehindIssue(
  checkId: string | undefined,
  findings: ReadonlyArray<DataStoreFinding>,
): Array<DataStoreFinding> {
  const behind: Array<DataStoreFinding> = findings.filter(
    (finding: DataStoreFinding): boolean => {
      return (
        Boolean(finding.dataTypeId) &&
        isFindingCounted(finding) &&
        finding.confidence !== DataConfidence.Low &&
        getTelemetryCheckIdOfDataType(finding.dataTypeId || "") === checkId
      );
    },
  );

  return [
    ...behind.filter(isUnscrubbedTelemetryFinding),
    ...behind.filter((finding: DataStoreFinding): boolean => {
      return !isUnscrubbedTelemetryFinding(finding);
    }),
  ];
}

const FindingBlock: FunctionComponent<{
  finding: DataStoreFinding;
  namer: DataTypeNamer;
  canReadSamples: boolean;
  isOpen: boolean;
  onToggle: () => void;
  scrubGate: PermissionGateResult;
  isScrubbing: boolean;
  onScrub: () => void;
}> = (props: {
  finding: DataStoreFinding;
  namer: DataTypeNamer;
  canReadSamples: boolean;
  isOpen: boolean;
  onToggle: () => void;
  scrubGate: PermissionGateResult;
  isScrubbing: boolean;
  onScrub: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const finding: DataStoreFinding = props.finding;
  const findingId: string = finding._id?.toString() || "";
  const samples: Array<string> = Array.isArray(finding.maskedSamples)
    ? finding.maskedSamples.filter((sample: unknown): sample is string => {
        return typeof sample === "string" && sample.length > 0;
      })
    : [];
  const showScrub: boolean =
    !finding.isScrubbed &&
    (props.scrubGate.isAllowed || Boolean(props.scrubGate.disabledReason));
  const matches: number = finding.matchCount || 0;
  const sampled: number = finding.valueCount || 0;

  return (
    <li
      className={`rounded-md border p-4 ${
        finding.isScrubbed
          ? "border-gray-200 bg-gray-50"
          : "border-gray-200 bg-white"
      }`}
      data-testid="data-security-issue-finding"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
              data-testid="data-security-issue-finding-type"
            >
              {props.namer(finding.dataTypeId || "", finding.dataTypeName)}
            </span>
            {finding.sensitivity ? (
              <SensitivityPill sensitivity={finding.sensitivity} />
            ) : (
              <></>
            )}
            {finding.isScrubbed ? (
              <Pill
                text={SCRUBBED}
                color={Green500}
                tooltip={SCRUBBED_TOOLTIP}
              />
            ) : (
              <></>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
            <code
              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere] [box-decoration-break:clone]"
              data-testid="data-security-issue-finding-location"
            >
              {finding.location || ""}
            </code>
            {finding.locationKind ? (
              <span className="text-xs text-gray-500">
                {translator.translateText(finding.locationKind) ||
                  finding.locationKind}
              </span>
            ) : (
              <></>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>
              {matches > 0 && sampled > 0
                ? translator.translateTemplate(VALUES_MATCHED, {
                    matches: translator.formatNumber(matches),
                    sampled: translator.formatNumber(sampled),
                  })
                : matches > 0
                  ? translator.translatePlural(MATCHES_ONLY, matches)
                  : translator.translateText(CONFIRMED_BY_A_PERSON)}
            </span>
            {finding.lastSeenAt ? (
              <span
                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  finding.lastSeenAt,
                )}
              >
                {translator.translateTemplate(LAST_SEEN, {
                  time: OneUptimeDate.fromNow(finding.lastSeenAt),
                })}
              </span>
            ) : (
              <></>
            )}
          </div>
        </div>
        {showScrub ? (
          <Button
            title={SCRUB_IT}
            icon={IconProp.EyeSlash}
            buttonStyle={ButtonStyleType.OUTLINE}
            isLoading={props.isScrubbing}
            disabled={!props.scrubGate.isAllowed || props.isScrubbing}
            tooltip={
              props.scrubGate.isAllowed
                ? undefined
                : props.scrubGate.disabledReason
            }
            dataTestId="data-security-issue-finding-scrub"
            onClick={props.onScrub}
          />
        ) : (
          <></>
        )}
      </div>

      {props.canReadSamples && samples.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(MASKED_SAMPLES)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {samples.map((sample: string): ReactElement => {
              return (
                <code
                  key={sample}
                  className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]"
                  data-testid="data-security-issue-finding-sample"
                >
                  {sample}
                </code>
              );
            })}
          </div>
        </div>
      ) : (
        <></>
      )}

      {props.canReadSamples && findingId ? (
        <div className="mt-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
            aria-expanded={props.isOpen}
            data-testid="data-security-issue-finding-records-toggle"
            onClick={props.onToggle}
          >
            <Icon
              icon={props.isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
              className="h-4 w-4"
            />
            <span>
              {translator.translateText(
                props.isOpen ? HIDE_RECORDS : SHOW_RECORDS,
              )}
            </span>
          </button>
          {props.isOpen ? (
            <div className="mt-2">
              <FindingOccurrences findingId={new ObjectID(findingId)} />
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

const IssueTelemetryFindings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const namer: DataTypeNamer = useDataTypeNamer();
  const storeId: string =
    props.issue.dataStoreId?.toString() || props.store?._id?.toString() || "";
  const checkId: string = props.issue.checkId || "";
  const canReadSamples: boolean = PermissionGate.canReadColumn(
    new DataStoreFinding(),
    "maskedSamples",
  );
  const scrubGate: PermissionGateResult = PermissionGate.check(
    new LogScrubRule(),
    ModelAction.Create,
    { sentence: SCRUB_LOCKED },
  );

  const [findings, setFindings] = useState<Array<DataStoreFinding> | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  // Which findings show their records: the first one, until a person says otherwise.
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const [scrubbing, setScrubbing] = useState<DataStoreFinding | null>(null);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubError, setScrubError] = useState<string>("");
  const [notice, setNotice] = useState<ScrubNotice | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!storeId) {
      setFindings([]);
      return;
    }

    setError("");

    ModelAPI.getList<DataStoreFinding>({
      modelType: DataStoreFinding,
      query: {
        dataStoreId: new ObjectID(storeId),
        isSuppressed: false,
        lastSeenAt: new GreaterThanOrEqual<Date>(
          OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -FINDING_FRESHNESS_IN_DAYS,
          ),
        ),
      },
      limit: MAX_ISSUE_FINDINGS_READ,
      skip: 0,
      select: getIssueFindingsSelect(canReadSamples),
      sort: { matchCount: SortOrder.Descending },
    })
      .then((result: ListResult<DataStoreFinding>) => {
        if (isCurrent) {
          setFindings(getFindingsBehindIssue(checkId, result.data));
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
  }, [storeId, checkId, canReadSamples, readCount]);

  const firstUnscrubbedId: string =
    findings
      ?.find((finding: DataStoreFinding): boolean => {
        return !finding.isScrubbed;
      })
      ?._id?.toString() || "";
  const isOpen: (findingId: string) => boolean = (
    findingId: string,
  ): boolean => {
    return openIds ? openIds.has(findingId) : findingId === firstUnscrubbedId;
  };
  const toggle: (findingId: string) => void = (findingId: string): void => {
    const next: Set<string> = new Set(
      openIds || (firstUnscrubbedId ? [firstUnscrubbedId] : []),
    );

    if (next.has(findingId)) {
      next.delete(findingId);
    } else {
      next.add(findingId);
    }

    setOpenIds(next);
  };

  const scrub: () => Promise<void> = async (): Promise<void> => {
    const findingId: string = scrubbing?._id?.toString() || "";

    if (!findingId) {
      setScrubbing(null);
      return;
    }

    setIsScrubbing(true);
    setScrubError("");

    try {
      const result: DataSecurityScrubResult =
        await DataSecurityApi.scrubFinding(new ObjectID(findingId));

      setNotice({ ruleName: result.scrubRuleName, signal: result.signal });
      setScrubbing(null);
      setReadCount((count: number): number => {
        return count + 1;
      });
      props.onChanged();
    } catch (err) {
      setScrubError(API.getFriendlyMessage(err));
    }

    setIsScrubbing(false);
  };

  const ownerRoute: Route | null = props.store
    ? getTelemetryStoreOwnerRoute(props.store)
    : null;
  const signal: string = props.store?.kind || "";
  const ownerName: string = (props.store?.name || "").split(" · ")[0] || "";
  // "In the traces of oneuptime-app": the signal named mid-sentence.
  const whereItIs: string =
    signal && ownerName
      ? translator.translateTemplate(WHERE_IT_IS, {
          signal: translatableTerm(signal, { inSentence: true }),
          owner: ownerName,
        })
      : "";
  const unscrubbed: number = (findings || []).filter(
    (finding: DataStoreFinding): boolean => {
      return !finding.isScrubbed;
    },
  ).length;

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
  } else if (findings.length === 0) {
    body = (
      <p className="text-sm text-gray-600">
        {translator.translateText(NOTHING_LEFT)}
      </p>
    );
  } else {
    body = (
      <ul className="space-y-3">
        {findings.map((finding: DataStoreFinding): ReactElement => {
          const findingId: string = finding._id?.toString() || "";

          return (
            <FindingBlock
              key={findingId}
              finding={finding}
              namer={namer}
              canReadSamples={canReadSamples}
              isOpen={isOpen(findingId)}
              onToggle={() => {
                toggle(findingId);
              }}
              scrubGate={scrubGate}
              isScrubbing={
                isScrubbing && scrubbing?._id?.toString() === findingId
              }
              onScrub={() => {
                setScrubError("");
                setScrubbing(finding);
              }}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <Card
      title="Where It Was Found"
      description="Each kind of data the check found, where it sits in this telemetry, and the newest records that carry it."
    >
      <div className="space-y-4" data-testid={ISSUE_TELEMETRY_FINDINGS_TEST_ID}>
        {notice ? (
          <Alert
            type={AlertType.SUCCESS}
            dataTestId="data-security-issue-findings-scrub-notice"
            title={
              <span>
                {translator.translateTemplate(
                  notice.signal === "trace" ? SCRUBBED_TRACES : SCRUBBED_LOGS,
                  { name: notice.ruleName || "" },
                )}{" "}
                <AppLink
                  className="font-medium underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[
                      notice.signal === "trace"
                        ? PageMap.TRACES_SETTINGS_SCRUB_RULES
                        : PageMap.LOGS_SETTINGS_SCRUB_RULES
                    ] as Route,
                  )}
                >
                  {translator.translateText(VIEW_SCRUB_RULES) ||
                    VIEW_SCRUB_RULES}
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

        {whereItIs ? (
          <div
            className="flex flex-wrap items-center gap-1.5 text-sm text-gray-600"
            data-testid="data-security-issue-findings-owner"
          >
            <Icon
              icon={getDataStoreKindInfo(signal)?.icon || IconProp.Logs}
              className="h-4 w-4 shrink-0 text-gray-400"
            />
            {ownerRoute ? (
              <AppLink
                className="font-medium text-indigo-600 hover:underline [overflow-wrap:anywhere]"
                to={ownerRoute}
              >
                {whereItIs}
              </AppLink>
            ) : (
              <span className="[overflow-wrap:anywhere]">{whereItIs}</span>
            )}
          </div>
        ) : (
          <></>
        )}

        {body}

        {findings && findings.length > 0 && !canReadSamples ? (
          <p className="text-xs text-gray-500">
            {translator.translateText(NO_SAMPLES_FOR_ROLE)}
          </p>
        ) : (
          <></>
        )}

        {findings && unscrubbed > 0 ? (
          <p className="text-xs text-gray-500">
            {translator.translateText(RESOLVES_WHEN_SCRUBBED)}
          </p>
        ) : (
          <></>
        )}

        {storeId ? (
          <AppLink
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_INSIDE] as Route,
              { modelId: new ObjectID(storeId) },
            )}
          >
            <span>{translator.translateText(MORE_IN_STORE)}</span>
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </AppLink>
        ) : (
          <></>
        )}
      </div>

      {scrubbing ? (
        <ConfirmModal
          title="Scrub This Data at Ingest"
          description="OneUptime adds a scrub rule that masks this kind of data at this place in new telemetry, before it is stored. What is already stored does not change."
          submitButtonText="Scrub It"
          isLoading={isScrubbing}
          error={scrubError || undefined}
          onClose={() => {
            setScrubbing(null);
            setScrubError("");
          }}
          onSubmit={() => {
            void scrub();
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default IssueTelemetryFindings;
