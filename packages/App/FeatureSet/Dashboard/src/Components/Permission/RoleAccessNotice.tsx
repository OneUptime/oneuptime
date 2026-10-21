import { RoleAccessHolder } from "./RoleAccess";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Above the list a key or a team was created from, when the key or team was
 * made but the role picked under Access could not be added (the server
 * refused it, or the request failed). The record stays: the notice names it,
 * says why it has no access, and opens it, where a role is one click.
 */

export interface ComponentProps {
  holder: RoleAccessHolder;
  // The new key's or team's name, as typed.
  name: string;
  // Why the role was not added, as the server put it.
  error: string;
  onOpen: () => void;
  onClose: () => void;
}

export const API_KEY_ACCESS_NOTICE_TEST_ID: string = "api-key-access-notice";
export const TEAM_ACCESS_NOTICE_TEST_ID: string = "team-access-notice";

const RoleAccessNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isApiKey: boolean = props.holder === RoleAccessHolder.ApiKey;

  // Each sentence written out whole, so every language can word its own.
  const title: string = isApiKey
    ? translator.translateTemplate(
        "{{apiKeyName}} was created without access.",
        { apiKeyName: props.name },
      )
    : translator.translateTemplate("{{teamName}} was created without access.", {
        teamName: props.name,
      });

  const action: string | undefined = isApiKey
    ? translator.translateText("Open the key to give it a role")
    : translator.translateText("Open the team to give it a role");

  return (
    <Alert
      type={AlertType.DANGER}
      dataTestId={
        isApiKey ? API_KEY_ACCESS_NOTICE_TEST_ID : TEAM_ACCESS_NOTICE_TEST_ID
      }
      className="mb-5"
      strongTitle={title}
      title={props.error}
      textOnRight={action}
      onClick={props.onOpen}
      onClose={props.onClose}
    />
  );
};

export default RoleAccessNotice;
