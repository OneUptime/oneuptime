import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CompactLoader from "../ComponentLoader/CompactLoader";
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import BasicFormModal from "../FormModal/BasicFormModal";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import Icon from "../Icon/Icon";
import Pill from "../Pill/Pill";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import BreakableCode from "./BreakableCode";
import ComponentSettingsSection from "./ComponentSettingsSection";
import {
  HUNTRESS_TRIGGER_POLL_FOR_MS,
  HUNTRESS_TRIGGER_POLL_INTERVAL_MS,
  HUNTRESS_TRIGGER_STATE_LABELS,
  HuntressSetupStep,
  HuntressSetupStepStatus,
  HuntressTriggerFacts,
  HuntressTriggerPanelCopy,
  HuntressTriggerState,
  getHuntressSetupStepStatuses,
  getHuntressSigningSecretProblem,
  getHuntressTriggerState,
  isWaitingForHuntress,
} from "./HuntressTriggerState";
import { WebhookTriggerPanelCopy } from "./WebhookTriggerPanel";
import WorkflowOffTriggerNote from "./WorkflowOffTriggerNote";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../Types/Workflow/WorkflowEnabled";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  workflowId?: ObjectID | undefined;
  /*
   * The URL to give Huntress, secret key included. Null when there is none
   * to show: the workflow has no key yet, or this user may not see it.
   */
  url: string | null;
  // False when this user may not read the workflow's webhook secret key.
  canSeeUrl: boolean;
  isWorkflowOff?: boolean | undefined;
}

const STATE_COLORS: Record<HuntressTriggerState, Color> = {
  [HuntressTriggerState.NeedsSigningSecret]: Yellow500,
  [HuntressTriggerState.Waiting]: Gray500,
  [HuntressTriggerState.Receiving]: Green500,
  [HuntressTriggerState.Failing]: Red500,
};

const FACTS_SELECT: JSONObject = {
  isWebhookSigningSecretSet: true,
  lastWebhookRequestAt: true,
  lastWebhookError: true,
  lastWebhookErrorAt: true,
};

interface SetupStepProps {
  number: number;
  status: HuntressSetupStepStatus;
  title: string;
  // What to do, in Huntress or here, translated: shown until the step is done.
  body: ReactNode;
  // What the step holds whether done or not: the URL, the secret's button.
  children?: ReactNode;
  dataTestId: string;
}

// The circle beside a step: a check once done, the next step's number filled.
const STEP_CIRCLE_CLASSES: Record<HuntressSetupStepStatus, string> = {
  [HuntressSetupStepStatus.Done]: "bg-green-100 text-green-700",
  [HuntressSetupStepStatus.Current]: "bg-indigo-600 text-white",
  [HuntressSetupStepStatus.Upcoming]:
    "bg-white text-gray-500 ring-1 ring-inset ring-gray-300",
};

/*
 * One numbered step: its number, or a check once it is done, beside what to
 * do. The step to do next has its number filled in, so there is one obvious
 * place to start; a step that is done drops its instructions and keeps only
 * what is still useful (the URL to copy, the button to replace the secret).
 * The list numbers the steps for a screen reader, so the circle is drawn
 * only: the step to do next is the list's current step, and a done step says
 * so after its title.
 */
