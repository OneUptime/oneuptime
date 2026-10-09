import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import {
  readFileAsDataUrl,
  saveWhiteLabelSettings,
  WHITE_LABEL_IMAGE_RULES,
  WhiteLabelImageInfo,
  WhiteLabelImageRule,
  WhiteLabelImageSlot as Slot,
  WhiteLabelSettingsView,
} from "./WhiteLabelSettingsAPI";

/*
 * One white-label image: a preview on the background it is for, and Upload
 * (Replace) and Remove. A picked file is checked for size here, with the
 * server's own sentence, then sent as a data: URL; the server reads its type
 * from its bytes and holds it to the same rules (WhiteLabelImages.ts), so
 * whatever it refuses is shown under the preview in its words.
 *
 * The preview backgrounds are inline styles, not classes: the dark theme
 * recolours classes (Theme.css), and the tile for light backgrounds has to
 * stay light in it.
 */

export type PreviewBackground = "light" | "dark";

const PREVIEW_BACKGROUND_COLORS: Record<PreviewBackground, string> = {
  light: "#ffffff",
  dark: "#0f172a",
};

const PREVIEW_PLACEHOLDER_COLORS: Record<PreviewBackground, string> = {
  light: "#6b7280",
  dark: "#94a3b8",
};

export interface ComponentProps {
  slot: Slot;
  label: string;
  hint?: string | undefined;
  image: WhiteLabelImageInfo | null;
  background: PreviewBackground;
  // What the preview says while no image is set.
  emptyText: string;
  // What removing the image does, for the confirmation.
  removedText: string;
  // The preview's height, and the image's size inside it.
  isCompact?: boolean | undefined;
  onSaved: (settings: WhiteLabelSettingsView) => void;
}

export const getSlotTestId: (slot: Slot, part: string) => string = (
  slot: Slot,
  part: string,
): string => {
  return `white-label-${slot}-${part}`;
};

const WhiteLabelImageSlot: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rule: WhiteLabelImageRule = WHITE_LABEL_IMAGE_RULES[props.slot];
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<boolean>(false);

  const save: (value: string | null) => Promise<void> = async (
    value: string | null,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      props.onSaved(await saveWhiteLabelSettings({ [props.slot]: value }));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const onFileChosen: (file: File | undefined) => Promise<void> = async (
    file: File | undefined,
  ): Promise<void> => {
    if (!file) {
      return;
    }

    if (file.size > rule.maxBytes) {
      setError(rule.tooLargeMessage);
      return;
    }

    try {
      await save(await readFileAsDataUrl(file));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  const previewHeightClassName: string = props.isCompact ? "h-20" : "h-28";
  const imageClassName: string = props.isCompact
    ? "h-8 w-8 object-contain"
    : "max-h-12 max-w-[80%] object-contain";

  return (
    <div
      className="rounded-lg border border-gray-200 p-4"
      data-testid={getSlotTestId(props.slot, "slot")}
    >
      <div className="text-sm font-medium text-gray-900">{props.label}</div>
      {props.hint ? (
        <div className="mt-0.5 text-sm text-gray-500">{props.hint}</div>
      ) : (
        <></>
      )}

      <div
        className={`mt-3 flex ${previewHeightClassName} items-center justify-center rounded-md border border-gray-200`}
        style={{
          backgroundColor: PREVIEW_BACKGROUND_COLORS[props.background],
        }}
        data-testid={getSlotTestId(props.slot, "preview")}
      >
        {props.image ? (
          <img
            src={props.image.url}
            alt={props.label}
            className={imageClassName}
            data-testid={getSlotTestId(props.slot, "image")}
          />
        ) : (
          <span
            className="px-4 text-center text-sm"
            style={{ color: PREVIEW_PLACEHOLDER_COLORS[props.background] }}
          >
            {props.emptyText}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          title={props.image ? "Replace" : "Upload"}
          icon={IconProp.Upload}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          isLoading={isSaving}
          disabled={isSaving}
          dataTestId={getSlotTestId(props.slot, "upload")}
          onClick={() => {
            setError("");
            inputRef.current?.click();
          }}
        />
        {props.image ? (
          <Button
            title="Remove"
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            disabled={isSaving}
            dataTestId={getSlotTestId(props.slot, "remove")}
            onClick={() => {
              setError("");
              setShowRemoveConfirm(true);
            }}
          />
        ) : (
          <></>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={rule.accept}
        className="hidden"
        aria-label={`${props.label} file`}
        data-testid={getSlotTestId(props.slot, "input")}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const file: File | undefined = event.target.files?.[0];
          // Choosing the same file again must fire change again.
          event.target.value = "";
          void onFileChosen(file);
        }}
      />

      {error ? (
        <p
          className="mt-2 text-sm text-red-600"
          role="alert"
          data-testid={getSlotTestId(props.slot, "error")}
        >
          {error}
        </p>
      ) : (
        <></>
      )}

      {showRemoveConfirm ? (
        <ConfirmModal
          title={`Remove the ${props.label.toLowerCase()}?`}
          description={`${props.removedText} You can upload it again at any time.`}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={error || undefined}
          onClose={() => {
            setShowRemoveConfirm(false);
          }}
          onSubmit={() => {
            save(null)
              .then(() => {
                setShowRemoveConfirm(false);
              })
              .catch(() => {
                // save() never rejects: it shows its own error.
              });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default WhiteLabelImageSlot;
