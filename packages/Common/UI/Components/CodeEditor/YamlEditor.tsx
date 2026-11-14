import CodeEditor, { CODE_EDITOR_VALIDATION_DEBOUNCE_MS } from "./CodeEditor";
import {
  YAML_EDITOR_MAX_HEIGHT,
  YAML_EDITOR_MIN_LINES,
} from "./CodeEditorSize";
import CodeType from "../../../Types/Code/CodeType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  initialValue?: string | undefined;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  onFocus?: (() => void) | undefined;
  /** Shown in the toolbar as a hint. Never written into the document. */
  placeholder?: string | undefined;
  // In the reader's words already: drawn as given (Field's, #7682).
  isPlaceholderTranslated?: boolean | undefined;
  error?: string | undefined;
  readOnly?: boolean | undefined;
  tabIndex?: number | undefined;
  dataTestId?: string | undefined;
  ariaLabelledby?: string | undefined;
  // What describes the document besides its status: its field's help.
  ariaDescribedby?: string | undefined;
  height?: string | undefined;
  className?: string | undefined;
}

/** How long the document sits still before it is parsed again. */
export const YAML_VALIDATION_DEBOUNCE_MS: number =
  CODE_EDITOR_VALIDATION_DEBOUNCE_MS;

export const YAML_DEFAULT_HINT: string =
  "Indentation is significant — use 2 spaces per level. Tabs are not valid YAML.";

/**
 * A YAML document editor: CodeEditor with the YAML grammar, YAML-safe
 * indentation (two spaces, never a tab) and a status bar that reports as you
 * type whether the document parses, and where it does not.
 *
 * Exists because YAML fields used to render the rich-text Markdown editor.
 * That was not only the wrong affordance (a Bold button over a Sigma rule);
 * the Markdown editor round-trips its value through HTML and back, and
 * indentation-sensitive YAML does not survive that intact.
 */
const YamlEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid="yaml-editor" className={props.className}>
      <CodeEditor
        type={CodeType.YAML}
        value={props.value}
        initialValue={props.initialValue}
        onChange={props.onChange}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        /*
         * A hint, not a placeholder: a YAML field's guidance is about how to
         * write it, and has to stay readable once there is text in the box.
         */
        hint={props.placeholder || YAML_DEFAULT_HINT}
        isHintTranslated={Boolean(
          props.placeholder && props.isPlaceholderTranslated,
        )}
        error={props.error}
        ariaInvalid={Boolean(props.error)}
        readOnly={props.readOnly}
        tabIndex={props.tabIndex}
        dataTestId={props.dataTestId}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        height={props.height}
        minLines={YAML_EDITOR_MIN_LINES}
        maxHeight={YAML_EDITOR_MAX_HEIGHT}
      />
    </div>
  );
};

export default YamlEditor;
