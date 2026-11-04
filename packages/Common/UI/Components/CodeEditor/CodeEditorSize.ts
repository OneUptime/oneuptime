/*
 * How much room a code editor takes, and the text it measures: on their own,
 * for what draws in its place until CodeEditor's file has arrived
 * (LazyCodeEditor). That place has to be exactly as big as the editor, so
 * both read the same numbers.
 */

/*
 * These two have to match .ou-code-editor's --ou-code-line-height and
 * --ou-code-padding-y in CodeEditor.css: the gutter's click target and the
 * current-line band are placed with them.
 */
export const CODE_EDITOR_LINE_HEIGHT_PX: number = 20;
export const CODE_EDITOR_PADDING_Y_PX: number = 10;
export const CODE_EDITOR_PADDING_X_PX: number = 12;

export const CODE_EDITOR_DEFAULT_MIN_LINES: number = 5;
export const CODE_EDITOR_DEFAULT_MAX_HEIGHT: string = "min(60vh, 30rem)";

// A rule is the whole point of the form it sits in: give it room.
export const YAML_EDITOR_MIN_LINES: number = 12;
export const YAML_EDITOR_MAX_HEIGHT: string = "min(70vh, 36rem)";

/*
 * Callers hand us `any` through Form's currentValues, so a non-string can
 * still reach a prop typed as string. Line breaks are normalised because a
 * textarea's value always reads back with "\n": keeping "\r\n" here would
 * put the highlighted layer one character per line out of step with it.
 */
type ToEditorTextFunction = (value: string | undefined) => string;

export const toEditorText: ToEditorTextFunction = (
  value: string | undefined,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return JSON.stringify(value, null, 4);
  }

  return value.replace(/\r\n?/g, "\n");
};

/*
 * How tall the part of the editor that holds the text is, for this text: as
 * many lines as it has, and at least minLines, before anything scrolls.
 */
export const getCodeEditorContentHeight: (
  text: string,
  minLines?: number | undefined,
) => number = (text: string, minLines?: number | undefined): number => {
  const lines: number = text.split("\n").length;

  return (
    Math.max(lines, minLines ?? CODE_EDITOR_DEFAULT_MIN_LINES) *
      CODE_EDITOR_LINE_HEIGHT_PX +
    2 * CODE_EDITOR_PADDING_Y_PX
  );
};
