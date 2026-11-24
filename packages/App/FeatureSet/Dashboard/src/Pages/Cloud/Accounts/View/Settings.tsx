import PageComponentProps from "../../../PageComponentProps";
import ResourceDetailsCard from "../../../../Components/TelemetryResource/ResourceDetailsCard";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_ENVIRONMENTS,
  CLOUD_RESOURCE_ENVIRONMENT_LABELS,
  CloudResourceEnvironment,
  isCloudResourceEnvironment,
} from "Common/Types/Cloud/CloudResourceEnvironment";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { getEnvironmentTone } from "../../../../Components/Cloud/Savings/CloudSavingsApplyModal";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Which account it is - its cloud, its id there and its name there - is
 * shown, never edited: the cloud connection that reads it keeps those, and
 * its resources are matched by them. Its name in OneUptime, its
 * description and its labels are yours.
 */
const ACCOUNT_IDENTITY_DETAILS: Array<ModelDetailField<CloudAccount>> = [
  {
    field: { providerAccountName: true },
    title: "Name in the Cloud",
    fieldType: FieldType.Text,
  },
];

/*
 * Whether the account is production (#11010). Off-hours schedules and AI
 * rules for savings act only on resources known not to be production: a
 * resource's own environment tag says so first, and where it has none, its
 * account's word here does. Not set, nothing is assumed - the account's
 * resources are left running and every saving waits for a person.
 */
const ENVIRONMENT_OPTIONS: Array<DropdownOption> =
  CLOUD_RESOURCE_ENVIRONMENTS.map(
    (environment: CloudResourceEnvironment): DropdownOption => {
      return {
        label: CLOUD_RESOURCE_ENVIRONMENT_LABELS[environment],
        value: environment,
      };
    },
  );

const ENVIRONMENT_DETAILS: Array<ModelDetailField<CloudAccount>> = [
  {
    field: { environment: true },
    title: "Environment",
    fieldType: FieldType.Element,
    getElement: (account: CloudAccount): ReactElement => {
      const environment: CloudResourceEnvironment = isCloudResourceEnvironment(
        account.environment,
      )
        ? account.environment
        : CloudResourceEnvironment.Unknown;

      return (
        <Pill
          text={CLOUD_RESOURCE_ENVIRONMENT_LABELS[environment]}
          tone={getEnvironmentTone(environment)}
        />
      );
    },
  },
];

const CloudAccountSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<CloudAccount>
        modelType={CloudAccount}
        modelId={modelId}
        id="cloud-account-details"
        title="Account Details"
        description="How this account is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this account appears. Its resources are not matched by the display name, so renaming is safe.",
          placeholder: "Production",
        }}
        descriptionField={{
          placeholder: "The checkout stack's production account",
        }}
        identityFields={[
          {
            column: "provider",
            title: "Cloud",
            // Kept as "aws", read as "AWS".
            getDisplayValue: getCloudProviderLabel,
          },
          {
            column: "accountId",
            title: "Account ID",
          },
        ]}
        detailFields={ACCOUNT_IDENTITY_DETAILS}
      />
      <CardModelDetail<CloudAccount>
        name="Cloud Account Environment"
        cardProps={{
          title: "Environment",
          description:
            "Off-hours schedules and AI rules stop and change only resources known not to be production. A resource's own environment tag wins over this.",
        }}
        isEditable={true}
        editButtonText="Edit"
        editModalTitle="Environment"
        formFields={[
          {
            field: { environment: true },
            title: "Environment",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: ENVIRONMENT_OPTIONS,
            required: true,
            description:
              "Not known leaves the account's untagged resources running, and every saving on them waits for a person.",
          },
        ]}
        modelDetailProps={{
          modelType: CloudAccount,
          id: "model-detail-cloud-account-environment",
          fields: ENVIRONMENT_DETAILS,
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default CloudAccountSettings;
