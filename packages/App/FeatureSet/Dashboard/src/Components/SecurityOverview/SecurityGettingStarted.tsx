import AppLink from "../AppLink/AppLink";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SecuritySetupStatus,
  SecuritySetupStep,
  SecuritySetupStepKey,
  TurnOnRecommendedProblem,
  TurnOnRecommendedResult,
  describeSetupCallFailure,
  didTurnOnAnything,
  getSecuritySetupSteps,
} from "./SecuritySetupModel";
import {
  SecuritySetupTestButton,
  SecuritySetupTestResultLine,
  SecuritySetupTestState,
  useSecuritySetupTest,
} from "./SecuritySetupTest";
import SecurityTurnOnProblems from "./SecurityTurnOnProblems";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const SECURITY_GETTING_STARTED_ID: string = "security-getting-started";

/*
 * What the card says when Turn on recommended could not do everything: the
 * click that came back with some of it undone, the click that failed
 * whole, and the test attack that failed (SecurityTurnOnProblems).
 */
export const TURN_ON_PARTLY_TITLE: string = translationKey(
  "Not everything could be turned on",
);
export const TURN_ON_FAILED_TITLE: string = translationKey(
  "Turn on recommended did not finish",
);
export const TURN_ON_PARTLY_NOTE: string = translationKey(
  "Everything else is on. Try again turns on only what is still missing.",
);
export const TURN_ON_RETRY_NOTE: string = translationKey(
  "Try again turns on only what is still missing.",
);
export const SETUP_TEST_FAILED_TITLE: string = translationKey(
  "The test attack could not be sent",
);

export interface ComponentProps {
  status: SecuritySetupStatus;
  // Called after something changed, so the page reads its figures again.
  onChanged: () => void;
  // Hides the card once every step is done and the reader says so.
  onDone: () => void;
  // Hides the card for good: the reader does not want it (Dismiss).
  onDismiss: () => void;
}

function getDismissKey(): string | null {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  return projectId ? `security-get-started-dismissed-${projectId}` : null;
}

/*
 * Whether this person put Get started away for this project, as Home's
 * checklist remembers it: a team that runs Security without playbooks, say,
 * is not asked to set them up on every visit. Kept in the browser; a
 * storage that cannot be read just shows the card again.
 */
export function isSecurityGetStartedDismissed(): boolean {
  try {
    const key: string | null = getDismissKey();

    return key ? Boolean(LocalStorage.getItem(key)) : false;
  } catch {
    return false;
  }
}

export function rememberSecurityGetStartedDismissed(): void {
  try {
    const key: string | null = getDismissKey();

    if (key) {
      LocalStorage.setItem(key, true);
    }
  } catch {
    // Not remembered: the card comes back on the next visit.
  }
}

/*
 * The Overview's Set up Security, on a project nothing watches yet: the
 * reader wants the card back, so it is no longer put away.
 */
export function forgetSecurityGetStartedDismissed(): void {
  try {
    const key: string | null = getDismissKey();

    if (key) {
      LocalStorage.removeItem(key);
    }
  } catch {
    // Nothing remembered to forget, or a storage that cannot be written.
  }
}

/*
 * Who may make the one click: whoever may turn your logs on, add rules and
 * add a playbook - the same rule the server holds the route to.
 */
export function getTurnOnRecommendedGate(): PermissionGateResult {
  for (const model of [
    new SecurityLogSource(),
    new DetectionRule(),
    new SecurityPlaybook(),
  ]) {
    const gate: PermissionGateResult = PermissionGate.check(
      model,
      ModelAction.Create,
    );

    if (!gate.isAllowed) {
      return gate;
    }
  }

  return { isAllowed: true };
}

/*
 * Whether "Turn on recommended" still has something to do: a source, a rule
 * or a playbook is missing. Once all three are there, the next thing to do
 * is the test, so it becomes the card's main button.
 */
