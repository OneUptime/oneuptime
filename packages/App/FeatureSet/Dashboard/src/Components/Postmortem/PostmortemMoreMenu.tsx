import IconProp from "Common/Types/Icon/IconProp";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import {
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { GENERATE_WITH_AI } from "./PostmortemEmptyState";

export const APPLY_TEMPLATE: string = translationKey("Apply Template");
export const POSTMORTEM_MORE_OPTIONS: string = translationKey(
  "More postmortem options",
);

export interface ComponentProps {
  // The gate of writing the postmortem: what Edit Postmortem Note takes.
  writeGate: PermissionGateResult;
  hasTemplates: boolean;
  isAiOffered: boolean;
  onApplyTemplate: () => void;
  onGenerateWithAI: () => void;
}

/*
 * Whether the ⋯ has anything to hold: a template to apply, or AI to draft
 * with, for someone the permissions are known for.
 */
export const hasPostmortemMoreMenuItems: (data: {
  writeGate: PermissionGateResult;
  hasTemplates: boolean;
  isAiOffered: boolean;
}) => boolean = (data: {
  writeGate: PermissionGateResult;
  hasTemplates: boolean;
  isAiOffered: boolean;
}): boolean => {
  if (!data.writeGate.isAllowed && !data.writeGate.disabledReason) {
    return false;
  }

  return data.hasTemplates || data.isAiOffered;
};

/*
 * The ⋯ beside Edit Postmortem Note on a written postmortem: Apply Template,
 * once the project has a template, and Generate with AI, while AI is on.
 * Both replace the note - in the editor, saved only on Save Changes - which
 * a written postmortem rarely needs, so they are folded away rather than
 * buttons of their own. Locked, with the reason, for someone who may not
 * edit the postmortem, as Edit is.
 */
const PostmortemMoreMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!hasPostmortemMoreMenuItems(props)) {
    return <></>;
  }

  const items: Array<ReactElement> = [];

  if (props.hasTemplates) {
    items.push(
      <MoreMenuItem
        key="apply-template"
        text={APPLY_TEMPLATE}
        icon={IconProp.Template}
        isDisabled={!props.writeGate.isAllowed}
        tooltip={props.writeGate.disabledReason}
        dataTestId="postmortem-apply-template"
        onClick={props.onApplyTemplate}
      />,
    );
  }

  if (props.isAiOffered) {
    items.push(
      <MoreMenuItem
        key="generate-with-ai"
        text={GENERATE_WITH_AI}
        icon={IconProp.Bolt}
        isDisabled={!props.writeGate.isAllowed}
        tooltip={props.writeGate.disabledReason}
        dataTestId="postmortem-generate-with-ai"
        onClick={props.onGenerateWithAI}
      />,
    );
  }

  return (
    <CardMoreMenu
      ariaLabel={
        translator.translateText(POSTMORTEM_MORE_OPTIONS) ||
        POSTMORTEM_MORE_OPTIONS
      }
      dataTestId="postmortem-more-menu"
    >
      {items}
    </CardMoreMenu>
  );
};

export default PostmortemMoreMenu;
