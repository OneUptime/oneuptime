import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import ProjectUserProfile from "Common/Models/DatabaseModels/ProjectUserProfile";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import Exception from "Common/Types/Exception/Exception";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";

const UserSettingsCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [projectUserProfileId, setProjectUserProfileId] =
    useState<ObjectID | null>(null);
  const [hasCustomFields, setHasCustomFields] = useState<boolean>(false);

  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
  const userId: ObjectID = UserUtil.getUserId()!;

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      // First check if there are any custom fields defined
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

      // Try to find existing ProjectUserProfile
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
        // Found existing profile
        setProjectUserProfileId(profileResult.data[0]!.id);
      } else {
        // Create new profile
        const newProfile: ProjectUserProfile = new ProjectUserProfile();
        newProfile.projectId = projectId;
        newProfile.userId = userId;

        const response: HTTPResponse<
          | JSONObject
          | JSONArray
          | ProjectUserProfile
          | Array<ProjectUserProfile>
        > = await ModelAPI.create<ProjectUserProfile>({
          model: newProfile,
          modelType: ProjectUserProfile,
        });

        const createdProfile: ProjectUserProfile =
          response.data as ProjectUserProfile;

        if (createdProfile && createdProfile._id) {
          setProjectUserProfileId(new ObjectID(createdProfile._id as string));
        } else {
          setError("Failed to create user profile.");
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
      setIsLoading(false);
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
      <Card
        title="Custom Fields"
        description="Custom fields help you add additional information to your profile."
      >
        <ErrorMessage message="No custom fields have been defined for team members in this project. Project administrators can add custom fields in Project Settings > Users > Custom Fields." />
      </Card>
    );
  }

  if (!projectUserProfileId) {
    return <ErrorMessage message="Could not load user profile." />;
  }

  return (
    <CustomFieldsDetail
      title="My Custom Fields"
      description="Fill in your custom field values for this project."
      modelType={ProjectUserProfile}
      customFieldType={TeamMemberCustomField}
      name="User Custom Fields"
      projectId={projectId}
      modelId={projectUserProfileId}
    />
  );
};

export default UserSettingsCustomFields;
