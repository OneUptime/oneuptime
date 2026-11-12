import EaseQuestion from "./EaseQuestion";
import { ProductFeedbackKind } from "Common/Types/ProductFeedback/ProductFeedback";
import ProductFeedback, {
  useProductFeedbackSettings,
} from "Common/UI/Utils/ProductFeedback";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A GUIDED SETUP ASKS HOW IT WENT (issue #6832), once, from the frame
 * every setup is drawn in (GuidedSetupFrame), so every setup asks the same
 * way and a new setup asks without a line of its own.
 *
 *   - At the end (the frame's isFinished): "How easy was that?", when the
 *     server says to ask - once per setup per person, at most one question
 *     a week, never while the project has an open incident or alert, and
 *     never once the person or the server switched questions off
 *     (ProductFeedback.ask). It sits under the summary and blocks nothing.
 *   - Before the end: a page cannot ask anything of someone leaving it
 *     without getting in their way, so the frame offers a quiet "Stuck?
 *     Tell us what got in the way" under the steps instead, which opens the
 *     same question. The person opens it, so it is never counted as a
 *     question OneUptime asked, and it shows wherever the server takes
 *     feedback.
 */

export const SETUP_FEEDBACK_STUCK_TEST_ID: string = "guided-setup-stuck";

export interface ComponentProps {
  setup: string;
  isFinished: boolean;
}

const SetupFeedback: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  useProductFeedbackSettings();
  const [isAsked, setIsAsked] = useState<boolean>(false);
  const [isOpenedByPerson, setIsOpenedByPerson] = useState<boolean>(false);
  const [isClosed, setIsClosed] = useState<boolean>(false);
  const hasAskedRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    // Asked once per page, and not after the person already answered it.
    if (
      !props.isFinished ||
      hasAskedRef.current ||
      isOpenedByPerson ||
      // The settings may arrive after the end: asked then.
      !ProductFeedback.isAskingMe()
    ) {
      return;
    }

    hasAskedRef.current = true;
    let isMounted: boolean = true;

    void ProductFeedback.ask({
      kind: ProductFeedbackKind.SetupFlow,
      topic: props.setup,
    }).then((shouldAsk: boolean) => {
      if (isMounted && shouldAsk) {
        setIsAsked(true);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [props.isFinished, ProductFeedback.isAskingMe()]);

  if (isClosed) {
    return <></>;
  }

  if (isAsked || isOpenedByPerson) {
    return (
      <div className="mt-6">
        <EaseQuestion
          setup={props.setup}
          isFinished={props.isFinished}
          isAsked={isAsked && !isOpenedByPerson}
          onClose={() => {
            setIsClosed(true);
          }}
        />
      </div>
    );
  }

  if (props.isFinished || !ProductFeedback.isOn()) {
    return <></>;
  }

  return (
    <p className="mt-4 text-sm text-gray-500">
      <button
        type="button"
        className="rounded-sm text-gray-500 underline decoration-gray-300 underline-offset-4 hover:text-gray-700 hover:decoration-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid={SETUP_FEEDBACK_STUCK_TEST_ID}
        onClick={() => {
          setIsOpenedByPerson(true);
        }}
      >
        {translator.translateText("Stuck? Tell us what got in the way")}
      </button>
    </p>
  );
};

export default SetupFeedback;
