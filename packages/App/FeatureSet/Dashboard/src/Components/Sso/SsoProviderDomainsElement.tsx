import ProjectSsoCopy, { SSO_PROVIDER_DOMAINS_TEST_ID } from "./ProjectSsoCopy";
import { getVerifiedDomains } from "./SsoProviderDomains";
import Domain from "Common/Models/DatabaseModels/Domain";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A provider's Domains, in its row on Settings > SSO (#9918): the verified
 * domains "Sign in with SSO" finds it by, each as written. A domain it lists
 * that is not verified - renamed since it was picked, or listed through the
 * API - finds nobody, and says so. With no verified domain the provider is
 * found by nobody's email, and the cell says that, in the notice's tone:
 * something to look at, not something broken.
 */

export interface ComponentProps {
  domains: Array<Domain>;
}

const SsoProviderDomainsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const verified: Array<Domain> = getVerifiedDomains({
    domains: props.domains,
  });
  const notVerified: Array<Domain> = (props.domains || []).filter(
    (domain: Domain): boolean => {
      return domain.isVerified !== true;
    },
  );

  return (
    <div
      className="flex flex-wrap gap-1"
      data-testid={SSO_PROVIDER_DOMAINS_TEST_ID}
    >
      {verified.map((domain: Domain): ReactElement => {
        return (
          <Pill
            key={domain._id?.toString() || domain.domain?.toString()}
            text={domain.domain?.toString() || ""}
            isUserContent={true}
            tone={PillTone.Neutral}
            isDotHidden={true}
          />
        );
      })}
      {notVerified.map((domain: Domain): ReactElement => {
        return (
          <Pill
            key={domain._id?.toString() || domain.domain?.toString()}
            text={translator.translateTemplate(
              ProjectSsoCopy.domainNotVerified,
              { domain: domain.domain?.toString() || "" },
            )}
            isUserContent={true}
            tone={PillTone.Warning}
          />
        );
      })}
      {verified.length === 0 ? (
        <Pill text={ProjectSsoCopy.noVerifiedDomain} tone={PillTone.Warning} />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SsoProviderDomainsElement;
