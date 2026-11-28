import AutomaticTrustedProxiesDetails from "./AutomaticTrustedProxiesDetails";
import {
  OWN_LOAD_BALANCERS_OFF,
  OWN_LOAD_BALANCERS_ON,
  OWN_LOAD_BALANCERS_TITLE,
  TRUSTED_AUTOMATICALLY_DESCRIPTION,
  TRUSTED_AUTOMATICALLY_TITLE,
  TRUSTED_PROXIES_TEST_IDS,
} from "../SecurityTrustedProxiesCopy";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

// Its place in More settings: the key the folded header names it by.
export const TRUSTED_AUTOMATICALLY_CARD_KEY: string =
  getPageAnchorNameForTitle(TRUSTED_AUTOMATICALLY_TITLE) ||
  "trusted-automatically";

export interface ComponentProps {
  // Told whether the project's own load balancers are trusted, for the fold's chip.
  onChange?: ((isOn: boolean) => void) | undefined;
  // Told whether private addresses are trusted, for the fold's chip (#11389).
  onPrivateAddressesChange?: ((isOn: boolean) => void) | undefined;
}

/*
 * TRUSTED AUTOMATICALLY (#10546): what Security Events trusts as a proxy
 * without being listed, under More settings on Security Events >
 * Connections, beside Trusted Proxies.
 *
 * Its first switch is whether the project's own application load balancers
 * are trusted (Project.securityTrustOwnLoadBalancers, on unless turned
 * off), and beside it, under the load balancers, whether private addresses
 * are (Project.securityTrustPrivateAddresses, #11389: off for a new
 * project, left on for one from before it). Each saves when flipped, and a
 * Project Owner, a Project Admin or a Security Admin may flip it. Under
 * them, what is trusted and why (AutomaticTrustedProxiesDetails): the load
 * balancers found, the private ranges, what is never trusted even listed -
 * where load balancers that pass on what a client wrote connect from - the
 * edges the project connected, and what is never trusted automatically -
 * its hosts, nodes and probes.
 */
const SecurityTrustedAutomaticallyCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={projectId}
      column="securityTrustOwnLoadBalancers"
      cardTitle={TRUSTED_AUTOMATICALLY_TITLE}
      cardDescription={TRUSTED_AUTOMATICALLY_DESCRIPTION}
      cardId={TRUSTED_AUTOMATICALLY_CARD_KEY}
      title={OWN_LOAD_BALANCERS_TITLE}
      getDescription={(isOn: boolean): string => {
        return isOn ? OWN_LOAD_BALANCERS_ON : OWN_LOAD_BALANCERS_OFF;
      }}
      select={{ securityTrustPrivateAddresses: true }}
      onLoaded={(item: Project): void => {
        props.onPrivateAddressesChange?.(
          item.securityTrustPrivateAddresses === true,
        );
      }}
      getDetails={(item: Project, isOn: boolean): ReactElement => {
        return (
          <AutomaticTrustedProxiesDetails
            isOn={isOn}
            projectId={projectId}
            trustsPrivateAddresses={item.securityTrustPrivateAddresses === true}
            onPrivateAddressesChange={props.onPrivateAddressesChange}
          />
        );
      }}
      onChange={props.onChange}
      dataTestId={TRUSTED_PROXIES_TEST_IDS.ownLoadBalancersSwitch}
    />
  );
};

export default SecurityTrustedAutomaticallyCard;
