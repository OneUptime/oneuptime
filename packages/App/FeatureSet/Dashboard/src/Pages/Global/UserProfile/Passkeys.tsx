import PageComponentProps from "../../PageComponentProps";
import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";
import WebAuthnCredentials from "../../../Components/TwoFactorAuth/WebAuthnCredentials";
import React, { FunctionComponent, ReactElement } from "react";

const Passkeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [enrolmentBackupCodes, setEnrolmentBackupCodes] = React.useState<
    Array<string>
  >([]);

  return (
    <div className="w-full min-w-0">
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
  );
};

export default Passkeys;
