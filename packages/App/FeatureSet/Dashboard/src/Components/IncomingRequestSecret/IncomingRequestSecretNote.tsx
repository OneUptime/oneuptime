import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import IncomingRequestSecretsCopy, {
  INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
} from "./IncomingRequestSecretsCopy";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Whether the project requires a secret (useIncomingRequestSecretRequirement).
  isRequired: boolean;
  // Spacing from what is above it, applied only when the note is drawn.
  className?: string | undefined;
}

/*
 * Under an Incoming Request monitor's heartbeat URL, while its project
 * requires an incoming request secret: that a request without one is
 * refused, where the secret goes, and where the secrets are. Whoever wires
 * a sender up reads the URL here, and a sender sending only the URL would
 * be refused without this line. Nothing at all while no secret is required.
 */
const IncomingRequestSecretNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.isRequired) {
    return <></>;
  }

  return (
    <div
      data-testid={INCOMING_REQUEST_SECRET_NOTE_TEST_ID}
      className={`flex items-start gap-2 text-sm text-gray-600 ${props.className || ""}`.trim()}
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
  );
};

export default IncomingRequestSecretNote;
