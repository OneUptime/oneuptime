import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { FormProps } from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import Label from "Common/Models/DatabaseModels/Label";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
} from "react";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const APIKeyView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refresher, setRefresher] = React.useState<boolean>(false);

  type GetPermissionTable = (data: {
    permissionType: PermissionType;
  }) => ReactElement;

  const getPermissionTable: GetPermissionTable = (data: {
    permissionType: PermissionType;
  }): ReactElement => {
    const { permissionType } = data;

    const formRef: MutableRefObject<FormProps<FormValues<ApiKeyPermission>>> =
      React.useRef<
        FormProps<FormValues<ApiKeyPermission>>
      >() as MutableRefObject<FormProps<FormValues<ApiKeyPermission>>>;

    let tableTitle: string = "Allow Permissions";

    if (permissionType === PermissionType.BlockPermissions) {
      tableTitle = "Block Permissions";
    }

    let tableDescription: string =
      "Here you can manage allow permissions for this API Key.";

    if (permissionType === PermissionType.BlockPermissions) {
      tableDescription =
        "Here you can manage block permissions for this API Key. This will override any allow permissions set for this API Key.";
    }

    {
      /* API Key Permisison Table */
    }

    return (
      <ModelTable<ApiKeyPermission>
        modelType={ApiKeyPermission}
        id="api-key-permission-table"
        userPreferencesKey="api-key-permission-table"
        isDeleteable={true}
        name="Settings > API Key > Permissions"
        query={{
          apiKeyId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
          isBlockPermission: permissionType === PermissionType.BlockPermissions,
        }}
        onBeforeCreate={(item: ApiKeyPermission): Promise<ApiKeyPermission> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }

          item.apiKeyId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          item.isBlockPermission =
            permissionType === PermissionType.BlockPermissions;
          return Promise.resolve(item);
        }}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: tableTitle,
          description: tableDescription,
        }}
        noItemsMessage={"No permisisons created for this API Key so far."}
        createEditFromRef={formRef}
        formFields={[
          {
            field: {
              permission: true,
            },
            onChange: async (_value: any) => {
              await formRef.current.setFieldValue("labels", [], true);
            },
            title: "Permission",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Permission",
            dropdownOptions:
              PermissionUtil.projectPermissionsAsDropdownOptions(),
          },
          {
            field: {
              labels: true,
            },
            title: "Restrict to Labels",
            description:
              "If you want to restrict this permission to specific labels, you can select them here. This is an optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            showIf: (values: FormValues<TeamPermission>): boolean => {
              if (!values["permission"]) {
                return false;
              }

              if (
                values["permission"] &&
                !PermissionHelper.isAccessControlPermission(
                  values["permission"] as Permission,
                )
              ) {
                return false;
              }

              return true;
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              permission: true,
            },
            title: "Permission",
            type: FieldType.Text,
          },
          {
            field: {
              labels: {
                name: true,
              },
            },
            title: "Restrict to Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              permission: true,
            },
            title: "Permission",
            type: FieldType.Text,

            getElement: (item: ApiKeyPermission): ReactElement => {
              return (
                <p>
                  {PermissionHelper.getTitle(item["permission"] as Permission)}
                </p>
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Restrict to Labels",
            type: FieldType.EntityArray,

            getElement: (item: ApiKeyPermission): ReactElement => {
              if (
                item &&
                item["permission"] &&
                !PermissionHelper.isAccessControlPermission(
                  item["permission"] as Permission,
                )
              ) {
                return (
                  <p>
                    Restriction by labels cannot be applied to this permission.
                  </p>
                );
              }

              if (!item["labels"] || item["labels"].length === 0) {
                return (
                  <p>No restrictions has been applied to this permission.</p>
                );
              }

              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      {/* API Key View  */}
      <CardModelDetail<ApiKey>
        name="API Key Details"
        cardProps={{
          title: "API Key Details",
          description: "Here are more details for this API Key.",
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

      {/* Allow Permissions */}
      {getPermissionTable({
        permissionType: PermissionType.AllowPermissions,
      })}

      {/* Block Permissions */}
      {getPermissionTable({
        permissionType: PermissionType.BlockPermissions,
      })}

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
