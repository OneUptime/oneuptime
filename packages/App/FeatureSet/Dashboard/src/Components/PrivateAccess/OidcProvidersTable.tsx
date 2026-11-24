import PrivateAccessCopy, {
  OIDC_CONFIG_VALUES_TEST_ID,
} from "./PrivateAccessCopy";
import { OidcProviderModel, PrivateAccessKind } from "./PrivateAccessKinds";
import Query from "Common/Types/BaseDatabase/Query";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
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
 * The OpenID Connect providers of a public link that asks its visitors to
 * sign in (#10250): a dashboard's, and a form's next (PrivateAccessKinds).
 * As a status page's are (StatusPages/View/OIDC): adding one asks for its
 * name, issuer, client ID and secret, everything else filled in under More
 * fields (Common/UI/Components/Sso/OidcProviderFormFields), and once it is
 * saved the dialog with the redirect URI to give the identity provider
 * opens straight away.
 */

interface OidcConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

export interface ComponentProps {
  kind: PrivateAccessKind;
  parentId: ObjectID;
}

const OidcProvidersTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: PrivateAccessKind = props.kind;

  const [configTarget, setConfigTarget] =
    useState<OidcConfigDialogTarget | null>(null);

  const query: Query<OidcProviderModel> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    [kind.parentColumn]: props.parentId.toString(),
  } as Query<OidcProviderModel>;

  return (
    <Fragment>
      <ModelTable<OidcProviderModel>
        modelType={kind.oidcModel}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        userPreferencesKey={kind.oidcTable.userPreferencesKey}
        query={query}
        onBeforeCreate={(
          item: OidcProviderModel,
        ): Promise<OidcProviderModel> => {
          (item as unknown as Record<string, unknown>)[kind.parentColumn] =
            props.parentId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;

          return Promise.resolve(item);
        }}
        id={kind.oidcTable.tableId}
        name={kind.oidcTable.tableName}
        saveFilterProps={{
          tableId: kind.oidcTable.saveFilterTableId,
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        singularName={PrivateAccessCopy.oidcProvider}
        pluralName={PrivateAccessCopy.oidcProviders}
        createVerb="Add"
        cardProps={{
          title: PrivateAccessCopy.oidcCardTitle,
          description: kind.copy.oidcDescription,
        }}
        formSteps={getSsoProviderFormSteps<OidcProviderModel>()}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getOidcProviderFormFields<OidcProviderModel>()}
        onCreateSuccess={(
          item: OidcProviderModel,
          modalType?: ModalType,
        ): Promise<OidcProviderModel> => {
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
            title: PrivateAccessCopy.viewOidcConfig,
            icon: IconProp.Settings,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: OidcProviderModel,
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
          title={PrivateAccessCopy.oidcConfigTitle}
          description={
            <div className="space-y-4">
              <CopyableValueList
                dataTestId={OIDC_CONFIG_VALUES_TEST_ID}
                values={[
                  {
                    label: PrivateAccessCopy.oidcRedirectUriLabel,
                    value: kind.getOidcRedirectUri(
                      props.parentId,
                      configTarget.id,
                    ),
                  },
                ]}
              />
              <div className="text-sm text-gray-500">
                {translator.translateText(PrivateAccessCopy.oidcRedirectHint)}
              </div>
              {!configTarget.isEnabled && (
                <div
                  className="text-sm text-gray-500"
                  data-testid="oidc-config-turn-on-note"
                >
                  {translator.translateText(PrivateAccessCopy.oidcTurnOnNote)}
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

export default OidcProvidersTable;
