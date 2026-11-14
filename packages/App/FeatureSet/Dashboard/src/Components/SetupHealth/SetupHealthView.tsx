import RelativeTime from "../EpisodeView/RelativeTime";
import { getAdminServerSetupUrl } from "../../Utils/ServerEmail";
import SetupHealthApi from "./SetupHealthApi";
import {
  FINDINGS_SHOWN_PER_CHECK,
  LEVEL_WORDS,
  SERVER_FIX_WORDS,
  SETUP_HEALTH_WORDS_PAGE,
  SetupHealthFixLink,
  getSetupHealthFixLink,
  getSetupHealthSentence,
  groupSetupHealthFindings,
} from "./SetupHealthWords";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DismissedSetupHealthFinding,
  SETUP_HEALTH_LEVEL_ORDER,
  SetupHealthAnswer,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
} from "Common/Types/SetupHealth/SetupHealth";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Card from "Common/UI/Components/Card/Card";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
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
 * SETUP HEALTH (#6812): one list of what is misconfigured in the project,
 * worst first, each finding in one sentence with the button that opens its
 * fix. A finding the team leaves as it is on purpose is dismissed, with a
 * reason, for everyone; Dismissed, folded at the end, brings it back.
 *
 * One request (SetupHealthApi), answered from a minute-old answer on the
 * server; Recheck works it out again.
 */

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; answer: SetupHealthAnswer };

// Each level's look: its icon and colours.
const LEVEL_STYLE: Readonly<
  Record<SetupHealthLevel, { icon: IconProp; iconClassName: string }>
> = {
  [SetupHealthLevel.PagesWillNotArrive]: {
    icon: IconProp.Alert,
    iconClassName: "text-red-600",
  },
  [SetupHealthLevel.WorthFixing]: {
    icon: IconProp.Alert,
    iconClassName: "text-amber-600",
  },
  [SetupHealthLevel.Suggestion]: {
    icon: IconProp.Info,
    iconClassName: "text-gray-500",
  },
};

/*
 * A card's list runs to the card's edges and down to its bottom edge, as
 * Home's lists do (HOME_ROW_CARD_BODY_CLASS_NAME), under the card's usual
 * gap below its header.
 */
const LIST_BODY_CLASS_NAME: string = "mt-4 -mx-5 -mb-6 md:-mx-6";

const LINK_BASE_CLASS_NAME: string =
  "text-sm font-medium text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded";

const LINK_HOVER_CLASS_NAME: string = "hover:underline";

const LINK_CLASS_NAME: string = `${LINK_BASE_CLASS_NAME} ${LINK_HOVER_CLASS_NAME}`;

