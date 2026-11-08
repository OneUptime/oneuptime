import {
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
} from "./SloBurnRateTemplate";

/*
 * The output columns an SLO raises Alerts and Incidents from - a burn rate
 * rule's, and a tier of its error budget policy's, which carry the same
 * columns under the same names (SloRecordSourceSettings explains the pair).
 *
 * Pure, with no service imports, so a service can read these at module load:
 * the services that validate the columns sit in an import loop (AlertService
 * -> LabelService -> ... -> ServiceLevelObjectiveService -> the burn rate rule
 * service), and a value read off a module still loading is undefined.
 */

/*
 * Template columns and their limits, from the module the dashboard form reads
 * too, so the browser refuses exactly what these hooks would.
 *
 * Titles are varchar(ColumnLength.LongText) - on the source and on the Alert
 * and Incident they render into - so the column's own length is the limit,
 * and saying so here beats Postgres' raw "value too long". The worker still
 * clamps the RENDERED title, because `{{sloName}}` can expand a template that
 * fit.
 *
 * Markdown columns are unbounded text, but a template is copied into every
 * record the source opens and into the notifications each of those sends, so
 * they get a generous cap rather than none.
 */
export const SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH: number =
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH;

export const SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH: number =
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH;

export type SloRecordOutputTemplateColumn =
  | "alertTitleTemplate"
  | "alertDescriptionTemplate"
  | "alertRemediationNotes"
  | "incidentTitleTemplate"
  | "incidentDescriptionTemplate"
  | "incidentRemediationNotes";

export const SLO_RECORD_OUTPUT_TEMPLATE_COLUMNS: Array<{
  column: SloRecordOutputTemplateColumn;
  title: string;
  maxLength: number;
}> = [
  {
    column: "alertTitleTemplate",
    title: "Alert title template",
    maxLength: SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "alertDescriptionTemplate",
    title: "Alert description template",
    maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "alertRemediationNotes",
    title: "Alert remediation notes",
    maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "incidentTitleTemplate",
    title: "Incident title template",
    maxLength: SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "incidentDescriptionTemplate",
    title: "Incident description template",
    maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "incidentRemediationNotes",
    title: "Incident remediation notes",
    maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
];

// The five option flags, and what each defaults to on a source.
export interface SloRecordOutputOptionFlagDefaults {
  isAlertPrivate: boolean;
  autoResolveAlert: boolean;
  isIncidentPrivate: boolean;
  autoResolveIncident: boolean;
  addSloOwnersAsOwners: boolean;
}

export type SloRecordOutputOptionFlag = keyof SloRecordOutputOptionFlagDefaults;

// Every many-to-many list a source copies onto the records it opens.
export type SloRecordOutputProjectScopedRelationColumn =
  | "onCallDutyPolicies"
  | "incidentOnCallDutyPolicies"
  | "alertLabels"
  | "incidentLabels"
  | "alertOwnerTeams"
  | "incidentOwnerTeams";

export type SloRecordOutputOwnerUserColumn =
  | "alertOwnerUsers"
  | "incidentOwnerUsers";

export type SloRecordOutputRelationColumn =
  | SloRecordOutputProjectScopedRelationColumn
  | SloRecordOutputOwnerUserColumn;

export const SLO_RECORD_OUTPUT_OWNER_USER_COLUMNS: Array<SloRecordOutputOwnerUserColumn> =
  ["alertOwnerUsers", "incidentOwnerUsers"];

export const SLO_RECORD_OUTPUT_PROJECT_SCOPED_RELATION_COLUMNS: Array<SloRecordOutputProjectScopedRelationColumn> =
  [
    "onCallDutyPolicies",
    "incidentOnCallDutyPolicies",
    "alertLabels",
    "incidentLabels",
    "alertOwnerTeams",
    "incidentOwnerTeams",
  ];

// Every relation list of the outputs, in the order a service names them.
export const SLO_RECORD_OUTPUT_RELATION_COLUMNS: Array<SloRecordOutputRelationColumn> =
  [
    ...SLO_RECORD_OUTPUT_PROJECT_SCOPED_RELATION_COLUMNS,
    ...SLO_RECORD_OUTPUT_OWNER_USER_COLUMNS,
  ];

// The relations every source names, checked by its service's own hooks.
export const SLO_RECORD_OUTPUT_CHECKED_RELATIONS: Array<string> = [
  "serviceLevelObjective",
  "alertSeverity",
  "incidentSeverity",
];

export type GetSloRecordOwnerUsersNotInProjectErrorPrefixFunction = (
  subject: string,
) => string;

// The start of the error that refuses owner users from outside the project.
export const getSloRecordOwnerUsersNotInProjectErrorPrefix: GetSloRecordOwnerUsersNotInProjectErrorPrefixFunction =
  (subject: string): string => {
    return `This ${subject} names owner users who are not members of this project:`;
  };
