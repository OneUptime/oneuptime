/*
 * What a form's submission creates. A form is built once and decides this
 * for every submission made through it: each one becomes a new incident, or
 * a new scheduled maintenance event, in the form's project.
 *
 * Incidents and scheduled maintenance events are where Forms start. Another
 * kind of record is added here, with its fields in FormTargetCatalog, its
 * settings in FormTargetSettings and a target handler on the server
 * (Server/Services/Form/FormTargets) - nothing else in the form builder, the
 * public page or the submit route is written for one target in particular.
 *
 * The values are stored in Form.targetType and FormSubmission.targetType, so
 * they never change once released.
 */
enum FormTargetType {
  Incident = "Incident",
  ScheduledMaintenance = "ScheduledMaintenance",
}

// Every target, in the order a picker lists them.
export const FORM_TARGET_TYPES: ReadonlyArray<FormTargetType> = [
  FormTargetType.Incident,
  FormTargetType.ScheduledMaintenance,
];

// What a form creates when nobody chose otherwise.
export const DEFAULT_FORM_TARGET_TYPE: FormTargetType = FormTargetType.Incident;

export interface FormTargetTypeText {
  // "Incident": a column value, a pill, the palette's group heading.
  title: string;
  // "incident": inside a sentence ("Each submission creates an incident.").
  noun: string;
  // "an incident": the noun with its article.
  nounWithArticle: string;
  // What the picker says about it.
  description: string;
}

/*
 * The words the dashboard uses for each target. Every string is a whole
 * sentence or a whole name, so the dashboard can look each one up in its
 * locale files on its own.
 */
export const FORM_TARGET_TYPE_TEXT: Record<FormTargetType, FormTargetTypeText> =
  {
    [FormTargetType.Incident]: {
      title: "Incident",
      noun: "incident",
      nounWithArticle: "an incident",
      description:
        "Each submission declares an incident, so your on-call team is told straight away. Use it for problem reports.",
    },
    [FormTargetType.ScheduledMaintenance]: {
      title: "Scheduled Maintenance",
      noun: "scheduled maintenance event",
      nounWithArticle: "a scheduled maintenance event",
      description:
        "Each submission schedules a maintenance event. Use it for change and maintenance requests.",
    },
  };

export type IsFormTargetTypeFunction = (
  value: unknown,
) => value is FormTargetType;

/** Whether a value is one of the targets, spelled exactly as stored. */
export const isFormTargetType: IsFormTargetTypeFunction = (
  value: unknown,
): value is FormTargetType => {
  return (
    typeof value === "string" &&
    (FORM_TARGET_TYPES as ReadonlyArray<string>).includes(value)
  );
};

export type ReadFormTargetTypeFunction = (value: unknown) => FormTargetType;

// A stored target, or the default for anything else.
export const readFormTargetType: ReadFormTargetTypeFunction = (
  value: unknown,
): FormTargetType => {
  return isFormTargetType(value) ? value : DEFAULT_FORM_TARGET_TYPE;
};

export default FormTargetType;
