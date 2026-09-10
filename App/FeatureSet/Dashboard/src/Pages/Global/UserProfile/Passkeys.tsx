import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";
import WebAuthnCredentials from "../../../Components/TwoFactorAuth/WebAuthnCredentials";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

const Passkeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [enrolmentBackupCodes, setEnrolmentBackupCodes] = React.useState<
    Array<string>
  >([]);

  return (
    <Page
      title="User Profile"
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "User Profile",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route,
          ),
        },
        {
          title: "Passkeys",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_PASSKEYS] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenu />}
    >
      <div className="max-w-6xl">
        <WebAuthnCredentials
          isPasskey={true}
          onBackupCodes={setEnrolmentBackupCodes}
        />
        <BackupCodes
          hideCard={true}
          codesFromEnrolment={enrolmentBackupCodes}
          onEnrolmentCodesAcknowledged={() => {
            setEnrolmentBackupCodes([]);
          }}
        />
      </div>
    </Page>
  );
};

export default Passkeys;
