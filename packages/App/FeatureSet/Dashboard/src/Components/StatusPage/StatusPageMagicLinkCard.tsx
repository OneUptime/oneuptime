import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement } from "react";
import StatusPageMagicLinkCopy, {
  STATUS_PAGE_MAGIC_LINK_COLUMN,
  STATUS_PAGE_MAGIC_LINK_PLACE,
  STATUS_PAGE_MAGIC_LINK_SWITCH_TEST_ID,
} from "./StatusPageMagicLinkCopy";

/*
 * "Sign-In Links", on a status page's Security -> Private Users, under More
 * settings: one switch that saves the moment it is flipped. On, the page's
 * sign-in page offers "Email me a sign-in link" and its private users can
 * sign in from their inbox without a password; off, they sign in with their
 * password only. Neither way locks anybody out, so neither asks first. See
 * StatusPageMagicLinkCopy and Common/Types/StatusPage/StatusPageMagicLink.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  // Told whether links are on, once read and each time the switch moves.
  onChange?: ((isOn: boolean) => void) | undefined;
}

const StatusPageMagicLinkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<StatusPage>
      modelType={StatusPage}
      modelId={props.statusPageId}
      column={STATUS_PAGE_MAGIC_LINK_COLUMN}
      cardTitle={StatusPageMagicLinkCopy.cardTitle}
      title={StatusPageMagicLinkCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? StatusPageMagicLinkCopy.switchOnDescription
          : StatusPageMagicLinkCopy.switchOffDescription;
      }}
      note={StatusPageMagicLinkCopy.note}
      dataTestId={STATUS_PAGE_MAGIC_LINK_SWITCH_TEST_ID}
      cardId={STATUS_PAGE_MAGIC_LINK_PLACE}
      onChange={props.onChange}
    />
  );
};

export default StatusPageMagicLinkCard;
