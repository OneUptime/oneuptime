import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Where a setting that saves itself (no Save button, no dialog) is with its
 * last change.
 */
export enum SaveState {
  // Nothing changed here since the setting was drawn, or a change failed.
  Idle = "Idle",
  Saving = "Saving",
  Saved = "Saved",
}

export interface ComponentProps {
  state: SaveState;
  // Spacing from the setting it sits beside.
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * "Saving…" while a change is on its way and "Saved" once it is, beside a
 * setting that saves the moment it changes - the words and the tick a
 * settings switch (ModelSwitchRow) and a status page's number of days show.
 *
 * It is always in the page, empty while nothing is happening: a screen
 * reader hears "Saved" as it appears only from a live region that was
 * already there, and one added along with its text is often not announced.
 * Why a change failed is not said here; it is an alert beside the setting.
 */
const SaveStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const getContent: () => ReactNode = (): ReactNode => {
    if (props.state === SaveState.Saving) {
      return (
        <div className="text-gray-500">
          {translator.translateText("Saving…")}
        </div>
      );
    }

    if (props.state === SaveState.Saved) {
      return (
        <div className="inline-flex items-center gap-1 text-emerald-700">
          <Icon icon={IconProp.Check} className="h-4 w-4" />
          {translator.translateText("Saved")}
        </div>
      );
    }

    return null;
  };

  /*
   * Divs, not spans: Icon draws a div of its own, which a span may not
   * hold.
   */
  return (
    <div
      role="status"
      className={`inline-flex items-center text-sm ${props.className || ""}`}
      data-testid={props.dataTestId}
    >
      {getContent()}
    </div>
  );
};

export default SaveStatus;
