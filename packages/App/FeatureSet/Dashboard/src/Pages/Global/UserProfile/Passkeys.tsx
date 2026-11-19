import PageComponentProps from "../../PageComponentProps";
import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";
import WebAuthnCredentials from "../../../Components/TwoFactorAuth/WebAuthnCredentials";
import {
  getSecondStepDeleteDisabledReason,
  TwoFactorAuthSetupState,
  useTwoFactorAuthSetup,
} from "../../../Components/TwoFactorAuth/TwoFactorAuthSetupState";
import { LocalSignInSettings } from "../../../Components/UserProfile/SignInManagement";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import React, { FunctionComponent, ReactElement } from "react";

const Passkeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [enrolmentBackupCodes, setEnrolmentBackupCodes] = React.useState<
    Array<string>
  >([]);

  /*
   * A passkey is a second step too: the last one is not removed while
   * two-factor authentication is on (#9666), so the list reads where the
   * person stands, again after each passkey added or removed.
   */
  const [setupRefresh, setSetupRefresh] = React.useState<number>(0);
  const twoFactorAuth: TwoFactorAuthSetupState =
    useTwoFactorAuthSetup(setupRefresh);

  const refreshSetup: () => void = (): void => {
    setSetupRefresh((value: number) => {
      return value + 1;
    });
  };

  return (
    <div className="w-full min-w-0">
      <LocalSignInSettings>
        <WebAuthnCredentials
          isPasskey={true}
          onBackupCodes={setEnrolmentBackupCodes}
          onRegistered={refreshSetup}
          onDeleted={refreshSetup}
          getDeleteDisabledReason={(item: UserWebAuthn) => {
            return getSecondStepDeleteDisabledReason({
              setup: twoFactorAuth.setup,
              isVerified: item.isVerified,
            });
          }}
        />
        <BackupCodes
          hideCard={true}
          codesFromEnrolment={enrolmentBackupCodes}
          onEnrolmentCodesAcknowledged={() => {
            setEnrolmentBackupCodes([]);
          }}
        />
      </LocalSignInSettings>
    </div>
  );
};

export default Passkeys;
