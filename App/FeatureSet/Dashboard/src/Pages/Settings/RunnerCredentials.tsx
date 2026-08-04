import RunnersElement from "../../Components/Runner/Runners";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Credentials are what let a runbook act on something other than the Runner's
 * own host — an SSH target, or a Kubernetes cluster.
 *
 * Secret fields are write-only: they are encrypted at rest and the API never
 * returns them, so the table can show what a credential IS without ever
 * showing what it holds. Re-entering a value is how you rotate one.
 */
const RunbookCredentials: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<RunbookCredential>
        userPreferencesKey={"runbook-credentials-table"}
        modelType={RunbookCredential}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="runbook-credential-table"
        name="Settings > Runner Credentials"
        saveFilterProps={{
          tableId: "runbook-credentials-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Runbook Credentials",
          description:
            "Access an SSH or Kubernetes step uses to act on your infrastructure. Secret values are encrypted and can never be read back — re-enter one to rotate it.",
        }}
        noItemsMessage={
          "No credentials yet. Create one, assign it to the Runner that will use it, then reference it from an SSH or Kubernetes step."
        }
        formSteps={[
          { title: "Credential", id: "credential" },
          /*
           * Only the chosen type's step is shown. Walking an SSH credential
           * through a Kubernetes step asks for fields that will never be read
           * and reads as though both were required.
           */
          {
            title: "SSH",
            id: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
          },
          {
            title: "Kubernetes",
            id: "kubernetes",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.Kubernetes;
            },
          },
          { title: "Runners", id: "runners" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "credential",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-cluster",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "credential",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Service account limited to restarting checkout pods.",
          },
          {
            field: { credentialType: true },
            title: "Type",
            stepId: "credential",
            description:
              "Which kind of access this is. It cannot be changed later — create a new credential instead.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            /*
             * The column is immutable, so its update ACL is empty and the edit
             * form would not fetch it. It still has to be present in the form
             * values, because every step below is chosen by it — without this
             * an edit would show neither the SSH nor the Kubernetes step.
             */
            showEvenIfPermissionDoesNotExist: true,
            doNotShowWhenEditing: true,
            dropdownOptions: [
              { value: RunbookCredentialType.SSH, label: "SSH" },
              {
                value: RunbookCredentialType.Kubernetes,
                label: "Kubernetes",
              },
            ],
          },

          {
            field: { sshHostname: true },
            title: "Hostname",
            stepId: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "10.0.4.21",
          },
          {
            field: { sshPort: true },
            title: "Port",
            stepId: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "22",
          },
          {
            field: { sshUsername: true },
            title: "Username",
            stepId: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "deploy",
          },
          {
            field: { sshPrivateKey: true },
            title: "Private Key (PEM)",
            stepId: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
            description:
              "Encrypted at rest and never shown again. Leave empty when using a password.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----",
          },
          {
            field: { sshPassphrase: true },
            title: "Private Key Passphrase",
            stepId: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
            description: "Only if the key is passphrase-protected.",
            fieldType: FormFieldSchemaType.Password,
            required: false,
          },
          {
            field: { sshPassword: true },
            title: "Password",
            stepId: "ssh",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.SSH;
            },
            description:
              "For hosts without key access. A key is the better option where you have the choice.",
            fieldType: FormFieldSchemaType.Password,
            required: false,
          },

          {
            field: { kubernetesApiServerUrl: true },
            title: "API Server URL",
            stepId: "kubernetes",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.Kubernetes;
            },
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "https://10.0.0.1:6443",
          },
          {
            field: { kubernetesServiceAccountToken: true },
            title: "Service Account Token",
            stepId: "kubernetes",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.Kubernetes;
            },
            description:
              "Bind the account to a role that permits only the actions your runbooks need. Encrypted at rest and never shown again.",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
          },
          {
            field: { kubernetesCaCertificate: true },
            title: "CA Certificate (PEM)",
            stepId: "kubernetes",
            showIf: (item: FormValues<RunbookCredential>): boolean => {
              return item.credentialType === RunbookCredentialType.Kubernetes;
            },
            description:
              "So the Runner can verify the API server. Leave empty only if it presents a certificate your Runner already trusts.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "-----BEGIN CERTIFICATE-----",
          },

          {
            field: { runners: true },
            title: "Runners",
            stepId: "runners",
            description:
              "Only these Runners may use this credential. A step referencing it must target one of them.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Runner,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Runners",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { credentialType: true },
            title: "Type",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { credentialType: true },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              runners: {
                name: true,
                _id: true,
              },
            },
            title: "Runners",
            type: FieldType.EntityArray,
            getElement: (item: RunbookCredential): ReactElement => {
              return (
                <RunnersElement
                  runners={(item["runners"] as Array<Runner>) || []}
                />
              );
            },
          },
        ]}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
      />
    </Fragment>
  );
};

export default RunbookCredentials;
