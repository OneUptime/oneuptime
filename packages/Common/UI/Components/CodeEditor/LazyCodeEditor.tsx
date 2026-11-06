/*
 * Type-only on purpose: the one place the editor is loaded is the import()
 * below, so it and the syntax checks it runs stay out of the first load of
 * every page that draws a form.
 */
import type CodeEditor from "./CodeEditor";
import type { ComponentProps } from "./CodeEditor";
import {
  CODE_EDITOR_DEFAULT_MAX_HEIGHT,
  getCodeEditorContentHeight,
  toEditorText,
} from "./CodeEditorSize";
import FieldError from "../Forms/Fields/FieldError";
import LazyControlPlaceholder from "../Forms/Fields/LazyControlPlaceholder";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The code editor as a form field draws it. Every page with a form reaches
 * FormField, and few forms have a code field: the sign-in page's have none. So
 * the editor is a file of its own, loaded by the first form that has one
 * (issue #5619), and until it arrives the field draws its place, the same size
 * (CodeEditorPlaceholder).
 */
const codeEditor: LazyLibrary<typeof CodeEditor> = new LazyLibrary<
  typeof CodeEditor
>(async (): Promise<typeof CodeEditor> => {
  return (await import("./CodeEditor")).default;
});

// Loads the editor, once however many ask; a failed load is retried.
export const loadCodeEditor: () => Promise<typeof CodeEditor> = (): Promise<
  typeof CodeEditor
> => {
  return codeEditor.load();
};

export interface CodeEditorPlaceholderProps {
  dataTestId: string;
  loadError: Error | null;
  value?: string | undefined;
  initialValue?: string | undefined;
  error?: string | undefined;
  minLines?: number | undefined;
  height?: string | undefined;
  maxHeight?: string | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * The editor's place: its frame, its toolbar, its status bar and between them
 * room for the text it will hold, as many lines of it as the editor shows
 * (CodeEditorSize). These classes are the ones that give CodeEditor its size;
 * CodeEditor.css is not here yet, and nothing here needs it.
 */
export const CodeEditorPlaceholder: FunctionComponent<
  CodeEditorPlaceholderProps
> = (props: CodeEditorPlaceholderProps): ReactElement => {
  // Where the editor says it: in its status bar. Under the place if that failed.
  const statusError: string | undefined = props.loadError
    ? undefined
    : props.error;

  return (
    <LazyControlPlaceholder
      dataTestId={props.dataTestId}
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={
        <div
          data-testid="code-editor-placeholder-frame"
          className={`overflow-hidden rounded-md border bg-white shadow-sm ${
            statusError ? "border-red-300" : "border-gray-300"
          }`}
        >
          <div
            data-testid="code-editor-placeholder-toolbar"
            className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 py-1 pl-3 pr-1.5"
          >
            <div className="h-4 w-10 animate-pulse rounded bg-gray-200" />
            <div className="h-6 w-14 animate-pulse rounded bg-gray-200" />
          </div>
          <div
            data-testid="code-editor-placeholder-scroller"
            className="overflow-hidden"
            style={
              props.height
                ? { height: props.height }
                : {
                    maxHeight:
                      props.maxHeight || CODE_EDITOR_DEFAULT_MAX_HEIGHT,
                  }
            }
          >
            <div
              data-testid="code-editor-placeholder-code"
              className="space-y-2 px-3 py-3"
              style={{
                minHeight: getCodeEditorContentHeight(
                  toEditorText(props.value ?? props.initialValue),
                  props.minLines,
                ),
              }}
            >
              <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
          <div
            data-testid="code-editor-placeholder-status"
            className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-3 py-1 text-xs"
          >
            {statusError ? (
              <FieldError
                message={statusError}
                className="min-w-0 break-words text-red-700"
              />
            ) : (
              <div className="h-4" />
            )}
          </div>
        </div>
      }
    />
  );
};

const LazyCodeEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof CodeEditor> = useLazyLibraryLoad(
    codeEditor,
    true,
  );

  if (load.library) {
    const Editor: typeof CodeEditor = load.library;

    return <Editor {...props} />;
  }

  return (
    <CodeEditorPlaceholder
      dataTestId="code-editor-placeholder"
      loadError={load.error}
      value={props.value}
      initialValue={props.initialValue}
      error={props.error}
      minLines={props.minLines}
      height={props.height}
      maxHeight={props.maxHeight}
      ariaLabelledby={props.ariaLabelledby}
    />
  );
};

export default LazyCodeEditor;
