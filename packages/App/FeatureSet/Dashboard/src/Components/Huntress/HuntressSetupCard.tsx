import RelativeTime from "../EpisodeView/RelativeTime";
import {
  HUNTRESS_CONNECTION_STATE_COLORS,
  HUNTRESS_CONNECTION_STATE_LABELS,
  HuntressConnectionState,
  getHuntressConnectionState,
  getHuntressWebhookUrl,
} from "./HuntressConnectionDisplay";
import HuntressSigningSecretModal from "./HuntressSigningSecretModal";
import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { APP_API_URL } from "Common/UI/Config";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";

export interface ComponentProps {
  connection: HuntressConnection;
  // Called once a signing secret is saved, to read the connection again.
  onSigningSecretSaved: () => void;
}

interface SetupStepProps {
  number: number;
  isDone: boolean;
  title: string;
  children: ReactNode;
  dataTestId: string;
}

/*
 * One numbered step: its number, or a check once it is done, beside what to
 * do.
 */
const SetupStep: FunctionComponent<SetupStepProps> = (
  props: SetupStepProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li className="flex gap-3" data-testid={props.dataTestId}>
      <div
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          props.isDone
            ? "bg-green-50 text-green-700"
            : "bg-gray-100 text-gray-700"
        }`}
        data-testid={`${props.dataTestId}-${props.isDone ? "done" : "todo"}`}
      >
        {props.isDone ? (
          <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
        ) : (
          props.number
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-gray-900">
          {translator.translateText(props.title)}
        </p>
        {props.children}
      </div>
    </li>
  );
};

/*
 * Where a Huntress connection stands, and what is left to set it up.
 *
 * Until Huntress has reached it, the card walks the three things to do in
 * Huntress, in the order Huntress asks for them: add an endpoint with this
 * URL, save the endpoint's signing secret here, send a test. Each step
 * shows a check once it is done. Once events arrive, the card shrinks to
 * the connection's state - when the last one came in, or why requests are
 * refused - with the URL and the secret at hand.
 */
const HuntressSetupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showSecretModal, setShowSecretModal] = useState<boolean>(false);

  const connection: HuntressConnection = props.connection;
  const state: HuntressConnectionState = getHuntressConnectionState(connection);
  const url: string = getHuntressWebhookUrl({
    apiUrl: APP_API_URL,
    connectionId: connection.id!,
  });

  const updateGate: PermissionGateResult = PermissionGate.check(
    new HuntressConnection(),
    ModelAction.Update,
  );

  const isSecretSaved: boolean = Boolean(connection.isSigningSecretSet);
  const hasReceived: boolean = Boolean(connection.lastEventReceivedAt);

  const statePill: ReactElement = (
    <span data-testid="huntress-connection-state" data-state={state}>
      <Pill
        text={HUNTRESS_CONNECTION_STATE_LABELS[state]}
        color={HUNTRESS_CONNECTION_STATE_COLORS[state]}
        isPulsing={state === HuntressConnectionState.Waiting}
      />
    </span>
  );

  const urlRow: ReactElement = (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <span
        data-testid="huntress-webhook-url"
        className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
      >
        {url}
      </span>
      <CopyTextButton
        textToBeCopied={url}
        size="sm"
        variant="soft"
        title="Copy webhook URL"
      />
    </div>
  );

  const secretButton: ReactElement | null =
    updateGate.isAllowed || updateGate.disabledReason ? (
      <Button
        title={isSecretSaved ? "Replace Signing Secret" : "Save Signing Secret"}
        buttonStyle={
          isSecretSaved ? ButtonStyleType.NORMAL : ButtonStyleType.PRIMARY
        }
        buttonSize={ButtonSize.Small}
        icon={IconProp.Lock}
        disabled={!updateGate.isAllowed}
        tooltip={updateGate.disabledReason}
        dataTestId="huntress-signing-secret-button"
        onClick={() => {
          setShowSecretModal(true);
        }}
      />
    ) : null;

  const errorBox: ReactElement | null =
    state === HuntressConnectionState.Failing && connection.lastError ? (
      <div
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2"
        data-testid="huntress-last-error"
      >
        <p className="text-sm font-medium text-red-800">
          {translator.translateText("The last request was refused")}
          {connection.lastErrorAt ? (
            <>
              {" · "}
              <RelativeTime date={connection.lastErrorAt} />
            </>
          ) : null}
        </p>
        <p className="mt-1 text-sm text-red-700">{connection.lastError}</p>
      </div>
    ) : null;

  const modal: ReactElement | null = showSecretModal ? (
    <HuntressSigningSecretModal
      connectionId={connection.id!}
      isReplacing={isSecretSaved}
      onClose={() => {
        setShowSecretModal(false);
      }}
      onSaved={() => {
        setShowSecretModal(false);
        props.onSigningSecretSaved();
      }}
    />
  ) : null;

  // Reached by Huntress: the state, and the URL and secret at hand.
  if (hasReceived && isSecretSaved) {
    return (
      <Fragment>
        <Card
          title="Connection"
          description="Huntress sends its incident reports to this URL, signed with the endpoint's signing secret."
        >
          <div className="space-y-4" data-testid="huntress-connection-status">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {statePill}
              {connection.lastEventReceivedAt ? (
                <p className="text-sm text-gray-500">
                  {translator.translateText("Last event")}{" "}
                  <RelativeTime date={connection.lastEventReceivedAt} />
                  {connection.lastEventType ? (
                    <span className="font-mono text-xs text-gray-500">
                      {" · "}
                      {connection.lastEventType}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            {errorBox}
            <div>
              <p className="text-xs font-medium text-gray-500">
                {translator.translateText("Webhook URL")}
              </p>
              <div className="mt-1">{urlRow}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">
                {translator.translateText("Signing secret saved")}
              </p>
              {secretButton}
            </div>
          </div>
        </Card>
        {modal}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <Card
        title="Connect Huntress"
        description="Three steps in Huntress. You need the Account Admin role there."
      >
        <div className="space-y-4" data-testid="huntress-setup">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {statePill}
          </div>
          {errorBox}
          <ol className="space-y-5">
            <SetupStep
              number={1}
              isDone={hasReceived}
              title="Add a webhook endpoint in Huntress"
              dataTestId="huntress-setup-step-url"
            >
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  "In Huntress, open Integrations, choose Add an Integration, then Webhooks, and Add Endpoint. Paste this URL, and turn on Incident Reports.",
                )}
              </p>
              {urlRow}
            </SetupStep>
            <SetupStep
              number={2}
              isDone={isSecretSaved}
              title="Save the endpoint's signing secret"
              dataTestId="huntress-setup-step-secret"
            >
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  "In Huntress, open the endpoint's menu (⋯) and choose View Signing Secret. Requests are refused until it is saved here.",
                )}
              </p>
              {isSecretSaved ? (
                <p
                  className="text-sm text-green-700"
                  data-testid="huntress-signing-secret-saved"
                >
                  {translator.translateText("Signing secret saved")}
                </p>
              ) : null}
              {secretButton ? <div>{secretButton}</div> : null}
            </SetupStep>
            <SetupStep
              number={3}
              isDone={hasReceived}
              title="Send a test"
              dataTestId="huntress-setup-step-test"
            >
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  "In Huntress, choose Send Test on the endpoint. This card changes as soon as the test arrives.",
                )}
              </p>
            </SetupStep>
          </ol>
        </div>
      </Card>
      {modal}
    </Fragment>
  );
};

export default HuntressSetupCard;
