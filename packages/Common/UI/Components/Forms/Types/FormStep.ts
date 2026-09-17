import FormValues from "./FormValues";

export enum FormStepState {
  ACTIVE,
  INACTIVE,
  COMPLETED,
}

export interface FormStep<TEntity> {
  id: string;
  title: string;
  showIf?: ((item: FormValues<TEntity>) => boolean) | undefined;
  isSummaryStep?: boolean | undefined;
  /*
   * Grid column count for fields in this step. Overrides form-level
   * showAsColumns. Defaults to 1 (single column).
   */
  columns?: number | undefined;
}
