import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import TimezoneCode from "Common/Types/TimezoneCode";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import Page from "CommonUI/src/Components/Page/Page";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import UserUtil from "CommonUI/src/Utils/User";
import User from "Model/Models/User";
import React, { FunctionComponent, ReactElement } from "react";

const Home: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
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
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(TimezoneCode),
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
            },
            {
              field: {
                email: true,
              },
              title: "Email",
            },
            {
              field: {
                timezone: true,
              },
              title: "Timezone",
              placeholder: "No timezone selected",
            },
          ],
          modelId: UserUtil.getUserId(),
        }}
      />
    </Page>
  );
};

export default Home;