/*
 * A link drawn as a button that works for a while (Recheck, Restore): busy
 * then, it keeps its look without its hover, as a busy Button does
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

// The fix of one finding: its page, or for the server, its admin.
const FindingFix: FunctionComponent<{
  finding: SetupHealthFinding;
}> = (props: { finding: SetupHealthFinding }): ReactElement => {
  const translator: Translator = useTranslator();
  const finding: SetupHealthFinding = props.finding;

  const onOpen: () => void = (): void => {
    ProductEvents.send(ProductEventName.SetupHealthFixOpened, {
      check: finding.check,
      level: finding.level,
    });
  };

  if (finding.fix === SetupHealthFix.ServerSettings) {
    if (!User.isMasterAdmin()) {
      return (
        <span
          className="text-sm text-gray-600"
          data-testid="setup-health-ask-admin"
        >
          {translator.translateText(SETUP_HEALTH_WORDS_PAGE.askServerAdmin)}
        </span>
      );
    }

    return (
      <Link
        to={getAdminServerSetupUrl()}
        openInNewTab={true}
        onClick={onOpen}
        className={LINK_CLASS_NAME}
        dataTestId="setup-health-fix"
      >
        {translator.translateText(SERVER_FIX_WORDS)}
      </Link>
    );
  }

  const fix: SetupHealthFixLink | null = getSetupHealthFixLink({
    finding: finding,
    translator: translator,
  });

  if (!fix) {
    return <></>;
  }

  return (
    <Link
      to={fix.route}
      onClick={onOpen}
      className={LINK_CLASS_NAME}
      dataTestId="setup-health-fix"
    >
      {fix.text}
    </Link>
  );
};

// One finding: what is wrong, and what to do.
const FindingRow: FunctionComponent<{
  finding: SetupHealthFinding;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
}> = (props: {
  finding: SetupHealthFinding;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const style: { icon: IconProp; iconClassName: string } =
    LEVEL_STYLE[props.finding.level];

  return (
    <li
      className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-start md:justify-between md:gap-6 md:px-6"
      data-testid="setup-health-finding"
      data-check={props.finding.check}
      data-level={props.finding.level}
      data-key={props.finding.key}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          icon={style.icon}
          className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClassName}`}
        />
        <p
          className="min-w-0 text-sm text-gray-900"
          data-testid="setup-health-sentence"
        >
          {getSetupHealthSentence(props.finding, translator)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 ps-7 md:ps-0">
        <FindingFix finding={props.finding} />
        {props.canDismiss ? (
          <button
            type="button"
            className="text-sm text-gray-600 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
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
    </li>
  );
};

// One check's findings: the first few, and the rest a click away.
const FindingGroup: FunctionComponent<{
  groupKey: string;
  findings: Array<SetupHealthFinding>;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
}> = (props: {
  groupKey: string;
  findings: Array<SetupHealthFinding>;
  canDismiss: boolean;
  onDismiss: (finding: SetupHealthFinding) => void;
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
            />
          );
        })}
      </ul>
      {hidden > 0 ? (
        <div className="pb-3 pe-5 ps-12 md:pe-6 md:ps-[3.25rem]">
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
      className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-start md:justify-between md:gap-6 md:px-6"
      data-testid="setup-health-dismissed-finding"
      data-check={props.item.finding.check}
    >
      <div className="min-w-0">
        <p className="text-sm text-gray-700">
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
      </div>
      {props.canRestore ? (
        <div className="shrink-0">
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
  const [reason, setReason] = useState<string>("");
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [dismissError, setDismissError] = useState<string>("");
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

  const confirmDismiss: () => Promise<void> = async (): Promise<void> => {
    if (!dismissTarget) {
      return;
    }

    setIsDismissing(true);
    setDismissError("");

    try {
      await SetupHealthApi.dismiss({ finding: dismissTarget, reason: reason });

      ProductEvents.send(ProductEventName.SetupHealthFindingDismissed, {
        check: dismissTarget.check,
        has_reason: reason.trim().length > 0,
      });

      setDismissTarget(null);
      setReason("");
      await load(false);
    } catch (err) {
      setDismissError(API.getFriendlyMessage(err as Error));
    }

    setIsDismissing(false);
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

  const getHeader: () => ReactElement = (): ReactElement => {
    return (
      <Card
        title={SETUP_HEALTH_WORDS_PAGE.title}
        description={SETUP_HEALTH_WORDS_PAGE.description}
        rightElement={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {state.status === "loaded" ? (
              <span data-testid="setup-health-checked">
                <TranslatedSentence
                  template="Checked {{time}}"
                  slots={{
                    time: (
                      <RelativeTime
                        date={OneUptimeDate.fromString(state.answer.checkedAt)}
                      />
                    ),
                  }}
                />
              </span>
            ) : (
              <></>
            )}
            <button
              type="button"
              className={getBusyLinkClassName(
                isRechecking || state.status === "loading",
              )}
              disabled={isRechecking || state.status === "loading"}
              data-testid="setup-health-recheck"
              onClick={() => {
                void recheck();
              }}
            >
              {isRechecking
                ? translator.translateText("Checking...")
                : translator.translateText("Recheck")}
            </button>
          </div>
        }
      />
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (state.status === "loading") {
      return (
        <div
          role="status"
          aria-label={translator.translateText("Checking...")}
          className="space-y-3 animate-pulse"
          data-testid="setup-health-loading"
        >
          <div className="h-24 rounded-lg bg-gray-100"></div>
          <div className="h-24 rounded-lg bg-gray-100"></div>
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <Card>
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
        </Card>
      );
    }

    const answer: SetupHealthAnswer = state.answer;

    return (
      <div className="space-y-5">
        {actionError ? (
          <p className="text-sm text-red-700" role="alert">
            {actionError}
          </p>
        ) : (
          <></>
        )}

        {answer.findings.length === 0 ? (
          <Card>
            <div data-testid="setup-health-nothing-to-fix">
              <TableEmptyState
                kind={TableEmptyStateKind.AllClear}
                title={SETUP_HEALTH_WORDS_PAGE.nothingToFix}
                description={SETUP_HEALTH_WORDS_PAGE.nothingToFixDescription}
                isCompact={true}
              />
            </div>
          </Card>
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

            return (
              <div key={level} data-testid={`setup-health-level-${level}`}>
                <Card
                  title={LEVEL_WORDS[level].title}
                  description={LEVEL_WORDS[level].description}
                  rightElement={
                    <span
                      data-testid={`setup-health-level-${level}-count`}
                      className="rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-gray-700 ring-1 ring-inset ring-gray-200"
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
                              setDismissError("");
                              setReason("");
                              setDismissTarget(finding);
                            }}
                          />
                        );
                      },
                    )}
                  </ul>
                </Card>
              </div>
            );
          },
        )}

        {answer.dismissed.length > 0 ? (
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
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5" data-testid="setup-health">
      {getHeader()}
      {getBody()}

      {dismissTarget ? (
        <ConfirmModal
          title={SETUP_HEALTH_WORDS_PAGE.dismissTitle}
          description={
            <div className="space-y-2">
              <p className="text-sm text-gray-900">
                {getSetupHealthSentence(dismissTarget, translator)}
              </p>
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  SETUP_HEALTH_WORDS_PAGE.dismissDescription,
                )}
              </p>
            </div>
          }
          submitButtonText={SETUP_HEALTH_WORDS_PAGE.dismiss}
          isLoading={isDismissing}
          error={dismissError || undefined}
          onSubmit={() => {
            void confirmDismiss();
          }}
          onClose={() => {
            if (!isDismissing) {
              setDismissTarget(null);
              setReason("");
              setDismissError("");
            }
          }}
        >
          <div className="mt-3 space-y-1">
            <label
              id="setup-health-dismiss-reason-label"
              htmlFor="setup-health-dismiss-reason"
              className="block text-sm font-medium text-gray-700"
            >
              {translator.translateText(
                SETUP_HEALTH_WORDS_PAGE.dismissReasonLabel,
              )}{" "}
              <span className="font-normal text-gray-500">
                {translator.translateText("(Optional)")}
              </span>
            </label>
            <TextArea
              id="setup-health-dismiss-reason"
              value={reason}
              placeholder={SETUP_HEALTH_WORDS_PAGE.dismissPlaceholder}
              ariaLabelledby="setup-health-dismiss-reason-label"
              dataTestId="setup-health-dismiss-reason"
              autoGrow={true}
              rows={2}
              onChange={(value: string) => {
                setReason(value);
              }}
            />
          </div>
        </ConfirmModal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SetupHealthView;
