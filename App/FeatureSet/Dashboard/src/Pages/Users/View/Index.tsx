import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Exception from "Common/Types/Exception/Exception";
import Route from "Common/Types/API/Route";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Image from "Common/UI/Components/Image/Image";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Detail from "Common/UI/Components/Detail/Detail";
import Card from "Common/UI/Components/Card/Card";
import UserUtil from "Common/UI/Utils/User";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import User from "Common/Models/DatabaseModels/User";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const UserViewIndex: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID();

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
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

  return (
    <Fragment>
      <Card
        title={
          user?.name?.toString() || user?.email?.toString() || "User Details"
        }
        description="View details about this user."
      >
        <Detail
          item={user!}
          fields={[
            {
              key: "profilePictureId",
              fieldType: FieldType.Element,
              title: "Profile Picture",
              placeholder: "No profile picture uploaded.",
              getElement: (item: User): ReactElement => {
                if (!item.id) {
                  return (
                    <Image
                      className="h-12 w-12 rounded-full"
                      imageUrl={Route.fromString(`${BlankProfilePic}`)}
                      alt={
                        item.name?.toString() ||
                        item.email?.toString() ||
                        "User Profile Picture"
                      }
                    />
                  );
                }

                const imageUrl: Route = UserUtil.getProfilePictureRoute(
                  item.id,
                );

                return (
                  <Image
                    className="h-12 w-12 rounded-full"
                    imageUrl={imageUrl}
                    alt={
                      item.name?.toString() ||
                      item.email?.toString() ||
                      "User Profile Picture"
                    }
                  />
                );
              },
            },
            {
              key: "name",
              title: "Name",
              fieldType: FieldType.Name,
              placeholder: "No name provided.",
            },
            {
              key: "email",
              title: "Email",
              fieldType: FieldType.Email,
            },
            {
              key: "_id",
              title: "User ID",
              fieldType: FieldType.ObjectID,
            },
          ]}
        />
      </Card>
    </Fragment>
  );
};

export default UserViewIndex;
