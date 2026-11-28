/*
 * Type-only on purpose: the one place the key/value editor is loaded is the
 * import() below, so it - with its key suggestions and its filter operators -
 * stays out of the first load of every page whose forms hold no key/value
 * list.
 */
import type DictionaryForm from "./Dictionary";
import type { ComponentProps } from "./Dictionary";
import Button, { ButtonSize } from "../Button/Button";
import LazyControlPlaceholder from "../Forms/Fields/LazyControlPlaceholder";
import IconProp from "../../../Types/Icon/IconProp";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import {
  translateNamedAction,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The key/value editor as a form draws it (FormField, for a Dictionary
 * field: a request's headers, a workflow's values). Every page with a form
 * reaches FormField, and the public pages' forms - the sign-in pages', a
 * status page's, a public dashboard's - hold no key/value list. So the
 * editor, with its key suggestions and its filter operators, is a file of
 * its own (2 to 3 KiB gzipped of each one's first load,
 * packages/Common/Scripts/first-load-budgets.js), loaded by the first form
 * that has such a field, as soon as the form is drawn (FormFieldControls),
 * and until it arrives the field draws its place, the same size
 * (DictionaryPlaceholder).
 */
const dictionaryForm: LazyLibrary<typeof DictionaryForm> = new LazyLibrary<
  typeof DictionaryForm
>(async (): Promise<typeof DictionaryForm> => {
  return (await import("./Dictionary")).default;
});

// Loads the editor, once however many ask; a failed load is retried.
export const loadDictionary: () => Promise<typeof DictionaryForm> = (): Promise<
  typeof DictionaryForm
> => {
  return dictionaryForm.load();
};

export interface DictionaryPlaceholderProps extends ComponentProps {
  loadError: Error | null;
}

/*
 * The editor's place, as the editor draws its first frame: its rows come in
 * once it has read the field's value, so it opens on its Add button alone
 * (or on "None", read-only), and that is what its place draws - the same
 * button, which cannot be pressed yet.
 */
export const DictionaryPlaceholder: FunctionComponent<
  DictionaryPlaceholderProps
> = (props: DictionaryPlaceholderProps): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <LazyControlPlaceholder
      dataTestId="dictionary-placeholder"
      loadError={props.loadError}
      ariaLabelledby={undefined}
      shape={
        <div>
          {props.readOnly ? (
            <p className="text-sm text-gray-500">
              {translator.translateText("None")}
            </p>
          ) : (
            <div className="mt-4" aria-hidden="true">
              <Button
                title={translateNamedAction(translator, {
                  template: "Add {{itemName}}",
                  itemName: props.addButtonSuffix || translationKey("Item"),
                })}
                isTitleTranslated={true}
                icon={IconProp.Add}
                buttonSize={ButtonSize.Small}
                disabled={true}
              />
            </div>
          )}
        </div>
      }
    />
  );
};

const LazyDictionary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof DictionaryForm> = useLazyLibraryLoad(
    dictionaryForm,
    true,
  );

  if (load.library) {
    const Editor: typeof DictionaryForm = load.library;

    return <Editor {...props} />;
  }

  return <DictionaryPlaceholder {...props} loadError={load.error} />;
};

export default LazyDictionary;
