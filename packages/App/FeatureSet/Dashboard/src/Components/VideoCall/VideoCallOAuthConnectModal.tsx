import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import {
  VideoCallOAuthDefinition,
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { startVideoCallSignIn } from "./VideoCallApi";
import VideoCallProviderLogo from "./VideoCallProviderLogo";

/*
 * The one-click Connect: what is about to happen, which account to sign in
 * with, and the button that goes to the provider's sign-in. Nothing to set
 * up on the provider's side - the server has its own app there - so this is
 * the whole of connecting Zoom, Google Meet or Microsoft Teams.
 *
 * With a connection, it signs that connection in again: after its account
 * removed OneUptime, its sign-in expired, or to move its meetings to
 * another account. Without one, it offers the project's own app instead
 * (onUseOwnApp), for an organization that wants a service identity.
 */

export interface ComponentProps {
  provider: VideoCallProvider;
  // Reconnect: the connection to sign in again.
  connection?: VideoCallConnection | undefined;
  onClose: () => void;
  // Opens the connection form for the project's own app instead.
  onUseOwnApp?: (() => void) | undefined;
}

const VideoCallOAuthConnectModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const definition: VideoCallProviderDefinition | undefined =
    getVideoCallProviderDefinition(props.provider);
  const oauth: VideoCallOAuthDefinition | undefined = definition?.oauth;

  if (!definition || !oauth) {
    return <></>;
  }

  const isReconnect: boolean = Boolean(props.connection?.id);

  const steps: Array<string> = [
    translator.translateTemplate(
      "Sign in to {{signInWith}} with the account that should host incident meetings.",
      { signInWith: oauth.signInWith },
    ),
    translator.translateText(
      "Allow OneUptime to create meetings for that account.",
    ) || "Allow OneUptime to create meetings for that account.",
    translator.translateTemplate(
      "Back here, start a test meeting, then pick {{provider}} in a Slack or Microsoft Teams notification rule.",
      { provider: definition.title },
    ),
  ];

  return (
    <Modal
      title={
        isReconnect
          ? translator.translateTemplate("Reconnect {{name}}", {
              name: props.connection?.name || definition.title,
            })
          : translator.translateTemplate("Connect {{provider}}", {
              provider: definition.title,
            })
      }
      description={definition.description}
      modalWidth={ModalWidth.Medium}
      isLoading={isLoading}
      error={error}
      submitButtonText={translator.translateTemplate(
        "Continue to {{signInWith}}",
        { signInWith: oauth.signInWith },
      )}
      closeButtonText="Cancel"
      onClose={props.onClose}
      onSubmit={(): void => {
        setError(undefined);
        setIsLoading(true);

        startVideoCallSignIn({
          provider: props.provider,
          connectionId: props.connection?.id?.toString(),
        }).catch((err: unknown) => {
          setIsLoading(false);
          setError(API.getFriendlyErrorMessage(err as Error));
        });
      }}
      leftFooterElement={
        props.onUseOwnApp && !isReconnect ? (
          <button
            type="button"
            data-testid={`video-call-use-own-app-${props.provider}`}
            onClick={props.onUseOwnApp}
            className="text-sm font-medium text-gray-500 hover:text-indigo-600 focus:outline-none focus-visible:underline"
          >
            {translator.translateTemplate("Use your own {{provider}} app", {
              provider: definition.title,
            })}
          </button>
        ) : undefined
      }
    >
      <div data-testid="video-call-oauth-connect" className="space-y-4">
        <div className="flex items-center gap-3">
          <VideoCallProviderLogo provider={props.provider} size="lg" />
          <p className="text-sm text-gray-600">
            {isReconnect && props.connection?.connectedAccount
              ? translator.translateTemplate(
                  "Signed in as {{account}}. Signing in again replaces this sign-in, for every connection signed in as the same account.",
                  { account: props.connection.connectedAccount },
                )
              : translator.translateTemplate(
                  "Connect in one click: sign in to {{signInWith}} and OneUptime creates every incident's meeting as that account. Nothing to set up in {{provider}}.",
                  { signInWith: oauth.signInWith, provider: definition.title },
                )}
          </p>
        </div>

        <ol className="space-y-3">
          {steps.map((step: string, index: number): ReactElement => {
            return (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm text-gray-700">
                  {step}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">
          <Icon
            icon={IconProp.ShieldCheck}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
          />
          <span>
            {translator.translateText(oauth.accountHint) || oauth.accountHint}
          </span>
        </div>
      </div>
    </Modal>
  );
};

export default VideoCallOAuthConnectModal;
