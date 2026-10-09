import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HuntressSeverity, {
  AllHuntressSeverities,
} from "Common/Types/Huntress/HuntressSeverity";
import { getHuntressOrganizationFilterProblem } from "Common/Types/Huntress/HuntressOrganizationFilter";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import {
  HUNTRESS_PAGE_ON_CALL_FOR_DESCRIPTIONS,
  HUNTRESS_PAGE_ON_CALL_FOR_LABELS,
  HUNTRESS_SEVERITY_BY_RANK_LABELS,
} from "../../../Components/Huntress/HuntressConnectionDisplay";

/*
 * The Huntress connection form - one page, the same on Connect Huntress and
 * on Edit Settings - kept in a plain .ts module so App's tests can read it
 * without the pages (see Pages/Slo/SloFormFields.ts for why).
 *
 * It asks the two things that decide what happens at 3 AM: who is paged,
 * and for which reports. Everything else starts from a default that suits
 * most teams and waits folded under More fields, whose line says what those
 * defaults do: the connection's name ("Huntress"), the incident severity of
 * each Huntress severity (the project's severities in rank order), the
 * organizations it watches (all of them), the labels its incidents get
 * besides their organization's, and resolving the incident when Huntress
 * closes the report (on). A form of three rows or fewer walks no steps
 * (LongFormStepsGuard), so this one has none.
 *
 * The signing secret is not on it: the endpoint's URL, which Huntress asks
 * for first, exists only once the connection does, so the secret is pasted
 * on the connection's page after Huntress shows it (HuntressSetupCard).
 */

export const HUNTRESS_DEFAULT_CONNECTION_NAME: string = "Huntress";

export const HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES: FormValues<HuntressConnection> =
  {
    name: HUNTRESS_DEFAULT_CONNECTION_NAME,
    pageOnCallFor: HuntressSeverity.High,
    resolveIncidentWhenReportCloses: true,
  };

/*
 * What More fields says while everything in it is left as it starts: how a
 * report becomes an incident without anyone choosing.
 */
export const HUNTRESS_MORE_FIELDS_SUMMARY: string = translationKey(
  "Critical, high and low reports open at your three most severe incident severities, from every Huntress organization, and are resolved when Huntress closes them.",
);

export function getHuntressPageOnCallForOptions(): Array<DropdownOption> {
  return AllHuntressSeverities.map(
    (severity: HuntressSeverity): DropdownOption => {
      return {
        value: severity,
        label: HUNTRESS_PAGE_ON_CALL_FOR_LABELS[severity],
        description: HUNTRESS_PAGE_ON_CALL_FOR_DESCRIPTIONS[severity],
      };
    },
  );
}

type FormRecord = Record<string, unknown>;

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

// Whether the folded fields hold only what a new connection starts with.
export function isHuntressMoreFieldsAtDefaults(
  values: FormValues<HuntressConnection>,
): boolean {
  const record: FormRecord = (values || {}) as FormRecord;

  return (
    isHuntressConnectionNameAtDefault(values) &&
    isEmpty(record["criticalIncidentSeverity"]) &&
    isEmpty(record["highIncidentSeverity"]) &&
    isEmpty(record["lowIncidentSeverity"]) &&
    isEmpty(record["watchedOrganizations"]) &&
    isEmpty(record["labels"]) &&
    record["resolveIncidentWhenReportCloses"] !== false
  );
}

export function getHuntressMoreFieldsSummary(
  values: FormValues<HuntressConnection>,
): Array<string> | undefined {
  return isHuntressMoreFieldsAtDefaults(values)
    ? [HUNTRESS_MORE_FIELDS_SUMMARY]
    : undefined;
}

export function isHuntressConnectionNameAtDefault(
  values: FormValues<HuntressConnection>,
): boolean {
  const name: unknown = ((values || {}) as FormRecord)["name"];

  return (
    isEmpty(name) ||
    (typeof name === "string" &&
      name.trim() === HUNTRESS_DEFAULT_CONNECTION_NAME)
  );
}

