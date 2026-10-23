import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useState } from "react";
import LicenseBulkCopy, {
  expiresOnDay,
  toCalendarDay,
} from "./LicenseBulkCopy";

/*
 * Bulk Actions of the Enterprise Licenses list, besides Delete (which the
 * shared table adds itself, as on every list whose rows are deleted from it).
 *
 * Change Expiry Date: renewals and evaluation extensions come in batches - a
 * reseller's customers renewing together, every evaluation extended over a
 * holiday - and one license at a time meant opening each one's page. One
 * dialog asks for the new date, and each selected license is changed with
 * its own update, as its edit form would change it: the server lets only a
 * master admin write a license, each update is checked and audit logged on
 * its own (EnterpriseLicenseService), and the result lists any license it
 * refused, with the server's reason, and any that already expired on that
 * day, as not changed.
 *
 * The date must be after today. A day in the past would only mark the
 * license expired here: an installation never takes a license back that is
 * worse than the one it holds (ee/Server/License/LicenseRanking), so it would
 * keep running on its old expiry while this list said it had ended.
 *
 * Changing a license's type (evaluation or production), seat limit or name
 * in bulk is left out on purpose: each of those follows one customer's
 * purchase, and is made on that license's page.
 */

export interface LicenseBulkActionsResult {
  bulkActions: Array<BulkActionButtonSchema<EnterpriseLicense>>;
  modals: ReactElement;
}

// The dialog's one field (a type alias: BasicFormModal takes a GenericObject).
type ChangeExpiryFormData = {
  expiresAt: string;
};

const useLicenseBulkActions: () => LicenseBulkActionsResult =
  (): LicenseBulkActionsResult => {
    const translator: Translator = useTranslator();

    // The selection the dialog is open for; null while it is closed.
    const [actionProps, setActionProps] =
      useState<BulkActionOnClickProps<EnterpriseLicense> | null>(null);

    /*
     * One license after another: the license server reads a license's terms
     * whenever an installation reports, and each change is its own audited
     * write.
     */
    const changeExpiry: (
      props: BulkActionOnClickProps<EnterpriseLicense>,
      day: string,
    ) => Promise<void> = async (
      props: BulkActionOnClickProps<EnterpriseLicense>,
      day: string,
    ): Promise<void> => {
      await runBulkAction<EnterpriseLicense>({
        actionProps: props,
        concurrency: 1,
        step: async (license: EnterpriseLicense): Promise<BulkItemOutcome> => {
          if (!license.id) {
            throw new BadDataException("Item ID not found");
          }

          if (expiresOnDay(license.expiresAt, day)) {
            return bulkItemUnchanged(
              translator.translateText(LicenseBulkCopy.alreadyExpiresOnDay) ||
                LicenseBulkCopy.alreadyExpiresOnDay,
            );
          }

          await AdminModelAPI.updateById<EnterpriseLicense>({
            modelType: EnterpriseLicense,
            id: license.id,
            data: {
              expiresAt: day,
            },
          });

          return BULK_ITEM_CHANGED;
        },
      });
    };

    const changeExpiryAction: BulkActionButtonSchema<EnterpriseLicense> = {
      title: LicenseBulkCopy.changeExpiryTitle,
      icon: IconProp.Calendar,
      buttonStyleType: ButtonStyleType.NORMAL,
      resultLabels: {
        succeeded: LicenseBulkCopy.updatedCount,
        failed: LicenseBulkCopy.notUpdatedCount,
      },
      // The dialog asks for the date; the run starts when it is saved.
      onClick: async (
        props: BulkActionOnClickProps<EnterpriseLicense>,
      ): Promise<void> => {
        setActionProps(props);
      },
    };

    const modals: ReactElement = actionProps ? (
      <BasicFormModal<ChangeExpiryFormData>
        title={LicenseBulkCopy.changeExpiryTitle}
        description={translator.translatePlural(
          LicenseBulkCopy.changeExpiryDescription,
          actionProps.items.length,
        )}
        name="Change Enterprise License Expiry Date"
        submitButtonText={LicenseBulkCopy.changeExpiryTitle}
        onClose={() => {
          setActionProps(null);
        }}
        onSubmit={(data: ChangeExpiryFormData) => {
          const props: BulkActionOnClickProps<EnterpriseLicense> | null =
            actionProps;
          const day: string = toCalendarDay(String(data.expiresAt || ""));

          setActionProps(null);

          // The field is required and in the future: nothing to do without it.
          if (!props || !day) {
            return;
          }

          void changeExpiry(props, day);
        }}
        formProps={{
          name: "Change Enterprise License Expiry Date",
          fields: [
            {
              field: {
                expiresAt: true,
              },
              title: LicenseBulkCopy.newExpiryDateTitle,
              description: LicenseBulkCopy.newExpiryDateDescription,
              fieldType: FormFieldSchemaType.Date,
              required: true,
              validation: {
                dateShouldBeInTheFuture: true,
              },
            },
          ],
        }}
      />
    ) : (
      <></>
    );

    return {
      bulkActions: [changeExpiryAction],
      modals,
    };
  };

export default useLicenseBulkActions;
