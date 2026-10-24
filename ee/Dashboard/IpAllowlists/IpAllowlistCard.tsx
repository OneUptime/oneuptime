import EnterpriseSettingLicenseNotice from "../EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import {
  getIpAllowlistEntries,
  getIpAllowlistProblem,
  IP_ALLOWLIST_COLUMN,
  isIpAllowlistInForce,
} from "@oneuptime/dashboard/Components/IpAllowlist/IpAllowlistCopy";
import {
  IpAllowlistCardProps,
  IpAllowlistModel,
} from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import { getChoiceRowPlanPillText } from "Common/UI/Components/ChoiceRows/ChoiceRows";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The IP allowlist of a private status page, a public dashboard or a form:
 * who may open it, by address, one entry a line. Each page words the card
 * its own way (the props); the card is the same.
 *
 * - Saved on its own, so the plan it needs on OneUptime Cloud never stands
 *   in the way of the page's other settings; the plan's pill sits beside
 *   the title before anyone tries.
 * - The server skips a line it cannot read, and a list of blank lines lets
 *   nobody in, so both are refused before saving (getIpAllowlistProblem).
 * - The entries are listed one a line, as typed.
 * - When the Enterprise license has lapsed or leaves IP allowlists out, a
 *   notice says the list is still enforced and can only be removed; the
 *   server refuses any other change.
 */
const IpAllowlistCard: FunctionComponent<IpAllowlistCardProps> = (
  props: IpAllowlistCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.IpAllowlists,
  );

  const planNeeded: PlanType | null = getPlanNeededToChangeColumn(
    new props.modelType(),
    IP_ALLOWLIST_COLUMN,
  );

  return (
    <Fragment>
      <EnterpriseSettingLicenseNotice
        mode={licenseMode}
        feature={LicensedFeature.IpAllowlists}
      />
      <CardModelDetail<IpAllowlistModel>
        name={props.cardName}
        cardProps={{
          title: props.cardTitle || props.title,
          description: props.description,
          rightElement: planNeeded ? (
            <Pill
              text={getChoiceRowPlanPillText(translator, planNeeded)}
              color={Yellow}
            />
          ) : undefined,
        }}
        editButtonText={props.editButtonText}
        isEditable={true}
        formFields={[
          {
            field: {
              ipWhitelist: true,
            },
            title: props.title,
            description: props.fieldDescription,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<IpAllowlistModel>,
            ): string | null => {
              return getIpAllowlistProblem(
                values.ipWhitelist as string | null | undefined,
              );
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: props.modelType,
          id: props.modelDetailId,
          fields: [
            {
              field: {
                ipWhitelist: true,
              },
              fieldType: FieldType.LongText,
              title: props.title,
              placeholder: props.emptyText,
              getElement: (item: IpAllowlistModel): ReactElement => {
                if (!isIpAllowlistInForce(item.ipWhitelist)) {
                  return <PlaceholderText text={props.emptyText} />;
                }

                const entries: Array<string> = getIpAllowlistEntries(
                  item.ipWhitelist,
                );

                if (entries.length === 0) {
                  return (
                    <p className="text-sm text-gray-900">
                      {translator.translateText(props.noAddressText)}
                    </p>
                  );
                }

                /*
                 * The monospace class sits on each line: the page's
                 * `* { font-family }` rule would draw a line in Inter
                 * whatever its list says.
                 */
                return (
                  <ul
                    className="space-y-1 text-sm text-gray-900"
                    data-testid={props.entriesTestId}
                  >
                    {entries.map((entry: string, index: number) => {
                      return (
                        <li key={`${entry}-${index}`} className="font-mono">
                          {entry}
                        </li>
                      );
                    })}
                  </ul>
                );
              },
            },
          ],
          modelId: props.modelId,
          // Read again after every save, so the page follows the list.
          onItemLoaded: (item: IpAllowlistModel) => {
            props.onLoaded?.(item.ipWhitelist || "");
          },
        }}
      />
    </Fragment>
  );
};

export default IpAllowlistCard;
