import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import User from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import API from "Common/UI/Utils/API/API";
import { ToastType } from "Common/UI/Components/Toast/Toast";
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
      ShowToastNotification({
        title: "Error Saving Timezone",
        description: API.getFriendlyErrorMessage(err as Error),
        type: ToastType.DANGER,
      });
    }
  };

  useAsyncEffect(async () => {
    if (User.isLoggedIn()) {
      // check user timezone

      const guessTimezone: Timezone = OneUptimeDate.getCurrentTimezone();
      const userTimezone: Timezone | null = User.getSavedUserTimezone();

      if (userTimezone === null) {
        // first time — silently save the browser timezone
        await updateUserTimezone(guessTimezone);
        return;
      }

      if (userTimezone === guessTimezone) {
        return;
      }

      // Suppress the prompt if the user has already dismissed it for this
      // exact browser timezone. We will re-prompt only if the browser
      // timezone changes again.
      const dismissedTimezone: Timezone | null =
        User.getDismissedTimezonePrompt();
      if (dismissedTimezone === guessTimezone) {
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
