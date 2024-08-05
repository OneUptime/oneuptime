import EventName from "../../../Utils/EventName";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import Page from "CommonUI/src/Components/Page/Page";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import GlobalEvents from "CommonUI/src/Utils/GlobalEvents";
import UserUtil from "CommonUI/src/Utils/User";
import User from "Common/AppModels/Models/User";
import React, { FunctionComponent, ReactElement } from "react";

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Page
      title={"User Profile"}
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "User Profile",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route,
          ),
        },

        {
          title: "Profile Picture",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_PROFILE_PICTURE] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenu />}
    >
      <CardModelDetail<User>
        name="User Profile > Profile Picture"
        cardProps={{
          title: "Profile Picture",
          description: "Please update your profile picture here.",
        }}
        isEditable={true}
        editButtonText={"Update Profile Picture"}
        formFields={[
          {
            field: {
              profilePictureFile: true,
            },
            title: "Profile Picture",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload profile picture",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          selectMoreFields: {
            profilePictureId: true,
          },
          onItemLoaded: (item: User) => {
            if (item.profilePictureId) {
              UserUtil.setProfilePicId(item.profilePictureId);
              GlobalEvents.dispatchEvent(EventName.SET_NEW_PROFILE_PICTURE, {
                id: item.profilePictureId,
              });
            } else {
              UserUtil.setProfilePicId(null);
              GlobalEvents.dispatchEvent(EventName.SET_NEW_PROFILE_PICTURE, {
                id: null,
              });
            }
          },
          modelType: User,
          id: "model-detail-user-profile-picture",
          fields: [
            {
              field: {
                profilePictureFile: {
                  file: true,
                  type: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Profile Picture",
              placeholder: "No profile picture uploaded.",
            },
          ],
          modelId: UserUtil.getUserId(),
        }}
      />
    </Page>
  );
};

export default Home;
