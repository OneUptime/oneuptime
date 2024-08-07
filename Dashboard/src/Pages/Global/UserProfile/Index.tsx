import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";
import TimezoneElement from "../../../Components/Timezone/TimezoneElement";

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
      ]}
      sideMenu={<SideMenu />}
    >
      <CardModelDetail
        cardProps={{
          title: "Basic Info",
          description: "Here are some of your details.",
        }}
        name="User Profile > Basic Info"
        onSaveSuccess={(user: User) => {
          if (user.timezone) {
            UserUtil.setSavedUserTimezone(user.timezone);
          }
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              email: true,
            },
            fieldType: FormFieldSchemaType.Email,
            placeholder: "jeff@example.com",
            required: true,
            title: "Email",
            description:
              "You will have to verify your email again if you change it",
          },
          {
            field: {
              name: true,
            },
            fieldType: FormFieldSchemaType.Text,
            placeholder: "Jeff Smith",
            required: true,
            title: "Full Name",
          },
          {
            field: {
              timezone: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            placeholder: "Select Timezone",
            description:
              "Select your timezone. This will be used for all date and time related notifications sent out to you.",
            required: false,
            title: "Timezone",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: User,
          id: "user-profile",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              placeholder: "No name added",
            },
            {
              field: {
                email: true,
              },
              title: "Email",
              placeholder: "No email added",
            },
            {
              field: {
                timezone: true,
              },
              title: "Timezone",
              placeholder: "No timezone selected",
              fieldType: FieldType.Element,
              getElement: (user: User) => {
                if (!user.timezone) {
                  return <p>No timezone selected</p>;
                }

                return <TimezoneElement timezone={user.timezone} />;
              },
            },
          ],

          modelId: UserUtil.getUserId(),
        }}
      />
    </Page>
  );
};

export default Home;
