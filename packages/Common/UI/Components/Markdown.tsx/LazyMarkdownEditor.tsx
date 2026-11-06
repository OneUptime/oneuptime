/*
 * Type-only on purpose: the one place the editor is loaded is the import()
 * below, so it and DOMPurify stay out of the first load of every page that
 * draws a form.
 */
import type MarkdownEditor from "./MarkdownEditor";
import type { ComponentProps } from "./MarkdownEditor";
import FieldError from "../Forms/Fields/FieldError";
import LazyControlPlaceholder from "../Forms/Fields/LazyControlPlaceholder";
import { hasTemplateVariables } from "../../../Types/Template/TemplateVariable";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Markdown editor as a form field draws it. Every page with a form reaches
 * FormField, and few forms have a Markdown field: the sign-in page's have none.
 * So the editor, with the about 120 KB of DOMPurify it pastes through, is a
 * file of its own, loaded by the first form that has one (issue #5619), and
 * until it arrives the field draws its place, the same size
 * (MarkdownEditorPlaceholder).
 */
const markdownEditor: LazyLibrary<typeof MarkdownEditor> = new LazyLibrary<
  typeof MarkdownEditor
>(async (): Promise<typeof MarkdownEditor> => {
  return (await import("./MarkdownEditor")).default;
});

// Loads the editor, once however many ask; a failed load is retried.
export const loadMarkdownEditor: () => Promise<
  typeof MarkdownEditor
> = (): Promise<typeof MarkdownEditor> => {
  return markdownEditor.load();
};

export interface MarkdownEditorPlaceholderProps {
  loadError: Error | null;
  initialValue?: string | undefined;
  error?: string | undefined;
  hasVariablesList: boolean;
  ariaLabelledby?: string | undefined;
}

// As many as the line of formatting buttons usually holds, at its 32px each.
const TOOLBAR_BUTTONS: ReadonlyArray<string> = ["a", "b", "c", "d", "e"];

/*
 * The editor's place: its toolbar, its box, the fold of template variables
 * under it if it has one, and its Formatting help line. The classes are the
 * ones that give MarkdownEditor its size. What the field holds already is in
 * the box out of sight, for the room it takes, so an edit form's note does not
 * start small and push the form down: its words wrap the same way, though the
 * editor adds a little room around each block it draws.
 */
export const MarkdownEditorPlaceholder: FunctionComponent<
  MarkdownEditorPlaceholderProps
> = (props: MarkdownEditorPlaceholderProps): ReactElement => {
  const { translateString } = useTranslateValue();

  const heldText: string =
    typeof props.initialValue === "string" ? props.initialValue : "";

  // Under the box while it is on its way, under the place if that failed.
  const boxError: string | undefined = props.loadError
    ? undefined
    : props.error;

  return (
    <LazyControlPlaceholder
      dataTestId="markdown-editor-placeholder"
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={
        <div className="relative">
          <div
            data-testid="markdown-editor-placeholder-toolbar"
            className="overflow-hidden p-2 bg-gray-50 border border-gray-300 rounded-t-md border-b-0"
            style={{ contain: "inline-size" }}
          >
            <div className="flex items-center gap-1">
              {TOOLBAR_BUTTONS.map((button: string): ReactElement => {
                return (
                  <div
                    key={button}
                    className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-gray-200"
                  />
                );
              })}
            </div>
          </div>
          <div className="relative">
            <div
              data-testid="markdown-editor-placeholder-box"
              className={`block w-full min-h-32 rounded-md rounded-t-none border bg-white py-2 pl-3 pr-3 text-sm ${
                boxError ? "border-red-300" : "border-gray-300"
              }`}
            >
              <div className="invisible whitespace-pre-wrap break-words">
                {heldText}
              </div>
              <div className="absolute inset-x-3 top-3 space-y-2">
                <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          </div>
          {boxError && <FieldError message={boxError} />}
          {props.hasVariablesList && (
            <div
              data-testid="markdown-editor-placeholder-variables"
              className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
            >
              <div className="h-6" />
            </div>
          )}
          <div
            data-testid="markdown-editor-placeholder-help"
            className="mt-2 text-xs text-gray-500"
          >
            <div className="invisible">
              {translateString("Formatting help") ?? "Formatting help"}
            </div>
          </div>
        </div>
      }
    />
  );
};

const LazyMarkdownEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof MarkdownEditor> = useLazyLibraryLoad(
    markdownEditor,
    true,
  );

  if (load.library) {
    const Editor: typeof MarkdownEditor = load.library;

    return <Editor {...props} />;
  }

  return (
    <MarkdownEditorPlaceholder
      loadError={load.error}
      initialValue={props.initialValue}
      error={props.error}
      hasVariablesList={hasTemplateVariables(props.templateVariables || [])}
      ariaLabelledby={props.ariaLabelledby}
    />
  );
};

export default LazyMarkdownEditor;
