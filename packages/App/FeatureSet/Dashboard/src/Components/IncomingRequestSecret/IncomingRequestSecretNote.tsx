import AppLink from "../AppLink/AppLink";
import RelativeTime from "../EpisodeView/RelativeTime";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import IncomingRequestSecretsCopy, {
  INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
  INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID,
} from "./IncomingRequestSecretsCopy";
import { IncomingRequestSecretStatus } from "./UseIncomingRequestSecretStatus";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // What there is to say (useIncomingRequestSecretStatus).
  status: IncomingRequestSecretStatus;
  // Spacing from what is above it, applied only when the note is drawn.
  className?: string | undefined;
}

/*
 * Under an Incoming Request monitor's heartbeat URL:
 *
 *   - when this monitor got a request without a valid secret in the last day
 *     (issue #8498), that its requests are being refused - or, before the
 *     project requires a secret, that they would be. Whoever looks at a
 *     monitor that went quiet learns why, and a tenant preparing a sender
 *     learns it needs the secret before anything is refused;
 *   - while the project requires a secret, that a request without one is
 *     refused, where the secret goes, and where the secrets are. Whoever
 *     wires a sender up reads the URL here, and a sender sending only the URL
 *     would be refused without this line.
 *
 * Nothing at all when there is nothing to say.
 */
const IncomingRequestSecretNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: IncomingRequestSecretStatus = props.status;

  if (!status.isRequired && !status.withoutSecretAt) {
    return <></>;
  }

  return (
    <div className={`space-y-2 ${props.className || ""}`.trim()}>
      {status.withoutSecretAt ? (
        <div
          data-testid={INCOMING_REQUEST_WITHOUT_SECRET_NOTE_TEST_ID}
          className="flex items-start gap-2 text-sm text-gray-700"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
          />
          <p className="min-w-0">
            <TranslatedSentence
              template={
                status.isRequired
                  ? IncomingRequestSecretsCopy.monitorRefusedNote
                  : IncomingRequestSecretsCopy.monitorWouldBeRefusedNote
              }
              slots={{
                time: <RelativeTime date={status.withoutSecretAt} />,
              }}
            />
          </p>
        </div>
      ) : (
        <></>
      )}
      {status.isRequired ? (
        <div
          data-testid={INCOMING_REQUEST_SECRET_NOTE_TEST_ID}
          className="flex items-start gap-2 text-sm text-gray-600"
        >
          <Icon
            icon={IconProp.Lock}
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          <p className="min-w-0">
            {translator.translateText(
              IncomingRequestSecretsCopy.monitorRequirementNote,
            )}{" "}
            <AppLink
              className="font-medium text-indigo-600 hover:text-indigo-500"
              to={RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.MONITORS_SETTINGS_INCOMING_REQUEST_SECRETS
                ] as Route,
              )}
            >
              <span>
                {translator.translateText(
                  IncomingRequestSecretsCopy.manageSecretsLink,
                )}
              </span>
            </AppLink>
          </p>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default IncomingRequestSecretNote;
