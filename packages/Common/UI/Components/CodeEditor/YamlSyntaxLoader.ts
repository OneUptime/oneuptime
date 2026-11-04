/*
 * Type-only: the one place the check is loaded is the import() below, so
 * js-yaml stays out of the first load of every page that draws a form.
 */
import type {
  checkYamlSyntax,
  describeYamlSyntaxError,
} from "../../../Types/Code/YamlSyntax";
import { LazyLibrary } from "../../Utils/LazyLibrary";

/*
 * Whether a YAML field's text parses, which a form asks before it saves
 * (Validation.validateYAMLSyntax). Only a form with a YAML field ever asks,
 * and the parser is js-yaml, so it is a file of its own, loaded with the
 * YAML editor (LazyYamlEditor): it is there before anyone can type in one.
 */
export interface YamlSyntaxCheck {
  checkYamlSyntax: typeof checkYamlSyntax;
  describeYamlSyntaxError: typeof describeYamlSyntaxError;
}

const yamlSyntaxCheck: LazyLibrary<YamlSyntaxCheck> =
  new LazyLibrary<YamlSyntaxCheck>(async (): Promise<YamlSyntaxCheck> => {
    const library: YamlSyntaxCheck = await import(
      "../../../Types/Code/YamlSyntax"
    );

    return {
      checkYamlSyntax: library.checkYamlSyntax,
      describeYamlSyntaxError: library.describeYamlSyntaxError,
    };
  });

// The check, when a YAML field has loaded it already.
export const getLoadedYamlSyntaxCheck: () => YamlSyntaxCheck | null =
  (): YamlSyntaxCheck | null => {
    return yamlSyntaxCheck.getLoaded();
  };

// Loads the check, once however many ask; a failed load is retried.
export const loadYamlSyntaxCheck: () => Promise<YamlSyntaxCheck> =
  (): Promise<YamlSyntaxCheck> => {
    return yamlSyntaxCheck.load();
  };