const SetupStep: FunctionComponent<SetupStepProps> = (
  props: SetupStepProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isDone: boolean = props.status === HuntressSetupStepStatus.Done;

  return (
    <li
      className="flex gap-3"
      data-testid={props.dataTestId}
      data-status={props.status}
      aria-current={
        props.status === HuntressSetupStepStatus.Current ? "step" : undefined
      }
    >
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          STEP_CIRCLE_CLASSES[props.status]
        }`}
        aria-hidden="true"
        data-testid={`${props.dataTestId}-${isDone ? "done" : "todo"}`}
      >
        {isDone ? (
          <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
        ) : (
          props.number
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p
          className={`text-sm font-medium ${
            isDone ? "text-gray-700" : "text-gray-900"
          }`}
        >
          {translator.translateText(props.title)}
          {isDone ? (
            <>
              {" "}
              <span
                className="sr-only"
                data-testid={`${props.dataTestId}-done-label`}
              >
                {translator.translateText(HuntressTriggerPanelCopy.stepDone)}
              </span>
            </>
          ) : null}
        </p>
        {isDone ? null : (
          <p
            className="text-sm text-gray-500"
            data-testid={`${props.dataTestId}-body`}
          >
            {props.body}
          </p>
        )}
        {props.children}
      </div>
    </li>
  );
};

// "5 minutes ago", with the exact time on hover.
const When: FunctionComponent<{ date: Date | string }> = (props: {
  date: Date | string;
}): ReactElement => {
  const date: Date = OneUptimeDate.fromString(props.date);

  return (
    <time
      dateTime={date.toISOString()}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)}
    >
      {OneUptimeDate.fromNow(date)}
    </time>
  );
};

/*
 * THE HUNTRESS TRIGGER'S PANEL: what someone opening the trigger has come
 * for. Until Huntress reaches the workflow, it walks the three things to do
 * in Huntress, in the order Huntress asks for them - add an endpoint with
 * this URL, save the endpoint's signing secret here, send a test - with a
 * check beside each one that is done. It reads the workflow again every few
 * seconds while it waits, so a test that arrives shows up as it does. Once
 * Huntress reaches it, the panel shrinks to where it stands, with the URL
 * and the secret at hand.
 *
 * The signing secret is write-only: it is pasted into a dialog, saved
 * encrypted, and never read back - the panel only learns that one is saved.
 */
const HuntressTriggerPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [facts, setFacts] = useState<HuntressTriggerFacts | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [showSecretModal, setShowSecretModal] = useState<boolean>(false);
  const [isSavingSecret, setIsSavingSecret] = useState<boolean>(false);
  const [secretError, setSecretError] = useState<string>("");

  const workflowId: ObjectID | undefined = props.workflowId;

  type LoadFactsFunction = () => Promise<void>;

  const loadFacts: LoadFactsFunction = async (): Promise<void> => {
    if (!workflowId) {
      return;
    }

    try {
      const workflow: Workflow | null = await ModelAPI.getItem<Workflow>({
        modelType: Workflow,
        id: workflowId,
        select: FACTS_SELECT as never,
      });

      setFacts({
        isWebhookSigningSecretSet: workflow?.isWebhookSigningSecretSet,
        lastWebhookRequestAt: workflow?.lastWebhookRequestAt,
        lastWebhookError: workflow?.lastWebhookError,
        lastWebhookErrorAt: workflow?.lastWebhookErrorAt,
      });
      setLoadError("");
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    loadFacts().catch(() => {
      // loadFacts keeps every failure in loadError.
    });
  }, [workflowId?.toString()]);

  const state: HuntressTriggerState = getHuntressTriggerState(facts || {});
  const isWaiting: boolean = facts !== null && isWaitingForHuntress(state);

  // While it waits, read the workflow again, so a test shows up as it arrives.
  useEffect(() => {
    if (!isWaiting) {
      return;
    }

    const startedAt: number = Date.now();
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      if (Date.now() - startedAt > HUNTRESS_TRIGGER_POLL_FOR_MS) {
        clearInterval(interval);
        return;
      }

      loadFacts().catch(() => {
        // loadFacts keeps every failure in loadError.
      });
    }, HUNTRESS_TRIGGER_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isWaiting, workflowId?.toString()]);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Workflow(),
    ModelAction.Update,
  );

  const isSecretSaved: boolean = Boolean(facts?.isWebhookSigningSecretSet);
  const hasReceived: boolean = Boolean(facts?.lastWebhookRequestAt);
  const steps: Record<HuntressSetupStep, HuntressSetupStepStatus> =
    getHuntressSetupStepStatuses(facts || {});

  /*
   * Read out when it changes - a test that arrives while the dialog is open -
   * as it stays in place when the steps give way to the status.
   */
  const statePill: ReactElement = (
    <span
      data-testid="huntress-trigger-state"
      data-state={state}
      aria-live="polite"
    >
      <Pill
        text={HUNTRESS_TRIGGER_STATE_LABELS[state]}
        color={STATE_COLORS[state]}
        isPulsing={state === HuntressTriggerState.Waiting}
      />
    </span>
  );

  const urlRow: ReactElement = props.canSeeUrl ? (
    props.url ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div
          className="min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-900 sm:text-sm"
          data-testid="huntress-trigger-url"
        >
          <BreakableCode text={props.url} breakAfter="/" />
        </div>
        <div className="flex shrink-0 items-start">
          <CopyTextButton
            textToBeCopied={props.url}
            label={translate(HuntressTriggerPanelCopy.copyUrl)}
            copiedLabel={translate(HuntressTriggerPanelCopy.copied)}
            size="md"
            variant="soft"
            title={translate(HuntressTriggerPanelCopy.copyUrlTitle)}
          />
        </div>
      </div>
    ) : (
      <p
        className="text-sm text-gray-600"
        data-testid="huntress-trigger-url-missing"
      >
        {translate(WebhookTriggerPanelCopy.missing)}
      </p>
    )
  ) : (
    <div
      className="flex items-start gap-2 text-sm text-gray-600"
      data-testid="huntress-trigger-url-hidden"
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
      />
      <p>{translate(WebhookTriggerPanelCopy.hidden)}</p>
    </div>
  );

  const secretButton: ReactElement | null =
    updateGate.isAllowed || updateGate.disabledReason ? (
      <Button
        title={
          isSecretSaved
            ? HuntressTriggerPanelCopy.replaceSecret
            : HuntressTriggerPanelCopy.saveSecret
        }
        buttonStyle={
          isSecretSaved ? ButtonStyleType.NORMAL : ButtonStyleType.PRIMARY
        }
        buttonSize={ButtonSize.Small}
        icon={IconProp.Lock}
        // In line with the step's text, and as wide as its words, on a phone too.
        className="!w-auto md:!ml-0"
        disabled={!updateGate.isAllowed || !workflowId}
        tooltip={updateGate.disabledReason}
        dataTestId="huntress-trigger-signing-secret-button"
        onClick={() => {
          setSecretError("");
          setShowSecretModal(true);
        }}
      />
    ) : null;

  const errorBox: ReactElement | null =
    state === HuntressTriggerState.Failing && facts?.lastWebhookError ? (
      <div
        className="rounded-md border border-red-200 bg-red-50 px-3 py-2"
        data-testid="huntress-trigger-last-error"
        role="status"
      >
        <p className="text-sm font-medium text-red-800">
          {translate(HuntressTriggerPanelCopy.lastRefused)}
          {facts.lastWebhookErrorAt ? (
            <>
              {" · "}
              <When date={facts.lastWebhookErrorAt} />
            </>
          ) : null}
        </p>
        <p className="mt-1 break-words text-sm text-red-700">
          {facts.lastWebhookError}
        </p>
      </div>
    ) : null;

  const offNote: ReactElement | null = props.isWorkflowOff ? (
    <WorkflowOffTriggerNote
      template={WebhookTriggerPanelCopy.workflowOff}
      dataTestId="huntress-trigger-workflow-off"
    />
  ) : null;

  const footer: ReactElement = (
    <div
      className="flex min-w-0 items-start gap-1.5 border-t border-indigo-100 pt-3 text-xs text-gray-500"
      data-testid="huntress-trigger-url-note"
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400"
      />
      <p>{translate(HuntressTriggerPanelCopy.urlStartsNothing)}</p>
    </div>
  );

  const modal: ReactElement | null =
    showSecretModal && workflowId ? (
      <BasicFormModal<JSONObject>
        title={
          isSecretSaved
            ? HuntressTriggerPanelCopy.replaceSecret
            : HuntressTriggerPanelCopy.saveSecret
        }
        name="Huntress > Signing Secret"
        description={HuntressTriggerPanelCopy.secretDialogDescription}
        isLoading={isSavingSecret}
        error={secretError || undefined}
        submitButtonText={HuntressTriggerPanelCopy.saveSecret}
        onClose={() => {
          setIsSavingSecret(false);
          setSecretError("");
          setShowSecretModal(false);
        }}
        onSubmit={async (data: JSONObject) => {
          const secret: string = (
            (data["webhookSigningSecret"] as string) || ""
          ).trim();

          try {
            setIsSavingSecret(true);
            setSecretError("");

            await ModelAPI.updateById<Workflow>({
              modelType: Workflow,
              id: workflowId,
              data: {
                webhookSigningSecret: secret,
              },
            });
          } catch (err) {
            setSecretError(API.getFriendlyMessage(err));
            setIsSavingSecret(false);
            return;
          }

          setIsSavingSecret(false);
          setShowSecretModal(false);
          await loadFacts();
        }}
        formProps={{
          initialValues: {
            webhookSigningSecret: "",
          },
          fields: [
            {
              field: {
                webhookSigningSecret: true,
              },
              title: HuntressTriggerPanelCopy.secretField,
              fieldType: FormFieldSchemaType.EncryptedText,
              required: true,
              placeholder: "whsec_…",
              disableSpellCheck: true,
              customValidation: (
                values: FormValues<JSONObject>,
              ): string | null => {
                return getHuntressSigningSecretProblem(
                  values["webhookSigningSecret"] as string | undefined,
                );
              },
            },
          ],
        }}
      />
    ) : null;

  const section: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <ComponentSettingsSection
        id="huntress"
        icon={IconProp.ShieldCheck}
        title={translate(HuntressTriggerPanelCopy.title)}
        tone="primary"
      >
        {children}
      </ComponentSettingsSection>
    );
  };

  /*
   * Until the first read answers, where it stands is not known: neither the
   * steps nor the status, so a workflow Huntress already reaches never
   * flashes the steps first.
   */
  if (workflowId && !facts && !loadError) {
    return section(
      <div data-testid="huntress-trigger-loading">
        <CompactLoader />
      </div>,
    );
  }

  // Nothing to show where it stands from: say so, and read it again on a click.
  if (loadError && !facts) {
    return section(
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2"
        data-testid="huntress-trigger-load-error"
      >
        <p className="text-sm text-red-700" role="alert">
          {translate(HuntressTriggerPanelCopy.loadError)}
        </p>
        <Button
          title={HuntressTriggerPanelCopy.tryAgain}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Refresh}
          className="!w-auto md:!ml-0"
          dataTestId="huntress-trigger-load-retry"
          onClick={() => {
            // Back to the loader until the read answers.
            setLoadError("");
            loadFacts().catch(() => {
              // loadFacts keeps every failure in loadError.
            });
          }}
        />
      </div>,
    );
  }

  // Reached by Huntress: where it stands, and the URL and secret at hand.
  if (hasReceived && isSecretSaved) {
    return section(
      <>
        <div className="space-y-4" data-testid="huntress-trigger-status">
          {offNote}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {statePill}
            {facts?.lastWebhookRequestAt ? (
              <p className="text-sm text-gray-500">
                {translate(HuntressTriggerPanelCopy.lastEvent)}{" "}
                <When date={facts.lastWebhookRequestAt} />
              </p>
            ) : null}
          </div>
          {errorBox}
          <div>
            <p className="text-xs font-medium text-gray-500">
              {translate(HuntressTriggerPanelCopy.webhookUrl)}
            </p>
            <div className="mt-1">{urlRow}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* A div: the icon draws a div of its own, which no p may hold. */}
            <div className="flex items-center gap-1.5 text-sm text-gray-700">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-4 w-4 shrink-0 text-green-600"
              />
              <span>{translate(HuntressTriggerPanelCopy.secretSaved)}</span>
            </div>
            {secretButton}
          </div>
          {footer}
        </div>
        {modal}
      </>,
    );
  }

  /*
   * The steps. While the workflow is off - as the template creates it - the
   * last one says to turn it on before sending the test, which is refused
   * until it is: so the note the other views show above everything is not
   * needed here, and the reader meets it at the step it belongs to.
   */
  return section(
    <>
      <div className="space-y-4" data-testid="huntress-trigger-setup">
        {/* No workflow to read (a step not saved yet): no state to show. */}
        {facts ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {statePill}
          </div>
        ) : null}
        {errorBox}
        <ol className="space-y-5">
          <SetupStep
            number={1}
            status={steps[HuntressSetupStep.Endpoint]}
            title={HuntressTriggerPanelCopy.stepEndpointTitle}
            body={translate(HuntressTriggerPanelCopy.stepEndpointBody)}
            dataTestId="huntress-trigger-step-endpoint"
          >
            {urlRow}
          </SetupStep>
          <SetupStep
            number={2}
            status={steps[HuntressSetupStep.Secret]}
            title={HuntressTriggerPanelCopy.stepSecretTitle}
            body={translate(HuntressTriggerPanelCopy.stepSecretBody)}
            dataTestId="huntress-trigger-step-secret"
          >
            {isSecretSaved ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p
                  className="text-sm text-gray-500"
                  data-testid="huntress-trigger-signing-secret-saved"
                >
                  {translate(HuntressTriggerPanelCopy.secretSaved)}
                </p>
                {secretButton}
              </div>
            ) : secretButton ? (
              <div>{secretButton}</div>
            ) : null}
          </SetupStep>
          <SetupStep
            number={3}
            status={steps[HuntressSetupStep.Test]}
            title={
              props.isWorkflowOff
                ? HuntressTriggerPanelCopy.stepTurnOnTitle
                : HuntressTriggerPanelCopy.stepTestTitle
            }
            body={
              props.isWorkflowOff ? (
                <TranslatedSentence
                  template={HuntressTriggerPanelCopy.stepTurnOnBody}
                  slots={{
                    // The switch as the Builder's toolbar names it.
                    switch: (
                      <strong
                        className="font-semibold text-gray-700"
                        data-testid="huntress-trigger-enabled-switch-name"
                      >
                        {translate(WORKFLOW_ENABLED_SWITCH_LABEL)}
                      </strong>
                    ),
                  }}
                />
              ) : (
                translate(HuntressTriggerPanelCopy.stepTestBody)
              )
            }
            dataTestId="huntress-trigger-step-test"
          />
        </ol>
        {footer}
      </div>
      {modal}
    </>,
  );
};

export default HuntressTriggerPanel;
