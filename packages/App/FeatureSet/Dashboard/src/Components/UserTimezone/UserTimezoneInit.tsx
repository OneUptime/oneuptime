import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import TimezoneAlias from "Common/Types/TimezoneAlias";
import User from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";
import API from "Common/UI/Utils/API/API";
import { Logger } from "Common/UI/Utils/Logger";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserModel from "Common/Models/DatabaseModels/User";
import useAsyncEffect from "use-async-effect";

const UseTimezoneInitElement: FunctionComponent = (): ReactElement => {
  const [showConfirmModal, setShowConfirmModal] =
    React.useState<boolean>(false);
  const [timezoneToSave, setTimezoneToSave] = React.useState<Timezone | null>(
    null,
  );

  type UpdateUserTimezoneFunction = (timezone: Timezone) => Promise<void>;

  const updateUserTimezone: UpdateUserTimezoneFunction = async (
    timezone: Timezone,
  ): Promise<void> => {
    try {
      User.setSavedUserTimezone(timezone);
      User.clearDismissedTimezonePrompt();

      await ModelAPI.updateById({
        id: User.getUserId(),
        data: {
          timezone: timezone,
        },
        modelType: UserModel,
      });
    } catch (err) {
      /*
       * Nothing here is user-initiated in the first-run path (the browser
       * timezone is saved silently), and the prompt has already closed by
       * the time this can fail — so the failure goes to the console and the
       * saved-timezone prompt simply comes back on the next load.
       */
      Logger.error(
        `Error saving timezone: ${API.getFriendlyErrorMessage(err as Error)}`,
      );
    }
  };

  useAsyncEffect(async () => {
    if (User.isLoggedIn()) {
      // check user timezone

      // Already in its current name — see OneUptimeDate.getCurrentTimezone.
      const guessTimezone: Timezone = OneUptimeDate.getCurrentTimezone();
      const savedTimezone: Timezone | null = User.getSavedUserTimezone();

      if (savedTimezone === null) {
        // first time — silently save the browser timezone
        await updateUserTimezone(guessTimezone);
        return;
      }

      /*
       * Compare in current names on both sides. The saved value can be a
       * legacy name — this component used to save the browser's guess
       * untranslated, and Chromium reports "Asia/Calcutta" for India — while
       * the guess is now "Asia/Kolkata". Compared as they are, every such
       * user would be asked to "change" to the zone they already have.
       */
      const userTimezone: Timezone =
        TimezoneAlias.getCanonicalTimezone(savedTimezone);

      if (userTimezone === guessTimezone) {
        return;
      }

      /*
       * Suppress the prompt if the user has already dismissed it for this
       * exact browser timezone. We will re-prompt only if the browser
       * timezone changes again. A dismissal saved by an older build can be
       * a legacy name too.
       */
      const dismissedTimezone: Timezone | null =
        User.getDismissedTimezonePrompt();
      if (
        dismissedTimezone !== null &&
        TimezoneAlias.getCanonicalTimezone(dismissedTimezone) === guessTimezone
      ) {
        return;
      }

      setShowConfirmModal(true);
      setTimezoneToSave(guessTimezone);
    }
  }, []);

  if (showConfirmModal) {
    return (
      <ConfirmModal
        title={`Update Timezone`}
        description={
          <div>
            <p>
              We have detected that your timezone is different from the timezone
              you have saved in your profile. Would you like to update your
              timezone to <strong>{timezoneToSave?.toString()}</strong>?
            </p>
          </div>
        }
        onClose={() => {
          setShowConfirmModal(false);
          if (timezoneToSave) {
            User.setDismissedTimezonePrompt(timezoneToSave);
          }
        }}
        submitButtonText={"Update Timezone"}
        onSubmit={async () => {
          setShowConfirmModal(false);
          return await updateUserTimezone(timezoneToSave as Timezone);
        }}
      />
    );
  }

  return <></>;
};

export default UseTimezoneInitElement;
