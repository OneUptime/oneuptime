import PageComponentProps from "../../PageComponentProps";
import DashboardThemeCard from "../../../Components/Dashboard/Branding/DashboardThemeCard";
import DashboardBrandingCopy from "../../../Components/Dashboard/Branding/DashboardBrandingCopy";
import ObjectID from "Common/Types/ObjectID";
import { DetailImageBackdrop } from "Common/UI/Components/Detail/DetailImageBackdrop";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Dashboards -> a dashboard -> Branding: how the dashboard's public link
 * looks - its page title and description, its logo and the logo for its
 * dark theme, its theme (light, dark, or as each visitor's device is set:
 * DashboardThemeCard, right under the logos, as on a status page's Branding
 * page) and its favicon.
 */
const DashboardBranding: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<Dashboard>
        name="Dashboard > Branding > Title and Description"
        cardProps={{
          title: "Title and Description",
          description: "This will also be used for SEO.",
        }}
        editButtonText={"Edit"}
        isEditable={true}
        formFields={[
          {
            field: {
              pageTitle: true,
            },
            title: "Page Title",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Please enter page title here.",
          },
          {
            field: {
              pageDescription: true,
            },
            title: "Page Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Please enter page description here.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Dashboard,
          id: "model-detail-dashboard-branding",
          fields: [
            {
              field: {
                pageTitle: true,
              },
              fieldType: FieldType.Text,
              title: "Page Title",
              placeholder: "No page title entered so far.",
            },
            {
              field: {
                pageDescription: true,
              },
              fieldType: FieldType.Text,
              title: "Page Description",
              placeholder: "No page description entered so far.",
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * The logo, and a logo made for a dark background - light lettering -
       * shown instead of it wherever the public dashboard is dark: a Dark
       * dashboard, one that follows each visitor's device while it is dark,
       * and any dashboard a visitor turns dark from its toolbar. Optional:
       * without it the logo sits on a small light backdrop there.
       */}
      <CardModelDetail<Dashboard>
        name="Dashboard > Branding > Logo"
        cardProps={{
          title: "Logo",
          description: DashboardBrandingCopy.logoDescription,
        }}
        isEditable={true}
        editButtonText={"Edit Logo"}
        // Named as its button is: it edited "Dashboard" as a whole before.
        editModalTitle={"Edit Logo"}
        formFields={[
          {
            field: {
              logoFile: true,
            },
            title: "Logo",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload Logo.",
            description: DashboardBrandingCopy.logoDescription,
            hideColumnDescription: true,
          },
          {
            field: {
              darkThemeLogoFile: true,
            },
            title: DashboardBrandingCopy.darkThemeLogoTitle,
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: DashboardBrandingCopy.darkThemeLogoPlaceholder,
            description: DashboardBrandingCopy.darkThemeLogoDescription,
            hideColumnDescription: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Dashboard,
          id: "model-detail-dashboard-logo",
          fields: [
            {
              field: {
                logoFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Logo",
              placeholder: "No logo uploaded.",
              /*
               * Each logo on the page it is made for, in both of the
               * Dashboard's themes: a dark theme logo's light lettering
               * would vanish on the card's white frame.
               */
              imageBackdrop: DetailImageBackdrop.Light,
            },
            {
              field: {
                darkThemeLogoFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: DashboardBrandingCopy.darkThemeLogoTitle,
              placeholder: DashboardBrandingCopy.noDarkThemeLogo,
              imageBackdrop: DetailImageBackdrop.Dark,
            },
          ],
          modelId: modelId,
        }}
      />

      <DashboardThemeCard dashboardId={modelId} />

      <CardModelDetail<Dashboard>
        name="Dashboard > Branding > Favicon"
        cardProps={{
          title: "Favicon",
          description: "Favicon will be used for SEO.",
        }}
        isEditable={true}
        editButtonText={"Edit Favicon"}
        formFields={[
          {
            field: {
              faviconFile: true,
            },
            title: "Favicon",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload Favicon.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Dashboard,
          id: "model-detail-dashboard-favicon",
          fields: [
            {
              field: {
                faviconFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Favicon",
              placeholder: "No favicon uploaded.",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default DashboardBranding;
