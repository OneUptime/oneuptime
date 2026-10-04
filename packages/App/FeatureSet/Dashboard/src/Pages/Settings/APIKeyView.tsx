import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ApiKeyPermissionTable, {
  ApiKeyPermissionType,
} from "../../Components/ApiKey/ApiKeyPermissionTable";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { foldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
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
 * itself, to copy), what it can do, resetting it, then - folded under More
 * settings - what it can never do, and deleting it.
 *
 * Block permissions are rarely needed and were always on screen, as large as
 * what the key can do; they now sit in the More settings section, whose
 * folded header shows how many the key has.
 */
const APIKeyView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refresher, setRefresher] = React.useState<boolean>(false);
  const [blockPermissionCount, setBlockPermissionCount] =
    React.useState<number>(0);

  return (
    <Fragment>
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
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "API Key Description",
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires",
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

      {/* What the key can never do, folded away. */}
      <AdvancedPageSection
        description="Block permissions: what this key can never do, even when one of its roles or permissions allows it."
        items={[
          foldedSectionItem("Block Permissions", {
            key: "blockPermissions",
            isSet: blockPermissionCount > 0,
            value: String(blockPermissionCount),
          }),
        ]}
        dataTestId="api-key-advanced-section"
      >
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
