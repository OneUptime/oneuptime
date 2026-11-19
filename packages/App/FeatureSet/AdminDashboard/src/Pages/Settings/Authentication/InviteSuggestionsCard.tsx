import AdminModelAPI from "../../../Utils/ModelAPI";
import {
  INVITE_SUGGESTIONS_SWITCH_TEST_ID,
  getInviteSuggestionsSwitchConfirmation,
} from "./AuthenticationSwitchesCopy";
import ObjectID from "Common/Types/ObjectID";
import { BILLING_ENABLED } from "Common/UI/Config";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Authentication's Invite Suggestions (#9744): "Suggest every
 * account on this server", on while GlobalConfig.
 * suggestServerAccountsWhenInviting is true. The invite forms' email box
 * then suggests every account on the server, marked Not in this project
 * yet, to anyone who may invite people to a project, not to master admins
 * alone (Common/Server/Utils/Team/InviteSuggestions). Off until a master
 * admin turns it on, and turning it on asks first, saying who sees what:
 * on a server that hosts several organizations it would show one
 * organization's people to another.
 *
 * Not drawn on OneUptime Cloud, where the server never applies it, whatever
 * it says: Cloud's accounts are its customers'. A card of its own, so the
 * Authentication page itself draws every one of its switches in every
 * edition and billing state.
 */
const InviteSuggestionsCard: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  if (BILLING_ENABLED) {
    return <></>;
  }

  return (
    <ModelSwitchCard<GlobalConfig>
      modelType={GlobalConfig}
      modelId={ObjectID.getZeroObjectID()}
      column="suggestServerAccountsWhenInviting"
      modelAPI={AdminModelAPI}
      cardTitle={t("pages.settings.authentication.inviteSuggestionsCardTitle")}
      cardDescription={t(
        "pages.settings.authentication.inviteSuggestionsCardDescription",
      )}
      title={t("pages.settings.authentication.inviteSuggestionsSwitchTitle")}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? t(
              "pages.settings.authentication.inviteSuggestionsSwitchOnDescription",
            )
          : t(
              "pages.settings.authentication.inviteSuggestionsSwitchOffDescription",
            );
      }}
      getConfirmation={getInviteSuggestionsSwitchConfirmation}
      dataTestId={INVITE_SUGGESTIONS_SWITCH_TEST_ID}
    />
  );
};

export default InviteSuggestionsCard;
