import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

const Vaults: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <>
      <Card
        title="HashiCorp Vault"
        description="Connect HashiCorp Vault to securely manage and inject secrets, tokens, and encryption keys into your OneUptime workflows and monitors."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Lock,
            onClick: () => {},
          },
        ]}
      />
      <Card
        title="AWS Secrets Manager"
        description="Connect AWS Secrets Manager to securely retrieve and manage secrets stored in your AWS account for use with OneUptime monitors and integrations."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Lock,
            onClick: () => {},
          },
        ]}
      />
      <Card
        title="Google Cloud Secret Manager"
        description="Connect Google Cloud Secret Manager to securely access and manage secrets stored in your GCP project for use with OneUptime."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Lock,
            onClick: () => {},
          },
        ]}
      />
      <Card
        title="Azure Key Vault"
        description="Connect Azure Key Vault to securely manage and access secrets, keys, and certificates stored in your Azure subscription."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Lock,
            onClick: () => {},
          },
        ]}
      />
      <Card
        title="Doppler"
        description="Connect Doppler to sync and manage environment variables and secrets across your OneUptime integrations and workflows."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Lock,
            onClick: () => {},
          },
        ]}
      />
      <Card
        title="1Password"
        description="Connect 1Password to securely access and manage secrets using 1Password Connect for your OneUptime monitors and automations."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Lock,
            onClick: () => {},
          },
        ]}
      />
    </>
  );
};

export default Vaults;
