import {
  OPENS_CHAIN_LINES,
  getWhoIsToldSeverityValue,
} from "../Monitor/Overview/WhoIsToldWords";
import OnCallTestPageApi from "./OnCallTestPageApi";
import {
  FIRE_DRILL_CANT_TEST,
  FIRE_DRILL_WORDS,
} from "./OnCallTestPageWords";
import {
  PreviewLevel,
  describeTestPageCost,
  doesLevelReachAnybody,
} from "./SendTestPageModal";
import TestPageResult from "./TestPageResult";
import {
  OnCallFireDrillEvent,
  OnCallFireDrillPolicy,
  OnCallFireDrillPreview,
  OnCallFireDrillRun,
} from "Common/Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  OnCallTestPageRecordKind,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  getInlineSeparator,
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
 */

export interface ComponentProps {
  monitorId: string;
  onClose: () => void;
  // Told once the drill is started, with each policy's test.
  onStarted?: ((runs: Array<OnCallFireDrillRun>) => void) | undefined;
}

// A failure, as the picker offers it: "Offline · An incident (Critical)".
export function getFireDrillFailureLabel(
  translator: Translator,
  event: OnCallFireDrillEvent,
): string {
  const opens: string = translator.translateTemplate(
    event.recordKind === OnCallTestPageRecordKind.Alert
      ? OPENS_CHAIN_LINES.alert
      : OPENS_CHAIN_LINES.incident,
    {
      severity: getWhoIsToldSeverityValue({
        kind: event.recordKind,
        severityName: event.severityName,
      }),
    },
  );

  return event.criteriaName
    ? `${event.criteriaName}${getInlineSeparator(translator.language)}${opens}`
    : opens;
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
 * WHY THE DRILL CAN'T START:
 *
 *   cantTest      a policy of it the reader may not test: it tests every
 *                 policy, or none (`count` of them).
 *   reachesNobody nobody any of its policies pages can receive a test now:
 *                 it would send nothing (#7529's rule, for each policy).
 */
export type FireDrillBlocker =
  | { kind: "cantTest"; count: number }
  | { kind: "reachesNobody" };

export function getFireDrillBlocker(
  preview: OnCallFireDrillPreview | null,
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

  const reachesAnybody: boolean = preview.policies.some(
    (policy: OnCallFireDrillPolicy): boolean => {
      return Boolean(policy.preview && doesLevelReachAnybody(policy.preview));
    },
  );

  return reachesAnybody ? null : { kind: "reachesNobody" };
}

// The line that says why the drill can't start, in the reader's words.
export function getFireDrillBlockerSentence(
  translator: Translator,
  blocker: FireDrillBlocker,
): string {
  return blocker.kind === "cantTest"
    ? translator.translatePlural(FIRE_DRILL_CANT_TEST, blocker.count)
    : translator.translateTemplate(FIRE_DRILL_WORDS.reachesNobody);
}

// One policy the drill pages: its name, and who its first level pages now.
const FireDrillPolicyBlock: FunctionComponent<{
  policy: OnCallFireDrillPolicy;
}> = (props: { policy: OnCallFireDrillPolicy }): ReactElement => {
  const translator: Translator = useTranslator();
  const policy: OnCallFireDrillPolicy = props.policy;

  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="fire-drill-policy">
      <h4
        className="text-sm font-semibold text-gray-900 break-words"
        data-testid="fire-drill-policy-name"
      >
        {getFireDrillPolicyName(translator, policy)}
      </h4>
      {policy.mayTest && policy.preview ? (
        <PreviewLevel level={policy.preview} showNames={true} />
      ) : (
        <p
          className="mt-1 text-sm text-amber-700"
          data-testid="fire-drill-policy-cant-test"
        >
          {translator.translateText(FIRE_DRILL_WORDS.cantTestPolicy)}
        </p>
      )}
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

  const blocker: FireDrillBlocker | null = isLoading
    ? null
    : getFireDrillBlocker(preview);

  const costSentence: string =
    preview && !isLoading
      ? describeTestPageCost(translator, preview.cost, { isFireDrill: true })
      : "";

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
      description={
        translator.translateText(FIRE_DRILL_WORDS.description) || ""
      }
      onClose={props.onClose}
      submitButtonText={
        translator.translateText(FIRE_DRILL_WORDS.start) || ""
      }
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
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor="fire-drill-failure"
            >
              {translator.translateText(FIRE_DRILL_WORDS.whatFails)}
            </label>
            {events.length > 1 ? (
              <Dropdown
                id="fire-drill-failure"
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
            ) : (
              <p
                id="fire-drill-failure"
                className="text-sm text-gray-900 break-words"
                data-testid="fire-drill-failure-only"
              >
                {selected?.label || ""}
              </p>
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
              <p data-testid="fire-drill-blocked-reason">
                {getFireDrillBlockerSentence(translator, blocker)}
              </p>
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
      </div>
    </Modal>
  );
};

export default FireDrillModal;
