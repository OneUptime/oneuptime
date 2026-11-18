import ProjectUtil from "Common/UI/Utils/Project";
import Route from "Common/Types/API/Route";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import User from "Common/UI/Utils/User";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";
import VerificationCodeModal from "./VerificationCodeModal";
import { VerificationCodeChannel } from "./VerificationCodeChannels";
import ServerCannotSendPanel, {
  ServerCannotSendChannel,
} from "./ServerCannotSendPanel";
import { useProjectCanSend } from "Common/UI/Utils/ServerSending";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ProjectCanSendAnswer } from "Common/Types/ServerSending/ProjectCanSend";

// The empty list's words while no email can be sent, so Add is not offered.
export const NO_EMAIL_ADDRESSES_YET: string = translationKey(
  "No email addresses yet.",
);

const Email: () => JSX.Element = (): ReactElement => {
  // The address whose verify dialog is open.
  const [verifyItem, setVerifyItem] = useState<UserEmail | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Whether this server can send email (#6880). While it cannot, every
   * address here would read as reached and none is: the list says so, with
   * who can fix it, and offers no Add - an address is verified by an email
   * its code would never come in.
   */
  const canSend: ProjectCanSendAnswer | null = useProjectCanSend();
  const isServerUnableToSend: boolean = canSend?.email === false;

  /*
   * Deleting an email address cascades to every notification rule that uses it,
   * so the confirmation is the impact modal rather than ModelTable's generic
   * one. `isDeleteable` below is false for the same reason: two delete controls
   * on one row, one of which explains nothing, is how the explanation gets
   * skipped.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserEmail> =
    useNotificationMethodDeleteGuard<UserEmail>({
      modelType: UserEmail,
      relationName: "userEmail",
      singularName: "Email",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  return (
    <>
      <ModelTable<UserEmail>
        userPreferencesKey={"user-email-table"}
        modelType={UserEmail}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserEmail): Promise<UserEmail> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        /*
         * Adding an address emails its code, so the next step - typing it
         * in - opens straight away instead of waiting to be found behind
         * Verify.
         */
        onCreateSuccess={(item: UserEmail): Promise<UserEmail> => {
          if (!item.isVerified) {
            setVerifyItem(item);
          }

          return Promise.resolve(item);
        }}
        createVerb={"Add"}
        actionButtons={[
          {
            title: "Verify",
            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
            icon: IconProp.Check,
            /*
             * Entering the code is what an unverified row is waiting for, so
             * Verify is the row's button, whatever else the row offers.
             */
            placement: ActionButtonPlacement.Primary,
            isVisible: (item: UserEmail): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            /*
             * The one way to verify, and to get a new code: sending another
             * one is in the dialog, next to the field it is for.
             */
            onClick: async (
              item: UserEmail,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setVerifyItem(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          deleteGuard.deleteActionButton,
        ]}
        id="user-emails"
        name="User Settings > Notification Methods > Emails"
        isDeleteable={false}
        isEditable={false}
        isCreateable={!isServerUnableToSend}
        topContent={
          <ServerCannotSendPanel
            channel={ServerCannotSendChannel.Email}
            canSend={canSend?.email}
          />
        }
        cardProps={{
          title: "Emails for Notifications",
          description:
            "Manage emails that will receive notifications for this project.",
        }}
        /*
         * The first card of Notification Methods: its one way to the docs
         * page that explains every method and how each is verified.
         */
        documentationLink={Route.fromString(
          "/docs/notifications/notification-methods",
        )}
        noItemsMessage={
          isServerUnableToSend
            ? NO_EMAIL_ADDRESSES_YET
            : "No email addresses yet. Add one to receive notifications."
        }
        formFields={[
          {
            field: {
              email: true,
            },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "you@company.com",
            validation: {
              minLength: 2,
            },
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        filters={[]} // No filters
        columns={[
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
          {
            field: {
              isVerified: true,
            },
            title: "Verified",
            type: FieldType.Boolean,
          },
        ]}
      />

      {deleteGuard.deletionModal}

      {verifyItem ? (
        <VerificationCodeModal
          channel={VerificationCodeChannel.Email}
          itemId={verifyItem.id?.toString() || verifyItem._id || ""}
          destination={verifyItem.email?.toString() || ""}
          onClose={() => {
            setVerifyItem(null);
          }}
          onVerified={() => {
            setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default Email;
