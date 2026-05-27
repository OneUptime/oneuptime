import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Exception from "Common/Types/Exception/Exception";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import ProjectUserProfile from "Common/Models/DatabaseModels/ProjectUserProfile";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const UserViewCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [projectUserProfileId, setProjectUserProfileId] =
    useState<ObjectID | null>(null);
  const [hasCustomFields, setHasCustomFields] = useState<boolean>(false);

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const customFieldsResult: ListResult<TeamMemberCustomField> =
        await ModelAPI.getList<TeamMemberCustomField>({
          modelType: TeamMemberCustomField,
          query: {
            projectId: projectId,
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
          },
          sort: {},
        });

      setHasCustomFields(customFieldsResult.data.length > 0);

      if (customFieldsResult.data.length > 0) {
        const profileResult: ListResult<ProjectUserProfile> =
          await ModelAPI.getList<ProjectUserProfile>({
            modelType: ProjectUserProfile,
            query: {
              projectId: projectId,
              userId: userId,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });

        if (profileResult.data.length > 0 && profileResult.data[0]!.id) {
          setProjectUserProfileId(profileResult.data[0]!.id);
        }
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPage().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Exception));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!hasCustomFields) {
    return (
      <EmptyState
        id="empty-state-user-custom-fields"
        icon={IconProp.TableCells}
        title="No custom fields defined"
        description="There are no custom fields defined for team members in this project. Define custom fields in Project Settings to capture additional information about each user."
      />
    );
  }

  if (!projectUserProfileId) {
    return (
      <EmptyState
        id="empty-state-user-custom-fields-no-profile"
        icon={IconProp.TableCells}
        title="No custom field values"
        description="This user does not have any custom field values yet."
      />
    );
  }

  return (
    <Fragment>
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom field values for this user."
        modelType={ProjectUserProfile}
        customFieldType={TeamMemberCustomField}
        name="User Custom Fields"
        projectId={ProjectUtil.getCurrentProjectId()!}
        modelId={projectUserProfileId}
        isEditable={false}
      />
    </Fragment>
  );
};

export default UserViewCustomFields;
