// Type-only: the one place the editor is loaded is the import() below.
import type YamlEditor from "./YamlEditor";
import type { ComponentProps } from "./YamlEditor";
import {
  YAML_EDITOR_MAX_HEIGHT,
  YAML_EDITOR_MIN_LINES,
} from "./CodeEditorSize";
import { CodeEditorPlaceholder } from "./LazyCodeEditor";
import { loadYamlSyntaxCheck } from "./YamlSyntaxLoader";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The YAML editor as a form field draws it: a file of its own, as the code
 * editor it is built on is (LazyCodeEditor). The form's own check of the text
 * arrives with it, so what is typed in the editor is checked before it saves
 * (Validation.validateYAMLSyntax).
 */
const yamlEditor: LazyLibrary<typeof YamlEditor> = new LazyLibrary<
  typeof YamlEditor
>(async (): Promise<typeof YamlEditor> => {
  const [library] = await Promise.all([
    import("./YamlEditor"),
    loadYamlSyntaxCheck(),
  ]);

  return library.default;
});

// Loads the editor, once however many ask; a failed load is retried.
export const loadYamlEditor: () => Promise<typeof YamlEditor> = (): Promise<
  typeof YamlEditor
> => {
  return yamlEditor.load();
};

const LazyYamlEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof YamlEditor> = useLazyLibraryLoad(
    yamlEditor,
    true,
  );

  if (load.library) {
    const Editor: typeof YamlEditor = load.library;

    return <Editor {...props} />;
  }

  return (
    <CodeEditorPlaceholder
      dataTestId="yaml-editor-placeholder"
      loadError={load.error}
      value={props.value}
      initialValue={props.initialValue}
      error={props.error}
      minLines={YAML_EDITOR_MIN_LINES}
      height={props.height}
      maxHeight={YAML_EDITOR_MAX_HEIGHT}
      ariaLabelledby={props.ariaLabelledby}
    />
  );
};

export default LazyYamlEditor;
