import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export const POSTMORTEM_EMPTY_TITLE: string =
  translationKey("No postmortem yet");
export const POSTMORTEM_EMPTY_DESCRIPTION: string = translationKey(
  "Write down what happened, its impact on your users, and what changes now.",
);
export const WRITE_POSTMORTEM: string = translationKey("Write Postmortem");
export const START_FROM_TEMPLATE: string = translationKey(
  "Start from Template",
);
export const GENERATE_WITH_AI: string = translationKey("Generate with AI");

export interface ComponentProps {
  /*
   * Whether the reader may write the postmortem: the gate of the incident's
   * update. Locked, the buttons stay where they are and say why; with
   * nothing honest to say yet (permissions not loaded), they are not drawn.
   */
  writeGate: PermissionGateResult;
  hasTemplates: boolean;
  isAiOffered: boolean;
  onWrite: () => void;
  onApplyTemplate: () => void;
  onGenerateWithAI: () => void;
}

/*
 * What an incident's Postmortem page shows while nothing is written: one
 * obvious next step, Write Postmortem, and beside it the two ways to start
 * from something - a template, once the project has one, and a draft by
 * OneUptime AI, while AI is on. All three open the same editor.
 */
const PostmortemEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isLockedSilently: boolean =
    !props.writeGate.isAllowed && !props.writeGate.disabledReason;

  const lockProps: {
    disabled: boolean;
    tooltip: string | undefined;
  } = {
    disabled: !props.writeGate.isAllowed,
    tooltip: props.writeGate.disabledReason,
  };

  const footer: ReactElement | undefined = isLockedSilently ? undefined : (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button
        title={WRITE_POSTMORTEM}
        icon={IconProp.Edit}
        buttonStyle={ButtonStyleType.PRIMARY}
        onClick={props.onWrite}
        dataTestId="postmortem-write-button"
        {...lockProps}
      />
      {props.hasTemplates ? (
        <Button
          title={START_FROM_TEMPLATE}
          icon={IconProp.Template}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={props.onApplyTemplate}
          dataTestId="postmortem-start-from-template-button"
          {...lockProps}
        />
      ) : (
        <></>
      )}
      {props.isAiOffered ? (
        <Button
          title={GENERATE_WITH_AI}
          icon={IconProp.Bolt}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={props.onGenerateWithAI}
          dataTestId="postmortem-generate-with-ai-button"
          {...lockProps}
        />
      ) : (
        <></>
      )}
    </div>
  );

  return (
    <div className="w-full" data-testid="postmortem-empty-state">
      <EmptyState
        id="postmortem-empty-state"
        icon={IconProp.DocumentText}
        title={POSTMORTEM_EMPTY_TITLE}
        description={POSTMORTEM_EMPTY_DESCRIPTION}
        paddingClassName="py-8"
        footer={footer}
      />
    </div>
  );
};

export default PostmortemEmptyState;