export function needsTurnOnRecommended(
  steps: Array<SecuritySetupStep>,
): boolean {
  return steps.some((step: SecuritySetupStep): boolean => {
    return step.key !== SecuritySetupStepKey.Test && !step.isDone;
  });
}

/*
 * Whether the last click left something undone - parts it named, or the
 * call failing whole - so the card says what, and its main button becomes
 * Try again: the same call, which does only what is still missing.
 */
export function needsTurnOnRetry(data: {
  turnedOn: TurnOnRecommendedResult | null;
  error: string;
}): boolean {
  return (
    Boolean(data.error) ||
    Boolean(data.turnedOn && (data.turnedOn.problems || []).length > 0)
  );
}

/*
 * "Get started", for a project that has not set Security up yet: what
 * Security does in two sentences, one click that turns on what most teams
 * need - your logs as a source, the recommended rules, a playbook that
 * enriches every new case - and a harmless test that shows a case open.
 *
 * The buttons sit under the text, where the eye lands after reading it,
 * and the main one is always the next thing to do: Turn on recommended
 * until it has nothing left to turn on, then Send a test attack, then Done.
 * Whoever may not set Security up is told who can, not left with a grey
 * button. The steps below say what is done and where to do each by hand.
 * The page keeps the card for the visit once it showed it, so the reader
 * sees each step tick and the test's case appear.
 *
 * A click that could not do everything says, under the buttons, what is
 * missing and why - never a server's raw sentence alone - and its button
 * becomes Try again, which does only what is still missing.
 */
const SecurityGettingStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isTurningOn, setIsTurningOn] = useState<boolean>(false);
  const [turnedOn, setTurnedOn] = useState<TurnOnRecommendedResult | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  /*
   * Each click's answer is drawn afresh, so a Try again that comes back with
   * the same thing missing is announced again rather than looking as if
   * nothing happened.
   */
  const [attempt, setAttempt] = useState<number>(0);
  const test: SecuritySetupTestState = useSecuritySetupTest(props.onChanged);

  const steps: Array<SecuritySetupStep> = getSecuritySetupSteps(props.status);
  const doneCount: number = steps.filter((step: SecuritySetupStep) => {
    return step.isDone;
  }).length;
  const isAllDone: boolean = doneCount === steps.length;
  const problems: Array<TurnOnRecommendedProblem> = turnedOn?.problems || [];
  const showTryAgain: boolean = needsTurnOnRetry({ turnedOn, error });
  const showTurnOn: boolean = !showTryAgain && needsTurnOnRecommended(steps);

  // A sentence of the card's own, in the reader's language.
  const say: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  const turnOnGate: PermissionGateResult = getTurnOnRecommendedGate();
  // The main button is the next step; when it is locked, say who can do it.
  const isNextStepLocked: boolean =
    showTurnOn || showTryAgain ? !turnOnGate.isAllowed : !test.gate.isAllowed;

  const turnOnRecommended: () => Promise<void> = async (): Promise<void> => {
    setIsTurningOn(true);
    setError("");

    try {
      setTurnedOn(await SecurityCaseApi.turnOnRecommended());
      props.onChanged();
    } catch (err) {
      // The server's sentence for a role or a plan; the product's own for anything else.
      setError(describeSetupCallFailure(err));
    }

    setAttempt((count: number): number => {
      return count + 1;
    });
    setIsTurningOn(false);
  };

  // The page reads its figures again after the click; until then, the answer's.
  const rulesOn: number = turnedOn
    ? Math.max(
        turnedOn.rulesAdded + turnedOn.rulesTurnedOn,
        props.status.enabledRules,
      )
    : 0;

  return (
    <section
      id={SECURITY_GETTING_STARTED_ID}
      data-testid={SECURITY_GETTING_STARTED_ID}
      aria-labelledby={`${SECURITY_GETTING_STARTED_ID}-title`}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-4">
        <div
          className={
            isAllDone
              ? "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 max-sm:hidden"
              : "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 max-sm:hidden"
          }
          aria-hidden="true"
        >
          <Icon
            icon={isAllDone ? IconProp.CheckCircle : IconProp.ShieldCheck}
            className="h-5 w-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2
              id={`${SECURITY_GETTING_STARTED_ID}-title`}
              className="text-base font-semibold text-gray-900"
            >
              {isAllDone
                ? translator.translateText("Security is set up")
                : translator.translateText("Set up Security in a minute")}
            </h2>
            {isAllDone ? (
              <></>
            ) : (
              /*
               * Dismiss (28px with its padding) hangs 2px over the title's
               * 24px line above and below, centred on it. Taller than the
               * line, it made the line 28px and pushed the description 8px
               * under the title, where it keeps 4px.
               */
              <div className="-my-0.5 flex-shrink-0">
                <Button
                  title="Dismiss"
                  buttonStyle={ButtonStyleType.SECONDARY_LINK}
                  buttonSize={ButtonSize.Small}
                  dataTestId="security-getting-started-dismiss"
                  onClick={() => {
                    rememberSecurityGetStartedDismissed();
                    props.onDismiss();
                  }}
                />
              </div>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            {isAllDone
              ? translator.translateText(
                  "OneUptime now watches your sources, opens a case when a rule matches and runs your playbooks on it. Open cases and anything waiting for you show on this page.",
                )
              : translator.translateText(
                  "OneUptime finds threats in data you already have - your logs and the security tools you use - groups what it finds into cases and responds with playbooks. Turn on what most teams need, then send a test attack to see it work.",
                )}
          </p>
          <div
            className="mt-4 flex flex-wrap items-center gap-2 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0"
            data-testid="security-getting-started-actions"
          >
            {isAllDone ? (
              <>
                <Button
                  title="Done"
                  icon={IconProp.Check}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  dataTestId="security-getting-started-done"
                  onClick={props.onDone}
                />
                {/*
                 * Every step is done - a test attack opened its case - while
                 * something the last click named is still missing: Try
                 * again stays at hand beside Done, under the box that says
                 * what.
                 */}
                {showTryAgain ? (
                  <Button
                    title="Try again"
                    icon={IconProp.Refresh}
                    buttonStyle={ButtonStyleType.NORMAL}
                    isLoading={isTurningOn}
                    disabled={!turnOnGate.isAllowed || isTurningOn}
                    tooltip={
                      turnOnGate.isAllowed
                        ? undefined
                        : turnOnGate.disabledReason
                    }
                    dataTestId="security-turn-on-try-again"
                    onClick={() => {
                      void turnOnRecommended();
                    }}
                  />
                ) : (
                  <></>
                )}
              </>
            ) : (
              <>
                {showTurnOn ? (
                  <Button
                    title="Turn on recommended"
                    icon={IconProp.CheckCircle}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    isLoading={isTurningOn}
                    disabled={!turnOnGate.isAllowed || isTurningOn}
                    tooltip={
                      turnOnGate.isAllowed
                        ? undefined
                        : turnOnGate.disabledReason
                    }
                    dataTestId="security-turn-on-recommended"
                    onClick={() => {
                      void turnOnRecommended();
                    }}
                  />
                ) : (
                  <></>
                )}
                {showTryAgain ? (
                  <Button
                    title="Try again"
                    icon={IconProp.Refresh}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    isLoading={isTurningOn}
                    disabled={!turnOnGate.isAllowed || isTurningOn}
                    tooltip={
                      turnOnGate.isAllowed
                        ? undefined
                        : turnOnGate.disabledReason
                    }
                    dataTestId="security-turn-on-try-again"
                    onClick={() => {
                      void turnOnRecommended();
                    }}
                  />
                ) : (
                  <></>
                )}
                <SecuritySetupTestButton
                  test={test}
                  buttonStyle={
                    showTurnOn || showTryAgain
                      ? ButtonStyleType.NORMAL
                      : ButtonStyleType.PRIMARY
                  }
                />
              </>
            )}
          </div>
          {!isAllDone && isNextStepLocked ? (
            <p
              className="mt-2 text-sm text-gray-500"
              data-testid="security-getting-started-locked"
            >
              {translator.translateText(
                "Ask a Project Owner, Project Admin or Security Admin to set Security up.",
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>

      {showTryAgain ? (
        <div className="mt-4">
          <SecurityTurnOnProblems
            key={attempt}
            problems={problems}
            error={error}
            title={say(error ? TURN_ON_FAILED_TITLE : TURN_ON_PARTLY_TITLE)}
            /*
             * Under what it could not do: that the rest is on, and that Try
             * again adds nothing twice. A click that failed whole says why
             * instead - "try again in a moment", or the role or plan Try
             * again would not change - and nothing more.
             */
            note={
              error
                ? undefined
                : say(
                    turnedOn && didTurnOnAnything(turnedOn)
                      ? TURN_ON_PARTLY_NOTE
                      : TURN_ON_RETRY_NOTE,
                  )
            }
          />
        </div>
      ) : (
        <></>
      )}

      {test.error ? (
        <div className="mt-4">
          <SecurityTurnOnProblems
            problems={[]}
            error={test.error}
            title={say(SETUP_TEST_FAILED_TITLE)}
            dataTestId="security-setup-test-error"
          />
        </div>
      ) : (
        <></>
      )}

      {turnedOn && !showTryAgain ? (
        <p
          data-testid="security-turned-on"
          role="status"
          className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {translator.translatePlural(
            {
              one: "Done. {{count}} detection rule is on, your logs are checked for security events and every new case is enriched.",
              other:
                "Done. {{count}} detection rules are on, your logs are checked for security events and every new case is enriched.",
            },
            rulesOn,
          )}
        </p>
      ) : (
        <></>
      )}

      {test.result ? (
        <div className="mt-4">
          <SecuritySetupTestResultLine result={test.result} />
        </div>
      ) : (
        <></>
      )}

      <div className="mt-6 flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateTemplate("{{done}} of {{total}} done", {
            done: doneCount,
            total: steps.length,
          })}
        </span>
        <span
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"
          aria-hidden="true"
        >
          <span
            className="block h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </span>
      </div>

      <ol className="mt-3 divide-y divide-gray-100">
        {steps.map((step: SecuritySetupStep, index: number): ReactElement => {
          return (
            <li
              key={step.key}
              data-testid={`security-setup-step-${step.key}`}
              data-done={step.isDone ? "true" : "false"}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={
                    step.isDone
                      ? "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white"
                      : "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs font-semibold text-gray-500"
                  }
                  aria-hidden="true"
                >
                  {step.isDone ? (
                    <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                  ) : (
                    <>{index + 1}</>
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className={
                      step.isDone
                        ? "text-sm font-medium text-gray-500"
                        : "text-sm font-medium text-gray-900"
                    }
                  >
                    {translator.translateText(step.title)}
                    <span className="sr-only">
                      {" "}
                      {step.isDone
                        ? translator.translateText("(done)")
                        : translator.translateText("(to do)")}
                    </span>
                  </p>
                  <p
                    className={
                      step.isDone
                        ? "mt-0.5 text-sm text-gray-500"
                        : "mt-0.5 text-sm text-gray-600"
                    }
                  >
                    {translator.translateText(step.description)}
                  </p>
                </div>
              </div>
              <AppLink
                to={RouteUtil.populateRouteParams(RouteMap[step.page] as Route)}
                className="ml-9 inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 sm:ml-0"
              >
                <>
                  <span>{translator.translateText(step.linkText)}</span>
                  <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
                </>
              </AppLink>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default SecurityGettingStarted;
