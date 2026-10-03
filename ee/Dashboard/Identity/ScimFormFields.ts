import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * ADDING A SCIM CONNECTION ASKS ONLY FOR ITS NAME (AND, IN A PROJECT, THE
 * TEAMS NEWCOMERS JOIN).
 *
 * A SCIM connection gives the identity provider an address and a bearer
 * token; OneUptime makes both once the connection is saved, so there is
 * nothing to copy in from the identity provider at all. Yet the project's
 * form walked three steps (Basic Info, Configuration, Teams) and the status
 * page's two, with three checkboxes that drew unticked although their
 * columns save them ticked - an untouched one was left out of the request
 * and the server stored its default, on - and Default Teams with nothing
 * picked, so people provisioned without push groups joined no team at all.
 *
 * Both forms are now one page:
 *
 *   Project      Name, Default Teams (starting on the members team, see
 *                Dashboard Components/Sso/UseDefaultSsoTeams; hidden while
 *                push groups manage team membership), and one folded
 *                Advanced section: Auto Provision Users (on), Auto
 *                Deprovision Users (on), Enable Push Groups (off) and the
 *                description.
 *   Status page  Name, and one folded Advanced section: Auto Provision
 *                Users (on), Auto Deprovision Users (on) and the
 *                description.
 *
 * The three settings are switches that start where their columns do, so
 * what the form shows is what is saved, and turning one off saves it off.
 * While the folded section is at those defaults its header says what they
 * do in a sentence; once something differs it says "Configured". The edit
 * dialogs use the same layout.
 *
 * React-free: the pages, the guards and the tests read it.
 */

export const SCIM_NAME_DESCRIPTION: string = translationKey(
  "Friendly name to help you remember this SCIM configuration.",
);

export const SCIM_DESCRIPTION_DESCRIPTION: string = translationKey(
  "Optional description for this SCIM configuration.",
);

export const SCIM_DEFAULT_TEAMS_DESCRIPTION: string = translationKey(
  "New users will be automatically added to these teams.",
);

export const SCIM_AUTO_PROVISION_DESCRIPTION: string = translationKey(
  "Automatically create users when they are added in your identity provider.",
);

export const PROJECT_SCIM_AUTO_DEPROVISION_DESCRIPTION: string = translationKey(
  "Automatically remove users from teams when they are removed from your identity provider.",
);

export const STATUS_PAGE_SCIM_AUTO_DEPROVISION_DESCRIPTION: string =
  translationKey(
    "Automatically remove users when they are removed from your identity provider.",
  );

export const SCIM_PUSH_GROUPS_DESCRIPTION: string = translationKey(
  "Enable push groups provisioning instead of default teams. When enabled, users will not be added to default teams and team membership will be managed via push groups.",
);

/*
 * What the folded Advanced section says while everything in it is at its
 * default, in place of the "Configured" badge.
 */
export const PROJECT_SCIM_ADVANCED_DEFAULTS_SUMMARY: string = translationKey(
  "People added in your identity provider join the default teams, and people removed there leave them.",
);

export const STATUS_PAGE_SCIM_ADVANCED_DEFAULTS_SUMMARY: string =
  translationKey(
    "People added in your identity provider can sign in to this status page, and people removed there lose access.",
  );

type ReadValueFunction = (values: unknown, key: string) => unknown;

const readValue: ReadValueFunction = (
  values: unknown,
  key: string,
): unknown => {
  if (!values || typeof values !== "object") {
    return undefined;
  }

  return (values as Record<string, unknown>)[key];
};

type IsBlankFunction = (value: unknown) => boolean;

const isBlank: IsBlankFunction = (value: unknown): boolean => {
  return (
    value === undefined || value === null || String(value).trim().length === 0
  );
};

export interface ScimAdvancedOptions {
  // A project's connection, which also has push groups.
  withPushGroups?: boolean | undefined;
}

/**
 * Whether everything the Advanced section folds is where a new connection
 * starts: provisioning and deprovisioning on, push groups off (a project's
 * connection) and no description. A switch not set yet counts as at its
 * default: the form fills the column's in.
 */
export const isScimAdvancedAtDefaults: (
  values: unknown,
  options?: ScimAdvancedOptions,
) => boolean = (values: unknown, options?: ScimAdvancedOptions): boolean => {
  if (
    readValue(values, "autoProvisionUsers") === false ||
    readValue(values, "autoDeprovisionUsers") === false
  ) {
    return false;
  }

  if (
    options?.withPushGroups &&
    Boolean(readValue(values, "enablePushGroups"))
  ) {
    return false;
  }

  return isBlank(readValue(values, "description"));
};

