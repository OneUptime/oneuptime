import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
   * update. Locked, Write Postmortem stays where it is, dimmed, with why
   * under it; with nothing honest to say yet (permissions not loaded), no
   * button is drawn.
   */
  writeGate: PermissionGateResult;
  hasTemplates: boolean;
  isAiOffered: boolean;
  onWrite: () => void;
  onApplyTemplate: () => void;
  onGenerateWithAI: () => void;
}

interface EmptyStateAction {
  title: string;
  icon: IconProp;
  buttonStyle: ButtonStyleType;
  onClick: () => void;
  dataTestId: string;
}

/*
 * What an incident's Postmortem page shows while nothing is written: one
 * obvious next step, Write Postmortem, and beside it the two ways to start
 * from something - a template, once the project has one, and a draft by
 * OneUptime AI, while AI is on. All three open the same editor.
 *
 * Drawn like a list's empty state (TableEmptyState): the primary button
 * first, the others plain white buttons beside it - never bare words that
 * read as text - one under the other at full width on a phone. Someone who
 * may not write the postmortem sees Write Postmortem alone, dimmed, and why
 * under it: the other two are only other ways to do what they cannot.
 */
const PostmortemEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const isLocked: boolean = !props.writeGate.isAllowed;
  const isLockedSilently: boolean = isLocked && !props.writeGate.disabledReason;

  const actions: Array<EmptyStateAction> = [
    {
      title: WRITE_POSTMORTEM,
      icon: IconProp.Edit,
      buttonStyle: ButtonStyleType.PRIMARY,
      onClick: props.onWrite,
      dataTestId: "postmortem-write-button",
    },
  ];

  if (!isLocked && props.hasTemplates) {
    actions.push({
      title: START_FROM_TEMPLATE,
      icon: IconProp.Template,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: props.onApplyTemplate,
      dataTestId: "postmortem-start-from-template-button",
    });
  }

  if (!isLocked && props.isAiOffered) {
    actions.push({
      title: GENERATE_WITH_AI,
      icon: IconProp.Bolt,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: props.onGenerateWithAI,
      dataTestId: "postmortem-generate-with-ai-button",
    });
  }

  const footer: ReactElement | undefined = isLockedSilently ? undefined : (
    <div
      className="flex w-full flex-col items-center"
      data-testid="postmortem-empty-state-footer"
    >
      {/*
       * A column on a phone, each button the full width and easy to tap; a
       * row from sm up. The buttons' own left margin is for a dialog's
       * footer - here the gap spaces them.
       */}
      <div
        className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:flex-wrap [&>div>button]:ml-0 [&>div>button]:md:ml-0 [&>div>*>button]:ml-0 [&>div>*>button]:md:ml-0"
        data-testid="postmortem-empty-state-actions"
      >
        {actions.map((action: EmptyStateAction): ReactElement => {
          return (
            <div key={action.dataTestId} className="w-full sm:w-auto">
              <Button
                title={action.title}
                icon={action.icon}
                buttonStyle={action.buttonStyle}
                onClick={action.onClick}
                dataTestId={action.dataTestId}
                // Locked, it is drawn dimmed: the note under it says why.
                disabled={isLocked}
                tooltip={isLocked ? props.writeGate.disabledReason : undefined}
              />
            </div>
          );
        })}
      </div>
      {isLocked && props.writeGate.disabledReason ? (
        <p
          className="mt-4 max-w-md text-balance text-xs leading-5 text-gray-500"
          data-testid="postmortem-empty-state-note"
        >
          {translator.translateText(props.writeGate.disabledReason)}
        </p>
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
