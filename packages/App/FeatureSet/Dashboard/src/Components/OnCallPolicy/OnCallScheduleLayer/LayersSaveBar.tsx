import IconProp from "Common/Types/Icon/IconProp";
import { ScheduleLayersChanges } from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessageText from "Common/UI/Components/ErrorMessage/ErrorMessageText";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE BAR AT THE FOOT OF A SCHEDULE'S LAYERS PAGE, WHILE IT HAS CHANGES.
 *
 * Changes to who takes turns wait on the page (Layers, issue #7575): the
 * bar says there are some and what they are, and offers Save changes and
 * Discard. It stays in view at the bottom of the window as the page scrolls,
 * so it is there whichever layer the change was made in. While Save runs,
 * both wait; a save the server refused says why under the changes and
 * keeps them; a save refused because someone else changed the layers first
 * asks for a reload. Once saved, it says so for a moment and goes.
 */

// What the bar is doing about the changes.
export type LayersSaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  // Saved and read again: "Changes saved", for a moment.
  | { kind: "saved" }
  // Refused or failed: the changes stay, to save again or discard.
  | { kind: "error"; message: string }
  // Someone else changed the layers after the page read them (409).
  | { kind: "conflict" }
  // Saved, but the page could not read the layers again.
  | { kind: "reloadFailed"; message: string };

// How many changes the bar names before "and N more".
export const LAYERS_SAVE_BAR_SHOWN_CHANGES: number = 3;

/*
 * The row the bar's buttons sit in. Narrower than 40rem it is the bar's
 * last row, under the words; from 40rem it is at the bar's end, beside
 * them. Its buttons undo the dialog footer's left margin Button gives them.
 */
export const LAYERS_SAVE_BAR_ACTIONS_CLASS_NAME: string =
  "flex flex-shrink-0 flex-wrap items-center gap-2 [@container(min-width:40rem)]:justify-end [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

/*
 * Each button of the bar. Narrower than 40rem the buttons share their row,
 * half the bar each, and one goes to a row of its own only when a
 * language's words do not fit both: their words never break inside a
 * button. From 40rem each is as wide as its words.
 */
export const LAYERS_SAVE_BAR_BUTTON_CLASS_NAME: string =
  "flex-1 whitespace-nowrap [@container(min-width:40rem)]:w-auto [@container(min-width:40rem)]:flex-none";

/*
 * The changes, one line each, as the bar names them: the layers deleted, a
 * new priority order, then each layer's people added, taken out and put in
 * another turn order. Without the changes worked out, one line that says
 * there are some.
 */
export const getLayersChangeLines: (data: {
  changes: ScheduleLayersChanges | null;
  getLayerName: (layerId: string) => string;
  translator: Translator;
}) => Array<string> = (data: {
  changes: ScheduleLayersChanges | null;
  getLayerName: (layerId: string) => string;
  translator: Translator;
}): Array<string> => {
  const translator: Translator = data.translator;

  if (!data.changes) {
    return [translator.translateText("Changes to the layers") || ""];
  }

  const lines: Array<string> = [];

  for (const layerId of data.changes.deletedLayerIds) {
    lines.push(
      translator.translateTemplate("{{name}} will be deleted", {
        name: data.getLayerName(layerId),
      }),
    );
  }

  if (data.changes.isLayerOrderChanged) {
    lines.push(
      translator.translateText("Layers in a new priority order") || "",
    );
  }

  for (const layer of data.changes.layers) {
    const name: string = data.getLayerName(layer.layerId);

    if (layer.addedCount > 0) {
      lines.push(
        translator.translatePlural(
          {
            one: "{{count}} user added to {{name}}",
            other: "{{count}} users added to {{name}}",
          },
          layer.addedCount,
          { name: name },
        ),
      );
    }

    if (layer.removedCount > 0) {
      lines.push(
        translator.translatePlural(
          {
            one: "{{count}} user removed from {{name}}",
            other: "{{count}} users removed from {{name}}",
          },
          layer.removedCount,
          { name: name },
        ),
      );
    }

    if (layer.isTurnOrderChanged) {
      lines.push(
        translator.translateTemplate("New turn order in {{name}}", {
          name: name,
        }),
      );
    }
  }

  return lines;
};

export interface ComponentProps {
  hasUnsavedChanges: boolean;
  status: LayersSaveStatus;
  // The changes, as getLayersChangeLines names them.
  changeLines: Array<string>;
  onSave: () => void;
  onDiscard: () => void;
  // Read the layers again, as they are saved: after a conflict, or a save the page could not read back.
  onReload: () => void;
  isReloading?: boolean | undefined;
}

const LayersSaveBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const status: LayersSaveStatus = props.status;

  /*
   * In view at the foot of the window while the page scrolls under it, and
   * in the page's flow at its end. It lays itself out by its own width, not
   * the window's: beside a record page's side menu it is some 460px wide in
   * a 768px window. Narrower than 40rem, its buttons share one row under the
   * words, half the bar each, and a button goes to a row of its own only
   * when a language's words do not fit both: stacked one above the other,
   * they made the bar a third of a phone's screen, over the layers being
   * changed. From 40rem they sit beside the words. A button keeps a dialog
   * footer's left margin (md:ml-3) and, below md, a phone's full width:
   * both are cleared here so the two sit as a pair.
   */
  const frame: (children: ReactElement, testId: string) => ReactElement = (
    children: ReactElement,
    testId: string,
  ): ReactElement => {
    return (
      <div
        data-testid={testId}
        role="region"
        aria-label={translator.translateText("Unsaved changes to the layers")}
        className="sticky bottom-4 z-30 mt-6 [container-type:inline-size]"
      >
        {children}
      </div>
    );
  };

  const actionsClassName: string = LAYERS_SAVE_BAR_ACTIONS_CLASS_NAME;

  const buttonClassName: string = LAYERS_SAVE_BAR_BUTTON_CLASS_NAME;

  if (status.kind === "conflict") {
    return frame(
      <div className="flex flex-col gap-3 rounded-xl bg-white px-4 py-3 shadow-lg ring-1 ring-amber-300 [@container(min-width:40rem)]:flex-row [@container(min-width:40rem)]:items-center [@container(min-width:40rem)]:justify-between sm:px-5 sm:py-4">
        <div className="flex min-w-0 items-start gap-3" role="alert">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200">
            <Icon icon={IconProp.Alert} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              {translator.translateText("Someone else changed these layers")}
            </p>
            <p className="mt-0.5 text-sm text-gray-600">
              {translator.translateText(
                "Your changes were not saved. Reload to see the layers as they are now, then make your changes again.",
              )}
            </p>
          </div>
        </div>
        <div className={actionsClassName}>
          <Button
            title="Reload layers"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.PRIMARY}
            className={buttonClassName}
            isLoading={Boolean(props.isReloading)}
            disabled={Boolean(props.isReloading)}
            dataTestId="layers-save-bar-reload"
            onClick={props.onReload}
          />
        </div>
      </div>,
      "layers-save-bar-conflict",
    );
  }

  if (status.kind === "reloadFailed") {
    return frame(
      <div className="flex flex-col gap-3 rounded-xl bg-white px-4 py-3 shadow-lg ring-1 ring-gray-900/10 [@container(min-width:40rem)]:flex-row [@container(min-width:40rem)]:items-center [@container(min-width:40rem)]:justify-between sm:px-5 sm:py-4">
        <div className="flex min-w-0 items-start gap-3" role="alert">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200">
            <Icon icon={IconProp.Check} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              {translator.translateText("Your changes were saved")}
            </p>
            <p className="mt-0.5 text-sm text-gray-600">
              {translator.translateText(
                "The page could not load the layers again. Reload to keep editing them.",
              )}
            </p>
            {/*
             * Why the read failed, as a failure reads anywhere
             * (ErrorMessageText): in the reader's language, and one nobody
             * explained with what to do and the reference to give.
             */}
            <p className="mt-0.5 break-words text-xs text-gray-500">
              <ErrorMessageText
                message={status.message}
                hideWhatFailed={true}
              />
            </p>
          </div>
        </div>
        <div className={actionsClassName}>
          <Button
            title="Reload layers"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.PRIMARY}
            className={buttonClassName}
            isLoading={Boolean(props.isReloading)}
            disabled={Boolean(props.isReloading)}
            dataTestId="layers-save-bar-reload"
            onClick={props.onReload}
          />
        </div>
      </div>,
      "layers-save-bar-reload-failed",
    );
  }

  if (!props.hasUnsavedChanges) {
    if (status.kind !== "saved") {
      return null;
    }

    return (
      <div className="sticky bottom-4 z-30 mt-6 flex justify-center">
        <p
          data-testid="layers-save-bar-saved"
          role="status"
          className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-4 w-4 text-emerald-400"
          />
          {translator.translateText("Changes saved")}
        </p>
      </div>
    );
  }

  const isSaving: boolean = status.kind === "saving";
  const shownLines: Array<string> = props.changeLines.slice(
    0,
    LAYERS_SAVE_BAR_SHOWN_CHANGES,
  );
  const moreCount: number = props.changeLines.length - shownLines.length;

  return frame(
    <div className="flex flex-col gap-3 rounded-xl bg-white px-4 py-3 shadow-lg ring-1 ring-gray-900/10 [@container(min-width:40rem)]:flex-row [@container(min-width:40rem)]:items-center [@container(min-width:40rem)]:justify-between sm:px-5 sm:py-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200">
          <Icon icon={IconProp.PencilSquare} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {translator.translateText("You have unsaved changes")}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {translator.translateText(
              "Nothing changes for the people on call until you save.",
            )}
          </p>
          {shownLines.length > 0 && (
            <ul
              data-testid="layers-save-bar-changes"
              className="mt-1.5 space-y-0.5 text-sm text-gray-700"
            >
              {shownLines.map((line: string, index: number) => {
                return (
                  <li key={index} className="flex min-w-0 items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400"
                    />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                );
              })}
              {moreCount > 0 && (
                <li className="pl-3 text-xs text-gray-500">
                  {translator.translatePlural(
                    {
                      one: "and {{count}} more change",
                      other: "and {{count}} more changes",
                    },
                    moreCount,
                  )}
                </li>
              )}
            </ul>
          )}
          {status.kind === "error" && (
            <p
              data-testid="layers-save-bar-error"
              role="alert"
              className="mt-1.5 break-words text-sm font-medium text-red-600"
            >
              <ErrorMessageText
                message={status.message}
                hideWhatFailed={true}
              />
            </p>
          )}
        </div>
      </div>
      <div className={actionsClassName}>
        <Button
          title="Discard"
          buttonStyle={ButtonStyleType.OUTLINE}
          className={buttonClassName}
          disabled={isSaving}
          dataTestId="layers-save-bar-discard"
          onClick={props.onDiscard}
        />
        <Button
          title={isSaving ? "Saving…" : "Save changes"}
          buttonStyle={ButtonStyleType.PRIMARY}
          className={buttonClassName}
          isLoading={isSaving}
          disabled={isSaving}
          dataTestId="layers-save-bar-save"
          onClick={props.onSave}
        />
      </div>
    </div>,
    "layers-save-bar",
  );
};

export default LayersSaveBar;