// Whether the form names any on-call policy, so "Page On-Call For" means something.
export function hasHuntressOnCallPolicies(
  values: FormValues<HuntressConnection>,
): boolean {
  return !isEmpty(((values || {}) as FormRecord)["onCallDutyPolicies"]);
}

export function validateHuntressWatchedOrganizations(
  values: FormValues<HuntressConnection>,
): string | null {
  const text: unknown = ((values || {}) as FormRecord)["watchedOrganizations"];

  return getHuntressOrganizationFilterProblem(
    typeof text === "string" ? text : null,
  );
}

// Each Huntress severity's incident severity, picked from the project's own.
const INCIDENT_SEVERITY_DROPDOWN: NonNullable<
  ModelField<HuntressConnection>["dropdownModal"]
> = {
  type: IncidentSeverity,
  labelField: "name",
  valueField: "_id",
  sort: {
    order: SortOrder.Ascending,
  },
};

export function getHuntressConnectionFormFields(): Array<
  ModelField<HuntressConnection>
> {
  const moreFields: FormFieldCollapsibleSection<HuntressConnection> =
    getAdvancedFormSection<HuntressConnection>({
      getSummary: getHuntressMoreFieldsSummary,
    });

  return [
    {
      field: {
        onCallDutyPolicies: true,
      },
      title: "On-Call Policies",
      description:
        "Who is paged when Huntress reports an incident. Leave empty to open incidents without paging anyone; your incident on-call rules still apply.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: OnCallDutyPolicy,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select on-call policies",
    },
    {
      field: {
        pageOnCallFor: true,
      },
      title: "Page On-Call For",
      description:
        "Every report opens an incident. Reports below this severity open one without paging.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getHuntressPageOnCallForOptions(),
      required: true,
      placeholder: "High and critical reports",
      showIf: hasHuntressOnCallPolicies,
    },
    {
      field: {
        name: true,
      },
      title: "Name",
      description:
        "What this connection is called here, such as the Huntress account it receives from.",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: HUNTRESS_DEFAULT_CONNECTION_NAME,
      // The name every connection starts with is no choice of the user's.
      isAtDefault: isHuntressConnectionNameAtDefault,
      collapsibleSection: moreFields,
    },
    /*
     * Left empty, the project's severities in rank order decide: the
     * placeholder says which.
     */
    {
      field: {
        criticalIncidentSeverity: true,
      },
      title: "Severity For Critical Reports",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: INCIDENT_SEVERITY_DROPDOWN,
      required: false,
      placeholder: HUNTRESS_SEVERITY_BY_RANK_LABELS[HuntressSeverity.Critical],
      collapsibleSection: moreFields,
    },
    {
      field: {
        highIncidentSeverity: true,
      },
      title: "Severity For High Reports",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: INCIDENT_SEVERITY_DROPDOWN,
      required: false,
      placeholder: HUNTRESS_SEVERITY_BY_RANK_LABELS[HuntressSeverity.High],
      collapsibleSection: moreFields,
    },
    {
      field: {
        lowIncidentSeverity: true,
      },
      title: "Severity For Low Reports",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: INCIDENT_SEVERITY_DROPDOWN,
      required: false,
      placeholder: HUNTRESS_SEVERITY_BY_RANK_LABELS[HuntressSeverity.Low],
      collapsibleSection: moreFields,
    },
    {
      field: {
        watchedOrganizations: true,
      },
      title: "Only These Organizations",
      description:
        "Leave empty to open incidents for every organization in your Huntress account. Otherwise, one organization name or ID per line.",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Acme Corp",
      customValidation: validateHuntressWatchedOrganizations,
      collapsibleSection: moreFields,
    },
    getLabelsFormField<HuntressConnection>({
      collapsibleSection: moreFields,
      description:
        "Every incident this connection opens gets these labels, besides one named after the report's Huntress organization.",
    }),
    {
      field: {
        resolveIncidentWhenReportCloses: true,
      },
      title: "Resolve When Huntress Closes The Report",
      description:
        "Resolve the incident when its report is closed or dismissed in Huntress. When off, a note on the incident says so instead.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
}