export type GetScimAdvancedSectionFunction = <TEntity>(
  options?: ScimAdvancedOptions,
) => FormFieldCollapsibleSection<TEntity>;

/*
 * The form's Advanced section: folded on Create and Edit; while everything in
 * it is at its default its header says what that default does, and once
 * something differs it says "Configured".
 */
export const getScimAdvancedSection: GetScimAdvancedSectionFunction = <TEntity>(
  options?: ScimAdvancedOptions,
): FormFieldCollapsibleSection<TEntity> => {
  return getAdvancedFormSection<TEntity>({
    isConfigured: (values: FormValues<TEntity>): boolean => {
      return !isScimAdvancedAtDefaults(values, options);
    },
    getSummary: (values: FormValues<TEntity>): Array<string> | undefined => {
      if (!isScimAdvancedAtDefaults(values, options)) {
        return undefined;
      }

      return [
        options?.withPushGroups
          ? PROJECT_SCIM_ADVANCED_DEFAULTS_SUMMARY
          : STATUS_PAGE_SCIM_ADVANCED_DEFAULTS_SUMMARY,
      ];
    },
  });
};

// The teams field shows only while push groups do not manage team membership.
export const isScimDefaultTeamsShown: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return !readValue(values, "enablePushGroups");
};

/**
 * A project's connection about to be created: while push groups manage team
 * membership the form hides Default Teams, so the teams it started on are not
 * saved either. What the form showed is what is saved.
 */
export const withoutHiddenScimDefaultTeams: (
  connection: ProjectSCIM,
) => ProjectSCIM = (connection: ProjectSCIM): ProjectSCIM => {
  if (!isScimDefaultTeamsShown(connection)) {
    delete connection.teams;
  }

  return connection;
};

/**
 * The fields of a project's SCIM connection, create and edit alike: one page.
 */
export const getProjectScimFormFields: () => Array<
  Field<ProjectSCIM>
> = (): Array<Field<ProjectSCIM>> => {
  const advancedSection: FormFieldCollapsibleSection<ProjectSCIM> =
    getScimAdvancedSection<ProjectSCIM>({ withPushGroups: true });

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: SCIM_NAME_DESCRIPTION,
      placeholder: "Okta SCIM",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        teams: true,
      },
      title: "Default Teams",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Team,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      description: SCIM_DEFAULT_TEAMS_DESCRIPTION,
      placeholder: "Select Teams",
      showIf: (values: FormValues<ProjectSCIM>): boolean => {
        return isScimDefaultTeamsShown(values);
      },
    },
    {
      field: {
        autoProvisionUsers: true,
      },
      title: "Auto Provision Users",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: SCIM_AUTO_PROVISION_DESCRIPTION,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        autoDeprovisionUsers: true,
      },
      title: "Auto Deprovision Users",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: PROJECT_SCIM_AUTO_DEPROVISION_DESCRIPTION,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        enablePushGroups: true,
      },
      title: "Enable Push Groups",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: SCIM_PUSH_GROUPS_DESCRIPTION,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      description: SCIM_DESCRIPTION_DESCRIPTION,
      placeholder:
        "SCIM configuration for automatic user provisioning from Okta",
      collapsibleSection: advancedSection,
    },
  ];
};

/**
 * The fields of a status page's SCIM connection, create and edit alike: one
 * page.
 */
export const getStatusPageScimFormFields: () => Array<
  Field<StatusPageSCIM>
> = (): Array<Field<StatusPageSCIM>> => {
  const advancedSection: FormFieldCollapsibleSection<StatusPageSCIM> =
    getScimAdvancedSection<StatusPageSCIM>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: SCIM_NAME_DESCRIPTION,
      placeholder: "Okta SCIM for Status Page",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        autoProvisionUsers: true,
      },
      title: "Auto Provision Users",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: SCIM_AUTO_PROVISION_DESCRIPTION,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        autoDeprovisionUsers: true,
      },
      title: "Auto Deprovision Users",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: STATUS_PAGE_SCIM_AUTO_DEPROVISION_DESCRIPTION,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      description: SCIM_DESCRIPTION_DESCRIPTION,
      placeholder:
        "SCIM configuration for automatic user provisioning to the Status Page from Okta",
      collapsibleSection: advancedSection,
    },
  ];
};
