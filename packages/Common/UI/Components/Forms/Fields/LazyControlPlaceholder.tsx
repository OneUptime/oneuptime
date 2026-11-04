import FieldError from "./FieldError";
import ChunkLoadRecovery, {
  ChunkLoadRecoveryVariant,
} from "../../NewVersion/ChunkLoadRecovery";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  dataTestId: string;
  /*
   * The control's shape, as big as the control will be: what is drawn until
   * its file has arrived, so nothing on the form moves when it does.
   */
  shape: ReactElement;
  // Why its file did not arrive; null while it is on its way.
  loadError: Error | null;
  // The field's own error, while the shape cannot show it.
  fieldError?: string | undefined;
  // The field's label: says which field is loading to a screen reader.
  ariaLabelledby?: string | undefined;
}

/*
 * What a form field draws in place of a control that is a file of its own (a
 * code editor, a Markdown editor, a file picker) until that file has arrived.
 *
 * If it does not arrive, the field keeps its size and says so where the
 * control would be, rather than stay a label over an empty space. It says so
 * as every part of a page whose code will not download does
 * (ChunkLoadRecovery): the usual reason is a new version deployed while the
 * tab was open, and it moves the page onto that version - asking first if
 * something typed would be lost - until a reload has not helped either, and
 * it says this could not be loaded. The form's other fields stay as they are.
 */
const LazyControlPlaceholder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.loadError) {
    return (
      <div data-testid={props.dataTestId} data-load-state="failed">
        <div className="grid grid-cols-1">
          <div className="invisible col-start-1 row-start-1" aria-hidden="true">
            {props.shape}
          </div>
          <div className="col-start-1 row-start-1 flex min-w-0 rounded-md border border-gray-300 bg-white">
            <ChunkLoadRecovery
              error={props.loadError}
              variant={ChunkLoadRecoveryVariant.Part}
              isCompact={true}
            />
          </div>
        </div>
        {props.fieldError && <FieldError message={props.fieldError} />}
      </div>
    );
  }

  return (
    <div
      data-testid={props.dataTestId}
      data-load-state="loading"
      role="status"
      aria-live="polite"
      aria-labelledby={props.ariaLabelledby}
    >
      {props.shape}
      <span className="sr-only">
        {translator.translateText("Loading content")}
      </span>
    </div>
  );
};

export default LazyControlPlaceholder;
