import {
  getRefusalText,
  RefusalWithValues,
} from "../Exception/RefusalWithValues";
import { translationKey } from "../Translator";

/*
 * WHAT A PROJECT BELOW A FEATURE'S PLAN IS TOLD (#7276).
 *
 * Every plan check refused with "Please upgrade your plan to Growth to
 * access this feature": no full stop, and nothing about where a plan is
 * changed. It says now which plan the feature needs and where to upgrade,
 * as the project's other plan refusals do ("AI in Code needs the Growth
 * plan or above. Upgrade the project's plan in Project Settings > Billing
 * and Invoices > Billing.").
 *
 * The server fills it in English (getPlanRequiredMessage): an API client,
 * the CLI and Terraform read it as it is. The Dashboard reads the plan back
 * out of it and says the sentence in the reader's language with it
 * (Common/UI/Utils/ErrorInSentence): the sentence is a key of its locales
 * (this file is a "keys" root of its extractor). A plan's name stays as
 * written in every language. React-free and server-safe.
 */
export const PLAN_REQUIRED_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "This feature needs the {{plan}} plan or above. Upgrade the project's plan in Project Settings > Billing and Invoices > Billing, then try again.",
  ),
  terms: [],
};

// The refusal for a feature that needs `plan`, in English.
export const getPlanRequiredMessage: (plan: string) => string = (
  plan: string,
): string => {
  return getRefusalText(PLAN_REQUIRED_REFUSAL, { plan: plan });
};
