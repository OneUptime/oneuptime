/*
 * The answers the server refuses a new project with that are about one
 * field of the Create New Project form (CreateProjectFormFields), so the
 * form shows each under its field (Field.ownsServerError) instead of above
 * the form - a refused promo code was shown at the top of the dialog while
 * the code itself stayed folded under More fields.
 *
 * Read with indexOf, never a pattern: the words are the server's
 * (ProjectService.onBeforeCreate, BillingService), matched in any case.
 * React-free, so App's tests can read it.
 */

// The words every promo code answer names the code by, in either spelling.
export const PROMO_CODE_WORDS: ReadonlyArray<string> = [
  "promo code",
  "promocode",
];

// The words the server refuses a second project of the same name with.
export const SAME_PROJECT_NAME_WORDS: string = "same name";

/*
 * Whether the answer is about the promo code: "Promo code is invalid.",
 * "This promocode has already been used.", "Promocode is not valid for this
 * plan. Please select the Growth plan.", and the rest.
 */
export const isPromoCodeServerError: (message: string) => boolean = (
  message: string,
): boolean => {
  const text: string = message.toLowerCase();

  return PROMO_CODE_WORDS.some((words: string): boolean => {
    return text.indexOf(words) !== -1;
  });
};

// Whether the answer is about the name: "Project with the same name already exists".
export const isProjectNameServerError: (message: string) => boolean = (
  message: string,
): boolean => {
  return message.toLowerCase().indexOf(SAME_PROJECT_NAME_WORDS) !== -1;
};
