import FormValues from "./FormValues";

export enum FormStepState {
  ACTIVE,
  INACTIVE,
  COMPLETED,
}

export interface FormStep<TEntity> {
  id: string;
  title: string;
  /*
   * The title is a product's name (a provider's step: Resend, Postmark):
   * shown as given, never looked up - a name that is interface text too
   * ("Resend") would otherwise be shown as that text's translation.
   */
  isTitleProductName?: boolean | undefined;
  showIf?: ((item: FormValues<TEntity>) => boolean) | undefined;
  isSummaryStep?: boolean | undefined;
  /*
   * Grid column count for fields in this step. Overrides form-level
   * showAsColumns. Defaults to 1 (single column).
   */
  columns?: number | undefined;
}
