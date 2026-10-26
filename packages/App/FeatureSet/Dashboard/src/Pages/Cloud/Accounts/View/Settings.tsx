import PageComponentProps from "../../../PageComponentProps";
import ResourceDetailsCard from "../../../../Components/TelemetryResource/ResourceDetailsCard";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import ObjectID from "Common/Types/ObjectID";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
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
    </Fragment>
  );
};

export default CloudAccountSettings;
