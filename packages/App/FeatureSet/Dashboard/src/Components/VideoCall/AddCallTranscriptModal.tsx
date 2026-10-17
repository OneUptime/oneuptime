import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import { VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS } from "Common/Types/VideoCall/VideoCallTranscript";
import TranscriptText from "Common/Utils/VideoCall/TranscriptText";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  ChangeEvent,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { CallTranscriptSaved, addCallTranscript } from "./CallTranscriptApi";
import { MAX_TRANSCRIPT_FILE_BYTES } from "./CallTranscriptState";

/*
 * Add a call's transcript by hand (issue #4875): the file the meeting tool
 * saved - WebVTT, SRT or text - or the transcript pasted. It works for
 * every call: a Microsoft Teams meeting, whose transcript Microsoft lets
 * no app read, a Slack huddle, a link of one's own, and a Zoom or Google
 * Meet call whose provider could not be asked.
 *
 * The file is read in the browser and sent as text, so it is checked here
 * first - empty, too long - and the person hears at once, without an
 * upload. Adding replaces any transcript the call had, and OneUptime AI
 * reads the new one.
 */

export interface ComponentProps {
  callId: ObjectID;
  // "Zoom meeting", or a link's own title.
  callLabel: string;
  provider?: VideoCallProvider | undefined;
  // The call has a transcript already, which this one replaces.
  isReplacing?: boolean | undefined;
  onClose: () => void;
  onAdded: (result: CallTranscriptSaved) => void;
}

interface ChosenFile {
  name: string;
  size: number;
  text: string;
}

// Where each provider's transcript is found, said in the dialog.
export function getTranscriptSourceHint(
  provider: VideoCallProvider | undefined,
): string {
  switch (provider) {
    case VideoCallProvider.MicrosoftTeams:
      return translationKey(
        "In Microsoft Teams, open the meeting's Recap, then Transcript, and download it as a .vtt file.",
      );
    case VideoCallProvider.Zoom:
      return translationKey(
        "In Zoom, open Recordings and Transcripts and download the meeting's transcript (.vtt).",
      );
    case VideoCallProvider.GoogleMeet:
      return translationKey(
        "Google Meet saves the transcript to the organizer's Google Drive: open it and copy its text.",
      );
    case VideoCallProvider.SlackHuddle:
      return translationKey(
        "In Slack, open the huddle's notes and copy the transcript.",
      );
    default:
      return translationKey(
        "Most meeting tools let you download a call's transcript as a .vtt or .txt file.",
      );
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  // "5 MB", "2.4 MB".
  const megabytes: number = Math.round((bytes / (1024 * 1024)) * 10) / 10;

  return `${megabytes} MB`;
}

const AddCallTranscriptModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fileInput: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [pasted, setPasted] = useState<string>("");
  const [isReading, setIsReading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const chooseFile: (chosen: File | undefined) => Promise<void> = async (
    chosen: File | undefined,
  ): Promise<void> => {
    setError(undefined);

    if (!chosen) {
      return;
    }

    if (chosen.size > MAX_TRANSCRIPT_FILE_BYTES) {
      setError(
        translator.translateTemplate(
          "This file is larger than {{size}}. Add the part of the call about the incident.",
          { size: formatFileSize(MAX_TRANSCRIPT_FILE_BYTES) },
        ),
      );
      return;
    }

    setIsReading(true);

    try {
      const text: string = await chosen.text();
      setFile({ name: chosen.name, size: chosen.size, text });
    } catch {
      setError(translator.translateText("This file could not be read."));
    } finally {
      setIsReading(false);
    }
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    setError(undefined);

    const text: string = file ? file.text : pasted;

    // The same checks the server makes, said at once.
    try {
      TranscriptText.prepare({ text, fileName: file?.name });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    setIsSaving(true);

    try {
      const result: CallTranscriptSaved = await addCallTranscript({
        callId: props.callId,
        text,
        fileName: file?.name,
      });

      setIsSaving(false);
      props.onAdded(result);
    } catch (err) {
      setIsSaving(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  return (
    <Modal
      title={
        props.isReplacing
          ? "Replace the call's transcript"
          : "Add the call's transcript"
      }
      description={translator.translateTemplate(
        "Upload the transcript of the {{call}} or paste it. OneUptime AI reads it and suggests what caused the incident, for you to review.",
        { call: props.callLabel },
      )}
      modalWidth={ModalWidth.Medium}
      submitButtonText={
        props.isReplacing ? "Replace transcript" : "Add transcript"
      }
      isLoading={isSaving || isReading}
      disableSubmitButton={!file && !pasted.trim()}
      error={error}
      onClose={props.onClose}
      onSubmit={() => {
        void save();
      }}
    >
      <div className="space-y-4" data-testid="add-call-transcript">
        <input
          ref={fileInput}
          type="file"
          accept={VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS.join(",")}
          className="sr-only"
          data-testid="add-call-transcript-file-input"
          aria-label={translator.translateText("Transcript file")}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            void chooseFile(event.target.files?.[0]);
            // The same file can be chosen again after it is removed.
            event.target.value = "";
          }}
        />

        {file ? (
          <div
            data-testid="add-call-transcript-file"
            className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3"
          >
            <Icon
              icon={IconProp.DocumentText}
              className="h-5 w-5 flex-shrink-0 text-indigo-600"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {file.name}
              </p>
              <p className="text-xs text-gray-500">
                {formatFileSize(file.size)}
              </p>
            </div>
            <button
              type="button"
              data-testid="add-call-transcript-file-remove"
              className="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => {
                setFile(null);
                setError(undefined);
              }}
            >
              {translator.translateText("Remove")}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              data-testid="add-call-transcript-choose-file"
              onClick={() => {
                fileInput.current?.click();
              }}
              onDragOver={(event: React.DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
              }}
              onDrop={(event: React.DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                void chooseFile(event.dataTransfer.files?.[0]);
              }}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center transition-colors hover:border-indigo-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Icon
                icon={IconProp.DocumentArrowUp}
                className="h-6 w-6 text-gray-400"
              />
              <span className="text-sm font-medium text-indigo-600">
                {translator.translateText("Choose a file")}
              </span>
              <span className="text-xs text-gray-500">
                {translator.translateTemplate(
                  "or drop it here: .vtt, .srt or .txt, up to {{size}}",
                  { size: formatFileSize(MAX_TRANSCRIPT_FILE_BYTES) },
                )}
              </span>
            </button>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-500">
                {translator.translateText("or paste it")}
              </span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            {/*
              The box's name for a screen reader: the divider above it is
              drawn only, and a placeholder is no name.
            */}
            <span id="add-call-transcript-text-label" className="sr-only">
              {translator.translateText("Transcript")}
            </span>
            <TextArea
              id="add-call-transcript-text"
              ariaLabelledby="add-call-transcript-text-label"
              dataTestId="add-call-transcript-text"
              value={pasted}
              rows={6}
              placeholder="[00:12:03] Priya Shah: The pool maxes at 50 and we just went to 100 workers."
              onChange={(value: string) => {
                setPasted(value);
                setError(undefined);
              }}
            />
          </>
        )}

        <p
          className="text-xs text-gray-500"
          data-testid="add-call-transcript-hint"
        >
          {translator.translateText(getTranscriptSourceHint(props.provider))}
        </p>
      </div>
    </Modal>
  );
};

export default AddCallTranscriptModal;
