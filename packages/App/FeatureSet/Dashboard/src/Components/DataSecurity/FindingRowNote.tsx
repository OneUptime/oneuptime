import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  DATA_STORE_FINDING_VERDICT_TITLES,
  FINDING_VERDICT_TONES,
  FindingVerdictCopy,
} from "./FindingVerdictCopy";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import {
  DataStoreFindingDecision,
  DataStoreFindingPrecedent,
  DataStoreFindingVerdictRecord,
  FINDING_WRONG_MATCH_SIGN_TITLES,
  FindingWrongMatchSign,
  readDataStoreFindingVerdictRecord,
} from "Common/Types/DataSecurity/DataStoreFindingVerdict";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  getFindingNameKey,
  isFindingAwaitingJudgement,
} from "Common/Utils/DataSecurity/FindingJudgement";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT ONEUPTIME AI SAYS OF A FINDING, ACROSS ITS ROW (#10372, #6105).
 *
 * A finding's row in What's Inside and In Your Telemetry ends on a line
 * across its whole width (the shared table's getRowNote), where a column
 * was too narrow for a sentence - a suggestion's reason sat in 120px:
 *
 *   - "Suggested by OneUptime AI" and why, for its suggestion of a field
 *     no detector placed (#6105, item 7);
 *   - its verdict on a finding that waits for a person - Confirm it, Not
 *     sensitive or Cannot tell - and why, and the team's decisions it rests
 *     on, one glance away: "Your team marked order_number not sensitive on
 *     4 stores", with Show the decisions folding out each one, its store
 *     read with the reader's own permissions;
 *   - that OneUptime AI confirmed it on its own, as an AI rule allows, with
 *     where to undo it.
 *
 * Only what still applies is drawn: a verdict on a finding a person has
 * decided since says nothing more - their decision is the finding's. A
 * finding with nothing to say has no line at all.
 */

export const FINDING_VERDICT_TEST_ID: string = "data-store-finding-ai-verdict";
export const FINDING_PRECEDENT_TEST_ID: string =
  "data-store-finding-ai-precedent";
export const FINDING_AI_SUGGESTION_TEST_ID: string =
  "data-store-finding-ai-suggestion";
export const FINDING_AI_REASON_TEST_ID: string = "data-store-finding-ai-reason";
export const FINDING_CONFIRMED_BY_AI_TEST_ID: string =
  "data-store-finding-confirmed-by-ai";

// The columns a finding's line reads: select them with the list's own.
export const FINDING_ROW_NOTE_SELECT: {
  dataTypeId: true;
  location: true;
  locationKind: true;
  confidence: true;
  matchCount: true;
  testValueCount: true;
  isFreeText: true;
  isNameHinted: true;
  isAiSuggested: true;
  aiReason: true;
  isSuppressed: true;
  isConfirmed: true;
  isConfirmedByAi: true;
  aiVerdict: true;
  aiVerdictAnalysis: true;
} = {
  dataTypeId: true,
  location: true,
  locationKind: true,
  confidence: true,
  matchCount: true,
  testValueCount: true,
  isFreeText: true,
  isNameHinted: true,
  isAiSuggested: true,
  aiReason: true,
  isSuppressed: true,
  isConfirmed: true,
  isConfirmedByAi: true,
  aiVerdict: true,
  aiVerdictAnalysis: true,
};

// The verdict a finding's row shows: one that waits for a person still, and is OneUptime AI's.
export function getShownVerdict(
  finding: DataStoreFinding,
): DataStoreFindingVerdictRecord | null {
  if (!isFindingAwaitingJudgement(finding)) {
    return null;
  }

  const record: DataStoreFindingVerdictRecord | null =
    readDataStoreFindingVerdictRecord(finding.aiVerdictAnalysis);

  return record && record.verdict === finding.aiVerdict ? record : null;
}

// What a field is named in a sentence: the part a person recognises, as written.
function fieldOf(location: string): string {
  const separator: number = location.lastIndexOf(" › ");
  const field: string =
    separator >= 0 ? location.slice(separator + 3) : location;
  const dot: number = field.lastIndexOf(".");

  return dot >= 0 && dot < field.length - 1 ? field.slice(dot + 1) : field;
}

interface PrecedentSummary {
  decision: DataStoreFindingDecision;
  stores: number;
  // The field's own name, when every cited decision is on a field of the same name.
  field: string | null;
}

// The cited decisions, said as a line each of not sensitive and confirmed.
export function summarizePrecedent(
  precedent: ReadonlyArray<DataStoreFindingPrecedent>,
): Array<PrecedentSummary> {
  const summaries: Array<PrecedentSummary> = [];

  for (const decision of [
    DataStoreFindingDecision.NotSensitive,
    DataStoreFindingDecision.Confirmed,
  ]) {
    const entries: Array<DataStoreFindingPrecedent> = precedent.filter(
      (entry: DataStoreFindingPrecedent): boolean => {
        return entry.decision === decision;
      },
    );

    if (entries.length === 0) {
      continue;
    }

    const keys: Set<string | null> = new Set(
      entries.map((entry: DataStoreFindingPrecedent): string | null => {
        return entry.isSameName
          ? getFindingNameKey({ location: entry.location })
          : null;
      }),
    );
    const isOneName: boolean = keys.size === 1 && !keys.has(null);

    summaries.push({
      decision,
      stores: new Set(
        entries.map((entry: DataStoreFindingPrecedent): string => {
          return entry.dataStoreId.toLowerCase();
        }),
      ).size,
      field: isOneName ? fieldOf(entries[0]!.location) : null,
    });
  }

  return summaries;
}

// One line of what the team decided, its field as code.
const PrecedentSentence: FunctionComponent<{
  summary: PrecedentSummary;
}> = (props: { summary: PrecedentSummary }): ReactElement => {
  const isNotSensitive: boolean =
    props.summary.decision === DataStoreFindingDecision.NotSensitive;

  if (props.summary.field) {
    return (
      <TranslatedSentence
        template={
          isNotSensitive
            ? FindingVerdictCopy.markedNotSensitiveOnStores
            : FindingVerdictCopy.confirmedOnStores
        }
        count={props.summary.stores}
        slots={{
          field: (
            <code className="rounded bg-gray-100 px-1 py-px font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">
              {props.summary.field}
            </code>
          ),
        }}
      />
    );
  }

  return (
    <TranslatedSentence
      template={
        isNotSensitive
          ? FindingVerdictCopy.markedLikeItNotSensitiveOnStores
          : FindingVerdictCopy.confirmedLikeItOnStores
      }
      count={props.summary.stores}
      slots={{}}
    />
  );
};

/*
 * The decisions a verdict rests on, one each: its store - read with the
 * reader's own permissions, "Another store" where they may not read it -
 * its place, what was decided and why.
 */
const PrecedentList: FunctionComponent<{
  precedent: ReadonlyArray<DataStoreFindingPrecedent>;
}> = (props: {
  precedent: ReadonlyArray<DataStoreFindingPrecedent>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [names, setNames] = useState<Map<string, string> | null>(null);
  const [isUnread, setIsUnread] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;
    const ids: Array<string> = [
      ...new Set(
        props.precedent
          .map((entry: DataStoreFindingPrecedent): string => {
            return entry.dataStoreId;
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    ];

    ModelAPI.getList<DataStore>({
      modelType: DataStore,
      query: {
        _id: new Includes(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, name: true },
      limit: Math.max(ids.length, 1),
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<DataStore>) => {
        if (isCurrent) {
          const read: Map<string, string> = new Map();

          for (const store of result.data) {
            read.set(
              store._id?.toString().toLowerCase() || "",
              store.name || "",
            );
          }

          setNames(read);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setNames(new Map());
          setIsUnread(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.precedent]);

  return (
    <div className="mt-1 rounded-md border border-gray-200 bg-white p-3">
      <div className="text-xs font-medium text-gray-500">
        {translator.translateText(FindingVerdictCopy.decisionsTitle)}
      </div>
      {isUnread ? (
        <p className="mt-1 text-xs text-gray-500">
          {translator.translateText(FindingVerdictCopy.decisionsNotLoaded)}
        </p>
      ) : (
        <></>
      )}
      <ul className="mt-2 space-y-2">
        {props.precedent.map(
          (entry: DataStoreFindingPrecedent): ReactElement => {
            const storeName: string | undefined = names?.get(
              entry.dataStoreId.toLowerCase(),
            );

            return (
              <li key={entry.findingId} className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-gray-900">
                    {names === null ? (
                      <InlineValueSkeleton />
                    ) : storeName ? (
                      <IsolatedText text={storeName} />
                    ) : (
                      translator.translateText(FindingVerdictCopy.anotherStore)
                    )}
                  </span>
                  <code className="rounded bg-gray-100 px-1 py-px font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">
                    {entry.location}
                  </code>
                  <Pill
                    text={
                      entry.decision === DataStoreFindingDecision.NotSensitive
                        ? FindingVerdictCopy.markedNotSensitive
                        : FindingVerdictCopy.confirmed
                    }
                    isDotHidden={true}
                  />
                  <span className="text-xs text-gray-500">
                    {translator.translateText(
                      entry.isSameName
                        ? FindingVerdictCopy.sameName
                        : FindingVerdictCopy.nameLikeIt,
                    )}
                  </span>
                </div>
                {entry.reason ? (
                  <p className="mt-0.5 text-xs text-gray-600 [overflow-wrap:anywhere]">
                    <IsolatedText text={entry.reason} />
                  </p>
                ) : (
                  <></>
                )}
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

// OneUptime AI's mark, as the product's AI wears it elsewhere.
const AiMark: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-purple-700">
      <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5 shrink-0" />
      <span>{translator.translateText(FindingVerdictCopy.oneUptimeAi)}</span>
    </span>
  );
};

export interface ComponentProps {
  finding: DataStoreFinding;
}

const FindingRowNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const finding: DataStoreFinding = props.finding;
  const verdict: DataStoreFindingVerdictRecord | null =
    getShownVerdict(finding);
  const isSuggestion: boolean =
    Boolean(finding.isAiSuggested) && !finding.isSuppressed;
  const isConfirmedByAi: boolean =
    Boolean(finding.isConfirmedByAi) &&
    Boolean(finding.isConfirmed) &&
    !finding.isSuppressed;
  const summaries: Array<PrecedentSummary> = verdict
    ? summarizePrecedent(verdict.precedent)
    : [];

  return (
    <div className="min-w-0 space-y-1.5">
      {isSuggestion ? (
        <div
          className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
          data-testid={FINDING_AI_SUGGESTION_TEST_ID}
        >
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-purple-700">
            <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5 shrink-0" />
            <span>
              {translator.translateText(FindingVerdictCopy.suggestedByAi)}
            </span>
          </span>
          {finding.aiReason ? (
            <span
              className="min-w-0 flex-1 text-sm text-gray-600 [overflow-wrap:anywhere]"
              data-testid={FINDING_AI_REASON_TEST_ID}
            >
              <IsolatedText text={finding.aiReason} />
            </span>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      {verdict ? (
        <div className="min-w-0" data-testid={FINDING_VERDICT_TEST_ID}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <AiMark />
            <span className="sr-only">
              {translator.translateText(FindingVerdictCopy.verdictLabel)}
            </span>
            <Pill
              text={DATA_STORE_FINDING_VERDICT_TITLES[verdict.verdict]}
              tone={FINDING_VERDICT_TONES[verdict.verdict]}
            />
            {verdict.reason ? (
              <span className="min-w-0 flex-1 basis-64 text-sm text-gray-700 [overflow-wrap:anywhere]">
                <IsolatedText text={verdict.reason} />
              </span>
            ) : (
              <></>
            )}
          </div>

          {/*
           * The signs of a wrong match it was judged with: sentences, which
           * wrap on a phone where a chip would cut them short.
           */}
          {verdict.signs.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {verdict.signs.map(
                (sign: FindingWrongMatchSign): ReactElement => {
                  return (
                    <li
                      key={sign}
                      className="flex min-w-0 items-start gap-1.5 text-xs text-gray-600"
                    >
                      <Icon
                        icon={IconProp.Flag}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
                      />
                      <span className="min-w-0">
                        {translator.translateText(
                          FINDING_WRONG_MATCH_SIGN_TITLES[sign],
                        )}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          ) : (
            <></>
          )}

          {summaries.length > 0 ? (
            <div
              className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600"
              data-testid={FINDING_PRECEDENT_TEST_ID}
            >
              {summaries.map((summary: PrecedentSummary): ReactElement => {
                return (
                  <span key={summary.decision} className="min-w-0">
                    <PrecedentSentence summary={summary} />
                  </span>
                );
              })}
              <Button
                title={
                  isOpen
                    ? FindingVerdictCopy.hideDecisions
                    : FindingVerdictCopy.showDecisions
                }
                buttonStyle={ButtonStyleType.LINK}
                icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
                onClick={() => {
                  setIsOpen(!isOpen);
                }}
              />
            </div>
          ) : (
            <></>
          )}

          {isOpen && verdict.precedent.length > 0 ? (
            <PrecedentList precedent={verdict.precedent} />
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      {isConfirmedByAi ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-600"
          data-testid={FINDING_CONFIRMED_BY_AI_TEST_ID}
        >
          <AiMark />
          <span className="min-w-0">
            {translator.translateText(FindingVerdictCopy.confirmedByAi)}
          </span>
          <Link
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.DATA_SECURITY_AI] as Route,
            )}
          >
            {translator.translateText(FindingVerdictCopy.undoInAiPage)}
          </Link>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * A finding's line across its row, or null when it has nothing to say:
 * what the list hands the shared table (getRowNote).
 */
export function getFindingRowNote(
  finding: DataStoreFinding,
): ReactElement | null {
  const hasSuggestion: boolean =
    Boolean(finding.isAiSuggested) && !finding.isSuppressed;
  const hasVerdict: boolean = getShownVerdict(finding) !== null;
  const isConfirmedByAi: boolean =
    Boolean(finding.isConfirmedByAi) &&
    Boolean(finding.isConfirmed) &&
    !finding.isSuppressed;

  if (!hasSuggestion && !hasVerdict && !isConfirmedByAi) {
    return null;
  }

  return <FindingRowNote finding={finding} />;
}

export default FindingRowNote;
