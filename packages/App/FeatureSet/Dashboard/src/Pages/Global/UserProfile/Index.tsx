import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import { getUserChosenLanguage } from "Common/Types/UserLanguage";
import React, { FunctionComponent, ReactElement } from "react";
import TimezoneElement from "../../../Components/Timezone/TimezoneElement";
import {
  getUserLanguageLabelOfCode,
  USER_LANGUAGE_OPTIONS,
} from "../../../Components/UserLanguage/UserLanguageOptions";
import {
  getDashboardLanguage,
  switchDashboardLanguage,
} from "../../../Utils/DashboardLanguageSwitch";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <CardModelDetail
      cardProps={{
        title: "Basic Info",
        description:
          "Your name and email as your team sees them, and the time zone and language OneUptime uses with you.",
      }}
      name="User Profile > Basic Info"
      onSaveSuccess={(user: User) => {
        if (user.timezone) {
          UserUtil.setSavedUserTimezone(user.timezone);
        }

        /*
         * The language they picked is the Dashboard's at once, as it is on
         * every browser they sign in on (UserLanguageInit). Cleared, the
         * page stays in the language it shows.
         */
        const language: string = getUserChosenLanguage(user);

        if (language && language !== getDashboardLanguage()) {
          void switchDashboardLanguage(language);
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
          disableSpellCheck: true,
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
        {
          field: {
            language: true,
          },
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: USER_LANGUAGE_OPTIONS,
          placeholder: "Not set (English)",
          description:
            "The Dashboard and your on-call pages are in this language, on every browser. Not set: English pages, and the Dashboard follows your browser.",
          required: false,
          title: "Language",
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
                return (
                  <p>{translator.translateText("No timezone selected")}</p>
                );
              }

              return <TimezoneElement timezone={user.timezone} />;
            },
          },
          {
            field: {
              language: true,
            },
            title: "Language",
            fieldType: FieldType.Element,
            getElement: (user: User) => {
              const language: string = getUserChosenLanguage(user);

              if (!language) {
                return (
                  <p className="text-gray-500" data-testid="user-profile-language-not-set">
                    {translator.translateText("Not set (English)")}
                  </p>
                );
              }

              return (
                <p>
                  <IsolatedText
                    text={getUserLanguageLabelOfCode(language)}
                    dataTestId="user-profile-language"
                  />
                </p>
              );
            },
          },
        ],

        modelId: UserUtil.getUserId(),
      }}
    />
  );
};

export default Home;
