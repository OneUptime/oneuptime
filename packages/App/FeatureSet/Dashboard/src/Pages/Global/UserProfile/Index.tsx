import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ProductFeedback, {
  useProductFeedbackSettings,
} from "Common/UI/Utils/ProductFeedback";
import { ProductFeedbackSettings } from "Common/Types/ProductFeedback/ProductFeedback";
import FieldType from "Common/UI/Components/Types/FieldType";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import { getUserChosenLanguage } from "Common/Types/UserLanguage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import TimezoneElement from "../../../Components/Timezone/TimezoneElement";
import {
  getUserLanguageLabelOfCode,
  USER_LANGUAGE_OPTIONS,
} from "../../../Components/UserLanguage/UserLanguageOptions";
import { followUserLanguage } from "../../../Utils/DashboardLanguageSwitch";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { isDashboardRecordingConfigured } from "../../../Utils/DashboardRecording/DashboardRecordingConfig";
import { PERSON_RECORDING_COPY } from "../../../Components/DashboardRecording/DashboardRecordingCopy";

/*
 * "Ask me how things went" (#6832): the person's own switch for the
 * questions OneUptime asks - at the end of a guided setup, under an
 * explanation, the first-week check-in. Give feedback in Help stays.
 */
export const FEEDBACK_QUESTIONS_COPY: {
  cardTitle: string;
  cardDescription: string;
  title: string;
  onDescription: string;
  offDescription: string;
} = {
  cardTitle: translationKey("Feedback Questions"),
  cardDescription: translationKey(
    "Now and then OneUptime asks how something went: at the end of a guided setup, under an explanation, and once in a new project's first weeks. At most one question a week, and never while something is down.",
  ),
  title: translationKey("Ask me how things went"),
  onDescription: translationKey(
    "OneUptime may ask you one short question now and then. Give feedback in Help works either way.",
  ),
  offDescription: translationKey(
    "OneUptime never asks you. Give feedback in Help still works whenever you want to tell us something.",
  ),
};

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { i18n } = useTranslation();
  /*
   * "Ask me how things went" (#6832), wherever the server asks people at
   * all: a server whose admins switched feedback off asks nobody.
   */
  const feedbackSettings: ProductFeedbackSettings | null =
    useProductFeedbackSettings();

  return (
    <Fragment>
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
          void followUserLanguage(i18n, getUserChosenLanguage(user));
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
              "Your on-call pages and the Dashboard use this language, on every browser.",
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
                // Unset reads as quiet text, as Language beside it does.
                if (!user.timezone) {
                  return (
                    <p className="text-gray-500">
                      {translator.translateText("No timezone selected")}
                    </p>
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
                    <p
                      className="text-gray-500"
                      data-testid="user-profile-language-not-set"
                    >
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
      {feedbackSettings?.isOn ? (
        <ModelSwitchCard<User>
          modelType={User}
          modelId={UserUtil.getUserId()}
          column="disableFeedbackQuestions"
          isInverted={true}
          cardTitle={FEEDBACK_QUESTIONS_COPY.cardTitle}
          cardDescription={FEEDBACK_QUESTIONS_COPY.cardDescription}
          title={FEEDBACK_QUESTIONS_COPY.title}
          getDescription={(isOn: boolean): string => {
            return isOn
              ? FEEDBACK_QUESTIONS_COPY.onDescription
              : FEEDBACK_QUESTIONS_COPY.offDescription;
          }}
          onSaved={(isOn: boolean) => {
            const settings: ProductFeedbackSettings | null =
              ProductFeedback.getSettings();

            if (settings) {
              ProductFeedback.setSettings({ ...settings, isAskingMe: isOn });
            }
          }}
          dataTestId="user-profile-feedback-questions"
        />
      ) : (
        <></>
      )}
      {/*
       * "Record how I use setup pages" (#6834), beside the feedback
       * questions: the help-improve-OneUptime choices sit together. Only on
       * a server that records at all - OneUptime Cloud, once it is on.
       */}
      {isDashboardRecordingConfigured() ? (
        <ModelSwitchCard<User>
          modelType={User}
          modelId={UserUtil.getUserId()}
          column="disableDashboardRecording"
          isInverted={true}
          cardTitle={PERSON_RECORDING_COPY.cardTitle}
          cardDescription={PERSON_RECORDING_COPY.cardDescription}
          title={PERSON_RECORDING_COPY.title}
          getDescription={(isOn: boolean): string => {
            return isOn
              ? PERSON_RECORDING_COPY.onDescription
              : PERSON_RECORDING_COPY.offDescription;
          }}
          dataTestId="user-profile-dashboard-recording"
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Home;
