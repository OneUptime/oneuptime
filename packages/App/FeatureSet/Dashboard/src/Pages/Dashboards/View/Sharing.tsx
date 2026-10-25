import PageComponentProps from "../../PageComponentProps";
import DashboardSharingCard from "../../../Components/Dashboard/Sharing/DashboardSharingCard";
import DashboardSharingCopy, {
  DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID,
  DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID,
} from "../../../Components/Dashboard/Sharing/DashboardSharingCopy";
import IpAllowlistCopy, {
  getIpAllowlistFoldedItem,
  isIpAllowlistInForce,
} from "../../../Components/IpAllowlist/IpAllowlistCopy";
import IpAllowlistSettings from "../../../Components/IpAllowlist/IpAllowlistSettings";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
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
 *
 * The IP allowlist is an Enterprise feature: IpAllowlistSettings renders
 * the Enterprise card, or the upsell with the allowlist the dashboard still
 * has.
 */
const DashboardSharing: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What the allowlist holds, once read: null until then.
  const [ipAllowlist, setIpAllowlist] = useState<string | null>(null);

  const isIpAllowlistSet: boolean = isIpAllowlistInForce(ipAllowlist);

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
        items={[getIpAllowlistFoldedItem(ipAllowlist)]}
        dataTestId={DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID}
      >
        <IpAllowlistSettings
          modelType={Dashboard}
          modelId={modelId}
          cardName="Dashboard > IP Allowlist"
          modelDetailId="model-detail-dashboard-ip-allowlist"
          title={IpAllowlistCopy.title}
          description={DashboardSharingCopy.ipAllowlistDescription}
          editButtonText={IpAllowlistCopy.editButton}
          fieldDescription={IpAllowlistCopy.fieldDescription}
          emptyText={DashboardSharingCopy.ipAllowlistEmpty}
          noAddressText={DashboardSharingCopy.ipAllowlistNoAddress}
          entriesTestId={DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID}
          onLoaded={(allowlist: string) => {
            setIpAllowlist(allowlist);
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default DashboardSharing;
