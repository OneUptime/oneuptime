import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import { buildReplayLinkRoute } from "../SessionReplay/ReplayLinkRoute";

/* A session's replay, from anywhere on the User Flows page. */

export interface ComponentProps {
  sessionId: string | undefined;
  rumApplicationId: ObjectID;
}

const UserFlowWatchLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.sessionId) {
    return <></>;
  }

  const route: Route | null = buildReplayLinkRoute({
    rumApplicationId: props.rumApplicationId,
    sessionId: props.sessionId,
  });

  if (!route) {
    return <></>;
  }

  return (
    <AppLink
      to={route}
      dataTestId="user-flow-watch"
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-700 hover:underline"
    >
      <Icon icon={IconProp.Play} className="h-3 w-3" />
      <span>{translator.translateText("Watch")}</span>
    </AppLink>
  );
};

export default UserFlowWatchLink;
