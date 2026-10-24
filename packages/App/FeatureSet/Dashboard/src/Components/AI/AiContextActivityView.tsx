import {
  AI_CONTEXT_ACTIVITY_COPY,
  AI_CONTEXT_TEST_IDS,
  describeAiContextLeftOut,
  describeAiContextSize,
} from "../AISettings/AiContextCopy";
import {
  AiContextActivity,
  AiContextPart,
  AiContextSource,
} from "Common/Types/AI/AiContext";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// Where a rule's name goes in its heading's sentence ("AI rule {{name}}").
const RULE_NAME_PLACEHOLDER: string = "{{name}}";

// "Project", or "AI rule Checkout incidents", in the reader's language.
export function getAiContextPartTitle(
  part: AiContextPart,
  translator: Translator,
): string {
  if (part.source === AiContextSource.AiRule) {
    return translator.translateTemplate(
      AI_CONTEXT_ACTIVITY_COPY.rulePartTitle,
      { name: part.ruleName || "" },
    );
  }

  return (
    translator.translateText(AI_CONTEXT_ACTIVITY_COPY.projectPartTitle) ||
    AI_CONTEXT_ACTIVITY_COPY.projectPartTitle
  );
}

/*
 * A part's heading in the dialog. A rule's says which rule by its name, in
 * full weight, the words around it ("AI rule") quieter - in the order the
 * reader's language puts them - so "AI rule Checkout incidents" reads as a
 * kind and a name rather than one run of words. The name is the team's own:
 * isolated, so a name in another script keeps its punctuation in place on a
 * right-to-left page.
 */
export const AiContextPartHeading: FunctionComponent<{
  part: AiContextPart;
}> = (props: { part: AiContextPart }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.part.source === AiContextSource.AiRule) {
    const sentence: string =
      translator.translateText(AI_CONTEXT_ACTIVITY_COPY.rulePartTitle) ||
      AI_CONTEXT_ACTIVITY_COPY.rulePartTitle;
    const at: number = sentence.indexOf(RULE_NAME_PLACEHOLDER);

    if (at >= 0) {
      return (
        <h3 className="text-sm text-gray-500">
          {sentence.slice(0, at)}
          <bdi className="font-semibold text-gray-900">
            {props.part.ruleName || ""}
          </bdi>
          {sentence.slice(at + RULE_NAME_PLACEHOLDER.length)}
        </h3>
      );
    }
  }

  return (
    <h3 className="text-sm font-semibold text-gray-900">
      {getAiContextPartTitle(props.part, translator)}
    </h3>
  );
};

export interface AiContextViewButtonProps {
  /*
   * Opens the dialog. The feed holds which run's notes are open, not the
   * button: a live run's line scrolls out of its feed as steps come in,
   * and the notes someone is reading must stay open when it does.
   */
  onClick: () => void;
  // The line the button belongs to, read with its name.
  describedById?: string | undefined;
}

// "View" on a run's "Read the project's AI context" line (ChatActivityFeed).
export const AiContextViewButton: FunctionComponent<
  AiContextViewButtonProps
> = (props: AiContextViewButtonProps): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <button
      type="button"
      data-testid={AI_CONTEXT_TEST_IDS.activityViewButton}
      aria-haspopup="dialog"
      aria-describedby={props.describedById}
      className="rounded font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      onClick={props.onClick}
    >
      {translator.translateText(AI_CONTEXT_ACTIVITY_COPY.viewButtonText)}
    </button>
  );
};

export interface AiContextActivityDialogProps {
  activity: AiContextActivity;
  onClose: () => void;
}

/*
 * What the View on a run's AI context line opens: the notes the run was
 * given, word for word and in the order it read them - the project's, then
 * each AI rule's under the rule's name - so people can see exactly what
 * OneUptime AI was told, even after the notes have been changed since. In a
 * dialog, not under the line: notes can run to pages, and the run's other
 * steps stay where they were. When a rule's notes were left out for the
 * run's limit, the dialog says so last, and names the rules.
 */
export const AiContextActivityDialog: FunctionComponent<
  AiContextActivityDialogProps
> = (props: AiContextActivityDialogProps): ReactElement => {
  const translator: Translator = useTranslator();
  const leftOut: string | null = describeAiContextLeftOut(
    props.activity,
    translator,
  );
  const leftOutNames: Array<string> = (
    props.activity.leftOutRuleNames || []
  ).filter((name: string): boolean => {
    return Boolean(name && name.trim());
  });

  return (
    /*
     * English keys: the dialog translates its own title, line and
     * button.
     */
    <Modal
      title={AI_CONTEXT_ACTIVITY_COPY.modalTitle}
      description={AI_CONTEXT_ACTIVITY_COPY.modalDescription}
      modalWidth={ModalWidth.Large}
      closeButtonText={AI_CONTEXT_ACTIVITY_COPY.closeButtonText}
      onClose={props.onClose}
    >
      {/*
       * text-start: the dialog's panel sets text-left, which on a
       * right-to-left page would put the headings and counts at the wrong
       * edge; they start where the reader's language starts.
       */}
      <div className="space-y-5 text-start">
        {props.activity.parts.map(
          (part: AiContextPart, index: number): ReactElement => {
            return (
              <section
                key={`${part.source}-${part.ruleId || ""}-${index}`}
                data-testid={AI_CONTEXT_TEST_IDS.activityModalPart}
                className="min-w-0"
              >
                <AiContextPartHeading part={part} />
                {/*
                 * Flush with the box: a first heading's top margin would
                 * open a gap under its border. dir="auto": the notes are
                 * laid out by their own first letter, not the reader's
                 * language.
                 */}
                <div
                  dir="auto"
                  className="mt-2 min-w-0 break-words rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 [&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0"
                >
                  <LazyMarkdownViewer text={part.text} />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  {describeAiContextSize(part.text, translator)}
                </p>
              </section>
            );
          },
        )}
        {leftOut ? (
          <div
            data-testid={AI_CONTEXT_TEST_IDS.activityModalLeftOut}
            className="flex items-start gap-2 text-xs text-amber-700"
          >
            <div className="flex h-4 flex-shrink-0 items-center">
              <Icon
                icon={IconProp.Info}
                className="h-3 w-3 flex-shrink-0 text-amber-500"
              />
            </div>
            <div className="min-w-0">
              <p className="leading-4">{leftOut}</p>
              {leftOutNames.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 ps-4">
                  {leftOutNames.map(
                    (name: string, index: number): ReactElement => {
                      return (
                        <li key={`${name}-${index}`} className="break-words">
                          <bdi>{name}</bdi>
                        </li>
                      );
                    },
                  )}
                </ul>
              ) : (
                <></>
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default AiContextActivityDialog;
