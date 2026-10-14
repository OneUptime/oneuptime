import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Asks before a project's Slack or Microsoft Teams connection goes. It is
 * the one step on the settings pages that reaches every member: their own
 * connected accounts, and the notification method each set up with one, go
 * with it (WorkspaceProjectAuthTokenService). The notification rules and
 * summaries stay, for when the workspace is connected again.
 */
export const UNINSTALL_WORKSPACE_TITLE: string = translationKey(
  "Uninstall OneUptime from {{workspace}}?",
);

export const UNINSTALL_WORKSPACE_WARNING: string = translationKey(
  "OneUptime stops posting to {{workspace}}, and every member's {{workspace}} account is disconnected from this project, along with their {{workspace}} notification method. The {{workspace}} notification rules and summaries are kept for when you connect again.",
);

export const UNINSTALL_WORKSPACE_BUTTON: string = translationKey("Uninstall");

// The ⋯ of a project's connection card: what it holds, for a screen reader.
export const MANAGE_WORKSPACE_CONNECTION: string = translationKey(
  "Manage the {{workspace}} connection",
);

export interface ComponentProps {
  // "Slack", "Microsoft Teams": a name, the same in every language.
  workspaceName: string;
  isUninstalling: boolean;
  // Why the last try failed; empty when it did not.
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

const UninstallWorkspaceConfirm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ConfirmModal
      title={translator.translateTemplate(UNINSTALL_WORKSPACE_TITLE, {
        workspace: props.workspaceName,
      })}
      description={translator.translateTemplate(UNINSTALL_WORKSPACE_WARNING, {
        workspace: props.workspaceName,
      })}
      submitButtonText={UNINSTALL_WORKSPACE_BUTTON}
      submitButtonType={ButtonStyleType.DANGER}
      isLoading={props.isUninstalling}
      error={props.error || undefined}
      onClose={props.onClose}
      onSubmit={props.onConfirm}
    />
  );
};

export default UninstallWorkspaceConfirm;
