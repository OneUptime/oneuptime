import PageComponentProps from "../../PageComponentProps";
import { getIpAllowlistFoldedItem } from "../../../Components/IpAllowlist/IpAllowlistCopy";
import StatusPageAccessCard from "../../../Components/StatusPage/StatusPageAccessCard";
import StatusPageAccessCopy, {
  getIpAllowlistEntries,
  getIpAllowlistProblem,
  isIpAllowlistInForce,
  STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID,
  STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
} from "../../../Components/StatusPage/StatusPageAccessCopy";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { getChoiceRowPlanPillText } from "Common/UI/Components/ChoiceRows/ChoiceRows";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Status Pages -> a page -> Security -> Access (the old "Authentication
 * Settings", at the same address): who can see the page, as one choice -
 * anyone with the link, only people who sign in, or anyone with the
 * password (StatusPageAccessCard). The IP allowlist, which applies whoever
 * the page is open to and which few pages need, is folded under Advanced,
 * which says "Configured" while the server enforces it.
 */
const StatusPageAccess: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What the allowlist holds, once read: null until then.
  const [ipAllowlist, setIpAllowlist] = useState<string | null>(null);

  const isIpAllowlistSet: boolean = isIpAllowlistInForce(ipAllowlist);

  const ipAllowlistPlan: PlanType | null = getPlanNeededToChangeColumn(
    new StatusPage(),
    "ipWhitelist",
  );

  return (
    <Fragment>
      <StatusPageAccessCard statusPageId={modelId} />

      <AdvancedPageSection
        description={StatusPageAccessCopy.advancedDescription}
        summary={
          ipAllowlist === null
            ? undefined
            : translator.translateText(
                isIpAllowlistSet
                  ? StatusPageAccessCopy.advancedSummaryConfigured
                  : StatusPageAccessCopy.advancedSummaryOpen,
              )
        }
        items={[getIpAllowlistFoldedItem(ipAllowlist)]}
        dataTestId={STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID}
      >
        <CardModelDetail<StatusPage>
          name="Status Page > IP Allowlist"
          cardProps={{
            title: StatusPageAccessCopy.ipAllowlistTitle,
            description: StatusPageAccessCopy.ipAllowlistDescription,
            rightElement: ipAllowlistPlan ? (
              <Pill
                text={getChoiceRowPlanPillText(translator, ipAllowlistPlan)}
                color={Yellow}
              />
            ) : undefined,
          }}
          editButtonText={StatusPageAccessCopy.ipAllowlistEditButton}
          isEditable={true}
          formFields={[
            {
              field: {
                ipWhitelist: true,
              },
              title: StatusPageAccessCopy.ipAllowlistTitle,
              description: StatusPageAccessCopy.ipAllowlistFieldDescription,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              disableSpellCheck: true,
              /*
               * The server skips a line it cannot read, and a list of blank
               * lines lets nobody in: say so before saving.
               */
              customValidation: (
                values: FormValues<StatusPage>,
              ): string | null => {
                return getIpAllowlistProblem(
                  values.ipWhitelist as string | null | undefined,
                );
              },
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: StatusPage,
            id: "model-detail-status-page-ip-allowlist",
            fields: [
              {
                field: {
                  ipWhitelist: true,
                },
                fieldType: FieldType.LongText,
                title: StatusPageAccessCopy.ipAllowlistTitle,
                placeholder: StatusPageAccessCopy.ipAllowlistEmpty,
                /*
                 * One address or range a line, as it is typed: running them
                 * together on one line made two entries read as one.
                 */
                getElement: (item: StatusPage): ReactElement => {
                  if (!isIpAllowlistInForce(item.ipWhitelist)) {
                    return (
                      <PlaceholderText
                        text={StatusPageAccessCopy.ipAllowlistEmpty}
                      />
                    );
                  }

                  const entries: Array<string> = getIpAllowlistEntries(
                    item.ipWhitelist,
                  );

                  if (entries.length === 0) {
                    return (
                      <p className="text-sm text-gray-900">
                        {translator.translateText(
                          StatusPageAccessCopy.ipAllowlistNoAddress,
                        )}
                      </p>
                    );
                  }

                  return (
                    <ul
                      className="space-y-1 font-mono text-sm text-gray-900"
                      data-testid={STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID}
                    >
                      {entries.map((entry: string, index: number) => {
                        return <li key={`${entry}-${index}`}>{entry}</li>;
                      })}
                    </ul>
                  );
                },
              },
            ],
            modelId: modelId,
            // Read again after every save, so the header follows the list.
            onItemLoaded: (item: StatusPage) => {
              setIpAllowlist(item.ipWhitelist || "");
            },
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default StatusPageAccess;
