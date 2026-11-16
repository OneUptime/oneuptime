import SetupHealthApi from "./SetupHealthApi";
import {
  DISMISS_CLASS_NAME,
  FindingFix,
  FindingIcon,
  FindingSentence,
  SetupHealthDismissModal,
} from "./SetupHealthFindingParts";
import {
  DISMISSED_ICON_BOX,
  LEVEL_LOOK,
  RECORD_ICONS,
  SetupHealthLevelLook,
  getSetupHealthFindingIcon,
} from "./SetupHealthLook";
import SetupHealthQuickFixButton from "./SetupHealthQuickFixButton";
import SetupHealthSummary from "./SetupHealthSummary";
import {
  FINDINGS_SHOWN_PER_CHECK,
  LEVEL_WORDS,
  RELATED_RECORDS_MORE,
  RELATED_RECORDS_SHOWN,
  SETUP_HEALTH_AFFECTS,
  SETUP_HEALTH_WORDS_PAGE,
  getSetupHealthRecordRoute,
  getSetupHealthSentence,
  groupSetupHealthFindings,
} from "./SetupHealthWords";
import Route from "Common/Types/API/Route";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DismissedSetupHealthFinding,
  SETUP_HEALTH_LEVEL_ORDER,
  SetupHealthAnswer,
  SetupHealthFinding,
  SetupHealthLevel,
  SetupHealthRecord,
} from "Common/Types/SetupHealth/SetupHealth";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Card from "Common/UI/Components/Card/Card";
import ErrorSentence, {
  ErrorInSentence,
} from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import { getLineDirection } from "Common/UI/Utils/LineDirection";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * SETUP HEALTH (#6812, #8135): what is misconfigured in the project, worst
 * first. The page opens with the verdict (SetupHealthSummary): how badly,
 * in one line. Each level is a card; each finding a row with the icon of
 * what it is about, one sentence with the project's names in bold, the
 * records it reaches, and right under the sentence the button that opens
 * its fix - never at the far end of a wide row. Two findings can be fixed
 * from their row in one click, after a dialog that says what will change
 * (#7299, SetupHealthQuickFixButton). A finding the team leaves as it is on
 * purpose is dismissed, with a reason, for everyone; Dismissed, folded at
 * the end, brings it back. A finding is drawn by SetupHealthFindingParts,
 * as the line at the top of its record's page draws it (#7297).
 *
 * One request (SetupHealthApi), answered from a minute-old answer on the
 * server; Recheck, and a fix made here, work it out again.
 */

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; answer: SetupHealthAnswer };

/*
 * A card's list runs to the card's edges and down to its bottom edge, as
 * Home's lists do (HOME_ROW_CARD_BODY_CLASS_NAME), under the card's usual
 * gap below its header.
 */
const LIST_BODY_CLASS_NAME: string = "mt-4 -mx-5 -mb-6 md:-mx-6";

// A row: its icon, then what it says, with the card's padding at each end.
const ROW_CLASS_NAME: string = "flex items-start gap-3 px-5 py-4 md:px-6";

// The words of a row start after its icon: the card's padding, 2rem, 0.75rem.
const UNDER_THE_WORDS_CLASS_NAME: string = "ps-16 pe-5 md:ps-[4.25rem] md:pe-6";

const LINK_BASE_CLASS_NAME: string =
  "text-sm font-medium text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded";

const LINK_HOVER_CLASS_NAME: string = "hover:underline";

const LINK_CLASS_NAME: string = `${LINK_BASE_CLASS_NAME} ${LINK_HOVER_CLASS_NAME}`;

// A record a finding reaches: a chip with its kind's icon and its name.
const RELATED_CHIP_CLASS_NAME: string =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200";

const RELATED_LINK_CLASS_NAME: string = `${RELATED_CHIP_CLASS_NAME} transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;

/*
 * A link drawn as a button that works for a while (Restore): busy then, it
 * keeps its look without its hover, as a busy Button does
 * (getHandDrawnButtonStateClassName); its hover otherwise.
 */
function getBusyLinkClassName(isBusy: boolean): string {
  return `${LINK_BASE_CLASS_NAME} ${getHandDrawnButtonStateClassName({
    isBusy: isBusy,
    hoverClassName: LINK_HOVER_CLASS_NAME,
  })}`.trim();
}

// Where the page was opened from, for setup_health/opened.
function getSource(): string {
  return Navigation.getQueryStringByName("from") || "direct";
}

// The records a finding reaches, each a chip that opens it.
const RelatedRecords: FunctionComponent<{
  records: Array<SetupHealthRecord>;
}> = (props: { records: Array<SetupHealthRecord> }): ReactElement => {
  const translator: Translator = useTranslator();
  const named: Array<SetupHealthRecord> = props.records.filter(
    (record: SetupHealthRecord): boolean => {
      return Boolean(record.name);
    },
  );

  if (named.length === 0) {
    return <></>;
  }

  const shown: Array<SetupHealthRecord> = named.slice(0, RELATED_RECORDS_SHOWN);
  const hidden: number = named.length - shown.length;

  return (
    <div
      className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5"
      data-testid="setup-health-related"
    >
      <span className="me-0.5 text-xs text-gray-500">
        {translator.translateText(SETUP_HEALTH_AFFECTS)}
      </span>
      {shown.map((record: SetupHealthRecord): ReactElement => {
        const route: Route | null = getSetupHealthRecordRoute(record);
        const content: ReactElement = (
          <>
            <Icon
              icon={RECORD_ICONS[record.kind]}
              className="h-3 w-3 flex-none text-gray-400"
            />
            <span
              className="truncate"
              dir={getLineDirection(record.name, translator.language)}
            >
              {record.name}
            </span>
          </>
        );

        return route ? (
          <Link
            key={`${record.kind}-${record.id}`}
            to={route}
            className={RELATED_LINK_CLASS_NAME}
            dataTestId="setup-health-related-record"
          >
            {content}
          </Link>
        ) : (
          <span
            key={`${record.kind}-${record.id}`}
            className={RELATED_CHIP_CLASS_NAME}
            data-testid="setup-health-related-record"
          >
            {content}
          </span>
        );
      })}
      {hidden > 0 ? (
        <span
          className="text-xs text-gray-500"
          data-testid="setup-health-related-more"
        >
          {translator.translatePlural(RELATED_RECORDS_MORE, hidden)}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

// One finding: what it is about, what is wrong, what it reaches, and the fix.
const FindingRow: FunctionComponent<{
  finding: SetupHealthFinding;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
  onFixed: () => void;
}> = (props: {
  finding: SetupHealthFinding;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
  onFixed: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const look: SetupHealthLevelLook = LEVEL_LOOK[props.finding.level];

  return (
    <li
      className={ROW_CLASS_NAME}
      data-testid="setup-health-finding"
      data-check={props.finding.check}
      data-level={props.finding.level}
      data-key={props.finding.key}
    >
      <FindingIcon
        icon={getSetupHealthFindingIcon(props.finding)}
        colors={look.iconBox}
      />
      {/* The first line of words level with the middle of the icon. */}
      <div className="min-w-0 flex-1 pt-1">
        <p
          className="text-sm leading-6 text-gray-800"
          data-testid="setup-health-sentence"
        >
          <FindingSentence finding={props.finding} />
        </p>
        <RelatedRecords records={props.finding.related} />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SetupHealthQuickFixButton
            finding={props.finding}
            onApplied={props.onFixed}
          />
          <FindingFix finding={props.finding} />
          {props.canDismiss ? (
            <button
              type="button"
              className={DISMISS_CLASS_NAME}
              data-testid="setup-health-dismiss"
              onClick={() => {
                props.onDismiss(props.finding);
              }}
            >
              {translator.translateText(SETUP_HEALTH_WORDS_PAGE.dismiss)}
            </button>
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

// One check's findings: the first few, and the rest a click away.
const FindingGroup: FunctionComponent<{
  groupKey: string;
  findings: Array<SetupHealthFinding>;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
  onFixed: () => void;
}> = (props: {
  groupKey: string;
  findings: Array<SetupHealthFinding>;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
  onFixed: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const hidden: number = Math.max(
    0,
    props.findings.length - FINDINGS_SHOWN_PER_CHECK,
  );
  const shown: Array<SetupHealthFinding> = isOpen
    ? props.findings
    : props.findings.slice(0, FINDINGS_SHOWN_PER_CHECK);

  return (
    <li data-testid="setup-health-group" data-group={props.groupKey}>
      <ul className="divide-y divide-gray-100">
        {shown.map((finding: SetupHealthFinding): ReactElement => {
          return (
            <FindingRow
              key={finding.key}
              finding={finding}
              canDismiss={props.canDismiss}
              onDismiss={props.onDismiss}
              onFixed={props.onFixed}
            />
          );
        })}
      </ul>
      {hidden > 0 ? (
        <div className={`pb-4 ${UNDER_THE_WORDS_CLASS_NAME}`}>
          <button
            type="button"
            className={LINK_CLASS_NAME}
            aria-expanded={isOpen}
            data-testid="setup-health-group-toggle"
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            {isOpen
              ? translator.translateText(SETUP_HEALTH_WORDS_PAGE.showFewer)
              : translator.translatePlural(
                  SETUP_HEALTH_WORDS_PAGE.showMore,
                  hidden,
                )}
          </button>
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

// One dismissed finding: what it said, who hid it and why, and Restore.
const DismissedRow: FunctionComponent<{
  item: DismissedSetupHealthFinding;
  canRestore: boolean;
  isRestoring: boolean;
  onRestore: (item: DismissedSetupHealthFinding) => void;
}> = (props: {
  item: DismissedSetupHealthFinding;
  canRestore: boolean;
  isRestoring: boolean;
  onRestore: (item: DismissedSetupHealthFinding) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const name: string =
    props.item.dismissal.dismissedByName ||
    translator.translateText(SETUP_HEALTH_WORDS_PAGE.someone) ||
    SETUP_HEALTH_WORDS_PAGE.someone;

  return (
    <li
      className={ROW_CLASS_NAME}
      data-testid="setup-health-dismissed-finding"
      data-check={props.item.finding.check}
    >
      <FindingIcon
        icon={getSetupHealthFindingIcon(props.item.finding)}
        colors={DISMISSED_ICON_BOX}
      />
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm leading-6 text-gray-600">
          {getSetupHealthSentence(props.item.finding, translator)}
        </p>
        <p
          className="mt-0.5 text-xs text-gray-500"
          data-testid="setup-health-dismissed-by"
        >
          {props.item.dismissal.reason
            ? translator.translateTemplate(
                SETUP_HEALTH_WORDS_PAGE.dismissedByWithReason,
                { name: name, reason: props.item.dismissal.reason },
                { setsValuesApart: true },
              )
            : translator.translateTemplate(
                SETUP_HEALTH_WORDS_PAGE.dismissedBy,
                { name: name },
                { setsValuesApart: true },
              )}
        </p>
        {props.canRestore ? (
          <div className="mt-2">
            <button
              type="button"
              className={getBusyLinkClassName(Boolean(props.isRestoring))}
              disabled={props.isRestoring}
              data-testid="setup-health-restore"
              onClick={() => {
                props.onRestore(props.item);
              }}
            >
              {translator.translateText(SETUP_HEALTH_WORDS_PAGE.restore)}
            </button>
          </div>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

const SetupHealthView: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isRechecking, setIsRechecking] = useState<boolean>(false);
  const [dismissTarget, setDismissTarget] = useState<SetupHealthFinding | null>(
    null,
  );
  const [restoringKey, setRestoringKey] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [isDismissedOpen, setIsDismissedOpen] = useState<boolean>(false);
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);
  const hasSentOpened: React.MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * Whether the person may hide a finding for everyone, and bring one
   * back: as the dismissals' table allows. Not offered while the
   * permission snapshot loads.
   */
  const canDismiss: boolean = PermissionGate.check(
    new RecommendationDismissal(),
    ModelAction.Create,
  ).isAllowed;
  const canRestore: boolean = PermissionGate.check(
    new RecommendationDismissal(),
    ModelAction.Delete,
  ).isAllowed;

  const load: (refresh: boolean) => Promise<void> = useCallback(
    async (refresh: boolean): Promise<void> => {
      const request: number = ++requestRef.current;

      try {
        const answer: SetupHealthAnswer = await SetupHealthApi.getAnswer({
          refresh: refresh,
        });

        if (request !== requestRef.current) {
          return;
        }

        setState({ status: "loaded", answer: answer });

        if (!hasSentOpened.current) {
          hasSentOpened.current = true;
          ProductEvents.send(ProductEventName.SetupHealthOpened, {
            source: getSource(),
            pages_will_not_arrive_count: answer.counts.pagesWillNotArrive,
            worth_fixing_count: answer.counts.worthFixing,
            suggestion_count: answer.counts.suggestion,
            dismissed_count: answer.dismissed.length,
          });
        }
      } catch (err) {
        if (request === requestRef.current) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const recheck: () => Promise<void> = async (): Promise<void> => {
    setIsRechecking(true);
    await load(true);
    setIsRechecking(false);
  };

  // After a failed read: read again, saying so while it does.
  const tryAgain: () => Promise<void> = async (): Promise<void> => {
    setState({ status: "loading" });
    await load(false);
  };

  /*
   * A fix made from a row (#7299): the findings are worked out again now,
   * not read from the minute-old answer, so the one just fixed is gone.
   */
  const afterFix: () => Promise<void> = async (): Promise<void> => {
    setIsRechecking(true);
    await load(true);
    setIsRechecking(false);
  };

  const restore: (item: DismissedSetupHealthFinding) => Promise<void> = async (
    item: DismissedSetupHealthFinding,
  ): Promise<void> => {
    setRestoringKey(item.finding.key);
    setActionError("");

    try {
      await SetupHealthApi.restore(item.dismissal.id);

      ProductEvents.send(ProductEventName.SetupHealthFindingRestored, {
        check: item.finding.check,
      });

      await load(false);
    } catch (err) {
      setActionError(API.getFriendlyMessage(err as Error));
    }

    setRestoringKey("");
  };

  const getLevelCard: (
    level: SetupHealthLevel,
    findings: Array<SetupHealthFinding>,
  ) => ReactElement = (
    level: SetupHealthLevel,
    findings: Array<SetupHealthFinding>,
  ): ReactElement => {
    return (
      <div key={level} data-testid={`setup-health-level-${level}`}>
        <Card
          title={LEVEL_WORDS[level].title}
          description={LEVEL_WORDS[level].description}
          rightElement={
            <span
              data-testid={`setup-health-level-${level}-count`}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${LEVEL_LOOK[level].countClassName}`}
            >
              {translator.formatNumber(findings.length)}
            </span>
          }
          bodyClassName={LIST_BODY_CLASS_NAME}
        >
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {groupSetupHealthFindings(findings).map(
              (group: {
                key: string;
                findings: Array<SetupHealthFinding>;
              }): ReactElement => {
                return (
                  <FindingGroup
                    key={group.key}
                    groupKey={group.key}
                    findings={group.findings}
                    canDismiss={canDismiss}
                    onDismiss={(finding: SetupHealthFinding) => {
                      setDismissTarget(finding);
                    }}
                    onFixed={() => {
                      void afterFix();
                    }}
                  />
                );
              },
            )}
          </ul>
        </Card>
      </div>
    );
  };

  const getDismissedCard: (answer: SetupHealthAnswer) => ReactElement = (
    answer: SetupHealthAnswer,
  ): ReactElement => {
    if (answer.dismissed.length === 0) {
      return <></>;
    }

    return (
      <div data-testid="setup-health-dismissed">
        <Card
          title={SETUP_HEALTH_WORDS_PAGE.dismissed}
          description={SETUP_HEALTH_WORDS_PAGE.dismissedDescription}
          rightElement={
            <button
              type="button"
              className={LINK_CLASS_NAME}
              aria-expanded={isDismissedOpen}
              data-testid="setup-health-dismissed-toggle"
              onClick={() => {
                setIsDismissedOpen(!isDismissedOpen);
              }}
            >
              {isDismissedOpen
                ? translator.translateText("Hide")
                : translator.translatePlural(
                    { one: "Show {{count}}", other: "Show {{count}}" },
                    answer.dismissed.length,
                  )}
            </button>
          }
          bodyClassName={LIST_BODY_CLASS_NAME}
        >
          {isDismissedOpen ? (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {answer.dismissed.map(
                (item: DismissedSetupHealthFinding): ReactElement => {
                  return (
                    <DismissedRow
                      key={item.finding.key}
                      item={item}
                      canRestore={canRestore}
                      isRestoring={restoringKey === item.finding.key}
                      onRestore={(
                        target: DismissedSetupHealthFinding,
                      ): void => {
                        void restore(target);
                      }}
                    />
                  );
                },
              )}
            </ul>
          ) : undefined}
        </Card>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (state.status === "loading") {
      return (
        <div
          role="status"
          aria-label={translator.translateText("Checking...")}
          className="space-y-5 animate-pulse"
          data-testid="setup-health-loading"
        >
          <div className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-5 py-5 shadow-sm md:px-6">
            <div className="h-11 w-11 flex-none rounded-full bg-gray-100"></div>
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              <div className="h-5 w-72 max-w-full rounded bg-gray-100"></div>
              <div className="h-4 w-96 max-w-full rounded bg-gray-100"></div>
            </div>
          </div>
          <div className="h-48 rounded-xl border border-gray-200 bg-white shadow-sm"></div>
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <Card>
          <div className="flex flex-col items-start gap-3">
            <p
              className="text-sm text-gray-600"
              role="alert"
              data-testid="setup-health-error"
            >
              <ErrorSentence
                template={SETUP_HEALTH_WORDS_PAGE.couldNotLoad}
                error={state.message}
              />
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              data-testid="setup-health-try-again"
              onClick={() => {
                void tryAgain();
              }}
            >
              <Icon icon={IconProp.Refresh} className="h-4 w-4 flex-none" />
              {translator.translateText("Try again")}
            </button>
          </div>
        </Card>
      );
    }

    const answer: SetupHealthAnswer = state.answer;

    return (
      <div className="space-y-5">
        <SetupHealthSummary
          answer={answer}
          isRechecking={isRechecking}
          onRecheck={() => {
            void recheck();
          }}
        />

        {actionError ? (
          <p className="text-sm text-red-700" role="alert">
            <ErrorInSentence message={actionError} showWhereToLook={true} />
          </p>
        ) : (
          <></>
        )}

        {SETUP_HEALTH_LEVEL_ORDER.map(
          (level: SetupHealthLevel): ReactElement => {
            const findings: Array<SetupHealthFinding> = answer.findings.filter(
              (finding: SetupHealthFinding): boolean => {
                return finding.level === level;
              },
            );

            if (findings.length === 0) {
              return <React.Fragment key={level}></React.Fragment>;
            }

            return getLevelCard(level, findings);
          },
        )}

        {getDismissedCard(answer)}
      </div>
    );
  };

  return (
    <div data-testid="setup-health">
      {getBody()}

      {dismissTarget ? (
        <SetupHealthDismissModal
          finding={dismissTarget}
          onClose={() => {
            setDismissTarget(null);
          }}
          onDismissed={() => {
            setDismissTarget(null);
            void load(false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SetupHealthView;
