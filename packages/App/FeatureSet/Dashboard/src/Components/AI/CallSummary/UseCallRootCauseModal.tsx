import Incident from "Common/Models/DatabaseModels/Incident";
import ObjectID from "Common/Types/ObjectID";
import { RootCauseSuggestionStatus } from "Common/Types/VideoCall/CallSummary";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { reviewCallRootCauseSuggestion } from "../../VideoCall/CallTranscriptApi";

/*
 * Use as root cause (issue #4875): the root cause OneUptime AI suggested
 * from an incident call, in the root cause's own editor, for the person to
 * read and change before it is saved. Saving makes it the incident's root
 * cause - an edit of the incident as that person, recorded in its feed like
 * any other - and marks the suggestion used. Nothing is written before.
 *
 * An incident nearly always has a root cause already: the person who
 * declared it, or what its monitor saw. The dialog says this one replaces
 * it, and shows it, so nothing is lost unseen.
 */

export interface ComponentProps {
  callId: ObjectID;
  incidentId: ObjectID;
  // What the editor starts with: the suggestion and the lines it rests on.
  initialRootCause: string;
  onClose: () => void;
  onSaved: () => void;
}

const UseCallRootCauseModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [rootCause, setRootCause] = useState<string>(props.initialRootCause);
  const [current, setCurrent] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const editorRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * The dialog starts in the editor, at the start of the suggestion, ready
   * to be read and changed. The dialog would otherwise start on the first
   * button it holds, the editor's Bold, whose focus ring reads as Bold being
   * on. This runs after the dialog's own first focus: a parent's effects
   * run after its children's.
   */
  useEffect(() => {
    const textbox: HTMLElement | null | undefined =
      editorRef.current?.querySelector<HTMLElement>(
        "[role='textbox'], textarea",
      );

    textbox?.focus();
  }, []);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<Incident>({
      modelType: Incident,
      id: props.incidentId,
      select: { _id: true, rootCause: true },
    })
      .then((incident: Incident | null) => {
        if (isCurrent) {
          setCurrent((incident?.rootCause || "").trim());
        }
      })
      .catch(() => {
        // Without it the dialog still says what saving does.
        if (isCurrent) {
          setCurrent("");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.incidentId.toString()]);

  const save: () => Promise<void> = async (): Promise<void> => {
    setError(undefined);

    if (!rootCause.trim()) {
      setError(translator.translateText("Write the root cause to save."));
      return;
    }

    setIsSaving(true);

    try {
      await reviewCallRootCauseSuggestion({
        callId: props.callId,
        decision: RootCauseSuggestionStatus.Accepted,
        rootCause,
      });
      setIsSaving(false);
      props.onSaved();
    } catch (err) {
      setIsSaving(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  return (
    <Modal
      title="Use as root cause"
      description="This becomes the incident's root cause. Read it and change what you need to first."
      modalWidth={ModalWidth.Large}
      submitButtonText="Save as root cause"
      isLoading={isSaving}
      disableSubmitButton={!rootCause.trim()}
      error={error}
      onClose={props.onClose}
      onSubmit={() => {
        void save();
      }}
    >
      <div className="space-y-4" data-testid="use-call-root-cause">
        {/* What a screen reader calls the editor: the dialog's title is the action. */}
        <span id="use-call-root-cause-label" className="sr-only">
          {translator.translateText("Root Cause")}
        </span>
        <div ref={editorRef}>
          <MarkdownEditor
            dataTestId="use-call-root-cause-editor"
            ariaLabelledby="use-call-root-cause-label"
            initialValue={props.initialRootCause}
            allowImageUpload={false}
            onChange={(value: string) => {
              setRootCause(value);
              setError(undefined);
            }}
          />
        </div>

        {current ? (
          <details
            data-testid="use-call-root-cause-current"
            className="group text-sm"
          >
            <summary className="cursor-pointer select-none text-gray-600 hover:text-gray-900">
              {translator.translateText(
                "It replaces the incident's current root cause. Show it",
              )}
            </summary>
            <div className="mt-2 border-l-2 border-gray-200 pl-3 text-gray-700">
              <LazyMarkdownViewer text={current} />
            </div>
          </details>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default UseCallRootCauseModal;
