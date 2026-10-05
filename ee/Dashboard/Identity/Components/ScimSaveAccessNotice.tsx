import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What Settings > SCIM says to someone who may see its connections but not
 * add or change them (ScimSaveAccess): who can, and why. Shown only to them.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them through the locale entry under the same English key.
 */

export const SCIM_SAVE_ACCESS_TITLE: string =
  "Only a project owner can add or change SCIM connections.";

export const SCIM_SAVE_ACCESS_DESCRIPTION: string =
  "Through SCIM, your identity provider can add people to any team in this project, so adding a connection, changing one or resetting its bearer token takes access that covers every team. You can still view and delete connections.";

export const SCIM_SAVE_ACCESS_NOTICE_TEST_ID: string =
  "scim-save-access-notice";

const ScimSaveAccessNotice: FunctionComponent = (): ReactElement => {
  return (
    <Alert
      type={AlertType.INFO}
      strongTitle={SCIM_SAVE_ACCESS_TITLE}
      title={SCIM_SAVE_ACCESS_DESCRIPTION}
      dataTestId={SCIM_SAVE_ACCESS_NOTICE_TEST_ID}
      className="mb-5"
    />
  );
};

export default ScimSaveAccessNotice;
