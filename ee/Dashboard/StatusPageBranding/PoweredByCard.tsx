import EnterpriseSettingLicenseNotice from "../EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import { StatusPagePoweredByCardProps } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import StatusPagePoweredByCopy, {
  getPoweredByDescription,
  POWERED_BY_COLUMN,
  STATUS_PAGE_POWERED_BY_SWITCH_TEST_ID,
} from "@oneuptime/dashboard/Components/StatusPage/StatusPagePoweredByCopy";
import StatusPageSwitchRow from "@oneuptime/dashboard/Components/StatusPage/StatusPageSwitchRow";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Whether a status page's footer says Powered by OneUptime: one switch,
 * on = visitors see the line, that saves the moment it is flipped
 * (StatusPageSwitchRow). The column stores what to hide, so the switch is
 * inverted.
 *
 * When the Enterprise license has lapsed or leaves the feature out, every
 * status page shows the line whatever the switch says (the server's
 * StatusPagePoweredBy), and a notice above the card says so. The switch is
 * kept: the line is hidden again as soon as a license is activated.
 *
 * It waits folded under the page's More settings, telling the page whether
 * visitors see the line, once read and after each save
 * (onPoweredByChange), so the folded header can say so.
 */
const PoweredByCard: FunctionComponent<StatusPagePoweredByCardProps> = (
  props: StatusPagePoweredByCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledListClassName: string = useCardRuledListClassName();
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.StatusPageBranding,
  );
  const [isHidden, setIsHidden] = useState<boolean | null>(null);
  const [error, setError] = useState<string>("");

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsHidden(null);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          [POWERED_BY_COLUMN]: true,
        },
      });

      if (!item) {
        setError(
          translator.translateText("Status page not found.") ||
            "Status page not found.",
        );
        return;
      }

      setIsHidden(item.hidePoweredByOneUptimeBranding === true);
      props.onPoweredByChange?.(item.hidePoweredByOneUptimeBranding !== true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    void fetchStatusPage();
  }, [props.statusPageId.toString()]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchStatusPage();
          }}
        />
      );
    }

    if (isHidden === null) {
      return <ComponentLoader />;
    }

    return (
      <div className={ruledListClassName}>
        <div className="px-5 py-4 md:px-6">
          <StatusPageSwitchRow
            statusPageId={props.statusPageId}
            column={POWERED_BY_COLUMN}
            initialValue={!isHidden}
            isInverted={true}
            title={StatusPagePoweredByCopy.switchTitle}
            getDescription={(isShown: boolean): string => {
              return getPoweredByDescription(isShown);
            }}
            onSaved={(isShown: boolean) => {
              props.onPoweredByChange?.(isShown);
            }}
            dataTestId={STATUS_PAGE_POWERED_BY_SWITCH_TEST_ID}
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <EnterpriseSettingLicenseNotice
        mode={licenseMode}
        feature={LicensedFeature.StatusPageBranding}
      />
      <Card
        title={StatusPagePoweredByCopy.cardTitle}
        description={StatusPagePoweredByCopy.cardDescription}
      >
        {getBody()}
      </Card>
    </Fragment>
  );
};

export default PoweredByCard;
