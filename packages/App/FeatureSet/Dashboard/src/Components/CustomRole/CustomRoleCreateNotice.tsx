import {
  getPermissionNotAddedReason,
  PermissionNotAdded,
} from "./CustomRoleCreateForm";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Above the Roles list, when a new role was made but some of the roles
 * picked for it could not be put in (the server refused them - most often
 * one the user does not hold themselves - or the request failed). The role
 * stays: the notice names it, says which ones are missing and why, and
 * opens it, where Add Role is.
 */

export interface ComponentProps {
  roleName: string;
  notAdded: Array<PermissionNotAdded>;
  onOpen: () => void;
  onClose: () => void;
}

export const CUSTOM_ROLE_CREATE_NOTICE_TEST_ID: string =
  "custom-role-create-notice";

const CustomRoleCreateNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const title: string = translator.translatePlural(
    {
      one: "{{role}} was created without {{count}} of the roles picked for it.",
      other:
        "{{role}} was created without {{count}} of the roles picked for it.",
    },
    props.notAdded.length,
    { role: props.roleName },
  );

  // Each missing one, with the server's reason, named once.
  const reasons: string = props.notAdded
    .map((item: PermissionNotAdded): string => {
      return getPermissionNotAddedReason(translator, item);
    })
    .join(" ");

  return (
    <Alert
      type={AlertType.DANGER}
      dataTestId={CUSTOM_ROLE_CREATE_NOTICE_TEST_ID}
      className="mb-5"
      strongTitle={title}
      title={reasons}
      textOnRight={translator.translateText("Open the role")}
      onClick={props.onOpen}
      onClose={props.onClose}
    />
  );
};

export default CustomRoleCreateNotice;
