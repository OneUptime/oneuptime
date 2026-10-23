import PageComponentProps from "../../PageComponentProps";
import { getIpAllowlistFoldedItem } from "../../../Components/IpAllowlist/IpAllowlistCopy";
import IpAllowlistSettings from "../../../Components/IpAllowlist/IpAllowlistSettings";
import StatusPageAccessCard from "../../../Components/StatusPage/StatusPageAccessCard";
import StatusPageSessionLengthSettings from "../../../Components/StatusPage/StatusPageSessionLengthSettings";
import StatusPageAccessCopy, {
  isIpAllowlistInForce,
  STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID,
  STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
} from "../../../Components/StatusPage/StatusPageAccessCopy";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
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
 * password (StatusPageAccessCard) - then how long readers stay signed in
 * (StatusPageSessionLengthSettings). The IP allowlist, which applies whoever
 * the page is open to and which few pages need, is folded under Advanced,
 * which says "Configured" while the server enforces it.
 *
 * The reader session limit and the IP allowlist are Enterprise features:
 * their components render the Enterprise cards, or the upsell with what the
 * page still has of them.
 */
const StatusPageAccess: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What the allowlist holds, once read: null until then.
  const [ipAllowlist, setIpAllowlist] = useState<string | null>(null);

  const isIpAllowlistSet: boolean = isIpAllowlistInForce(ipAllowlist);

  return (
    <Fragment>
      <StatusPageAccessCard statusPageId={modelId} />

      <StatusPageSessionLengthSettings statusPageId={modelId} />

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
        <IpAllowlistSettings
          modelType={StatusPage}
          modelId={modelId}
          cardName="Status Page > IP Allowlist"
          modelDetailId="model-detail-status-page-ip-allowlist"
          title={StatusPageAccessCopy.ipAllowlistTitle}
          description={StatusPageAccessCopy.ipAllowlistDescription}
          editButtonText={StatusPageAccessCopy.ipAllowlistEditButton}
          fieldDescription={StatusPageAccessCopy.ipAllowlistFieldDescription}
          emptyText={StatusPageAccessCopy.ipAllowlistEmpty}
          noAddressText={StatusPageAccessCopy.ipAllowlistNoAddress}
          entriesTestId={STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID}
          onLoaded={(allowlist: string) => {
            setIpAllowlist(allowlist);
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default StatusPageAccess;
