import PageComponentProps from "../../PageComponentProps";
import DashboardSharingCard from "../../../Components/Dashboard/Sharing/DashboardSharingCard";
import DashboardSharingCopy, {
  DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID,
  DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID,
} from "../../../Components/Dashboard/Sharing/DashboardSharingCopy";
import IpAllowlistCopy, {
  getIpAllowlistEntries,
  getIpAllowlistProblem,
  IP_ALLOWLIST_COLUMN,
  isIpAllowlistInForce,
} from "../../../Components/IpAllowlist/IpAllowlistCopy";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { getChoiceRowPlanPillText } from "Common/UI/Components/ChoiceRows/ChoiceRows";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Dashboards -> a dashboard -> Sharing (the old "Authentication" page under
 * Advanced, at the same address), also opened from ⋯ -> Share on the
 * dashboard: who can view the dashboard, as one choice - only people in
 * this project, anyone with the link, or anyone with the link and a
 * password (DashboardSharingCard), with the public link under the public
 * choice in force. The IP allowlist, which applies to the public link and
 * which few dashboards need, is folded under Advanced, which says
 * "Configured" while the server enforces it. It saves on its own, so its
 * Scale plan never stands in the way of the choice.
 */
const DashboardSharing: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What the allowlist holds, once read: null until then.
  const [ipAllowlist, setIpAllowlist] = useState<string | null>(null);

  const isIpAllowlistSet: boolean = isIpAllowlistInForce(ipAllowlist);

  const ipAllowlistPlan: PlanType | null = getPlanNeededToChangeColumn(
    new Dashboard(),
    IP_ALLOWLIST_COLUMN,
  );

  return (
    <Fragment>
      <DashboardSharingCard dashboardId={modelId} />

      <AdvancedPageSection
        description={DashboardSharingCopy.advancedDescription}
        summary={
          ipAllowlist === null
            ? undefined
            : translator.translateText(
                isIpAllowlistSet
                  ? DashboardSharingCopy.advancedSummaryConfigured
                  : DashboardSharingCopy.advancedSummaryOpen,
              )
        }
        isConfigured={isIpAllowlistSet}
        dataTestId={DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID}
      >
        <CardModelDetail<Dashboard>
          name="Dashboard > IP Allowlist"
          cardProps={{
            title: IpAllowlistCopy.title,
            description: DashboardSharingCopy.ipAllowlistDescription,
            rightElement: ipAllowlistPlan ? (
              <Pill
                text={getChoiceRowPlanPillText(translator, ipAllowlistPlan)}
                color={Yellow}
              />
            ) : undefined,
          }}
          editButtonText={IpAllowlistCopy.editButton}
          isEditable={true}
          formFields={[
            {
              field: {
                ipWhitelist: true,
              },
              title: IpAllowlistCopy.title,
              description: IpAllowlistCopy.fieldDescription,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              disableSpellCheck: true,
              /*
               * The server skips a line it cannot read, and a list of blank
               * lines lets nobody in: say so before saving.
               */
              customValidation: (
                values: FormValues<Dashboard>,
              ): string | null => {
                return getIpAllowlistProblem(
                  values.ipWhitelist as string | null | undefined,
                );
              },
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: Dashboard,
            id: "model-detail-dashboard-ip-allowlist",
            fields: [
              {
                field: {
                  ipWhitelist: true,
                },
                fieldType: FieldType.LongText,
                title: IpAllowlistCopy.title,
                placeholder: DashboardSharingCopy.ipAllowlistEmpty,
                // One address or range a line, as it is typed.
                getElement: (item: Dashboard): ReactElement => {
                  if (!isIpAllowlistInForce(item.ipWhitelist)) {
                    return (
                      <PlaceholderText
                        text={DashboardSharingCopy.ipAllowlistEmpty}
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
                          DashboardSharingCopy.ipAllowlistNoAddress,
                        )}
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
                      data-testid={DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID}
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
            modelId: modelId,
            // Read again after every save, so the header follows the list.
            onItemLoaded: (item: Dashboard) => {
              setIpAllowlist(item.ipWhitelist || "");
            },
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default DashboardSharing;
