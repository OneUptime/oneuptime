import PrivateAccessCopy, {
  SAML_CONFIG_VALUES_TEST_ID,
} from "./PrivateAccessCopy";
import { PrivateAccessKind, SamlProviderModel } from "./PrivateAccessKinds";
import Query from "Common/Types/BaseDatabase/Query";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * The SAML providers of a public link that asks its visitors to sign in
 * (#10250): a dashboard's, and a form's next (PrivateAccessKinds). As a
 * status page's are (StatusPages/View/SSO): adding one asks for what the
 * identity provider gives - its sign-on URL, issuer and certificate, the
 * signature and digest methods and the description filled in under More
 * fields (Common/UI/Components/Sso/SamlProviderFormFields) - and once it is
 * saved, the dialog with the Entity ID and Reply URL to give the identity
 * provider opens straight away: that is the next thing to do. Each row
 * turns on or off from its ⋯ menu, and turning one off ends the sign-ins
 * it gave (Server/Utils/SsoSignInsEnded).
 */

interface SamlConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

export interface ComponentProps {
  kind: PrivateAccessKind;
  parentId: ObjectID;
}

const SamlProvidersTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: PrivateAccessKind = props.kind;

  const [configTarget, setConfigTarget] =
    useState<SamlConfigDialogTarget | null>(null);

  const query: Query<SamlProviderModel> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    [kind.parentColumn]: props.parentId.toString(),
  } as Query<SamlProviderModel>;

  return (
    <Fragment>
      <ModelTable<SamlProviderModel>
        modelType={kind.samlModel}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        userPreferencesKey={kind.samlTable.userPreferencesKey}
        query={query}
        onBeforeCreate={(
          item: SamlProviderModel,
        ): Promise<SamlProviderModel> => {
          (item as unknown as Record<string, unknown>)[kind.parentColumn] =
            props.parentId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;

          return Promise.resolve(item);
        }}
        id={kind.samlTable.tableId}
        name={kind.samlTable.tableName}
        saveFilterProps={{
          tableId: kind.samlTable.saveFilterTableId,
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        singularName={PrivateAccessCopy.ssoProvider}
        pluralName={PrivateAccessCopy.ssoProviders}
        createVerb="Add"
        cardProps={{
          title: PrivateAccessCopy.samlCardTitle,
          description: kind.copy.samlDescription,
        }}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={getSsoProviderFormSteps<SamlProviderModel>()}
        formFields={getSamlProviderFormFields<SamlProviderModel>()}
        onCreateSuccess={(
          item: SamlProviderModel,
          modalType?: ModalType,
        ): Promise<SamlProviderModel> => {
          if (modalType === ModalType.Create && item._id) {
            setConfigTarget({
              id: item._id.toString(),
              isEnabled: Boolean(item.isEnabled),
            });
          }

          return Promise.resolve(item);
        }}
        showRefreshButton={true}
        actionButtons={[
          {
            title: PrivateAccessCopy.viewSamlConfig,
            icon: IconProp.Settings,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: SamlProviderModel,
              onCompleteAction: VoidFunction,
            ) => {
              setConfigTarget({
                id: (item["_id"] as string) || "",
                isEnabled: Boolean(item.isEnabled),
              });
              onCompleteAction();
            },
          },
        ]}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
            hideOnMobile: true,
          },
        ]}
      />

      {configTarget && configTarget.id ? (
        <ConfirmModal
          title={PrivateAccessCopy.samlConfigTitle}
          description={
            <div className="space-y-4">
              {/*
               * The two values to paste into the identity provider, each
               * with a button that copies it - as the server holds a
               * sign-in to them (PrivateAccessKinds).
               */}
              <CopyableValueList
                dataTestId={SAML_CONFIG_VALUES_TEST_ID}
                values={[
                  {
                    label: PrivateAccessCopy.samlEntityIdLabel,
                    value: kind.getSamlEntityId(
                      props.parentId,
                      configTarget.id,
                    ),
                  },
                  {
                    label: PrivateAccessCopy.samlReplyUrlLabel,
                    value: kind.getSamlReplyUrl(
                      props.parentId,
                      configTarget.id,
                    ),
                  },
                ]}
              />
              {!configTarget.isEnabled && (
                <div
                  className="text-sm text-gray-500"
                  data-testid="sso-config-turn-on-note"
                >
                  {translator.translateText(PrivateAccessCopy.samlTurnOnNote)}
                </div>
              )}
            </div>
          }
          submitButtonText={PrivateAccessCopy.close}
          onSubmit={() => {
            setConfigTarget(null);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SamlProvidersTable;
