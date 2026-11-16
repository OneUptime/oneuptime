/*
 * Type-only on purpose: the one place the rule criteria form is loaded is the
 * import() below, so the condition builder stays out of the first load of
 * every page that draws a form.
 */
import type { replaceLegacyRuleCriteriaFields } from "./RuleCriteriaModelForm";
import { LazyLibrary } from "../../Utils/LazyLibrary";

/*
 * What a rule's form needs to lay out its fields: the condition builder in
 * place of the match fields (RuleCriteriaModelForm). Every page with a form
 * reaches ModelForm, and only a rule's form - in the Dashboard - draws the
 * builder, with the checks of a pattern a condition is written with and
 * their sentences: some 80 KB before gzip of the sign-in pages' and a status
 * page's first load (packages/Common/Scripts/first-load-budgets.js). So it is
 * a file of its own: ModelForm asks for it when its fields are a rule's
 * (RuleCriteriaLegacyFields.shouldUseRuleCriteriaBuilder), as it fetches its
 * dropdowns' options, and lays out the fields once both are there.
 */
export interface RuleCriteriaModelFormLibrary {
  replaceLegacyRuleCriteriaFields: typeof replaceLegacyRuleCriteriaFields;
}

const ruleCriteriaModelForm: LazyLibrary<RuleCriteriaModelFormLibrary> =
  new LazyLibrary<RuleCriteriaModelFormLibrary>(
    async (): Promise<RuleCriteriaModelFormLibrary> => {
      const loaded: typeof import("./RuleCriteriaModelForm") = await import(
        "./RuleCriteriaModelForm"
      );

      return {
        replaceLegacyRuleCriteriaFields: loaded.replaceLegacyRuleCriteriaFields,
      };
    },
  );

// Loads it, once however many ask; a failed load is retried by the next.
export const loadRuleCriteriaModelForm: () => Promise<RuleCriteriaModelFormLibrary> =
  (): Promise<RuleCriteriaModelFormLibrary> => {
    return ruleCriteriaModelForm.load();
  };

export default ruleCriteriaModelForm;
