import {
  OPENS_CHAIN_LINES,
  getWhoIsToldSeverityValue,
} from "../Monitor/Overview/WhoIsToldWords";
import OnCallTestPageApi from "./OnCallTestPageApi";
import {
  FIRE_DRILL_CANT_TEST,
  FIRE_DRILL_DECLARED_AFTER,
  FIRE_DRILL_DECLARED_AFTER_HIDDEN_RULE,
  FIRE_DRILL_WORDS,
  WALK_EVERY_LEVEL,
} from "./OnCallTestPageWords";
import {
  PreviewLevel,
  WalkPreview,
  describeTestPageCost,
  doesTestPageAnybody,
} from "./SendTestPageModal";
import TestPageResult from "./TestPageResult";
import {
  OnCallFireDrillDeclaration,
  OnCallFireDrillEvent,
  OnCallFireDrillPolicy,
  OnCallFireDrillPreview,
  OnCallFireDrillRun,
} from "Common/Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
  OnCallTestPageRecordKind,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FOLDED_SECTION_ON } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  getInlineSeparator,
  TemplateValue,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A MONITOR'S FIRE DRILL (#7012, Common/Types/OnCallDutyPolicy/
 * OnCallFireDrill): rehearse one of its failures as a test.
 *
 * Before anything is sent the dialog says, plainly, that it is a test -
 * every message says TEST, no incident or alert is created, nothing public
 * is told - which policies the failure pages, and who each one's first
 * level pages now, and how, with what it costs. It can't start while a
 * policy of it is one the reader may not test, or while nobody it pages can
 * receive anything; one line says why. Started, it shows each policy's test
 * as it happens, as Test this policy does.
 *
 * Folded under More fields, Walk every escalation level (#9385) has each
 * policy's test page its levels in turn, as a walked test of the policy
 * does: the list then shows every level each one reaches, and the cost
 * what the walk sends at most. A failure may be the incident an alert
 * incident rule declares from an alert (#9397); the dialog says so, and
 * after how long.
 */

export interface ComponentProps {
  monitorId: string;
  onClose: () => void;
  // Told once the drill is started, with each policy's test.
  onStarted?: ((runs: Array<OnCallFireDrillRun>) => void) | undefined;
}

/*
 * A failure, as the picker offers it: "Offline · An incident (Critical)",
 * or for the incident an alert incident rule declares from an alert of the
 * criteria, "Slow · An incident (Critical) declared from its alert" (#9397).
 */
export function getFireDrillFailureLabel(
  translator: Translator,
  event: Pick<
    OnCallFireDrillEvent,
    "criteriaName" | "recordKind" | "severityName"
  > & {
    declaredBy?: Pick<OnCallFireDrillDeclaration, "waitInMinutes"> | undefined;
  },
): string {
  const severity: TemplateValue = getWhoIsToldSeverityValue({
    kind: event.recordKind,
    severityName: event.severityName,
  });

  let opens: string;

  if (event.declaredBy) {
    opens = translator.translateTemplate(FIRE_DRILL_WORDS.declaredIncident, {
      severity: severity,
    });
  } else {
    opens = translator.translateTemplate(
      event.recordKind === OnCallTestPageRecordKind.Alert
        ? OPENS_CHAIN_LINES.alert
        : OPENS_CHAIN_LINES.incident,
      { severity: severity },
    );
  }

  return event.criteriaName
    ? `${event.criteriaName}${getInlineSeparator(translator.language)}${opens}`
    : opens;
}

/*
 * Which alert incident rule declares the incident, and after how long
 * (#9397): by its name, or as one the reader can't see. A drill tests the
 * incident's policies at once, without the wait.
 */
export function getFireDrillDeclaredSentence(
  translator: Translator,
  declaredBy: OnCallFireDrillDeclaration,
): string {
  const isRuleHidden: boolean = !declaredBy.ruleName;
  const rule: { rule?: string } = isRuleHidden
    ? {}
    : { rule: declaredBy.ruleName };

  if (declaredBy.waitInMinutes > 0) {
    return translator.translatePlural(
      isRuleHidden
        ? FIRE_DRILL_DECLARED_AFTER_HIDDEN_RULE
        : FIRE_DRILL_DECLARED_AFTER,
      declaredBy.waitInMinutes,
      rule,
      { setsValuesApart: true },
    );
  }

  return translator.translateTemplate(
    isRuleHidden
      ? FIRE_DRILL_WORDS.declaredNowHiddenRule
      : FIRE_DRILL_WORDS.declaredNow,
    rule,
    { setsValuesApart: true },
  );
}

// A policy's name, or what it is called while the reader may not see it.
export function getFireDrillPolicyName(
  translator: Translator,
  policy: Pick<OnCallFireDrillPolicy, "policyName">,
): string {
  return (
    policy.policyName ||
    translator.translateText(FIRE_DRILL_WORDS.policyYouCantSee) ||
    ""
  );
}

/*
 * Whether "Walk every escalation level" is offered (#9385): for a drill
 * with a policy the reader may test that has a level after its first - or
 * whose server does not say how many it has. Nothing is offered before the
 * preview is read.
 */
export function isFireDrillWalkOffered(
  preview: OnCallFireDrillPreview | null,
): boolean {
  if (!preview) {
    return false;
  }

  return preview.policies.some((policy: OnCallFireDrillPolicy): boolean => {
    return Boolean(
      policy.mayTest &&
        policy.preview &&
        !(
          typeof policy.preview.levelCount === "number" &&
          policy.preview.levelCount <= 1
        ),
    );
  });
}

/*
 * WHY THE DRILL CAN'T START:
 *
 *   cantTest              a policy of it the reader may not test: it tests
 *                         every policy, or none (`count` of them).
 *   walkReachesLaterLevel nobody on any policy's first level can receive a
 *                         test now, the walk is offered and off, and a
 *                         later level of one reaches somebody: walk every
 *                         level (one click), as a policy's own test offers
 *                         it (#7259, #9385).
 *   reachesNobody         nobody any of its policies pages can receive a
 *                         test now - on its first levels, or on every level
 *                         the walk reaches: it would send nothing (#7529's
 *                         rule, for each policy).
 */
export type FireDrillBlocker =
  | { kind: "cantTest"; count: number }
  | { kind: "walkReachesLaterLevel" }
  | { kind: "reachesNobody" };

export function getFireDrillBlocker(
  preview: OnCallFireDrillPreview | null,
  options?:
    | {
        isWalking?: boolean | undefined;
        offersWalk?: boolean | undefined;
      }
    | undefined,
): FireDrillBlocker | null {
  if (!preview) {
    return null;
  }

  const cantTest: number = preview.policies.filter(
    (policy: OnCallFireDrillPolicy): boolean => {
      return !policy.mayTest;
    },
  ).length;

  if (cantTest > 0) {
    return { kind: "cantTest", count: cantTest };
  }

  // Whether a policy of it reaches anybody: its first level, or its walk.
  const reachesAnybody: (isWalking: boolean) => boolean = (
    isWalking: boolean,
  ): boolean => {
    return preview.policies.some((policy: OnCallFireDrillPolicy): boolean => {
      return Boolean(
        policy.preview && doesTestPageAnybody(policy.preview, isWalking),
      );
    });
  };

  const isWalking: boolean = Boolean(options?.isWalking);

  if (reachesAnybody(isWalking)) {
    return null;
  }

  if (!isWalking && options?.offersWalk && reachesAnybody(true)) {
    return { kind: "walkReachesLaterLevel" };
  }

  return { kind: "reachesNobody" };
}

// The line that says why the drill can't start, in the reader's words.
export function getFireDrillBlockerSentence(
  translator: Translator,
  blocker: FireDrillBlocker,
): string {
  switch (blocker.kind) {
    case "cantTest":
      return translator.translatePlural(FIRE_DRILL_CANT_TEST, blocker.count);
    case "walkReachesLaterLevel":
      return translator.translateTemplate(
        FIRE_DRILL_WORDS.firstLevelsReachNobody,
      );
    case "reachesNobody":
      return translator.translateTemplate(FIRE_DRILL_WORDS.reachesNobody);
  }
}

/*
 * One policy the drill pages: its name, and who its first level pages now
 * - or, walking every level, each level its walk reaches (#9385).
 */
const FireDrillPolicyBlock: FunctionComponent<{
  policy: OnCallFireDrillPolicy;
  isWalking: boolean;
}> = (props: {
  policy: OnCallFireDrillPolicy;
  isWalking: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const policy: OnCallFireDrillPolicy = props.policy;

  const getWho: () => ReactElement = (): ReactElement => {
    if (!policy.mayTest || !policy.preview) {
      return (
        <p
          className="mt-1 text-sm text-amber-700"
          data-testid="fire-drill-policy-cant-test"
        >
          {translator.translateText(FIRE_DRILL_WORDS.cantTestPolicy)}
        </p>
      );
    }

    if (props.isWalking && Array.isArray(policy.preview.walkLevels)) {
      return (
        <div className="mt-2">
          <WalkPreview preview={policy.preview} />
        </div>
      );
    }

    return <PreviewLevel level={policy.preview} showNames={true} />;
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="fire-drill-policy">
      <h4
        className="text-sm font-semibold text-gray-900 break-words"
        data-testid="fire-drill-policy-name"
      >
        {getFireDrillPolicyName(translator, policy)}
      </h4>
      {getWho()}
    </li>
  );
};

const FireDrillModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [eventKey, setEventKey] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<OnCallFireDrillPreview | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [runs, setRuns] = useState<Array<OnCallFireDrillRun>>([]);
  // Walk every escalation level of each policy (#9385): off unless asked for.
  const [walksEscalation, setWalksEscalation] = useState<boolean>(false);

  useEffect(() => {
    let isActive: boolean = true;

    setIsLoading(true);
    setError("");

    OnCallTestPageApi.fireDrillPreview({
      monitorId: props.monitorId,
      eventKey: eventKey,
    })
      .then((next: OnCallFireDrillPreview) => {
        if (isActive) {
          setPreview(next);
        }
      })
      .catch((err: Error) => {
        if (isActive) {
          setPreview(null);
          setError(err?.message || "");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [props.monitorId, eventKey]);

  const title: string = translator.translateText(FIRE_DRILL_WORDS.title) || "";

  // Started: each policy's test, as it happens.
  if (runs.length > 0) {
    return (
      <Modal
        title={title}
        isTitleTranslated={true}
        description={translator.translateTemplate(FIRE_DRILL_WORDS.started, {
          minutes: translator.formatNumber(
            ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
          ),
        })}
        onClose={props.onClose}
        /*
         * One button, Done, drawn plain: closing the dialog does not stop
         * the tests (DialogPrimaryActionGuard).
         */
        closeButtonText="Done"
        closeButtonStyleType={ButtonStyleType.NORMAL}
        modalWidth={ModalWidth.Medium}
      >
        <ul
          className="flex flex-col divide-y divide-gray-100"
          data-testid="fire-drill-results"
        >
          {runs.map((run: OnCallFireDrillRun) => {
            return (
              <li
                key={run.executionLogId}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                data-testid="fire-drill-result"
              >
                <h4 className="text-sm font-semibold text-gray-900 break-words">
                  {getFireDrillPolicyName(translator, run)}
                </h4>
                <TestPageResult executionLogId={run.executionLogId} />
              </li>
            );
          })}
        </ul>
      </Modal>
    );
  }

  const events: Array<OnCallFireDrillEvent> = preview?.events || [];

  const options: Array<DropdownOption> = events.map(
    (event: OnCallFireDrillEvent): DropdownOption => {
      return {
        value: event.key,
        label: getFireDrillFailureLabel(translator, event),
        // Worded already, a criteria's name as written.
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === preview?.eventKey;
    },
  );

  const selectedEvent: OnCallFireDrillEvent | undefined = events.find(
    (event: OnCallFireDrillEvent): boolean => {
      return event.key === preview?.eventKey;
    },
  );

  /*
   * Each policy walks every level only where that is offered (a drill of
   * one-level policies has nothing to walk) and asked for.
   */
  const offersWalk: boolean = isFireDrillWalkOffered(preview);
  const isWalking: boolean = offersWalk && walksEscalation;

  const blocker: FireDrillBlocker | null = isLoading
    ? null
    : getFireDrillBlocker(preview, {
        isWalking: isWalking,
        offersWalk: offersWalk,
      });

  let costSentence: string = "";

  if (preview && !isLoading) {
    costSentence =
      isWalking && preview.walkCost
        ? describeTestPageCost(translator, preview.walkCost, {
            isFireDrill: true,
            isWalk: true,
          })
        : describeTestPageCost(translator, preview.cost, {
            isFireDrill: true,
          });
  }

  const start: () => Promise<void> = async (): Promise<void> => {
    if (!preview) {
      return;
    }

    setIsStarting(true);
    setError("");

    try {
      const started: Array<OnCallFireDrillRun> =
        await OnCallTestPageApi.startFireDrill({
          monitorId: props.monitorId,
          eventKey: preview.eventKey,
          walksEscalation: isWalking,
        });

      setRuns(started);
      props.onStarted?.(started);
    } catch (err) {
      setError((err as Error)?.message || "");
    }

    setIsStarting(false);
  };

  return (
    <Modal
      title={title}
      isTitleTranslated={true}
      description={translator.translateText(FIRE_DRILL_WORDS.description) || ""}
      onClose={props.onClose}
      submitButtonText={translator.translateText(FIRE_DRILL_WORDS.start) || ""}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      onSubmit={() => {
        void start();
      }}
      isLoading={isStarting}
      disableSubmitButton={
        !preview || isLoading || isStarting || Boolean(blocker)
      }
      error={error}
      isBodyLoading={isLoading && !preview}
      modalWidth={ModalWidth.Medium}
    >
      <div className="flex flex-col gap-4" data-testid="fire-drill-dialog">
        {events.length > 0 ? (
          <div className="flex flex-col gap-1">
            {events.length > 1 ? (
              <>
                <label
                  className="text-sm font-medium text-gray-700"
                  htmlFor="fire-drill-failure"
                >
                  {translator.translateText(FIRE_DRILL_WORDS.whatFails)}
                </label>
                <Dropdown
                  inputId="fire-drill-failure"
                  dataTestId="fire-drill-failure"
                  options={options}
                  value={selected}
                  isClearable={false}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (typeof value === "string" && value) {
                      setEventKey(value);
                    }
                  }}
                />
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700">
                  {translator.translateText(FIRE_DRILL_WORDS.whatFails)}
                </p>
                <p
                  className="text-sm text-gray-900 break-words"
                  data-testid="fire-drill-failure-only"
                >
                  {selected?.label || ""}
                </p>
              </>
            )}
            {selectedEvent?.declaredBy ? (
              <p
                className="text-sm text-gray-600 break-words"
                data-testid="fire-drill-declared"
              >
                {getFireDrillDeclaredSentence(
                  translator,
                  selectedEvent.declaredBy,
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {preview ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-gray-700">
              {translator.translateText("Who it pages, and how")}
            </p>
            {isLoading ? (
              <InlineLoadingLine text="Reading what it will send..." />
            ) : (
              <ul
                className="flex flex-col divide-y divide-gray-100"
                data-testid="fire-drill-policies"
              >
                {preview.policies.map((policy: OnCallFireDrillPolicy) => {
                  return (
                    <FireDrillPolicyBlock
                      key={policy.policyId}
                      policy={policy}
                      isWalking={isWalking}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <></>
        )}

        {blocker ? (
          <Alert
            type={AlertType.WARNING}
            dataTestId="fire-drill-blocked"
            title={
              <div className="flex flex-col items-start gap-1.5">
                <p data-testid="fire-drill-blocked-reason">
                  {getFireDrillBlockerSentence(translator, blocker)}
                </p>
                {blocker.kind === "walkReachesLaterLevel" ? (
                  <Button
                    title={WALK_EVERY_LEVEL}
                    buttonStyle={ButtonStyleType.LINK}
                    onClick={() => {
                      setWalksEscalation(true);
                    }}
                    dataTestId="fire-drill-walk-every-level"
                  />
                ) : (
                  <></>
                )}
              </div>
            }
          />
        ) : (
          <></>
        )}

        {costSentence ? (
          <Alert
            type={AlertType.WARNING}
            title={costSentence}
            dataTestId="fire-drill-cost"
          />
        ) : (
          <></>
        )}

        {/*
         * Rarely wanted, so folded until it is (#9385): the fold's line
         * says the walk is on while it is, so nothing in force is hidden.
         */}
        {offersWalk ? (
          <FoldedSection
            title={MORE_FIELDS_SECTION_TITLE}
            dataTestId="fire-drill-more-fields"
            items={[
              {
                key: "walksEscalation",
                title: WALK_EVERY_LEVEL,
                isSet: isWalking,
                value: FOLDED_SECTION_ON,
                translateValue: true,
              },
            ]}
          >
            <div className="pt-1">
              <CheckboxElement
                title={translator.translateText(WALK_EVERY_LEVEL) || ""}
                description={translator.translateTemplate(
                  FIRE_DRILL_WORDS.walkDescription,
                  {
                    minutes: translator.formatNumber(
                      ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
                    ),
                  },
                )}
                value={walksEscalation}
                onChange={(value: boolean) => {
                  setWalksEscalation(value);
                }}
                dataTestId="fire-drill-walks-escalation"
              />
            </div>
          </FoldedSection>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default FireDrillModal;
