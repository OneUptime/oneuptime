import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ApiKeyCustomRolesSettings from "../../Components/ApiKey/ApiKeyCustomRolesSettings";
import {
  CustomRolesCardState,
  getApiKeyMoreSettingsDescription,
  getCustomRoleCount,
  getCustomRolesFoldedItem,
} from "../../Components/CustomRole/CustomRolesFold";
import ApiKeyPermissionTable, {
  ApiKeyPermissionType,
} from "../../Components/ApiKey/ApiKeyPermissionTable";
import ApiKeyStoppedNote from "../../Components/Billing/ApiKeyStoppedNote";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * An API key's page, in the order it is used: what the key is (and the key
 * itself, to copy), what it can do - its own roles and permissions -
 * resetting it, then - folded under More settings - the custom roles it is
 * given and what it can never do, and deleting it.
 *
 * Block permissions are rarely needed and were always on screen, as large as
 * what the key can do; they now sit in the More settings section, whose
 * folded header shows how many the key has. Custom roles - an Enterprise
 * feature most projects never use - opened the key's permissions once the
 * project had one; they sit in More settings too, before Block Permissions,
 * named in the folded header while the card is drawn, with how many roles
 * the key has (Components/CustomRole/CustomRolesFold). A link to
 * #custom-roles - a role's page links each key it is given to that way -
 * opens it there.
 */

// The Block Permissions card's place: its title's, as in any More settings.
export const API_KEY_BLOCK_PERMISSIONS_PLACE: string = "block-permissions";
const APIKeyView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refresher, setRefresher] = React.useState<boolean>(false);
  const [blockPermissionCount, setBlockPermissionCount] =
    React.useState<number>(0);
  // What the Custom Roles card holds, once it says: null until then.
  const [customRoles, setCustomRoles] =
    React.useState<CustomRolesCardState | null>(null);

  const customRolesItem: FoldedSectionItem | null =
    getCustomRolesFoldedItem(customRoles);

  return (
    <Fragment>
      {/* Below the plan API keys need, this key stopped working. */}
      <ApiKeyStoppedNote />

      {/* API Key View  */}
      <CardModelDetail<ApiKey>
        name="API Key Details"
        cardProps={{
          title: "API Key Details",
          description:
            "Send this key in the ApiKey header of each API request. It can do what its permissions allow, until it expires.",
        }}
        videoLink={URL.fromString("https://youtu.be/TzmaTe4sbCI")}
        refresher={refresher}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "API Key Name",
            validation: {
              minLength: 2,
            },
            // Not the column's "Any friendly name of this object", written for the API.
            hideColumnDescription: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "API Key Description",
            hideColumnDescription: true,
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires",
            description: "The key stops working on this date.",
            fieldType: FormFieldSchemaType.Date,
            required: true,
            placeholder: "Expires at",
            validation: {
              dateShouldBeInTheFuture: true,
            },
          },
        ]}
        modelDetailProps={{
          modelType: ApiKey,
          id: "model-detail-api-key",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                expiresAt: true,
              },
              title: "Expires",
              fieldType: FieldType.Date,
            },
            {
              field: {
                projectId: true,
              },
              title: "Project ID",
              fieldType: FieldType.ObjectID,
              opts: {
                isCopyable: true,
              },
            },
            {
              field: {
                apiKey: true,
              },
              title: "API Key",
              fieldType: FieldType.HiddenText,
              opts: {
                isCopyable: true,
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* What the key can do: a role, or single permissions. */}
      <ApiKeyPermissionTable
        apiKeyId={modelId}
        permissionType={ApiKeyPermissionType.AllowPermissions}
        currentProject={props.currentProject}
        customRoleCount={getCustomRoleCount(customRoles)}
      />

      <ResetObjectID<ApiKey>
        modelType={ApiKey}
        fieldName={"apiKey"}
        title={"Reset API Key"}
        description={"Reset the API Key to a new value."}
        modelId={modelId}
        onUpdateComplete={() => {
          setRefresher(!refresher);
        }}
      />

      {/*
       * The custom roles it is given - what a change to a role changes for
       * this key - and what it can never do, folded away. Custom roles are
       * an Enterprise feature: the shell draws the Enterprise card, or the
       * roles the key still has, with Remove.
       */}
      <AdvancedPageSection
        description={getApiKeyMoreSettingsDescription(customRoles)}
        items={[
          ...(customRolesItem ? [customRolesItem] : []),
          foldedSectionItem("Block Permissions", {
            key: API_KEY_BLOCK_PERMISSIONS_PLACE,
            isSet: blockPermissionCount > 0,
            value: String(blockPermissionCount),
          }),
        ]}
        dataTestId="api-key-advanced-section"
      >
        <ApiKeyCustomRolesSettings
          apiKeyId={modelId}
          onRolesChange={(state: CustomRolesCardState) => {
            setCustomRoles(state);
          }}
        />

        <ApiKeyPermissionTable
          apiKeyId={modelId}
          permissionType={ApiKeyPermissionType.BlockPermissions}
          currentProject={props.currentProject}
          onPermissionCountChange={(count: number) => {
            setBlockPermissionCount(count);
          }}
        />
      </AdvancedPageSection>

      {/* Delete API Key */}

      <ModelDelete
        modelType={ApiKey}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default APIKeyView;
