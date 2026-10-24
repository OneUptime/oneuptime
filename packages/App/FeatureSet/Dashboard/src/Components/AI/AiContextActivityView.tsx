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
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  activity: AiContextActivity;
}

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
 * "View" on a run's "Read the project's AI context" line (ChatActivityFeed):
 * the notes the run was given, word for word and in the order it read
 * them - the project's, then each AI rule's under the rule's name - so
 * people can see exactly what OneUptime AI was told, even after the notes
 * have been changed since. In a dialog, not under the line: notes can run
 * to pages, and the run's other steps stay where they were.
 */
const AiContextViewButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const leftOut: string | null = describeAiContextLeftOut(
    props.activity,
    translator,
  );

  return (
    <>
      <button
        type="button"
        data-testid={AI_CONTEXT_TEST_IDS.activityViewButton}
        aria-haspopup="dialog"
        className="rounded font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        {translator.translateText(AI_CONTEXT_ACTIVITY_COPY.viewButtonText)}
      </button>
      {isOpen ? (
        /*
         * English keys: the dialog translates its own title, line and
         * button.
         */
        <Modal
          title={AI_CONTEXT_ACTIVITY_COPY.modalTitle}
          description={AI_CONTEXT_ACTIVITY_COPY.modalDescription}
          modalWidth={ModalWidth.Large}
          closeButtonText={AI_CONTEXT_ACTIVITY_COPY.closeButtonText}
          onClose={() => {
            setIsOpen(false);
          }}
        >
          <div className="space-y-5">
            {props.activity.parts.map(
              (part: AiContextPart, index: number): ReactElement => {
                return (
                  <section
                    key={`${part.source}-${part.ruleId || ""}-${index}`}
                    data-testid={AI_CONTEXT_TEST_IDS.activityModalPart}
                    className="min-w-0"
                  >
                    <h3 className="text-sm font-semibold text-gray-900">
                      {getAiContextPartTitle(part, translator)}
                    </h3>
                    <div className="mt-2 min-w-0 break-words rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
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
              <p className="text-xs text-amber-700">{leftOut}</p>
            ) : (
              <></>
            )}
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </>
  );
};

export default AiContextViewButton;
