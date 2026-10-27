import PageComponentProps from "../../PageComponentProps";
import { getIpAllowlistFoldedItem } from "../../../Components/IpAllowlist/IpAllowlistCopy";
import IpAllowlistSettings from "../../../Components/IpAllowlist/IpAllowlistSettings";
import StatusPageAccessCard from "../../../Components/StatusPage/StatusPageAccessCard";
import StatusPageSessionLengthSettings from "../../../Components/StatusPage/StatusPageSessionLengthSettings";
import { getSessionLengthFoldedItem } from "../../../Components/StatusPage/StatusPageSessionLengthCopy";
import StatusPageAccessCopy, {
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
 * password (StatusPageAccessCard) - then, folded under More settings, how
 * long readers stay signed in (StatusPageSessionLengthSettings) and the IP
 * allowlist, which applies whoever the page is open to.
 *
 * Both are Enterprise access controls few pages need - a reader session
 * limit means nothing on a page open to anyone - so the page opens on the
 * one choice everyone makes, and the folded header names the two, each
 * with what it is set to while it is set ("Reader Sessions: 8 hours", "IP
 * Allowlist: 2"). Reader Sessions used to be a card of its own under the
 * choice; the maintainer: "audit the entire project for advanced features
 * just like these and move them to More as well". A link to
 * #reader-sessions or #ip-allowlist opens it there.
 *
 * Their components render the Enterprise cards, or the upsell with what the
 * page still has of them.
 */
const StatusPageAccess: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What the allowlist holds, once read: null until then.
  const [ipAllowlist, setIpAllowlist] = useState<string | null>(null);

  // How long readers stay signed in, once read: undefined until then.
  const [sessionLengthInHours, setSessionLengthInHours] = useState<
    number | null | undefined
  >(undefined);

  return (
    <Fragment>
      <StatusPageAccessCard statusPageId={modelId} />

      <AdvancedPageSection
        description={StatusPageAccessCopy.advancedDescription}
        items={[
          getSessionLengthFoldedItem(sessionLengthInHours, translator),
          getIpAllowlistFoldedItem(ipAllowlist),
        ]}
        dataTestId={STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID}
      >
        <StatusPageSessionLengthSettings
          statusPageId={modelId}
          onLengthChange={(lengthInHours: number | null) => {
            setSessionLengthInHours(lengthInHours);
          }}
        />

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
