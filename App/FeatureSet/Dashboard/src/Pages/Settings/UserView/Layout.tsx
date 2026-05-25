import { getSettingsBreadcrumbs } from "../../../Utils/Breadcrumbs/SettingsBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import UserViewSideMenu from "./SideMenu";
import ProjectUtil from "Common/UI/Utils/Project";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Exception from "Common/Types/Exception/Exception";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

const UserViewLayout: FunctionComponent = (): ReactElement => {
  const { modelId: idParam } = useParams();
  const userId: ObjectID = new ObjectID(idParam || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [hasCustomFields, setHasCustomFields] = useState<boolean>(false);

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const teamMembers: ListResult<TeamMember> =
        await ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: userId,
            projectId: projectId,
          },
          select: {
            user: {
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
          skip: 0,
          limit: 1,
        });

      if (teamMembers.data.length === 0) {
        setError("User not found.");
        return;
      }

      setUser(teamMembers.data[0]!.user!);

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

  const title: string =
    user?.name?.toString() || user?.email?.toString() || "User";

  return (
    <Page
      title={title}
      breadcrumbLinks={getSettingsBreadcrumbs(path)}
      sideMenu={
        <UserViewSideMenu modelId={userId} hasCustomFields={hasCustomFields} />
      }
      isLoading={isLoading}
      error={error}
    >
      <Outlet />
    </Page>
  );
};

export default UserViewLayout;
